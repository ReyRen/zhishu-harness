/**
 * Local stand-in for the model nginx gateway.
 * The packaged page is served from disk. API paths go straight to the LAN backends
 * named in the install directory's model-gateway.json.
 */

import { copyFileSync, createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { request as httpRequest, createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { extname, join, normalize, sep } from 'node:path'
import type { Duplex } from 'node:stream'

export const MODEL_SITE_PORT = 17321
export const MODEL_HARNESS_PORT = 3002
export const MODEL_SITE_ORIGIN = `http://127.0.0.1:${MODEL_SITE_PORT}`

export interface GatewayRoute {
  readonly prefix: string
  readonly target: string
  readonly replace?: string
  readonly host?: string
}

export interface GatewayConfig {
  readonly upstreams: readonly GatewayRoute[]
  readonly harness: { readonly target: string }
  /** Origin the LAN backends already allow. The page itself stays on 127.0.0.1. */
  readonly publicOrigin: string
}

const DEFAULT_PUBLIC_ORIGIN = 'https://172.18.127.67'

const STATIC_MOUNTS = [
  { prefix: '/flow/', directory: 'flow' },
  { prefix: '/prompt/', directory: 'prompt' },
] as const

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

/**
 * Longest prefix wins. A prefix matches the path itself or a path beneath it.
 * @param pathname - Request path without a query.
 * @param routes - Gateway routes.
 * @returns The selected route, if the path is an API.
 */
export function matchRoute(pathname: string, routes: readonly GatewayRoute[]): GatewayRoute | undefined {
  let selected: GatewayRoute | undefined
  for (const route of routes) {
    const boundary = route.prefix.endsWith('/') ? route.prefix : `${route.prefix}/`
    const matches = pathname === route.prefix || pathname.startsWith(boundary)
    if (!matches) continue
    if (selected === undefined || route.prefix.length > selected.prefix.length) selected = route
  }
  return selected
}

/**
 * Map a page path onto a backend URL. `replace` substitutes the matched prefix.
 * @param route - Selected upstream.
 * @param pathname - Request path.
 * @param search - Query, including the leading `?`, or empty.
 * @returns Absolute backend URL.
 */
export function resolveUpstream(route: GatewayRoute, pathname: string, search: string): URL {
  const target = new URL(route.target)
  if (target.username || target.password || (target.protocol !== 'http:' && target.protocol !== 'https:')) {
    throw new Error('desktop model gateway: upstream target must be an http(s) origin')
  }
  const rest = pathname.slice(route.prefix.length).replace(/^\/+/, '')
  const replacement = route.replace ?? route.prefix
  const base = replacement.endsWith('/') ? replacement : `${replacement}/`
  const path = rest === '' ? replacement : `${base}${rest}`
  return new URL(`${path.startsWith('/') ? path : `/${path}`}${search}`, target.origin)
}

/**
 * Copy the shipped default beside the install when the user has no file yet.
 * @param resourcesDir - Electron resources directory.
 * @returns Path of the editable gateway file.
 */
export function ensureGatewayConfig(resourcesDir: string): string {
  const destination = join(resourcesDir, 'model-gateway.json')
  if (!existsSync(destination)) {
    copyFileSync(join(resourcesDir, 'model-site', 'gateway.default.json'), destination)
  }
  return destination
}

/** @param resourcesDir - Electron resources directory. @returns The site directory when the packaged page is present. */
export function modelSiteDirectory(resourcesDir: string | undefined): string | undefined {
  if (resourcesDir === undefined || resourcesDir === '') return undefined
  const dir = join(resourcesDir, 'model-site')
  return existsSync(join(dir, 'app', 'index.html')) ? dir : undefined
}

let starting: Promise<void> | undefined

/**
 * Start the local page when a packaged build contains it. Development keeps using the model dev server.
 * @param resourcesDir - `process.resourcesPath`.
 */
export async function startPackagedModelSite(resourcesDir: string): Promise<void> {
  if (modelSiteDirectory(resourcesDir) === undefined) return
  starting ??= startModelGateway({
    siteDir: join(resourcesDir, 'model-site'),
    configPath: ensureGatewayConfig(resourcesDir),
  }).then(() => undefined).catch((error: unknown) => {
    starting = undefined
    throw error
  })
  await starting
}

/** @param file - Gateway JSON. @returns Parsed routes. */
export function readGatewayConfig(file: string): GatewayConfig {
  const parsed: unknown = JSON.parse(readFileSyncText(file))
  if (typeof parsed !== 'object' || parsed === null || !('upstreams' in parsed) || !('harness' in parsed)) {
    throw new Error('desktop model gateway: config must contain upstreams and harness')
  }
  const record = parsed as { upstreams: unknown; harness: unknown; publicOrigin?: unknown }
  if (!Array.isArray(record.upstreams)) throw new Error('desktop model gateway: upstreams must be a list')
  const upstreams = record.upstreams.map(readRoute)
  const harness = readRoute({ ...(record.harness as object), prefix: '/' })
  const configured = typeof record.publicOrigin === 'string' ? record.publicOrigin.trim() : ''
  const publicOrigin = configured === '' ? DEFAULT_PUBLIC_ORIGIN : new URL(configured).origin
  return { upstreams, harness: { target: harness.target }, publicOrigin }
}

/**
 * Serve the packaged model site and proxy its APIs.
 * @param options - Static root (`app`, `flow`, `prompt`) and the editable config.
 * @returns Local page origin and a closer.
 */
export async function startModelGateway(options: {
  siteDir: string
  configPath: string
}): Promise<{ origin: string; close(): Promise<void> }> {
  const config = readGatewayConfig(options.configPath)
  const site = await listen(MODEL_SITE_PORT, (request, response) => {
    try { handleSite(options.siteDir, config, request, response) } catch (error) {
      if (!response.headersSent) response.writeHead(502).end()
      else response.destroy(error instanceof Error ? error : undefined)
    }
  })
  site.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', MODEL_SITE_ORIGIN)
    const route = matchRoute(url.pathname, config.upstreams)
    if (route === undefined) { socket.destroy(); return }
    tunnel(route, url, config.publicOrigin, MODEL_SITE_ORIGIN, request, socket, head)
  })
  const harnessRoute: GatewayRoute = { prefix: '/', target: config.harness.target }
  const harnessOrigin = `http://127.0.0.1:${MODEL_HARNESS_PORT}`
  let harness: ReturnType<typeof createServer>
  try {
    harness = await listen(MODEL_HARNESS_PORT, (request, response) => {
      const url = new URL(request.url ?? '/', harnessOrigin)
      proxy(harnessRoute, url, config.publicOrigin, harnessOrigin, request, response)
    })
  } catch (error) {
    await closeServer(site)
    throw error
  }
  harness.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', harnessOrigin)
    tunnel(harnessRoute, url, config.publicOrigin, harnessOrigin, request, socket, head)
  })
  return {
    origin: MODEL_SITE_ORIGIN,
    close: () => Promise.all([closeServer(site), closeServer(harness)]).then(() => undefined),
  }
}

function readRoute(value: unknown): GatewayRoute {
  if (typeof value !== 'object' || value === null || !('target' in value)) {
    throw new Error('desktop model gateway: a route needs a target')
  }
  const route = value as { prefix?: unknown; target?: unknown; replace?: unknown; host?: unknown }
  const prefix = typeof route.prefix === 'string' && route.prefix.startsWith('/') ? route.prefix : '/'
  if (typeof route.target !== 'string' || route.target.trim() === '') throw new Error('desktop model gateway: empty target')
  return {
    prefix,
    target: route.target.trim(),
    ...typeof route.replace === 'string' ? { replace: route.replace } : {},
    ...typeof route.host === 'string' && route.host.trim() !== '' ? { host: route.host.trim() } : {},
  }
}

function handleSite(siteDir: string, config: GatewayConfig, request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? '/', MODEL_SITE_ORIGIN)
  const bareMount = url.pathname === '/flow' || url.pathname === '/prompt' ? url.pathname.slice(1) : undefined
  if (bareMount !== undefined && existsSync(join(siteDir, bareMount, 'index.html'))) {
    response.writeHead(302, { location: `${url.pathname}/` }).end()
    return
  }
  const route = matchRoute(url.pathname, config.upstreams)
  if (route !== undefined) { proxy(route, url, config.publicOrigin, MODEL_SITE_ORIGIN, request, response); return }
  const file = staticFile(siteDir, url.pathname)
  if (file === undefined) { response.writeHead(404).end(); return }
  response.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' })
  if (request.method === 'HEAD') { response.end(); return }
  createReadStream(file).pipe(response)
}

/** @returns A file inside the site, or the mount's index for an application route. */
function staticFile(siteDir: string, pathname: string): string | undefined {
  const mount = STATIC_MOUNTS.find(item => pathname.startsWith(item.prefix))
  const root = join(siteDir, mount?.directory ?? 'app')
  const relative = mount === undefined ? pathname : pathname.slice(mount.prefix.length - 1)
  const asset = safeJoin(root, relative)
  if (asset !== undefined && isFile(asset)) return asset
  if (isAsset(pathname)) return undefined
  const index = safeJoin(root, '/index.html')
  return index !== undefined && isFile(index) ? index : undefined
}

function safeJoin(root: string, pathname: string): string | undefined {
  let decoded: string
  try { decoded = decodeURIComponent(pathname) } catch { return undefined }
  const full = normalize(join(root, decoded.replace(/^\/+/, '')))
  const base = normalize(root)
  if (full !== base && !full.startsWith(base + sep)) return undefined
  return full
}

function isFile(path: string): boolean {
  try { return statSync(path).isFile() } catch { return false }
}

function isAsset(pathname: string): boolean {
  return extname(pathname) !== ''
}

function proxy(
  route: GatewayRoute, url: URL, publicOrigin: string, localOrigin: string,
  request: IncomingMessage, response: ServerResponse,
): void {
  let target: URL
  try { target = resolveUpstream(route, url.pathname, url.search) } catch {
    response.writeHead(502).end()
    return
  }
  const headers = forwardHeaders(request.headers, route, target, publicOrigin)
  const outbound = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
    method: request.method,
    headers,
  }, (incoming) => {
    const outgoing = rewriteResponseHeaders(incoming.headers, target.origin, localOrigin)
    response.writeHead(incoming.statusCode ?? 502, outgoing)
    incoming.pipe(response)
  })
  outbound.on('error', () => { if (!response.headersSent) response.writeHead(502).end() })
  request.pipe(outbound)
}

function tunnel(
  route: GatewayRoute, url: URL, publicOrigin: string, localOrigin: string,
  request: IncomingMessage, socket: Duplex, head: Buffer,
): void {
  let target: URL
  try { target = resolveUpstream(route, url.pathname, url.search) } catch { socket.destroy(); return }
  const headers = forwardHeaders(request.headers, route, target, publicOrigin)
  headers.connection = 'upgrade'
  headers.upgrade = request.headers.upgrade ?? 'websocket'
  const outbound = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, { method: request.method ?? 'GET', headers })
  outbound.on('upgrade', (incoming, upstream, upstreamHead) => {
    const lines = [`HTTP/1.1 ${String(incoming.statusCode ?? 101)} ${incoming.statusMessage ?? 'Switching Protocols'}`]
    for (const [name, value] of Object.entries(rewriteResponseHeaders(incoming.headers, target.origin, localOrigin))) {
      const values = Array.isArray(value) ? value : [value]
      for (const item of values) { if (item !== undefined) lines.push(`${name}: ${item}`) }
    }
    socket.write(`${lines.join('\r\n')}\r\n\r\n`)
    if (upstreamHead.length > 0) socket.write(upstreamHead)
    if (head.length > 0) upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  outbound.on('error', () => { socket.destroy() })
  outbound.end()
}

function forwardHeaders(
  headers: IncomingMessage['headers'],
  route: GatewayRoute,
  target: URL,
  publicOrigin: string,
): Record<string, string | string[]> {
  const next: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || isHop(name)) continue
    next[name] = value
  }
  const site = new URL(publicOrigin)
  next.host = route.host ?? site.host
  if (next.origin !== undefined) next.origin = site.origin
  if (next.referer !== undefined) {
    const referer = Array.isArray(next.referer) ? next.referer[0] ?? '' : next.referer
    try {
      const parsed = new URL(referer)
      next.referer = `${site.origin}${parsed.pathname}${parsed.search}`
    } catch {
      next.referer = `${site.origin}/`
    }
  }
  next['x-forwarded-proto'] = site.protocol.replace(':', '')
  next['x-forwarded-host'] = site.host
  void target
  return next
}

function rewriteResponseHeaders(
  headers: IncomingMessage['headers'],
  upstreamOrigin: string,
  localOrigin: string,
): Record<string, string | string[] | undefined> {
  const next: Record<string, string | string[] | undefined> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || isHop(name)) continue
    if (name.toLowerCase() === 'location') {
      const location = Array.isArray(value) ? value[0] : value
      next.location = location?.startsWith(upstreamOrigin) ? `${localOrigin}${location.slice(upstreamOrigin.length)}` : value
      continue
    }
    if (name.toLowerCase() === 'set-cookie') {
      const cookies = Array.isArray(value) ? value : [value]
      next['set-cookie'] = cookies.map(cookie => cookie.replace(/;\s*domain=[^;]*/gi, ''))
      continue
    }
    next[name] = value
  }
  return next
}

function isHop(name: string): boolean {
  return name.toLowerCase() === 'connection' || name.toLowerCase() === 'transfer-encoding'
    || name.toLowerCase() === 'keep-alive' || name.toLowerCase() === 'upgrade'
}

function listen(
  port: number, handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<ReturnType<typeof createServer>> {
  const server = createServer(handler)
  return new Promise((resolve, reject) => {
    const fail = (error: NodeJS.ErrnoException): void => {
      server.close()
      reject(error.code === 'EADDRINUSE' ? new Error(`desktop model site: 127.0.0.1:${String(port)} is already in use`) : error)
    }
    server.once('error', fail)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', fail)
      resolve(server)
    })
  })
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
}

function readFileSyncText(file: string): string {
  return readFileSync(file, 'utf8')
}

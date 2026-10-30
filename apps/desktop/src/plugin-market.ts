/** Local plugin catalog and npm registry shipped beside a packaged desktop build. */

import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { setTimeout as delay } from 'node:timers/promises'

/** Catalog the preinstalled market reads. Replaces the public plugin list. */
export const PLUGIN_MARKET_CATALOG = 'http://127.0.0.1:4874/plugins.json'
/** Loopback npm registry that serves the tarballs named by that catalog. */
export const PLUGIN_MARKET_REGISTRY = 'http://127.0.0.1:4873'

const REGISTRY_PORT = 4873
const CATALOG_PORT = 4874
const READY_TIMEOUT_MS = 30_000

/** One package the catalog offers and the registry must be able to install. */
export interface PluginMarketPackage {
  readonly name: string
  readonly version: string
}

/**
 * Point the Host at the loopback source and keep pnpm from fetching host peers there.
 * Applied after the login-shell merge so a shell profile cannot put peer installation back.
 * @param environment - Environment the Host would otherwise inherit.
 * @returns A new environment. The argument is left unchanged.
 */
export function pluginMarketHostEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...environment,
    DSHM_REGISTRY_URL: PLUGIN_MARKET_CATALOG,
    DSHM_NPM_MIRROR: PLUGIN_MARKET_REGISTRY,
    npm_config_auto_install_peers: 'false',
    pnpm_config_auto_install_peers: 'false',
    NPM_CONFIG_AUTO_INSTALL_PEERS: 'false',
    PNPM_CONFIG_AUTO_INSTALL_PEERS: 'false',
  }
}

/**
 * Locate the registry payload copied next to the installed app.
 * @param resourcesPath - Electron `process.resourcesPath`.
 * @returns The payload directory, or undefined when this build does not carry one.
 */
export function packagedPluginMarketRoot(resourcesPath: string | undefined): string | undefined {
  if (resourcesPath === undefined || resourcesPath === '') return undefined
  const root = join(resourcesPath, 'market-registry')
  const bin = join(root, 'node_modules', 'verdaccio', 'bin', 'verdaccio')
  return existsSync(bin) && existsSync(join(root, 'plugins.json')) ? root : undefined
}

/**
 * Read the packages a catalog file offers.
 * @param catalogPath - `plugins.json` shipped with the registry.
 * @returns Package name and version pairs, using `npm` when it is set.
 */
export function pluginMarketPackages(catalogPath: string): PluginMarketPackage[] {
  const parsed: unknown = JSON.parse(readFileSync(catalogPath, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || !('plugins' in parsed) || !Array.isArray(parsed.plugins)) {
    throw new Error('desktop plugin market: plugins.json has no plugins list')
  }
  return parsed.plugins.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) throw new Error('desktop plugin market: a catalog entry is not an object')
    const record = entry as { npm?: unknown; name?: unknown; version?: unknown }
    const name = typeof record.npm === 'string' && record.npm !== '' ? record.npm : record.name
    if (typeof name !== 'string' || name === '' || typeof record.version !== 'string' || record.version === '') {
      throw new Error('desktop plugin market: a catalog entry needs a name and a version')
    }
    return { name, version: record.version }
  })
}

/**
 * Read the workbench packages a catalog file offers. The display name is not a package name.
 * @param catalogPath - `workbenches.json` shipped with the registry.
 * @returns Package name and version pairs from each entry's `npm` field.
 */
export function workbenchMarketPackages(catalogPath: string): PluginMarketPackage[] {
  const parsed: unknown = JSON.parse(readFileSync(catalogPath, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || !('workbenches' in parsed) || !Array.isArray(parsed.workbenches)) {
    throw new Error('desktop plugin market: workbenches.json has no workbenches list')
  }
  return parsed.workbenches.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) throw new Error('desktop plugin market: a workbench entry is not an object')
    const record = entry as { npm?: unknown; version?: unknown }
    if (typeof record.npm !== 'string' || record.npm === '' || typeof record.version !== 'string' || record.version === '') {
      throw new Error('desktop plugin market: a workbench entry needs an npm package and a version')
    }
    return { name: record.npm, version: record.version }
  })
}

/**
 * Read every packed package in a tarball directory, including runtime dependencies that are not catalog entries.
 * @param tarballsDir - Directory of npm-pack tarballs.
 * @returns Package name and version pairs in filename order.
 */
export function tarballMarketPackages(tarballsDir: string): PluginMarketPackage[] {
  return readdirSync(tarballsDir).filter(filename => filename.endsWith('.tgz')).sort().map((filename) => {
    const manifest = readPackedManifest(readFileSync(join(tarballsDir, filename)))
    if (typeof manifest.name !== 'string' || manifest.name === '' || typeof manifest.version !== 'string' || manifest.version === '') {
      throw new Error(`desktop plugin market: ${filename} has no package name or version`)
    }
    return { name: manifest.name, version: manifest.version }
  })
}

/**
 * Copy any catalog tarball that is not already in Verdaccio's storage and write its metadata.
 * @param storageDir - Writable Verdaccio storage directory.
 * @param tarballsDir - Directory of npm-pack tarballs, with scoped names flattened to `scope-name-version.tgz`.
 * @param packages - Packages that must be installable after this call.
 */
export function seedPluginMarketStorage(
  storageDir: string, tarballsDir: string, packages: readonly PluginMarketPackage[],
): void {
  mkdirSync(storageDir, { recursive: true })
  for (const item of packages) {
    const filename = `${item.name.replace(/^@/u, '').replaceAll('/', '-')}-${item.version}.tgz`
    const packed = join(tarballsDir, filename)
    if (!existsSync(packed)) throw new Error(`desktop plugin market: missing ${packed}`)
    const bytes = readFileSync(packed)
    const manifest = readPackedManifest(bytes)
    if (manifest.name !== item.name || manifest.version !== item.version) {
      throw new Error(`desktop plugin market: ${packed} is ${String(manifest.name)}@${String(manifest.version)}`)
    }
    const directory = join(storageDir, item.name)
    mkdirSync(directory, { recursive: true })
    const stored = join(directory, filename)
    if (!existsSync(stored)) copyFileSync(packed, stored)
    writePackageDocument(join(directory, 'package.json'), item, bytes, manifest, filename)
  }
  writePackageIndex(storageDir, packages.map(item => item.name))
}

let starting: Promise<void> | undefined
let registry: ChildProcess | undefined
let ownsRegistry = false
let catalog: Server | undefined
let retired = false

function isRetired(): boolean { return retired }

/**
 * Start Verdaccio and the catalog when this process owns them. A source already
 * listening on the loopback ports is left running and reused.
 * @param root - Shipped `resources/market-registry` directory.
 * @param userData - Electron user-data directory; storage is written here.
 * @param node - Electron executable, started in Node mode.
 */
export function startPackagedPluginMarket(root: string, userData: string, node: string): Promise<void> {
  retired = false
  starting ??= runPackagedPluginMarket(root, userData, node).catch((error: unknown) => {
    stopPackagedPluginMarket()
    throw error
  })
  return starting
}

/** Stop the registry and catalog this process started. A reused listener is left running. */
export function stopPackagedPluginMarket(): void {
  retired = true
  catalog?.close()
  catalog = undefined
  if (ownsRegistry) registry?.kill()
  registry = undefined
  ownsRegistry = false
  starting = undefined
}

async function runPackagedPluginMarket(root: string, userData: string, node: string): Promise<void> {
  const state = join(userData, 'market-registry')
  const storage = join(state, 'storage')
  const tarballs = join(root, 'tarballs')
  const workbenches = join(root, 'workbenches.json')
  const packages = uniquePackages([
    ...pluginMarketPackages(join(root, 'plugins.json')),
    ...existsSync(workbenches) ? workbenchMarketPackages(workbenches) : [],
    ...tarballMarketPackages(tarballs),
  ])
  seedPluginMarketStorage(storage, tarballs, packages)
  const htpasswd = join(state, 'htpasswd')
  if (!existsSync(htpasswd)) writeFileSync(htpasswd, '')
  const config = join(state, 'verdaccio.yaml')
  writeFileSync(config, verdaccioConfig(storage, htpasswd))
  if (isRetired()) return
  if (!await probe(`${PLUGIN_MARKET_REGISTRY}/-/ping`)) {
    const bin = join(root, 'node_modules', 'verdaccio', 'bin', 'verdaccio')
    const child = spawn(node, [bin, '--config', config], {
      cwd: root,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    registry = child
    ownsRegistry = true
    const tail: string[] = []
    const remember = (chunk: Buffer): void => {
      tail.push(chunk.toString('utf8'))
      if (tail.join('').length > 4_000) tail.shift()
    }
    child.stdout.on('data', remember)
    child.stderr.on('data', remember)
    child.once('exit', (code, signal) => {
      if (!ownsRegistry || registry !== child) return
      console.error(`desktop plugin market: verdaccio exited ${String(code ?? signal)}`)
    })
    try {
      await waitForUrl(`${PLUGIN_MARKET_REGISTRY}/-/ping`, 'Verdaccio')
    } catch (error) {
      const detail = tail.join('').trim()
      throw new Error(`${error instanceof Error ? error.message : String(error)}${detail === '' ? '' : `\n${detail}`}`)
    }
  }
  if (isRetired()) return
  if (!await probe(PLUGIN_MARKET_CATALOG)) {
    const files: Record<string, Buffer> = {
      '/plugins.json': readFileSync(join(root, 'plugins.json')),
    }
    const workbenches = join(root, 'workbenches.json')
    if (existsSync(workbenches)) files['/workbenches.json'] = readFileSync(workbenches)
    catalog = await listenCatalog(files)
  }
}

function uniquePackages(packages: readonly PluginMarketPackage[]): PluginMarketPackage[] {
  const seen = new Set<string>()
  const unique: PluginMarketPackage[] = []
  for (const item of packages) {
    const key = `${item.name}@${item.version}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }
  return unique
}

function verdaccioConfig(storage: string, htpasswd: string): string {
  return [
    `storage: ${yamlString(storage)}`,
    'auth:',
    '  htpasswd:',
    `    file: ${yamlString(htpasswd)}`,
    '    max_users: 1000',
    'uplinks: {}',
    'packages:',
    '  "**":',
    '    access: $all',
    '    publish: $all',
    '    unpublish: $all',
    'log:',
    '  type: stdout',
    '  format: pretty',
    '  level: warn',
    `listen: 127.0.0.1:${String(REGISTRY_PORT)}`,
    'security:',
    '  api:',
    '    legacy: true',
    '',
  ].join('\n')
}

function yamlString(value: string): string {
  return JSON.stringify(value.replaceAll('\\', '/'))
}

function writePackageDocument(
  path: string, item: PluginMarketPackage, bytes: Buffer, manifest: Record<string, unknown>, filename: string,
): void {
  const shasum = createHash('sha1').update(bytes).digest('hex')
  const now = new Date().toISOString()
  const existing: Record<string, unknown> = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    : {}
  const versions = record(existing.versions)
  versions[item.version] = {
    ...manifest,
    _id: `${item.name}@${item.version}`,
    dist: {
      shasum,
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      tarball: `${PLUGIN_MARKET_REGISTRY}/${item.name}/-/${filename}`,
    },
  }
  const time = record(existing.time)
  const document = {
    name: item.name,
    versions,
    time: { ...time, modified: now, created: typeof time.created === 'string' ? time.created : now, [item.version]: now },
    users: record(existing.users),
    'dist-tags': { ...record(existing['dist-tags']), latest: item.version },
    _uplinks: record(existing._uplinks),
    _distfiles: record(existing._distfiles),
    _attachments: { ...record(existing._attachments), [filename]: { shasum, version: item.version } },
    _rev: typeof existing._rev === 'string' ? existing._rev : '1-0',
    _id: item.name,
  }
  writeFileSync(path, JSON.stringify(document))
}

function writePackageIndex(storageDir: string, names: readonly string[]): void {
  const path = join(storageDir, '.verdaccio-db.json')
  const existing: { list?: unknown; secret?: unknown } = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8')) as { list?: unknown; secret?: unknown }
    : {}
  const secret = typeof existing.secret === 'string' && existing.secret.length === 32
    ? existing.secret
    : randomBytes(16).toString('hex')
  const list = new Set([
    ...Array.isArray(existing.list) ? existing.list.filter((item): item is string => typeof item === 'string') : [],
    ...names,
  ])
  writeFileSync(path, JSON.stringify({ list: [...list], secret }))
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value as Record<string, unknown> } : {}
}

function readPackedManifest(bytes: Buffer): Record<string, unknown> {
  const raw = gunzipSync(bytes)
  let offset = 0
  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const name = field(header, 0, 100)
    const prefix = field(header, 345, 500)
    const path = prefix === '' ? name : `${prefix}/${name}`
    const size = Number.parseInt(field(header, 124, 136), 8)
    offset += 512
    if (!Number.isFinite(size) || size < 0) throw new Error('desktop plugin market: tarball header has no size')
    if (path === 'package/package.json') {
      return JSON.parse(raw.subarray(offset, offset + size).toString('utf8')) as Record<string, unknown>
    }
    offset += Math.ceil(size / 512) * 512
  }
  throw new Error('desktop plugin market: tarball has no package/package.json')
}

function field(header: Buffer, start: number, end: number): string {
  return header.subarray(start, end).toString('utf8').replace(/\0.*$/su, '').trim()
}

function listenCatalog(files: Readonly<Record<string, Buffer>>): Promise<Server> {
  const server = createServer((request, response) => {
    const body = files[request.url?.split('?')[0] ?? '']
    if (body === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    response.end(body)
  })
  return new Promise((resolve, reject) => {
    const fail = (error: NodeJS.ErrnoException): void => {
      server.close()
      reject(error.code === 'EADDRINUSE'
        ? new Error(`desktop plugin market: 127.0.0.1:${String(CATALOG_PORT)} is already in use`)
        : error)
    }
    server.once('error', fail)
    server.listen(CATALOG_PORT, '127.0.0.1', () => {
      server.off('error', fail)
      resolve(server)
    })
  })
}

async function probe(url: string): Promise<boolean> {
  try {
    const response = await fetch(url)
    return response.ok
  } catch {
    return false
  }
}

async function waitForUrl(url: string, label: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  let last = 'not started'
  while (Date.now() < deadline) {
    if (await probe(url)) return
    last = 'connection failed'
    await delay(250)
  }
  throw new Error(`desktop plugin market: ${label} did not answer at ${url}: ${last}`)
}

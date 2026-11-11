/** Per-runtime WeKnora SSO credentials and the private upstream-plugin transport. */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const BODY_LIMIT = 70_000
const TOOL_BODY_LIMIT = 1024 * 1024
const routes = new Map([
  ['GET', /^\/(?:knowledge-bases|shared-knowledge-bases|knowledge\/search|knowledge\/[^/]+|chunks\/[^/]+)$/u],
  ['POST', /^\/(?:knowledge-search|sessions|knowledge-chat\/[^/]+|agent-chat\/[^/]+)$/u],
])

/** A stable failure code, safe to return without backend credentials or bodies. */
export class KnowledgeAuthError extends Error {
  constructor(code, status) {
    super(code)
    this.code = code
    this.status = status
  }
}

function credential(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 32768
}

function expiry(token) {
  let claims
  try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) }
  catch { throw new KnowledgeAuthError('invalid_backend_response', 502) }
  if (!Number.isFinite(claims.exp)) throw new KnowledgeAuthError('invalid_backend_response', 502)
  // This only schedules refresh. WeKnora validates the signature and permissions.
  return claims.exp * 1000
}

function apiURL(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('WeKnora baseUrl must be an HTTP(S) URL without credentials, query or fragment')
  }
  return url.href.replace(/\/$/u, '')
}

async function bodyBytes(request, limit) {
  const parts = []
  let size = 0
  for await (const part of request) {
    size += part.length
    if (size > limit) throw new KnowledgeAuthError('request_too_large', 413)
    parts.push(part)
  }
  return Buffer.concat(parts)
}

/** Create an in-memory user credential owner; no secret is written to DSH_HOME. */
export function createKnowledgeRuntime({ baseUrl, platformUserID, tenantId, requestTimeoutMs = 30_000, chatTimeoutMs = 300_000 }, request = fetch) {
  const backend = apiURL(baseUrl)
  const capability = randomBytes(32).toString('hex')
  const lifetime = new AbortController()
  let credentials, refreshing, generation = 0

  function clear() { generation++; credentials = undefined; refreshing = undefined }
  function state() { return { mode: 'sso', authenticated: credentials !== undefined } }

  async function exchange(path, body, signal) {
    let response
    try {
      response = await request(`${backend}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), redirect: 'manual',
        signal: AbortSignal.any([lifetime.signal, signal, AbortSignal.timeout(requestTimeoutMs)]),
      })
    } catch { throw new KnowledgeAuthError('knowledge_backend_unavailable', 502) }
    if (!response.ok) {
      await response.body?.cancel()
      throw new KnowledgeAuthError(response.status === 401 || response.status === 403
        ? 'knowledge_login_required' : 'knowledge_authentication_failed', response.status === 401 || response.status === 403 ? 401 : 502)
    }
    let result
    try { result = JSON.parse(await bodyBytes(Readable.fromWeb(response.body), TOOL_BODY_LIMIT)) }
    catch { throw new KnowledgeAuthError('invalid_backend_response', 502) }
    const token = path === '/auth/refresh' ? result?.access_token : result?.token
    if (result?.success !== true || !credential(token) || !credential(result.refresh_token)) {
      throw new KnowledgeAuthError('invalid_backend_response', 502)
    }
    return { token, refresh: result.refresh_token, expires: expiry(token) }
  }

  async function signIn(ticket, signal = lifetime.signal) {
    if (!ticket || !credential(ticket.access_token) || (ticket.refresh_token !== undefined && !credential(ticket.refresh_token))) {
      throw new KnowledgeAuthError('invalid_login_ticket', 400)
    }
    if (ticket.user_id !== undefined && (typeof ticket.user_id !== 'string' || ticket.user_id.length > 128)) {
      throw new KnowledgeAuthError('invalid_login_ticket', 400)
    }
    clear()
    const revision = generation
    const next = await exchange('/auth/platform-sso/exchange', {
      access_token: ticket.access_token, refresh_token: ticket.refresh_token,
      expected_user_id: platformUserID || ticket.user_id,
    }, signal)
    if (generation !== revision || lifetime.signal.aborted) throw new KnowledgeAuthError('login_superseded', 409)
    credentials = next
    return state()
  }

  async function authorization(signal) {
    if (!credentials) throw new KnowledgeAuthError('knowledge_login_required', 401)
    if (credentials.expires > Date.now() + 30_000) return credentials.token
    if (!refreshing) {
      const previous = credentials, revision = generation
      refreshing = exchange('/auth/refresh', { refreshToken: previous.refresh }, signal).then(next => {
        if (generation !== revision || lifetime.signal.aborted) throw new KnowledgeAuthError('login_superseded', 409)
        credentials = next
        return next.token
      }).catch(error => {
        if (generation === revision) clear()
        throw error
      }).finally(() => { if (generation === revision) refreshing = undefined })
    }
    return refreshing
  }

  const server = createServer((incoming, outgoing) => {
    const controller = new AbortController()
    outgoing.once('close', () => controller.abort())
    void (async () => {
      const presented = incoming.headers['x-api-key']
      if (typeof presented !== 'string' || !/^[a-f0-9]{64}$/u.test(presented)
        || !timingSafeEqual(Buffer.from(presented), Buffer.from(capability))) {
        throw new KnowledgeAuthError('unauthorized_bridge_request', 401)
      }
      const url = new URL(incoming.url, 'http://127.0.0.1')
      const path = url.pathname.replace(/^\/api\/v1/u, '')
      if (!url.pathname.startsWith('/api/v1/') || !routes.get(incoming.method)?.test(path)) {
        throw new KnowledgeAuthError('unsupported_knowledge_operation', 404)
      }
      const body = incoming.method === 'POST' ? await bodyBytes(incoming, TOOL_BODY_LIMIT) : undefined
      const token = await authorization(controller.signal)
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: incoming.headers.accept || 'application/json' }
      const requestID = incoming.headers['x-request-id']
      if (typeof requestID === 'string' && /^harness\.[A-Za-z0-9._-]{1,240}$/u.test(requestID)) headers['X-Request-ID'] = requestID
      if (tenantId) headers['X-Tenant-ID'] = tenantId
      let response
      try {
        response = await request(`${backend}${path}${url.search}`, {
          method: incoming.method, body, headers, redirect: 'manual',
          signal: AbortSignal.any([lifetime.signal, controller.signal, AbortSignal.timeout(chatTimeoutMs)]),
        })
      } catch { throw new KnowledgeAuthError('knowledge_backend_unavailable', 502) }
      if (response.status === 401 && credentials?.token === token) clear()
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel()
        throw new KnowledgeAuthError('unexpected_backend_redirect', 502)
      }
      outgoing.writeHead(response.status, { 'content-type': response.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' })
      if (response.body) await pipeline(Readable.fromWeb(response.body), outgoing)
      else outgoing.end()
    })().catch(error => {
      if (outgoing.destroyed) return
      if (outgoing.headersSent) { outgoing.destroy(); return }
      const safe = error instanceof KnowledgeAuthError ? error : new KnowledgeAuthError('knowledge_request_failed', 502)
      outgoing.writeHead(safe.status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      outgoing.end(JSON.stringify({ error: safe.code }))
    })
  })

  return {
    state, signIn, clear,
    async handle(request) {
      try {
        if (request.method === 'GET') return Response.json(state(), { headers: { 'cache-control': 'no-store' } })
        if (!request.body) throw new KnowledgeAuthError('invalid_login_ticket', 400)
        const raw = await bodyBytes(Readable.fromWeb(request.body), BODY_LIMIT)
        let body
        try { body = JSON.parse(raw) }
        catch { throw new KnowledgeAuthError('invalid_login_ticket', 400) }
        if (body?.action === 'logout') { clear(); return Response.json(state()) }
        return Response.json(await signIn(body, request.signal), { headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        const safe = error instanceof KnowledgeAuthError ? error : new KnowledgeAuthError('knowledge_authentication_failed', 502)
        return Response.json({ error: safe.code }, { status: safe.status, headers: { 'cache-control': 'no-store' } })
      }
    },
    async listen() {
      if (lifetime.signal.aborted) throw new KnowledgeAuthError('knowledge_runtime_closed', 503)
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
      })
      if (lifetime.signal.aborted) {
        if (server.listening) await new Promise(resolve => server.close(resolve))
        throw new KnowledgeAuthError('knowledge_runtime_closed', 503)
      }
      return { baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`, apiKey: capability }
    },
    async close() {
      clear()
      lifetime.abort()
      server.closeAllConnections()
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    },
  }
}

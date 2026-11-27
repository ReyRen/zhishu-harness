/** Real HTTP checks for platform identity binding, credential refresh and revocation. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { resolveConfig, WeknoraClient } from '@wxg-prc-cpg/dsh-weknora'
import { createKnowledgeRuntime } from '../../overlay/weknora/runtime.mjs'
import { apply } from '../../overlay/weknora/index.mjs'
import { knowledgeImageHandler } from '../../overlay/weknora/media.mjs'

function token(user, expires = Date.now() + 3600_000) {
  return `fixture.${Buffer.from(JSON.stringify({ sub: user, exp: Math.floor(expires / 1000) })).toString('base64url')}.signature`
}

async function fixture(t, options = {}) {
  const calls = []
  const backend = createServer((req, res) => {
    void (async () => {
      let raw = ''
      for await (const part of req) raw += part
      const body = raw ? JSON.parse(raw) : undefined
      calls.push({ path: req.url, method: req.method, authorization: req.headers.authorization, apiKey: req.headers['x-api-key'], requestID: req.headers['x-request-id'], body })
      const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
      if (req.url === '/api/v1/auth/platform-sso/exchange') {
        const user = body.access_token.replace('platform-', '')
        if (!['369', '506'].includes(user) || body.expected_user_id !== user) { send(401, { error: 'wrong user' }); return }
        if (options.beforeLogin) await options.beforeLogin()
        send(200, { success: true, token: token(user, options.expired ? Date.now() - 1000 : undefined), refresh_token: `refresh-${user}` })
      } else if (req.url === '/api/v1/auth/refresh') {
        if (options.refreshDenied) { send(401, { error: 'revoked session' }); return }
        send(200, { success: true, access_token: token(body.refreshToken.replace('refresh-', '')), refresh_token: body.refreshToken })
      } else if (options.denied) send(options.denied, { error: 'permission denied' })
      else if (options.image && req.url.startsWith('/api/v1/knowledge-bases/kb-test/files?')) {
        res.writeHead(200, { 'content-type': options.imageType || 'image/png' })
        res.end(Buffer.from('iVBORw0KGgo=', 'base64'))
      }
      else if (options.redirect) { res.writeHead(302, { location: options.redirect }); res.end() }
      else send(200, { data: [{ id: 'kb-test' }] })
    })().catch(error => res.destroy(error))
  })
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    backend.closeAllConnections()
    await new Promise(resolve => backend.close(resolve))
  })
  const baseUrl = `http://127.0.0.1:${backend.address().port}/api/v1`
  const runtime = createKnowledgeRuntime({ baseUrl, platformUserID: '369' })
  t.after(() => runtime.close())
  const transport = await runtime.listen()
  const request = (path = '/knowledge-bases', init = {}) => fetch(transport.baseUrl + path, {
    ...init, headers: { 'X-API-Key': transport.apiKey, ...init.headers },
  })
  return { runtime, transport, calls, request }
}

test('the backend verifies the Worker user; a claimed ticket user cannot change it', async t => {
  const f = await fixture(t)
  await assert.rejects(f.runtime.signIn({ access_token: 'platform-506', user_id: '369' }), { code: 'knowledge_login_required' })
  assert.equal(f.calls[0].body.expected_user_id, '369')
  assert.equal(f.runtime.state().authenticated, false)
  assert.equal((await f.request()).status, 401)
  assert.equal(f.calls.length, 1)
})

test('authorized tools use Bearer credentials without forwarding private bridge keys', async t => {
  const f = await fixture(t)
  await f.runtime.signIn({ access_token: 'platform-369', user_id: '369' })
  assert.deepEqual(f.runtime.state(), { mode: 'sso', authenticated: true })
  const response = await f.request()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { data: [{ id: 'kb-test' }] })
  const claims = JSON.parse(Buffer.from(f.calls[1].authorization.split('.')[1], 'base64url').toString())
  assert.equal(claims.sub, '369')
  assert.ok(claims.exp * 1000 > Date.now())
  assert.equal(f.calls[1].apiKey, undefined)
  assert.equal(JSON.stringify(f.runtime.state()).includes('fixture.'), false)
  assert.equal(JSON.stringify(f.runtime.state()).includes('refresh-'), false)
})

test('trusted retrieval correlation reaches existing backend request logs without credentials', async t => {
  const f = await fixture(t)
  await f.runtime.signIn({ access_token: 'platform-369' })
  const requestID = 'harness.369.session-hash.call-hash.fixture'
  const response = await f.request('/knowledge-bases', { headers: { 'X-Request-ID': requestID } })
  await response.arrayBuffer()
  assert.equal(f.calls.at(-1).requestID, requestID)
  const ignored = await f.request('/knowledge-bases', { headers: { 'X-Request-ID': 'untrusted-correlation' } })
  await ignored.arrayBuffer()
  assert.equal(f.calls.at(-1).requestID, undefined)
})

test('untrusted loopback calls and unsupported paths never reach the backend', async t => {
  const f = await fixture(t)
  assert.equal((await fetch(f.transport.baseUrl + '/knowledge-bases')).status, 401)
  assert.equal((await f.request('/knowledge-bases', { headers: { 'X-API-Key': 'z'.repeat(64) } })).status, 401)
  assert.equal((await f.request('/auth/me')).status, 404)
  assert.equal((await f.request('/shared-knowledge-bases', { method: 'POST' })).status, 404)
  assert.equal((await f.request('/../knowledge-bases')).status, 404)
  assert.equal(f.calls.length, 0)
})

test('shared catalog reads use the same authenticated user and never forward the bridge secret', async t => {
  const f = await fixture(t)
  assert.equal((await f.request('/shared-knowledge-bases')).status, 401)
  await f.runtime.signIn({ access_token: 'platform-369' })
  const response = await f.request('/shared-knowledge-bases')
  assert.equal(response.status, 200)
  await response.arrayBuffer()
  const request = f.calls.at(-1)
  assert.equal(request.path, '/api/v1/shared-knowledge-bases')
  assert.equal(request.apiKey, undefined)
  assert.equal(JSON.parse(Buffer.from(request.authorization.split('.')[1], 'base64url')).sub, '369')
})

test('the SSO bridge forwards Wiki search and page reads with user credentials', async t => {
  const f = await fixture(t)
  const path = '/knowledgebase/kb-test/wiki/pages/concept/cedar'
  await f.runtime.signIn({ access_token: 'platform-369' })
  const query = JSON.stringify({ query: 'Cedar', knowledge_base_ids: ['kb-test'] })
  for (const response of [await f.request('/wiki-search', { method: 'POST', body: query }), await f.request(path)]) {
    assert.equal(response.status, 200)
    await response.arrayBuffer()
  }
  assert.deepEqual(f.calls.slice(1).map(call => [call.method, call.path]), [
    ['POST', '/api/v1/wiki-search'], ['GET', '/api/v1' + path],
  ])
  assert.ok(f.calls.slice(1).every(call => call.authorization?.startsWith('Bearer ') && call.apiKey === undefined))
  assert.equal((await f.request(path, { method: 'PUT', body: '{}' })).status, 404)
  assert.equal((await f.request(path, { method: 'DELETE' })).status, 404)
  assert.equal(f.calls.length, 3)
})

test('the packaged client retries only the scoped resource-URL refusal', async t => {
  const calls = []
  const backend = createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture')
    const mode = url.searchParams.get('resource_urls')
    calls.push(mode)
    if (mode === 'public') {
      response.writeHead(403, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'Scoped keys cannot use resource_urls=public' }))
    } else {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'kb-scoped' }] }))
    }
  })
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    backend.closeAllConnections()
    await new Promise(resolve => backend.close(resolve))
  })
  const config = resolveConfig({ baseUrl: `http://127.0.0.1:${backend.address().port}/api/v1`, apiKey: 'scoped-fixture' })
  assert.equal(config.resourceUrls, 'handle')
  const client = new WeknoraClient({ ...config, resourceUrls: 'public' })
  const signal = AbortSignal.timeout(5000)
  assert.equal((await client.listKnowledgeBases(signal))[0].id, 'kb-scoped')
  await client.listKnowledgeBases(signal)
  assert.deepEqual(calls, ['public', null, null])
})

test('expired credentials refresh once across concurrent retrievals', async t => {
  const f = await fixture(t, { expired: true })
  await f.runtime.signIn({ access_token: 'platform-369' })
  const responses = await Promise.all([f.request(), f.request()])
  assert.deepEqual(responses.map(r => r.status), [200, 200])
  await Promise.all(responses.map(r => r.arrayBuffer()))
  assert.equal(f.calls.filter(c => c.path === '/api/v1/auth/refresh').length, 1)
  assert.ok(f.calls.slice(2).every(c => c.authorization?.startsWith('Bearer ')))
})

test('knowledge images require current SSO and do not leak bytes, credentials or paths after revocation', async t => {
  const options = { image: true }
  const f = await fixture(t, options)
  const handle = knowledgeImageHandler({ ...f.transport, requestTimeoutMs: 2000 }, ['kb-test'])
  const request = (id = 'kb-test', ref = 'resource://Abcdef0000000000000000') => new Request(
    'https://host/dsh/api/zhishu-knowledge/image?' + new URLSearchParams({ kb: id, ref, load: '1' }),
    { headers: { 'X-Tenant-ID': '999', 'Authorization': 'Bearer untrusted' } })
  assert.equal((await handle(request())).status, 401)
  assert.equal(f.calls.length, 0)
  await f.runtime.signIn({ access_token: 'platform-369' })
  assert.equal((await handle(request('foreign'))).status, 403)
  assert.equal((await handle(request('kb-test', '/mnt/other-user/private.png'))).status, 400)
  assert.equal(f.calls.length, 1)
  const success = await handle(request())
  assert.equal(success.status, 200)
  assert.equal(success.headers.get('content-type'), 'image/png')
  assert.equal(success.headers.get('cache-control'), 'private, no-store')
  assert.equal(success.headers.get('cross-origin-resource-policy'), 'same-origin')
  assert.deepEqual(Buffer.from(await success.arrayBuffer()), Buffer.from('iVBORw0KGgo=', 'base64'))
  assert.equal(JSON.parse(Buffer.from(f.calls.at(-1).authorization.split('.')[1], 'base64url')).sub, '369')
  assert.equal(f.calls.at(-1).apiKey, undefined)
  assert.equal(new URL(f.calls.at(-1).path, 'http://fixture').searchParams.get('file_path'), 'resource://Abcdef0000000000000000')
  options.imageType = 'text/html'
  assert.equal((await handle(request())).status, 415)
  options.denied = 403
  const revoked = await handle(request())
  assert.equal(revoked.status, 403)
  assert.equal(await revoked.text(), '')
})

test('a revoked refresh clears authentication and never calls retrieval', async t => {
  const f = await fixture(t, { expired: true, refreshDenied: true })
  await f.runtime.signIn({ access_token: 'platform-369' })
  const response = await f.request()
  assert.equal(response.status, 401)
  await response.arrayBuffer()
  assert.equal(f.runtime.state().authenticated, false)
  assert.equal(f.calls.length, 2)
})

for (const status of [401, 403]) test(`backend ${status} is preserved without privileged fallback or POST retry`, async t => {
  const f = await fixture(t, { denied: status })
  await f.runtime.signIn({ access_token: 'platform-369' })
  const response = await f.request('/knowledge-chat/test', { method: 'POST', body: '{}' })
  assert.equal(response.status, status)
  await response.arrayBuffer()
  assert.equal(f.runtime.state().authenticated, status !== 401)
  assert.equal(f.calls.filter(c => c.path === '/api/v1/knowledge-chat/test').length, 1)
})

test('logout prevents a pending login from restoring credentials', async t => {
  let release, entered
  const waiting = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const f = await fixture(t, { beforeLogin: () => { entered(); return waiting } })
  const login = f.runtime.signIn({ access_token: 'platform-369' })
  await started
  f.runtime.clear()
  release()
  await assert.rejects(login, { code: 'login_superseded' })
  assert.equal(f.runtime.state().authenticated, false)
})

test('backend redirects cannot carry user credentials to another origin', async t => {
  const f = await fixture(t, { redirect: 'http://127.0.0.1:1/secret' })
  await f.runtime.signIn({ access_token: 'platform-369' })
  const response = await f.request()
  assert.equal(response.status, 502)
  assert.equal(response.headers.has('location'), false)
  assert.deepEqual(await response.json(), { error: 'unexpected_backend_redirect' })
})

test('authenticated handoff responses never expose local credentials; invalid requests fail closed', async t => {
  const f = await fixture(t)
  const make = body => new Request('http://host/api/zhishu-knowledge/auth', { method: 'POST', body })
  assert.equal((await f.runtime.handle(make(undefined))).status, 400)
  assert.equal((await f.runtime.handle(make('{'))).status, 400)
  assert.equal((await f.runtime.handle(make(JSON.stringify({ access_token: 'x'.repeat(71000) })))).status, 413)
  const signedIn = await f.runtime.handle(make(JSON.stringify({ access_token: 'platform-369' })))
  assert.deepEqual(await signedIn.json(), { mode: 'sso', authenticated: true })
  const signedOut = await f.runtime.handle(make(JSON.stringify({ action: 'logout' })))
  assert.deepEqual(await signedOut.json(), { mode: 'sso', authenticated: false })
  assert.equal((await f.request()).status, 401)
})

test('deployment URLs reject embedded credentials, queries and non-HTTP transports', () => {
  for (const baseUrl of ['file:///tmp/x', 'https://user:secret@host/api/v1', 'http://host/api/v1?token=x', 'http://host/#x']) {
    assert.throws(() => createKnowledgeRuntime({ baseUrl }))
  }
})

test('closing during startup prevents a late listener from retaining credentials or sockets', async () => {
  const runtime = createKnowledgeRuntime({ baseUrl: 'http://127.0.0.1:1/api/v1' })
  const pending = runtime.listen()
  await runtime.close()
  await assert.rejects(pending, { code: 'knowledge_runtime_closed' })
  await assert.rejects(runtime.listen(), { code: 'knowledge_runtime_closed' })
  await runtime.close()
})

test('profile configuration cannot replace the Worker identity or select a shared API key', async t => {
  const previous = process.env.DSH_PLATFORM_USER_ID
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_PLATFORM_USER_ID
    else process.env.DSH_PLATFORM_USER_ID = previous
  })
  process.env.DSH_PLATFORM_USER_ID = '369'
  await assert.rejects(apply({}, { apiKey: 'shared-key', platformUserID: '506' }), /require SSO/u)
  process.env.DSH_PLATFORM_USER_ID = '../invalid'
  await assert.rejects(apply({}, {}), /Worker-assigned/u)
})

test('a Worker runtime without a trusted environment identity refuses to activate', async t => {
  const oldUser = process.env.DSH_PLATFORM_USER_ID, oldAuthority = process.env.DSH_PUBLIC_AUTHORITY
  t.after(() => {
    if (oldUser === undefined) delete process.env.DSH_PLATFORM_USER_ID
    else process.env.DSH_PLATFORM_USER_ID = oldUser
    if (oldAuthority === undefined) delete process.env.DSH_PUBLIC_AUTHORITY
    else process.env.DSH_PUBLIC_AUTHORITY = oldAuthority
  })
  delete process.env.DSH_PLATFORM_USER_ID
  process.env.DSH_PUBLIC_AUTHORITY = 'dsh-u-test:3081'
  await assert.rejects(apply({}, { platformUserID: '506' }), /Worker must provide/u)
})

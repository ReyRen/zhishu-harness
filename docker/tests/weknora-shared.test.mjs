/** Real HTTP coverage for shared discovery, selected tools and revoked access. */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { apply } from '../../overlay/weknora/index.mjs'

async function fixture(t) {
  const state = { shared: true, status: 200, malformed: false }
  const calls = [], routes = new Map(), tools = new Map(), cleanups = []
  const backend = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url, 'http://localhost').pathname
      let raw = ''
      for await (const part of request) raw += part
      const body = raw ? JSON.parse(raw) : undefined
      calls.push({ path, body })
      assert.equal(request.headers['x-api-key'], 'shared-catalog-fixture')
      const send = (status, data) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(data)) }
      if (path === '/api/v1/knowledge-bases') send(200, { data: [{ id: 'own', name: 'Own' }] })
      else if (path === '/api/v1/shared-knowledge-bases') send(state.status, state.malformed ? { success: true } : { data: state.shared ? [
        { knowledge_base: { id: 'shared', name: 'Shared' }, permission: 'viewer' },
        { knowledge_base: { id: 'shared', name: 'Duplicate share' }, permission: 'viewer' },
        { knowledge_base: { id: 'own', name: 'Duplicate own' }, permission: 'viewer' },
      ] : [] })
      else if (path === '/api/v1/knowledge-search') send(200, { data: [] })
      else send(404, { error: 'Unknown fixture route' })
    })().catch(error => response.destroy(error))
  })
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
    backend.closeAllConnections()
    await new Promise(resolve => backend.close(resolve))
  })
  backend.listen(0, '127.0.0.1')
  await once(backend, 'listening')
  const session = { choice: ['own', 'shared'] }
  await apply({
    effect(setup) { const cleanup = setup(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    commands: { register() { return () => {} } },
    sessionProjections: { async register() { return { stateOf: s => ({ selection: { knowledgeBaseIds: s.choice } }) } }, onChanged() { return () => {} } },
    connection: { fetch: { register(route) { routes.set(route.path, route); return () => {} } } },
  }, { baseUrl: `http://127.0.0.1:${backend.address().port}`, apiKey: 'shared-catalog-fixture' })
  const signal = AbortSignal.timeout(5000)
  const catalog = () => routes.get('/api/zhishu-knowledge/catalog').fetch(new Request('http://localhost/api/zhishu-knowledge/catalog', { signal }))
  const execute = (name, args = {}) => tools.get('weknora_' + name).execute(args, { agent: { id: 'session', session }, callId: 'call', signal })
  return { state, calls, session, catalog, execute }
}

test('the shipped catalog and selected tool list include own and shared knowledge once each', async t => {
  const f = await fixture(t)
  const response = await f.catalog()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { knowledgeBases: [{ id: 'own', name: 'Own' }, { id: 'shared', name: 'Shared' }] })
  const result = await f.execute('list_knowledge_bases')
  const text = JSON.stringify(result)
  assert.ok(text.includes('Shared'), 'the selected shared KB reaches the actual tool output')
  assert.equal(text.includes('Duplicate share'), false)
  f.session.choice = ['shared']
  await f.execute('search', { query: 'policy' })
  assert.deepEqual(f.calls.find(call => call.path.endsWith('/knowledge-search')).body.knowledge_base_ids, ['shared'])
})

test('revoked or unavailable shared catalogs stop retrieval rather than retaining stale access', async t => {
  const f = await fixture(t)
  f.state.shared = false
  await assert.rejects(f.execute('search', { query: 'policy' }), { code: 'knowledge_scope_denied' })
  assert.equal(f.calls.some(call => call.path.endsWith('/knowledge-search')), false)
  f.state.status = 503
  assert.equal((await f.catalog()).status, 503)
  f.state.status = 200; f.state.malformed = true
  assert.equal((await f.catalog()).status, 502)
})

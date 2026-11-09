/** Selection recovery and actual HTTP retrieval scope, including adversarial model arguments. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { createTools, resolveConfig } from '@wxg-prc-cpg/dsh-weknora'
import { knowledgeRequestID, selectedArguments, SelectedKnowledgeClient, selectionProjection } from '../../overlay/weknora/selection.mjs'

const event = (type, data) => ({ type, data })
const run = (id, args) => event('command/run', { commandId: id, name: 'knowledge', args })
const done = (id, kind = 'success') => event('command/done', { commandId: id, kind })

test('new conversations default off; successful human selections recover from checkpoint plus suffix', () => {
  const initial = selectionProjection.init()
  assert.equal(initial.selection.knowledgeBaseId, null)
  const prefix = [run('a', ' kb-a'), done('a'), event('user/message', {})]
  const suffix = [run('b', ' kb-b'), done('b', 'error'), run('c', ' off'), done('c')]
  const checkpoint = selectionProjection.stateSchema.parse(prefix.reduce(selectionProjection.apply, initial))
  const restored = suffix.reduce(selectionProjection.apply, checkpoint)
  const replayed = [...prefix, ...suffix].reduce(selectionProjection.apply, selectionProjection.init())
  assert.deepEqual(restored, replayed)
  assert.equal(restored.selection.knowledgeBaseId, null)
  assert.equal(checkpoint.selection.knowledgeBaseId, 'kb-a')
  assert.equal(selectionProjection.apply(checkpoint, event('tool/result', {})), checkpoint)
  assert.equal(selectionProjection.init().selection.knowledgeBaseId, null, 'another conversation inherits no selection')
})

test('concurrent command completions preserve each validated selection and failed changes keep the previous scope', () => {
  const events = [run('a', 'kb-a'), run('b', 'kb-b'), done('a'), done('b', 'error')]
  const state = events.reduce(selectionProjection.apply, selectionProjection.init())
  assert.equal(state.selection.knowledgeBaseId, 'kb-a')
  assert.deepEqual(state.pending, {})
  const unchanged = [run('c', 'kb-a'), done('c')].reduce(selectionProjection.apply, state)
  assert.equal(unchanged.selection, state.selection)
  assert.equal([run('d', 'invalid/id'), done('d')].reduce(selectionProjection.apply, state), state)
})

async function fixture(t) {
  const calls = []
  const server = createServer((request, response) => {
    void (async () => {
      let raw = ''
      for await (const part of request) raw += part
      const path = new URL(request.url, 'http://localhost').pathname
      const body = raw ? JSON.parse(raw) : undefined
      calls.push({ path, body, requestID: request.headers['x-request-id'] })
      const send = data => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(data)) }
      if (path === '/api/v1/knowledge-bases') send({ data: [{ id: 'kb-a', name: 'Selected' }, { id: 'kb-b', name: 'Other' }] })
      else if (path.startsWith('/api/v1/knowledge/')) send({ data: { id: path.split('/').at(-1), knowledge_base_id: path.endsWith('doc-a') ? 'kb-a' : 'kb-b' } })
      else if (path.startsWith('/api/v1/chunks/')) send({ data: [{ content: 'Selected evidence', chunk_index: 0 }], total: 1 })
      else if (path === '/api/v1/knowledge-search') send({ data: [{ id: 'chunk-a', knowledge_id: 'doc-a', content: 'Selected evidence' }] })
      else throw new Error('Unexpected backend operation: '+path)
    })().catch(error => response.destroy(error))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const config = resolveConfig({ baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`, apiKey: 'fixture-key', knowledgeBaseIds: ['kb-a'] })
  const requestID = knowledgeRequestID('369', 'session-a', 'call-a')
  const client = new SelectedKnowledgeClient(config, 'kb-a', requestID)
  return { client, config, calls, requestID, signal: AbortSignal.timeout(10_000) }
}

test('actual upstream search always names the selected KB and never uses the unscoped title endpoint', async t => {
  const f = await fixture(t)
  const search = createTools(f.client, f.config).find(tool => tool.name === 'weknora_search')
  const result = await search.execute({ query: 'Selected evidence' }, { signal: f.signal })
  assert.deepEqual(result.knowledge_base_ids, ['kb-a'])
  assert.equal(result.count, 1)
  assert.deepEqual(f.calls.map(call => call.path), ['/api/v1/knowledge-search'])
  assert.deepEqual(f.calls[0].body.knowledge_base_ids, ['kb-a'])
  assert.equal(f.calls[0].requestID, f.requestID)
  assert.match(f.requestID, /^harness\.369\.[a-f0-9]{16}\.[a-f0-9]{16}\.[a-f0-9-]+$/u)
})

test('listed KBs, explicit document searches and chunk reads cannot expose another selected scope', async t => {
  const f = await fixture(t)
  assert.deepEqual((await f.client.listKnowledgeBases(f.signal)).map(base => base.id), ['kb-a'])
  await assert.rejects(f.client.search({ query: 'x', knowledgeBaseIds: ['kb-b'], knowledgeIds: [] }, f.signal), { code: 'knowledge_scope_denied' })
  await assert.rejects(f.client.search({ query: 'x', knowledgeBaseIds: [], knowledgeIds: ['doc-b'] }, f.signal), { code: 'knowledge_scope_denied' })
  await assert.rejects(f.client.listChunks({ knowledgeId: 'doc-b', page: 2, pageSize: 10 }, f.signal), { code: 'knowledge_scope_denied' })
  assert.equal(f.calls.some(call => call.path.startsWith('/api/v1/chunks/')), false)
  assert.equal(f.calls.some(call => call.path === '/api/v1/knowledge-search'), false)
  const allowed = await f.client.listChunks({ knowledgeId: 'doc-a', page: 1, pageSize: 10 }, f.signal)
  assert.equal(allowed.chunks[0].content, 'Selected evidence')
})

test('model arguments cannot broaden scope or reuse a backend conversation with unrelated history', () => {
  for (const args of [{ knowledge_base_ids: ['kb-b'] }, { session_id: 'old-session' }, { agent_id: 'custom' }, { web_search: true }]) {
    assert.throws(() => selectedArguments(args, 'kb-a'), { code: 'knowledge_scope_denied' })
  }
  assert.deepEqual(selectedArguments({ query: 'question', knowledge_base_ids: ['kb-a'] }, 'kb-a'), { query: 'question', knowledge_base_ids: ['kb-a'] })
})

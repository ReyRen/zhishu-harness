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
  assert.deepEqual(initial.selection.knowledgeBaseIds, [])
  const prefix = [run('a', ' kb-a'), done('a'), event('user/message', {})]
  const suffix = [run('b', ' kb-b'), done('b', 'error'), run('c', ' off'), done('c')]
  const checkpoint = selectionProjection.stateSchema.parse(prefix.reduce(selectionProjection.apply, initial))
  const restored = suffix.reduce(selectionProjection.apply, checkpoint)
  const replayed = [...prefix, ...suffix].reduce(selectionProjection.apply, selectionProjection.init())
  assert.deepEqual(restored, replayed)
  assert.deepEqual(restored.selection.knowledgeBaseIds, [])
  assert.deepEqual(checkpoint.selection.knowledgeBaseIds, ['kb-a'])
  assert.equal(selectionProjection.apply(checkpoint, event('tool/result', {})), checkpoint)
  assert.deepEqual(selectionProjection.init().selection.knowledgeBaseIds, [], 'another conversation inherits no selection')
})

test('concurrent command completions preserve each validated selection and failed changes keep the previous scope', () => {
  const events = [run('a', 'kb-a'), run('b', 'kb-b'), done('a'), done('b', 'error')]
  const state = events.reduce(selectionProjection.apply, selectionProjection.init())
  assert.deepEqual(state.selection.knowledgeBaseIds, ['kb-a'])
  assert.deepEqual(state.pending, {})
  const unchanged = [run('c', 'kb-a'), done('c')].reduce(selectionProjection.apply, state)
  assert.equal(unchanged.selection, state.selection)
  assert.equal([run('d', 'invalid/id'), done('d')].reduce(selectionProjection.apply, state), state)
})

test('multiple choices are canonical and historical single choices survive checkpoint suffix replay', () => {
  assert.equal(selectionProjection.stateVersion, 2)
  const prefix = [run('old', ' kb-a'), done('old')]
  const events = [run('multi', ' kb-b kb-a kb-b'), done('multi')]
  const checkpoint = selectionProjection.stateSchema.parse(prefix.reduce(selectionProjection.apply, selectionProjection.init()))
  const state = events.reduce(selectionProjection.apply, checkpoint)
  assert.deepEqual(state.selection.knowledgeBaseIds, ['kb-a', 'kb-b'])
  assert.deepEqual(state, [...prefix, ...events].reduce(selectionProjection.apply, selectionProjection.init()))
  assert.equal([run('same', 'kb-b kb-a'), done('same')].reduce(selectionProjection.apply, state).selection, state.selection)
  assert.deepEqual([run('remove', 'kb-b'), done('remove')].reduce(selectionProjection.apply, state).selection.knowledgeBaseIds, ['kb-b'])
})

async function fixture(t, ids = ['kb-a']) {
  const calls = []
  const server = createServer((request, response) => {
    void (async () => {
      let raw = ''
      for await (const part of request) raw += part
      const path = new URL(request.url, 'http://localhost').pathname
      const body = raw ? JSON.parse(raw) : undefined
      calls.push({ path, body, requestID: request.headers['x-request-id'] })
      const send = data => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(data)) }
      if (path === '/api/v1/knowledge-bases') send({ data: [{ id: 'kb-a', name: 'Selected' }, { id: 'kb-b', name: 'Other' }, { id: 'kb-c', name: 'Unselected' }] })
      else if (path.startsWith('/api/v1/knowledge/')) send({ data: { id: path.split('/').at(-1), knowledge_base_id: 'kb-'+path.slice(-1) } })
      else if (path.startsWith('/api/v1/chunks/')) send({ data: [{ content: 'Selected evidence', chunk_index: 0 }], total: 1 })
      else if (path === '/api/v1/knowledge-search') send({ data: [{ id: 'chunk-a', knowledge_id: 'doc-a', content: 'Selected evidence' }] })
      else if (path === '/api/v1/sessions') send({ data: { id: 'scoped-chat' } })
      else if (path === '/api/v1/knowledge-chat/scoped-chat') {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end('data: {"response_type":"answer","content":"Scoped answer"}\n\ndata: {"response_type":"complete"}\n\n')
      }
      else throw new Error('Unexpected backend operation: '+path)
    })().catch(error => response.destroy(error))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const config = resolveConfig({ baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`, apiKey: 'fixture-key', knowledgeBaseIds: ids })
  const requestID = knowledgeRequestID('369', 'session-a', 'call-a')
  const client = new SelectedKnowledgeClient(config, ids, requestID)
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
    assert.throws(() => selectedArguments(args, ['kb-a']), { code: 'knowledge_scope_denied' })
  }
  assert.deepEqual(selectedArguments({ query: 'question', knowledge_base_ids: ['kb-a'] }, ['kb-a']), { query: 'question', knowledge_base_ids: ['kb-a'] })
})

test('multi-KB search sends the selected union and rejects documents outside it', async t => {
  const f = await fixture(t, ['kb-a', 'kb-b'])
  assert.deepEqual((await f.client.listKnowledgeBases(f.signal)).map(base => base.id), ['kb-a', 'kb-b'])
  const search = createTools(f.client, f.config).find(tool => tool.name === 'weknora_search')
  const args = selectedArguments({ query: 'Selected evidence', knowledge_base_ids: ['kb-a'] }, ['kb-a', 'kb-b'])
  const result = await search.execute(args, { signal: f.signal })
  assert.deepEqual(result.knowledge_base_ids, ['kb-a', 'kb-b'])
  assert.deepEqual(f.calls.find(call => call.path === '/api/v1/knowledge-search').body.knowledge_base_ids, ['kb-a', 'kb-b'])
  await f.client.listChunks({ knowledgeId: 'doc-b', page: 1, pageSize: 10 }, f.signal)
  await assert.rejects(f.client.listChunks({ knowledgeId: 'doc-c', page: 1, pageSize: 10 }, f.signal), { code: 'knowledge_scope_denied' })
  assert.throws(() => selectedArguments({ knowledge_base_ids: ['kb-c'] }, ['kb-a', 'kb-b']), { code: 'knowledge_scope_denied' })
})

test('multi-KB ask creates a fresh RAG session and sends the full selected union', async t => {
  const f = await fixture(t, ['kb-a', 'kb-b'])
  const ask = createTools(f.client, f.config).find(tool => tool.name === 'weknora_ask')
  const result = await ask.execute({ query: 'Summarize selected knowledge' }, { signal: f.signal })
  assert.equal(result.answer, 'Scoped answer')
  const chat = f.calls.find(call => call.path === '/api/v1/knowledge-chat/scoped-chat')
  assert.deepEqual(chat.body.knowledge_base_ids, ['kb-a', 'kb-b'])
  assert.equal(chat.body.agent_id, undefined)
  assert.equal(f.calls.filter(call => call.path === '/api/v1/sessions').length, 1)
})

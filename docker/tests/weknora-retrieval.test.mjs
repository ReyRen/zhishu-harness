/** Actual HTTP evidence for automatic selected retrieval, document discovery and failures. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { apply } from '../../overlay/weknora/index.mjs'

async function fixture(t, options = {}) {
  const state = { revoked: false, filtered: false, broken: false, beforeDocuments: undefined }
  const calls = [], tools = new Map(), cleanups = []
  let provider, preStep, notify
  const backend = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url, 'http://localhost')
      let raw = ''
      for await (const part of request) raw += part
      const body = raw ? JSON.parse(raw) : undefined
      calls.push({ path: url.pathname, body, query: Object.fromEntries(url.searchParams) })
      const send = (status, data) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(data)) }
      if (url.pathname === '/api/v1/knowledge-bases') return send(200, { data: [{ id: 'own', name: 'Owned' }] })
      if (url.pathname === '/api/v1/shared-knowledge-bases') return send(200, { data: state.revoked ? [] : [{ knowledge_base: { id: 'shared', name: 'Shared' } }] })
      const catalog = /^\/api\/v1\/knowledge-bases\/(own|shared)\/knowledge$/u.exec(url.pathname)
      if (catalog) {
        await state.beforeDocuments?.()
        if (response.destroyed) return
        if (state.broken) return send(503, { error: 'fixture unavailable' })
        const page = Number(url.searchParams.get('page')), size = Number(url.searchParams.get('page_size'))
        const documents = options.empty ? [] : Array.from({ length: 3 }, (_, index) => ({
          id: `${catalog[1]}-doc-${index}`, knowledge_base_id: catalog[1], title: `Document ${index}`,
          parse_status: index === 2 ? 'processing' : 'completed', description: `Summary ${index}`,
        }))
        return send(200, { data: documents.slice((page - 1) * size, page * size), total: documents.length, page, page_size: size })
      }
      if (url.pathname === '/api/v1/knowledge-search') return send(200, { data: state.filtered ? [] : [{
        knowledge_id: 'own-doc-0', knowledge_title: 'Backup policy', content: 'Backups last 30 days.', chunk_index: 0,
      }], meta: { rerank: { outcome: state.filtered ? 'all_below_threshold' : 'selected', candidate_count: 13,
        result_count: state.filtered ? 0 : 1, top_score: state.filtered ? 0.09 : 0.95, effective_threshold: 0.2 } } })
      return send(404, { error: 'fixture route not found' })
    })().catch(error => response.destroy(error))
  })
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
    backend.closeAllConnections()
    await new Promise(resolve => backend.close(resolve))
  })
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve))
  const session = { id: 'selected-retrieval-session', choice: options.ids ?? [] }
  const agent = { id: session.id, session }
  await apply({
    effect(setup) { const dispose = setup(); if (dispose) cleanups.push(dispose) },
    on(name, listener) { if (name === 'agent/pre-step') preStep = listener; return () => {} },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    systemPrompt: { context(value) { provider = value; return () => {} } },
    commands: { register() { return () => {} } },
    sessionProjections: {
      async register() { return { stateOf: value => ({ selection: { knowledgeBaseIds: value.choice } }) } },
      onChanged(listener) { notify = listener; return () => {} },
    },
    connection: { fetch: { register() { return () => {} } } },
  }, { baseUrl: `http://127.0.0.1:${backend.address().port}/api/v1`, apiKey: 'retrieval-fixture', maxResults: 2, maxChunkChars: 64 })
  const context = () => provider.text({ agent })
  const snapshot = () => JSON.parse(context().split('\n').at(-1))
  const prepare = (question, signal = AbortSignal.timeout(5000)) => preStep({ agent, turn: 1, step: 1, signal },
    async () => ({ kind: 'enter', messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: question }] }] }))
  const execute = (name, args) => tools.get('weknora_' + name).execute(args, { agent, callId: 'call', signal: AbortSignal.timeout(5000) })
  return { state, calls, session, context, snapshot, prepare, execute, tools,
    unload: () => { for (const cleanup of [...cleanups].reverse()) cleanup() },
    notify: () => notify(session, 'zhishuKnowledge') }
}

test('unselected questions make no backend calls; ordinary selected questions receive bounded evidence before the model', async t => {
  const f = await fixture(t)
  await f.prepare('How long are backups retained?')
  assert.equal(f.calls.length, 0)
  assert.equal(f.context(), '')
  f.session.choice = ['own', 'shared']
  await f.prepare('How long are backups retained?')
  const result = f.snapshot()
  assert.equal(result.status, 'retrieved')
  assert.deepEqual(result.selected_knowledge_base_ids, ['own', 'shared'])
  assert.equal(result.passages[0].content, 'Backups last 30 days.')
  assert.equal(result.overview.documents.length, 2)
  assert.equal(result.overview.total_documents, 6)
  assert.equal(result.overview.complete, false)
  assert.equal(result.overview.knowledge_bases[1].has_more, true)
  assert.deepEqual(f.calls.find(row => row.path.endsWith('/knowledge-search')).body.knowledge_base_ids, ['own', 'shared'])
  assert.equal(f.calls.some(row => row.path === '/api/v1/knowledge/search'), false)
  f.session.choice = []
  assert.equal(f.context(), '', 'clearing removes cached context without erasing history')
})

test('a whole-library summary sees real documents even when reranking rejects every generic-query candidate', async t => {
  const f = await fixture(t, { ids: ['own'] })
  f.state.filtered = true
  await f.prepare('Summarize this knowledge base.')
  const snapshot = f.snapshot()
  assert.equal(snapshot.overview.total_documents, 3)
  assert.equal(snapshot.overview.documents[0].summary, 'Summary 0')
  assert.equal(snapshot.retrieval.status, 'filtered')
  assert.equal(snapshot.retrieval.candidate_count, 13)
  assert.equal(snapshot.passages.length, 0)
  const later = await f.execute('overview', { knowledge_base_id: 'own', page: 2 })
  assert.equal(later.documents[0].knowledge_id, 'own-doc-2')
  assert.equal(later.documents[0].parse_status, 'processing')
  assert.equal(later.knowledge_bases[0].has_more, false)
  const search = await f.execute('search', { query: 'backups' })
  assert.equal(search.retrieval.status, 'filtered')
  const rendered = f.tools.get('weknora_search').output.render({}, search)
  assert.match(rendered[0].text, /not an empty-library result/u)
})

test('empty and whitespace queries fail with typed argument errors before retrieval is dispatched', async t => {
  const f = await fixture(t, { ids: ['own'] })
  for (const query of ['', '  ', null]) {
    await assert.rejects(f.execute('search', { query }), { name: 'ToolArgsError', code: 'INVALID_ARGS' })
  }
  assert.equal(f.calls.some(row => row.path.endsWith('/knowledge-search')), false)
  await assert.rejects(f.execute('overview', { knowledge_base_id: 'foreign' }), { code: 'knowledge_scope_denied' })
  assert.equal(f.calls.some(row => row.path.includes('/foreign/')), false)
})

test('revocation and unavailable catalogs replace previous evidence with a failure instead of an empty-library assertion', async t => {
  const f = await fixture(t, { ids: ['shared'] })
  await f.prepare('Find the policy.')
  f.state.revoked = true
  const before = f.calls.length
  await f.prepare('What does it say?')
  assert.equal(f.snapshot().status, 'retrieval_failed')
  assert.equal(f.snapshot().code, 'knowledge_scope_denied')
  assert.equal(f.calls.slice(before).some(row => row.path.endsWith('/knowledge-search') || row.path.endsWith('/knowledge')), false)
  f.state.revoked = false; f.state.broken = true
  await f.prepare('Find the policy.')
  assert.equal(f.snapshot().status, 'retrieval_failed')
  assert.equal(f.snapshot().code, 'knowledge_backend_unavailable')
  assert.equal(f.snapshot().passages, undefined)
})

test('changing scope while document discovery is pending cancels the request without a late context write', async t => {
  const f = await fixture(t, { ids: ['own'] })
  const entered = Promise.withResolvers(), release = Promise.withResolvers()
  f.state.beforeDocuments = async () => { entered.resolve(); await release.promise }
  const pending = f.prepare('Find the policy.')
  const cancelled = assert.rejects(pending, { name: 'AbortError' })
  try {
    await entered.promise
    f.session.choice = ['shared']; f.notify()
    await cancelled
  } finally { release.resolve(); await Promise.allSettled([pending]) }
  assert.equal(f.snapshot().status, 'not_retrieved')
  assert.equal(f.calls.some(row => row.path.endsWith('/knowledge-search')), false)
})

test('only an authenticated zero-document catalog establishes an empty library', async t => {
  const f = await fixture(t, { ids: ['own'], empty: true })
  await f.prepare('Summarize this library.')
  assert.equal(f.snapshot().overview.total_documents, 0)
  assert.equal(f.snapshot().overview.complete, true)
  assert.equal(f.calls.some(row => row.path.endsWith('/knowledge-search')), false)
})

test('unloading automatic retrieval aborts pending discovery before it can publish model context', async t => {
  const f = await fixture(t, { ids: ['own'] })
  const entered = Promise.withResolvers(), release = Promise.withResolvers()
  f.state.beforeDocuments = async () => { entered.resolve(); await release.promise }
  const pending = f.prepare('Find the policy.')
  const cancelled = assert.rejects(pending, { name: 'AbortError' })
  try {
    await entered.promise
    f.unload()
    await cancelled
  } finally { release.resolve(); await Promise.allSettled([pending]) }
  assert.equal(f.snapshot().status, 'not_retrieved')
  assert.equal(f.calls.some(row => row.path.endsWith('/knowledge-search')), false)
})

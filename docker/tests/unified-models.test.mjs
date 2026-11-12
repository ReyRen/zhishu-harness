import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadLegacySelections } from '../../overlay/models/migration.mjs'
import { describeModel, migrateSelection, modelRequest, modelStream, parseModelID, UnifiedModelsAdapter, UNIFIED_PROVIDER } from '../../overlay/weknora/models.mjs'
import { createKnowledgeRuntime } from '../../overlay/weknora/runtime.mjs'

const row = {
  id: 'qwen-chat', name: 'Qwen3.5-122B-A10B-GPTQ-Int4', display_name: '内网对话模型', type: 'KnowledgeQA', status: 'active',
  tenant_id: 10000, is_builtin: true, updated_at: '2026-11-11T09:00:00Z',
  parameters: { context_window: 200000, max_output_tokens: 8192 },
  capabilities: { api: 'openai-completions', input: ['text'], reasoning: true, thinking_levels: ['off', 'auto'] },
}

const ctx = { get() { return undefined } }
function response(chunks, end = true) {
  return new Response(chunks.map(chunk => `event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`).join('') + (end ? 'event: end\ndata: {}\n\n' : ''),
    { headers: { 'content-type': 'text/event-stream' } })
}

test('the unified registry preserves workspace scope and exact context and reasoning capabilities', () => {
  const info = describeModel(row, '10004')
  assert.equal(info.id, '10004:qwen-chat', 'a globally visible built-in must use the caller workspace')
  assert.deepEqual(info.context, { contextWindow: 200000 })
  assert.equal(info.defaultMaxTokens, 8192)
  assert.equal(info.reasoning.efforts[0].id, 'off')
  assert.deepEqual(parseModelID(info.id), { tenant: '10004', id: 'qwen-chat' })
  assert.throws(() => parseModelID('10004:../../private'))
  assert.throws(() => describeModel({ ...row, type: 'Embedding' }, '10004'))
})

test('model calls keep tool JSON and model-bound reasoning metadata without using model keys', async () => {
  const options = { provider: UNIFIED_PROVIDER, model: '10004:qwen-chat', maxTokens: 4096,
    messages: [
      { role: 'assistant', content: [{ type: 'reasoning', text: 'thought' }, { type: 'tool-call', id: 'call1', name: 'read', arguments: '{"path":"/report"}' }],
        source: { kind: 'model', provider: UNIFIED_PROVIDER, model: '10004:qwen-chat', replayState: { response: { kind: 'zhishu-model', modelName: row.name, protocol: row.capabilities.api, reasoning_signature: 'signed', tools: { call1: { signature: 'tool-signature' } } } } } },
      { role: 'tool', source: { kind: 'tool', callId: 'call1' }, content: [{ type: 'text', text: 'file text' }] },
    ], tools: [{ name: 'read', description: 'Read', parameters: { type: 'object' } }],
  }
  const payload = await modelRequest(options, { ...row, parameters: { ...row.parameters, api_key: 'never-export' } }, ctx)
  assert.equal(payload.model_revision, row.updated_at)
  assert.equal(payload.messages[0].reasoning_signature, 'signed')
  assert.equal(payload.messages[0].tool_calls[0].function.arguments, '{"path":"/report"}')
  assert.equal(payload.messages[1].tool_call_id, 'call1')
  assert.equal(payload.messages[1].name, 'read')
  assert.equal(payload.options.tools[0].function.name, 'read')
  assert.ok(!JSON.stringify(payload).includes('never-export'))
  const other = await modelRequest({ ...options, model: '10004:other-model' }, row, ctx)
  assert.equal(other.messages[0].reasoning_signature, undefined, 'opaque state cannot cross model identities')
})

test('vision requests use retained attachment bytes and text-only models retain an explicit image placeholder', async () => {
  let reads = 0
  const attachment = { attachmentId: 'image-1', name: 'diagram.png', mediaType: 'image/png', width: 2, height: 1, bytes: 3 }
  const attachments = { imageHostPath: () => undefined, async readImageRequest(ref, target) {
    reads++; assert.equal(ref, attachment); assert.equal(target.maxBytes, 3)
    return { width: 2, height: 1, mediaType: 'image/png', data: Uint8Array.of(1, 2, 3) }
  } }
  const options = { provider: UNIFIED_PROVIDER, model: '10004:qwen-chat', messages: [{ role: 'user', content: [{ type: 'image', attachment }] }] }
  const requestCtx = { get(name) { return name === 'attachments' ? attachments : undefined } }
  const vision = await modelRequest(options, { ...row, parameters: { supports_vision: true } }, requestCtx)
  assert.equal(reads, 1)
  assert.equal(vision.messages[0].multi_content.at(-1).image_url.url, 'data:image/png;base64,AQID')
  const text = await modelRequest(options, row, requestCtx)
  assert.equal(reads, 1)
  assert.equal(text.messages[0].multi_content, undefined)
  assert.match(text.messages[0].content, /image/iu)
})

test('migration does not replace a still-registered third-party adapter', async () => {
  const active = { provider: 'my-plugin', model: 'custom' }
  const adapter = new UnifiedModelsAdapter({ get(name) { return name === 'llm' ? { listProviders: () => [{ id: active.provider }] } : undefined } },
    { state: () => ({ authenticated: true }), fetchModels() { assert.fail('an active adapter needs no registry migration') } })
  await adapter.migrateAgent({ model: { current: () => active, select() { assert.fail('active selection must remain unchanged') } } })
})

test('streaming preserves usage, full tool arguments and replay artifacts after intermediate done markers', async () => {
  const chunks = [
    { response_type: 'thinking', content: 'reason', done: true },
    { response_type: 'answer', content: 'answer' },
    { response_type: 'answer', done: true, finish_reason: 'tool_calls', tool_calls: [{ id: 'call1', function: { name: 'read', arguments: '{"path":"report.txt"}' }, provider_metadata: { signed: true } }] },
    { response_type: 'answer', done: true, finish_reason: 'tool_calls', tool_calls: [{ id: 'call1', function: { name: 'read', arguments: '{"path":"report.txt"}' }, provider_metadata: { signed: true } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cache_read_tokens: 30, cache_write_tokens: 10 }, data: { reasoning_signature: 'signed' } },
  ]
  const output = await Array.fromAsync(modelStream(response(chunks), row))
  assert.deepEqual(output.find(chunk => chunk.type === 'usage').usage, { inputTokens: 60, outputTokens: 20, totalTokens: 120, cacheReadTokens: 30, cacheWriteTokens: 10 })
  assert.equal(output.at(-1).reason.kind, 'tool-calls')
  assert.equal(output.at(-1).replayState.response.reasoning_signature, 'signed')
  assert.equal(output.filter(chunk => chunk.type === 'tool-call-delta').length, 1)
  assert.equal(output.find(chunk => chunk.type === 'tool-call-delta').argumentsDelta, '{"path":"report.txt"}')
})

test('a truncated stream and upstream errors cannot settle as a successful response', async () => {
  await assert.rejects(Array.fromAsync(modelStream(response([{ response_type: 'answer', content: 'partial' }], false), row)), { code: 'MODEL_STREAM_INTERRUPTED' })
  await assert.rejects(Array.fromAsync(modelStream(response([{ response_type: 'error', content: 'upstream-secret', done: true }]), row)), { code: 'MODEL_STREAM_INTERRUPTED' })
  await assert.rejects(Array.fromAsync(modelStream(new Response('{}', { status: 409 }), row)), { code: 'MODEL_CONFIGURATION_CHANGED' })
})

test('a prepared request keeps its captured model revision even when the catalog changes', async () => {
  let current = row, submitted
  const runtime = { state: () => ({ authenticated: true }), async fetchModels(path, init, tenant) {
    assert.equal(tenant, '10004')
    if (path.endsWith('/harness-chat')) {
      submitted = JSON.parse(init.body)
      return new Response('{}', { status: 409 })
    }
    return Response.json({ success: true, data: current })
  } }
  const adapter = new UnifiedModelsAdapter(ctx, runtime)
  const prepared = await adapter.prepareCall(UNIFIED_PROVIDER, '10004:qwen-chat')
  current = { ...row, updated_at: '2026-11-11T09:01:00Z' }
  await assert.rejects(Array.fromAsync(prepared.stream({ provider: UNIFIED_PROVIDER, model: '10004:qwen-chat', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] })), { code: 'MODEL_CONFIGURATION_CHANGED' })
  assert.equal(submitted.model_revision, row.updated_at)
})

test('existing selections move to stable model ids only when the registry has an unambiguous match', () => {
  const old = { provider: 'ds-utcs', model: row.name }
  assert.deepEqual(migrateSelection(old, [row], '10004'), { provider: UNIFIED_PROVIDER, model: '10004:qwen-chat' })
  assert.equal(migrateSelection(old, [row, { ...row, id: 'another-qwen' }], '10004'), undefined)
  assert.equal(migrateSelection({ provider: UNIFIED_PROVIDER, model: '10004:chosen' }, [row], '10004'), undefined)
})

test('an owner-verified import map keeps the exact legacy route when model names collide', async t => {
  const root = await mkdtemp(join(tmpdir(), 'unified-model-map-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'map.json')
  const models = [{ provider: 'ds-utcs', model: row.name, tenantID: 10004, id: 'imported-qwen' }]
  await writeFile(path, JSON.stringify({ version: 1, platformUserID: '369', models }))
  const mapping = await loadLegacySelections('369', path)
  await assert.rejects(loadLegacySelections('568', path), /does not belong/u)
  await writeFile(path, JSON.stringify({ version: 1, platformUserID: '369', models: [...models, ...models] }))
  await assert.rejects(loadLegacySelections('369', path), /duplicate/u)
  await writeFile(path, JSON.stringify({ version: 1, platformUserID: '369', models: [{ ...models[0], id: '../outside' }] }))
  await assert.rejects(loadLegacySelections('369', path), /invalid selection/u)
  const before = { provider: 'ds-utcs', model: row.name }
  const imported = { ...row, id: 'imported-qwen' }
  assert.deepEqual(migrateSelection(before, [row, imported], '10004', mapping), { provider: UNIFIED_PROVIDER, model: '10004:imported-qwen' })
  assert.equal(migrateSelection(before, [row], '10004', mapping), undefined, 'deletion must not substitute a different same-name model')
  const adapter = new UnifiedModelsAdapter(ctx, { async fetchModels(_path, _init, tenant) {
    assert.equal(tenant, '10004')
    return Response.json({ success: true, data: [row, imported] })
  } }, mapping)
  adapter.tenant = '10002'
  assert.deepEqual(await adapter.selectionFor(before), { provider: UNIFIED_PROVIDER, model: '10004:imported-qwen' })
})

test('the model picker uses the user directory independently of the active business space', async () => {
  const runtime = { state: () => ({ authenticated: true }), async fetchModels(path, _init, tenant) {
    return Response.json({ success: true, data: path === '/auth/me'
      ? { user: { tenant_id: 10004 }, tenant: { id: 10002, name: 'Team' } }
      : path === '/models/available' ? [{ ...row, tenant_id: 10004, is_builtin: false }, { ...row, id: 'team-qwen', tenant_id: 10002, is_builtin: false }, { ...row, id: 'builtin-qwen', is_builtin: true }]
        : [{ ...row, tenant_id: Number(tenant) }] })
  } }
  const adapter = new UnifiedModelsAdapter(ctx, runtime)
  adapter.tenant = '10002'
  const catalog = await adapter.listModels()
  assert.deepEqual(catalog.map(model => model.id), ['10004:qwen-chat', '10002:team-qwen', '10004:builtin-qwen'])
  assert.ok(catalog.every(model => !Object.hasOwn(model, 'badge')))
})

test('model calls carry the user SSO and workspace override; logout cancels a live model stream', async t => {
  const seen = []
  const token = 'fixture.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.signature'
  const server = createServer((request, outgoing) => {
    void (async () => {
      let body = ''
      for await (const part of request) body += part
      seen.push({ path: request.url, bearer: request.headers.authorization, tenant: request.headers['x-tenant-id'] })
      if (request.url.endsWith('/auth/platform-sso/exchange')) {
        assert.equal(JSON.parse(body).expected_user_id, '369')
        outgoing.writeHead(200, { 'content-type': 'application/json' })
        outgoing.end(JSON.stringify({ success: true, token, refresh_token: 'private-refresh' }))
      } else {
        outgoing.writeHead(200, { 'content-type': 'text/event-stream' })
        outgoing.write('event: chunk\ndata: {"response_type":"answer","content":"hello"}\n\n')
      }
    })().catch(error => outgoing.destroy(error))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const runtime = createKnowledgeRuntime({ baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`, platformUserID: '369' })
  t.after(() => runtime.close())
  await runtime.signIn({ access_token: 'platform-ticket', user_id: '369' })
  const stream = await runtime.fetchModels('/models/qwen-chat/harness-chat', { method: 'POST', body: '{}' }, '10004')
  assert.equal(seen.at(-1).bearer, `Bearer ${token}`)
  assert.equal(seen.at(-1).tenant, '10004')
  assert.deepEqual(runtime.state(), { mode: 'sso', authenticated: true })
  runtime.clear()
  await assert.rejects(stream.text(), /abort/iu)
  await assert.rejects(runtime.fetchModels('/models'), { code: 'knowledge_login_required' })
  await assert.rejects(runtime.fetchModels('//untrusted-host/models'), { code: 'unsupported_model_operation' })
})

test('retired routes select the configured model owner independently of the business context', () => {
  const selected = migrateSelection({ provider: 'retired', model: 'missing' }, [{ ...row, tenant_id: 10004, is_builtin: false }], '10002')
  assert.deepEqual(selected, { provider: UNIFIED_PROVIDER, model: '10004:qwen-chat' })
})

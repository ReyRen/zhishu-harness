/** Native model management stays on owner-authenticated, scoped and redacted Host routes. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createModelManagement } from '../../overlay/models/management.mjs'
import { KnowledgeAuthError } from '../../overlay/weknora/runtime.mjs'

const model = { id: 'qwen-one', name: 'Qwen', type: 'KnowledgeQA', source: 'remote', status: 'active',
  parameters: { base_url: 'http://model.test/v1', api_key: 'never-return', app_secret: 'also-private' },
  credentials: { api_key: { configured: true } } }
const definition = { name: 'Qwen', type: 'KnowledgeQA', source: 'remote', parameters: { base_url: 'http://model.test/v1' } }
const request = body => new Request('http://harness.test/api/zhishu-models/manage', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: '10002', ...body }),
})

test('native settings project current-user memberships and redact keys from model rows', async () => {
  const seen = []
  const handle = createModelManagement({ async fetchModels(path, init, tenant) {
    seen.push({ path, tenant })
    return Response.json({ success: true, data: path === '/auth/me'
      ? { user: { is_system_admin: false }, tenant: { id: 10002 }, memberships: [{ tenant_id: 10002, tenant_name: 'Private', role: 'owner' }] }
      : [model] })
  } }, () => assert.fail('reads must not invalidate'))
  const context = await handle(new Request('http://harness.test/api/zhishu-models/manage'))
  assert.deepEqual(await context.json(), { data: { spaces: [{ id: '10002', name: 'Private', role: 'owner' }], currentTenantId: '10002', systemAdmin: false } })
  const rows = await handle(new Request('http://harness.test/api/zhishu-models/manage?operation=models&tenantId=10002'))
  assert.equal(rows.status, 200)
  const text = await rows.text()
  assert.ok(!text.includes('never-return') && !text.includes('also-private'))
  assert.equal(seen[1].tenant, '10002')
  assert.equal(rows.headers.get('cache-control'), 'no-store')
})

test('model definitions, credentials and clears are separate scoped operations and invalidate only after commit', async () => {
  const seen = []
  let invalidations = 0
  const handle = createModelManagement({ async fetchModels(path, init, tenant) {
    seen.push({ path, method: init.method, tenant, body: init.body && JSON.parse(init.body) })
    return Response.json({ success: true, data: model })
  } }, () => { invalidations++ })
  assert.equal((await handle(request({ operation: 'update', id: 'qwen-one', model: definition }))).status, 200)
  assert.equal((await handle(request({ operation: 'credentials', id: 'qwen-one', values: { api_key: 'fresh-write-only' } }))).status, 200)
  assert.equal((await handle(request({ operation: 'clearCredential', id: 'qwen-one', field: 'api_key' }))).status, 200)
  assert.deepEqual(seen.map(entry => [entry.method, entry.path, entry.tenant]), [
    ['PUT', '/models/qwen-one', '10002'], ['PUT', '/models/qwen-one/credentials', '10002'], ['DELETE', '/models/qwen-one/credentials/api_key', '10002'],
  ])
  assert.equal(seen[1].body.api_key, 'fresh-write-only')
  assert.equal(invalidations, 3)
})

test('connection tests use the declared task route and return only availability and embedding dimension', async () => {
  const seen = []
  const handle = createModelManagement({ async fetchModels(path, init, tenant) {
    seen.push({ path, body: JSON.parse(init.body), tenant })
    return Response.json({ success: true, data: path.includes('ollama') ? { models: { local: true } }
      : { available: true, dimension: 1024, message: 'provider raw text with secret' } })
  } }, () => assert.fail('tests do not change the catalog'))
  const result = await handle(request({ operation: 'test', type: 'Embedding', draft: { modelName: 'bge-m3', modelId: 'qwen-one', apiKey: 'typed' } }))
  assert.deepEqual(await result.json(), { data: { available: true, dimension: 1024 } })
  assert.equal(seen[0].path, '/initialization/embedding/test')
  assert.equal(seen[0].body.modelId, 'qwen-one')
  const local = await handle(request({ operation: 'test', type: 'KnowledgeQA', draft: { modelName: 'local', source: 'local' } }))
  assert.deepEqual(await local.json(), { data: { available: true } })
  assert.deepEqual(seen[1].body, { models: ['local'] })
})

test('invalid task, path, workspace, secret field and oversized requests never reach the backend', async () => {
  const handle = createModelManagement({ async fetchModels() { assert.fail('invalid request reached backend') } }, () => assert.fail('invalidated'))
  for (const body of [
    { operation: 'update', id: '../private', model: definition }, { operation: 'delete', id: 'one', tenantId: '0' },
    { operation: 'create', model: { ...definition, type: 'unsupported' } },
    { operation: 'credentials', id: 'one', values: { private_token: 'bad' } }, { operation: 'clearCredential', id: 'one', field: 'other' },
    { operation: 'test', type: 'Embedding', draft: { modelName: 'x', modelId: '../x' } },
  ]) assert.equal((await handle(request(body))).status, 400)
  assert.equal((await handle(request({ operation: 'create', model: { ...definition, description: 'x'.repeat(1024 * 1024) } }))).status, 413)
})

test('SSO, membership and in-use failures retain status without leaking backend response text', async () => {
  for (const status of [401, 403, 409]) {
    const handle = createModelManagement({ async fetchModels() { return new Response('private backend secret', { status }) } }, () => assert.fail('not committed'))
    const response = await handle(request({ operation: 'delete', id: 'one' }))
    assert.equal(response.status, status)
    assert.ok(!(await response.text()).includes('private backend secret'))
  }
  const anonymous = createModelManagement({ async fetchModels() { throw new KnowledgeAuthError('knowledge_login_required', 401) } }, () => {})
  assert.equal((await anonymous(new Request('http://harness.test/api/zhishu-models/manage'))).status, 401)
})

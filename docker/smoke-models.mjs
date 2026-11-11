/** Validate authenticated unified models in the built Web application without user data or external services. */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { serviceOwner } from './services.mjs'

const repository = dirname(dirname(fileURLToPath(import.meta.url)))
const root = await mkdtemp(join(tmpdir(), 'dsh-unified-models-'))
const calls = []
const row = { id: 'fixture-chat', name: 'fixture-chat', type: 'KnowledgeQA', status: 'active', is_default: true,
  tenant_id: 10004, updated_at: '2026-11-11T09:00:00Z', parameters: { context_window: 200000, max_output_tokens: 4096 },
  capabilities: { api: 'openai-completions', input: ['text'] } }
const token = `fixture.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`
const backend = createServer((request, outgoing) => {
  void (async () => {
    let raw = ''
    for await (const part of request) raw += part
    const body = raw ? JSON.parse(raw) : undefined
    const path = new URL(request.url, 'http://localhost').pathname
    const send = (status, data) => { outgoing.writeHead(status, { 'content-type': 'application/json' }); outgoing.end(JSON.stringify(data)) }
    if (path === '/api/v1/auth/platform-sso/exchange') {
      assert.equal(body.expected_user_id, 'user-a'); assert.equal(body.access_token, 'platform-a')
      send(200, { success: true, token, refresh_token: 'refresh-a' }); return
    }
    assert.equal(request.headers.authorization, `Bearer ${token}`)
    if (path === '/api/v1/auth/me') send(200, { success: true, data: { tenant: { id: 10004, name: 'Test workspace' }, memberships: [{ tenant_id: 10004 }] } })
    else if (path === '/api/v1/models') send(200, { success: true, data: [row] })
    else if (path === '/api/v1/models/fixture-chat') send(200, { success: true, data: row })
    else if (path === '/api/v1/models/fixture-chat/harness-chat') {
      assert.equal(request.headers['x-tenant-id'], '10004')
      assert.equal(body.model_revision, row.updated_at)
      assert.equal(body.options.tools.some(tool => tool.function.name === 'weknora_list_knowledge_bases'), true)
      assert.ok(!raw.includes('refresh-a') && !raw.includes(token))
      calls.push(body)
      const completed = body.messages.some(message => message.role === 'tool')
      outgoing.writeHead(200, { 'content-type': 'text/event-stream' })
      const chunks = completed
        ? [{ response_type: 'answer', content: 'UNIFIED_MODELS_OK' }, { response_type: 'answer', done: true, finish_reason: 'stop', usage: { prompt_tokens: 100, completion_tokens: 8, total_tokens: 108 } }]
        : [{ response_type: 'answer', done: true, finish_reason: 'tool_calls', tool_calls: [{ id: 'list-kb', type: 'function', function: { name: 'weknora_list_knowledge_bases', arguments: '{}' } }] }]
      for (const chunk of chunks) outgoing.write(`event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`)
      outgoing.end('event: end\ndata: {}\n\n')
    } else if (path === '/api/v1/knowledge-bases') send(200, { data: [{ id: 'kb-a', name: 'Test policies' }] })
    else if (path === '/api/v1/shared-knowledge-bases') send(200, { data: [] })
    else send(404, { error: 'Unknown fixture route' })
  })().catch(error => outgoing.destroy(error))
})
backend.listen(0, '127.0.0.1')
await once(backend, 'listening')
const owner = serviceOwner()
let timer, logs = ''
try {
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const patch = join(root, 'observer.patch.yml')
  await writeFile(patch, JSON.stringify([{ insert: [{ id: 'models-observer', name: pathToFileURL(join(repository, 'docker/tests/models-observer.mjs')).href }] }]))
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:KEY|SECRET|TOKEN|PASSWORD|^WEKNORA_)/iu.test(key))),
    HOME: root, DSH_HOME: join(root, 'home'), DSH_DEFAULT_WORKSPACE: workspace, DSH_WORKSPACE_ROOT: root,
    DSH_PLATFORM_USER_ID: 'user-a', DSH_TELEMETRY_DISABLED: '1', WEKNORA_BASE_URL: `http://127.0.0.1:${backend.address().port}/api/v1` }
  delete env.VITEST; delete env.DSH_PUBLIC_AUTHORITY
  const child = owner.start(process.execPath, [join(repository, 'apps/cli/lib/bin.js'), '--profile', 'web', '--patch', patch,
    '--host', '127.0.0.1', '--port', '0', '--no-open'], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  const result = await new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Unified-model Web probe timed out')), 90000)
    owner.signal.addEventListener('abort', () => reject(owner.signal.reason), { once: true })
    let started = false
    const remember = part => {
      logs = (logs + part).slice(-32000)
      if (started || !/dsh web: http:\/\//u.test(logs)) return
      started = true
      void (async () => {
        const printed = /dsh web: (http:\/\/[^\s]+)/u.exec(logs)[1], origin = new URL(printed).origin
        const denied = await fetch(`${origin}/api/zhishu-models/auth`)
        assert.equal(denied.status, 401); await denied.body?.cancel()
        const login = await fetch(printed, { redirect: 'manual' })
        const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
        await login.body?.cancel(); assert.notEqual(cookie, '')
        for (const namespace of ['zhishu-knowledge', 'zhishu-models']) {
          const authenticated = await fetch(`${origin}/api/${namespace}/auth`, { method: 'POST',
            headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify({ access_token: 'platform-a', user_id: 'user-a' }) })
          assert.equal(authenticated.status, 200); await authenticated.body?.cancel()
        }
        const configured = await fetch(`${origin}/api/zhishu-models/config`, { headers: { cookie } })
        assert.equal(configured.status, 200)
        assert.equal(new URL((await configured.json()).settingsURL).searchParams.get('target'), 'models')
        child.send({ command: 'models-probe', workspace })
      })().catch(reject)
    }
    child.stdout.on('data', remember); child.stderr.on('data', remember)
    child.on('message', message => { if (message.error) reject(new Error(message.error)); else if (message.models) resolve(message.models) })
  })
  assert.equal(result.answer, 'UNIFIED_MODELS_OK'); assert.equal(calls.length, 2)
  console.log(JSON.stringify({ unifiedModels: result, modelCalls: calls.length, nativeOwnerAuthentication: true, credentialsExported: false }))
} catch (error) {
  console.error(logs); throw error
} finally {
  clearTimeout(timer); await owner.close()
  backend.closeAllConnections(); await new Promise(resolve => backend.close(resolve))
  await rm(root, { recursive: true, force: true })
}

/** Validate default Web tools, real agent dispatch and credential isolation without external services. */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { serviceOwner } from './services.mjs'

const directory = dirname(fileURLToPath(import.meta.url))
const repository = dirname(directory)
const root = await mkdtemp(join(tmpdir(), 'dsh-weknora-smoke-'))
const requests = []
const text = 'Backups are retained for 30 days.'
const chunk = { id: 'chunk-backups', knowledge_id: 'doc-backups', knowledge_title: 'Backup policy',
  chunk_index: 0, score: 0.95, content: text }
const backend = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url, 'http://localhost')
    let raw = ''
    for await (const part of request) raw += part
    const body = raw === '' ? undefined : JSON.parse(raw)
    const user = /^smoke-user-([ab])$/u.exec(request.headers['x-api-key'] ?? '')?.[1]
    const send = (status, data) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(data))
    }
    if (!user) { send(401, { error: 'Invalid credential' }); return }
    assert.equal(url.searchParams.has('resource_urls'), false, 'Default internal handles do not request public file URLs')
    requests.push({ user, method: request.method, path: url.pathname, body, tenant: request.headers['x-tenant-id'] })
    if (body?.knowledge_base_ids?.includes('forbidden')) { send(403, { error: 'Knowledge base access denied' }); return }
    if (url.pathname === '/api/v1/knowledge-bases') {
      send(200, { data: [{ id: `kb-${user}`, name: `Policies ${user}`, description: 'Backup policies' }] })
    } else if (url.pathname === '/api/v1/knowledge-search') {
      assert.deepEqual(body.knowledge_base_ids, [`kb-${user}`])
      send(200, { data: [chunk] })
    } else if (url.pathname === '/api/v1/knowledge/search') {
      send(200, { data: [] })
    } else if (url.pathname === '/api/v1/knowledge/doc-backups') {
      send(200, { data: { id: 'doc-backups', title: 'Backup policy', description: 'Retention policy' } })
    } else if (url.pathname === '/api/v1/chunks/doc-backups') {
      send(200, { data: [chunk], total: 1, page: 1, page_size: 30 })
    } else if (url.pathname === '/api/v1/sessions') {
      send(200, { data: { id: `answer-${user}` } })
    } else if (url.pathname === `/api/v1/knowledge-chat/answer-${user}`) {
      assert.deepEqual(body.knowledge_base_ids, [`kb-${user}`])
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const event of [
        { response_type: 'answer', content: text },
        { response_type: 'references', knowledge_references: [chunk] },
        { response_type: 'complete' },
      ]) response.write(`data: ${JSON.stringify(event)}\n\n`)
      response.end()
    } else { send(404, { error: 'Unknown fixture route' }) }
  })().catch(error => { response.destroy(error) })
})
backend.listen(0, '127.0.0.1')
await once(backend, 'listening')
const baseUrl = `http://127.0.0.1:${backend.address().port}`

async function probe(user, installed = false) {
  const home = join(root, user, 'dsh-home')
  const workspace = join(root, user, 'workspace')
  await mkdir(workspace, { recursive: true })
  const patch = join(root, user, 'observer.patch.yml')
  await writeFile(patch, JSON.stringify([{ insert: [{ id: 'weknora-observer',
    name: pathToFileURL(join(directory, 'tests/weknora-observer.mjs')).href }] }]))
  const owner = serviceOwner()
  let logs = '', timer
  const environment = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/(?:KEY|SECRET|TOKEN|PASSWORD|^WEKNORA_)/iu.test(name))),
    HOME: join(root, user), DSH_HOME: home, DSH_DEFAULT_WORKSPACE: workspace, DSH_WORKSPACE_ROOT: join(root, user),
    DSH_TELEMETRY_DISABLED: '1', WEKNORA_BASE_URL: baseUrl, WEKNORA_API_KEY: `smoke-user-${user}`,
    WEKNORA_TENANT_ID: `tenant-${user}`,
  }
  delete environment.VITEST
  const child = owner.start(process.execPath, [join(repository, 'apps/cli/lib/bin.js'),
    '--profile', 'web', '--patch', patch, '--host', '127.0.0.1', '--port', '0', '--no-open'],
  { cwd: workspace, env: environment, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  const completion = new Promise(resolve => child.once('close', (code, signal) => { resolve({ code, signal }) }))
  try {
    const result = await new Promise((resolve, reject) => {
      let sent = false
      timer = setTimeout(() => reject(new Error('WeKnora Web probe did not finish')), 90_000)
      owner.signal.addEventListener('abort', () => reject(owner.signal.reason), { once: true })
      const remember = part => {
        logs = (logs + part.toString()).slice(-48_000)
        if (!sent && /dsh web: http:\/\//u.test(logs)) {
          sent = true
          child.send({ command: 'weknora-probe', workspace, sessionId: installed ? 'weknora-smoke-installed' : 'weknora-smoke' },
            error => { if (error) reject(error) })
        }
      }
      child.stdout.on('data', remember)
      child.stderr.on('data', remember)
      child.on('message', message => {
        if (message.error) reject(new Error(message.error))
        else if (message.weknora) resolve(message.weknora)
      })
    })
    assert.equal(result.unloaded, true)
    assert.equal(JSON.stringify(result).includes(`smoke-user-${user}`), false, 'Credentials never reach the transcript')
    const manifest = JSON.parse(await readFile(join(home, 'profiles/web/package.json'), 'utf8'))
    if (!installed) {
      assert.equal(manifest.dependencies?.['@wxg-prc-cpg/dsh-weknora'], undefined)
      assert.equal(manifest.dsh.profile.bundles.includes('@wxg-prc-cpg/dsh-weknora'), false)
    } else assert.ok(result.startedBundles.includes('@wxg-prc-cpg/dsh-weknora'))
    return result
  } catch (error) {
    throw new Error(`WeKnora Web smoke failed: ${logs.replace(/([?&]token=)[\w-]+/gu, '$1<redacted>')}`, { cause: error })
  } finally {
    clearTimeout(timer)
    await owner.close()
    const stopped = await completion
    assert.equal(stopped.signal, null)
    assert.equal(stopped.code, 0)
  }
}

try {
  const first = await probe('a')
  await probe('b')
  for (const user of ['a', 'b']) {
    assert.ok(requests.some(request => request.user === user && request.path === '/api/v1/knowledge-search'))
    assert.ok(requests.filter(request => request.user === user).every(request => request.tenant === `tenant-${user}`))
  }
  const path = join(root, 'a/dsh-home/profiles/web/package.json')
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  manifest.dsh.profile.bundles.push('@wxg-prc-cpg/dsh-weknora')
  await writeFile(path, JSON.stringify(manifest))
  await probe('a', true)
  console.log(JSON.stringify({ plugin: '@wxg-prc-cpg/dsh-weknora', tools: first.names,
    agentConversation: true, independentCredentials: true, profileInstallRequired: false,
    installedBundleDeduplicated: true, forbiddenScopeRejected: true, unloadRemovesTools: true }))
} finally {
  backend.closeAllConnections()
  await new Promise((resolve, reject) => backend.close(error => error ? reject(error) : resolve()))
  await rm(root, { recursive: true, force: true })
}

/** Verify cold-cache installation, native Web assets and persisted plugins with networking disabled. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { serviceOwner, waitForService } from './services.mjs'
import { verifyDifyMigration } from './smoke-dify-migration.mjs'

const root = await mkdtemp(join(tmpdir(), 'dsh-offline-market-smoke-'))
const authority = 'offline.localhost:3081'
const registry = 'http://127.0.0.1:4873'
const env = { ...process.env, DSH_HOME: join(root, 'dsh-home'), HOME: root,
  XDG_CACHE_HOME: join(root, 'cache'), DSH_WORKSPACE_ROOT: root,
  DSH_DEFAULT_WORKSPACE: join(root, 'workspace'), DSH_PUBLIC_AUTHORITY: authority,
  npm_config_store_dir: join(root, 'empty-store'), PNPM_CONFIG_STORE_DIR: join(root, 'empty-store') }
let owner
let logs = ''
let headers

async function webRequest(path, { method = 'GET', body, extraHeaders = {} } = {}) {
  const url = new URL(path, `http://${authority}`)
  assert.equal(url.origin, `http://${authority}`, 'Web assets must use the public authority')
  return new Promise((resolve, reject) => {
    const request = httpRequest(`http://127.0.0.1:3081${url.pathname}${url.search}`, {
      method, headers: { host: authority, ...headers, ...extraHeaders }, timeout: 90_000,
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.once('error', reject)
      response.once('end', () => resolve({ status: response.statusCode, headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8') }))
    })
    request.once('error', reject)
    request.once('timeout', () => request.destroy(new Error('Native Web request timed out')))
    request.end(body)
  })
}

async function startWeb() {
  owner = serviceOwner()
  logs = ''
  const child = owner.start('/opt/dsh/deploy/container-entrypoint.sh', [], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const remember = chunk => { logs = (logs + chunk.toString()).slice(-64_000) }
  child.stdout.on('data', remember)
  child.stderr.on('data', remember)
  await waitForService(`${registry}/-/ping`, owner.signal)
  const deadline = Date.now() + 60_000
  while (!/[?&]token=([\w-]+)/u.test(logs)) {
    owner.signal.throwIfAborted()
    if (Date.now() >= deadline) throw new Error('Native Web did not report its authentication URL')
    await delay(100)
  }
  const token = logs.match(/[?&]token=([\w-]+)/u)[1]
  const authenticated = await webRequest(`/?token=${encodeURIComponent(token)}`)
  const cookie = (authenticated.headers['set-cookie'] ?? []).map(value => value.split(';')[0]).join('; ')
  assert.ok(cookie, 'Native Web must create an authenticated browser cookie')
  headers = { host: authority, cookie }
  const page = await webRequest('/')
  assert.ok(page.body.includes('meow-memory/client'), 'Native Web must preload the default memory UI')
  assert.ok(page.body.includes('@zhishu/dsh-overlay-workbenches/client'), 'Native Web must preload the workbench UI')
  assert.equal(page.status, 200)
  const html = page.body
  assert.match(html, /<!doctype html>/iu)
  const paths = [...html.matchAll(/(?:src|href)="([^"]*plugins\/[^"]+)"/gu)].map(match => match[1].replaceAll('&amp;', '&'))
  assert.ok(paths.length > 0, 'Native Web must preload plugin clients')
  for (const path of paths) {
    const response = await webRequest(path)
    assert.equal(response.status, 200)
    assert.ok(response.body.length > 1_000)
  }
  // The plugin registers optional Web routes after its service becomes visible.
  // Wait for that route, and fail immediately on authentication/server errors.
  const memoryDeadline = Date.now() + 30_000
  let memory = await webRequest('/meow-memory/dreamed-sessions')
  while (memory.status === 404 && Date.now() < memoryDeadline) {
    await delay(100, undefined, { signal: owner.signal })
    memory = await webRequest('/meow-memory/dreamed-sessions')
  }
  assert.equal(memory.status, 200, 'Default memory routes must become ready')
  assert.deepEqual(Object.keys(JSON.parse(memory.body)).sort(), ['dreamingIds', 'sessionIds'])
}

try {
  await mkdir(env.DSH_DEFAULT_WORKSPACE)
  await startWeb()
  assert.equal((await webRequest('/meow-memory/dreamed-sessions', { extraHeaders: { cookie: '' } })).status, 401)
  assert.equal((await webRequest('/meow-memory/dreamed-sessions', { extraHeaders: { host: 'undeclared.invalid' } })).status, 403)
  const response = await fetch('http://127.0.0.1:4874/plugins.json')
  assert.equal(response.status, 200)
  const catalog = await response.json()
  assert.ok(catalog.plugins.length > 0)
  const workbenches = await (await fetch('http://127.0.0.1:4874/workbenches.json')).json()
  assert.ok(workbenches.workbenches.length > 0)
  assert.equal(workbenches.workbenches.some(item => item.npm === 'deepseek-harness-daily'), false)
  assert.equal(catalog.plugins.some(item => item.npm === 'dsh-visual-workflow'), true)
  const dependencyLock = JSON.parse(await readFile('/opt/dsh/market-registry/offline-dependencies.lock.json', 'utf8'))
  for (const item of dependencyLock.packages) {
    const metadata = await fetch(`${registry}/${encodeURIComponent(item.name)}`)
    assert.equal(metadata.status, 200, `Existing profile dependency must be available offline: ${item.name}`)
    const document = await metadata.json()
    assert.equal(document.versions[item.version]?.dist.integrity, item.integrity)
    assert.ok(Number.isFinite(Date.parse(document.time[item.version])))
  }
  // pnpm verifies the whole existing lockfile even when adding an unrelated workbench.
  // This representative workflow dependency set must survive that verification offline.
  const existing = join(root, 'existing-profile')
  await mkdir(existing)
  await writeFile(join(existing, 'package.json'), JSON.stringify({ private: true, dependencies: {
    '@huggingface/transformers': '4.3.0', '@types/node': '26.6.3', mysql2: '3.24.4', pg: '8.23.0',
  } }))
  const runPnpm = args => promisify(execFile)('pnpm', [...args, '--registry', registry, '--ignore-scripts'], {
    cwd: existing, env: { ...env, npm_config_store_dir: join(root, 'workflow-store'), PNPM_CONFIG_STORE_DIR: join(root, 'workflow-store') },
    timeout: 180_000, maxBuffer: 2 * 1024 * 1024,
  })
  await runPnpm(['install'])
  await runPnpm(['add', '--save-exact', 'dsh-mind-workbench@1.0.16-zhishu.1'])
  const mind = JSON.parse(await readFile(join(existing, 'node_modules/dsh-mind-workbench/package.json'), 'utf8'))
  assert.equal(mind.version, '1.0.16-zhishu.1')
  const guarded = join(root, 'unreviewed-build')
  await mkdir(guarded)
  await writeFile(join(guarded, 'package.json'), JSON.stringify({ private: true, dependencies: { sharp: '0.34.5' } }))
  await assert.rejects(promisify(execFile)('pnpm', ['install', '--registry', registry], {
    cwd: guarded, env, timeout: 180_000, maxBuffer: 2 * 1024 * 1024,
  }), error => error.code === 1 && /Ignored build scripts.*sharp/u.test(error.stdout + error.stderr),
  'Unreviewed original install hooks must retain pnpm\'s approval requirement')
  const offered = await webRequest('/api/desktop-workbenches/catalog')
  assert.equal(offered.status, 200)
  assert.deepEqual(JSON.parse(offered.body).workbenches.map(item => item.npm), workbenches.workbenches.map(item => item.npm))
  assert.equal((await webRequest('/api/desktop-workbenches/state', { extraHeaders: { cookie: '' } })).status, 401)
  assert.equal((await webRequest('/api/desktop-workbenches/catalog', { extraHeaders: { host: 'undeclared.invalid' } })).status, 403)
  const initial = JSON.parse((await webRequest('/api/desktop-workbenches/state')).body)
  const ownership = { ...initial.state, sessionBindings: { 'offline-workbench-session': 'offline-workbench-owner' } }
  const save = () => webRequest('/api/desktop-workbenches/state/write', { method: 'POST',
    body: JSON.stringify({ revision: initial.revision, state: ownership }),
    extraHeaders: { origin: `http://${authority}`, 'content-type': 'application/json' } })
  assert.equal((await save()).status, 200)
  assert.equal((await save()).status, 409, 'A stale window must not replace newer workbench ownership')
  const marketResponse = await webRequest('/dsh-market/registry')
  assert.equal(marketResponse.status, 200)
  assert.deepEqual(JSON.parse(marketResponse.body).registry.plugins, catalog.plugins.map(item => ({
    ...item, category: Array.isArray(item.category) ? item.category : [item.category],
  })))
  assert.equal((await webRequest('/dsh-market/registry', { extraHeaders: { cookie: '' } })).status, 401)
  assert.equal((await webRequest('/dsh-market/registry', { extraHeaders: { host: 'undeclared.invalid' } })).status, 403)
  const retained = join(env.DSH_HOME, 'visual-workflow', 'offline-user-data.txt')
  await mkdir(join(env.DSH_HOME, 'visual-workflow'), { recursive: true })
  await writeFile(retained, 'retained across plugin upgrade and removal')
  for (const item of catalog.plugins) {
    const name = item.npm ?? item.name
    const version = name === 'dsh-visual-workflow' ? '1.1.1-zhishu.1' : item.version
    const body = JSON.stringify({ url: item.url, version })
    const extraHeaders = { origin: `http://${authority}`, 'content-type': 'application/json' }
    assert.equal((await webRequest('/dsh-market/install', { method: 'POST', body,
      extraHeaders: { ...extraHeaders, origin: 'http://untrusted.invalid' } })).status, 403)
    const installed = await webRequest('/dsh-market/install', {
      method: 'POST', extraHeaders, body,
    })
    const result = JSON.parse(installed.body)
    assert.equal(installed.status, 200, JSON.stringify(result))
    assert.equal(result.ok, true, JSON.stringify(result))
    const manifest = JSON.parse(await readFile(join(env.DSH_HOME, 'profiles/web/node_modules', name, 'package.json'), 'utf8'))
    assert.equal(manifest.version, version)
    if (name === 'dsh-visual-workflow') {
      const metadata = await (await fetch(`${registry}/dsh-visual-workflow`)).json()
      assert.equal(metadata.versions['0.11.1-zhishu.1'].dist.integrity,
        'sha512-1bPdd2G97JEF6JSicWiCD5gveLU1Go9vYmhOUKRvGb+Zc3ESRglaDBhXfRXeKmvG08yzIXrZz0GxsPsBRWUOmg==')
      const previous = await fetch(metadata.versions[version].dist.tarball)
      assert.equal(previous.status, 200)
      assert.equal(createHash('sha256').update(Buffer.from(await previous.arrayBuffer())).digest('hex'),
        '0bb7d2ece3d32c9afb6517568191d14046449edff80e64f96618838193ffa064')
      const method = 'pluginManager/updateBundle'
      const updated = await webRequest(`/api/${method}`, { method: 'POST', extraHeaders,
        body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method,
          payload: { args: { name, version: item.version, options: { registry } } } }) })
      const reply = JSON.parse(updated.body)
      assert.equal(updated.status, 200, updated.body)
      assert.equal(reply.result.ok, true, updated.body)
      assert.equal(reply.result.value.step, 'install', updated.body)
      assert.ok(['applied', 'restart-required'].includes(reply.result.value.result.application), updated.body)
      assert.equal(reply.result.value.restore, undefined, updated.body)
      const current = JSON.parse(await readFile(join(env.DSH_HOME, 'profiles/web/node_modules', name, 'package.json'), 'utf8'))
      assert.equal(current.version, item.version)
      assert.equal(await readFile(retained, 'utf8'), 'retained across plugin upgrade and removal')
    }
  }
  for (const endpoint of ['listFlowTemplates', 'listTemplates', 'models', 'presets', 'toolCombos']) {
    const options = { method: 'POST', body: JSON.stringify({ args: { kind: 'role' } }),
      extraHeaders: { origin: `http://${authority}`, 'content-type': 'application/json' } }
    const deadline = Date.now() + 30_000
    let response = await webRequest(`/visual-workflow/${endpoint}`, options)
    while ([404, 405, 503].includes(response.status) && Date.now() < deadline) {
      await delay(100, undefined, { signal: owner.signal })
      response = await webRequest(`/visual-workflow/${endpoint}`, options)
    }
    assert.equal(response.status, 200, endpoint)
    assert.equal(JSON.parse(response.body).ok, true, response.body)
  }
  const gui = { method: 'POST', body: JSON.stringify({ args: {} }),
    extraHeaders: { origin: `http://${authority}`, 'content-type': 'application/json', cookie: '' } }
  assert.equal((await webRequest('/visual-workflow/listFlowTemplates', gui)).status, 401)
  assert.equal((await webRequest('/visual-workflow/files/nonexistent.txt', { extraHeaders: { cookie: '' } })).status, 401)
  assert.equal((await webRequest('/visual-workflow/listFlowTemplates', { ...gui,
    extraHeaders: { ...gui.extraHeaders, cookie: headers.cookie, origin: 'http://untrusted.invalid' } })).status, 403)
  await promisify(execFile)(process.execPath, ['/opt/dsh/docker/smoke-workflow.mjs'], {
    env: { ...env, OMP_NUM_THREADS: '2' }, timeout: 180_000, maxBuffer: 2 * 1024 * 1024,
  })
  await verifyDifyMigration(webRequest, authority, env.DSH_HOME, process.argv.includes('--exercise-dify-worker'))
  const workflowCli = args => promisify(execFile)(process.execPath,
    ['/opt/dsh/apps/cli/lib/bin.js', 'plugin', '--profile', 'web', ...args],
    { env, cwd: env.DSH_DEFAULT_WORKSPACE, timeout: 180_000, maxBuffer: 2 * 1024 * 1024 })
  await workflowCli(['remove', 'dsh-visual-workflow'])
  assert.equal(await readFile(retained, 'utf8'), 'retained across plugin upgrade and removal')
  const workflow = catalog.plugins.find(item => item.npm === 'dsh-visual-workflow')
  await workflowCli(['add', '--registry', registry, '--save-exact', `dsh-visual-workflow@${workflow.version}`])
  assert.equal(await readFile(retained, 'utf8'), 'retained across plugin upgrade and removal')
  // Unlisted legacy packages remain subject to the official host-compatibility check.
  await assert.rejects(workflowCli(['add', '--registry', registry, '--save-exact', 'deepseek-harness-daily@0.4.10']), error => error.code === 1
    && error.stderr.includes('is incompatible with dsh')
    && /nothing was installed|restored package\.json, pnpm-lock\.yaml, and node_modules/u.test(error.stderr))
  const profile = JSON.parse(await readFile(join(env.DSH_HOME, 'profiles/web/package.json'), 'utf8'))
  assert.equal(profile.dependencies?.['deepseek-harness-daily'], undefined)
  const installedWorkbenches = []
  for (const item of workbenches.workbenches) {
    const install = () => promisify(execFile)(process.execPath, ['/opt/dsh/apps/cli/lib/bin.js', 'plugin', '--profile', 'web',
      'add', '--registry', registry, '--save-exact', `${item.npm}@${item.version}`],
    { env, cwd: env.DSH_DEFAULT_WORKSPACE, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 })
    await install()
    const manifest = JSON.parse(await readFile(join(env.DSH_HOME, 'profiles/web/node_modules', item.npm, 'package.json'), 'utf8'))
    assert.equal(manifest.version, item.version)
    installedWorkbenches.push(item)
  }
  const missing = await fetch(`${registry}/dsh-intentionally-missing-offline-package`)
  assert.equal(missing.status, 404)
  await missing.body?.cancel()
  const forbidden = await fetch(`${registry}/dsh-intentionally-forbidden-publish`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}',
  })
  assert.ok([401, 403].includes(forbidden.status))
  await forbidden.body?.cancel()
  await owner.close()
  await startWeb()
  for (const item of [...catalog.plugins, ...installedWorkbenches]) {
    const name = item.npm ?? item.name
    const manifest = JSON.parse(await readFile(join(env.DSH_HOME, 'profiles/web/node_modules', name, 'package.json'), 'utf8'))
    assert.equal(manifest.version, item.version)
  }
  const restored = JSON.parse((await webRequest('/api/desktop-workbenches/state')).body)
  assert.deepEqual(restored.state.sessionBindings, ownership.sessionBindings)
  await owner.close()
  env.DSH_HOME = join(root, 'other-user-home')
  await startWeb()
  const separate = JSON.parse((await webRequest('/api/desktop-workbenches/state')).body)
  assert.deepEqual(separate.state.sessionBindings, {})
  assert.equal((await webRequest('/')).body.includes('dsh-visual-workflow/client'), false, 'Other users must choose installation themselves')
  const separateProfile = JSON.parse(await readFile(join(env.DSH_HOME, 'profiles/web/package.json'), 'utf8'))
  assert.equal(separateProfile.dependencies?.['dsh-visual-workflow'], undefined)
  assert.equal(separateProfile.dependencies?.['dsh-dify-migrator'], undefined)
  console.log('Offline market: cold-cache plugins/workbenches, Workflow upgrade/local embedding/import/data retention, incompatible-release rejection, native Web, ownership conflict/restart/isolation and read-only registry passed')
} catch (error) {
  console.error(logs.replace(/([?&]token=)[\w-]+/gu, '$1<redacted>'))
  throw error
} finally {
  await owner?.close()
  await rm(root, { recursive: true, force: true })
}

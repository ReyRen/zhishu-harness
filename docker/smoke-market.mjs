/** Verify cold-cache installation, native Web assets and persisted plugins with networking disabled. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { serviceOwner, waitForService } from './services.mjs'

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
  for (const item of catalog.plugins) {
    const name = item.npm ?? item.name
    const body = JSON.stringify({ url: item.url, version: item.version })
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
    assert.equal(manifest.version, item.version)
  }
  const installedWorkbenches = []
  for (const item of workbenches.workbenches) {
    const install = () => promisify(execFile)(process.execPath, ['/opt/dsh/apps/cli/lib/bin.js', 'plugin', '--profile', 'web',
      'add', '--registry', registry, '--save-exact', `${item.npm}@${item.version}`],
    { env, cwd: env.DSH_DEFAULT_WORKSPACE, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 })
    // This pinned community release explicitly excludes the current DSH host.
    // Its catalog presence must not bypass the official compatibility guard.
    if (item.npm === 'deepseek-harness-daily' && item.version === '0.4.10') {
      await assert.rejects(install, error => error.code === 1
        && error.stderr.includes('is incompatible with dsh')
        && error.stderr.includes('restored package.json, pnpm-lock.yaml, and node_modules'))
      const profile = JSON.parse(await readFile(join(env.DSH_HOME, 'profiles/web/package.json'), 'utf8'))
      assert.equal(profile.dependencies?.[item.npm], undefined)
      continue
    }
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
  console.log('Offline market: compatible cold-cache plugins/workbenches, incompatible-release rejection, native Web, ownership conflict/restart/isolation and read-only registry passed')
} catch (error) {
  console.error(logs.replace(/([?&]token=)[\w-]+/gu, '$1<redacted>'))
  throw error
} finally {
  await owner?.close()
  await rm(root, { recursive: true, force: true })
}

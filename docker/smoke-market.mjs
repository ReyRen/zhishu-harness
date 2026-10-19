/** Verify cold-cache installation, native Web assets and persisted plugins with networking disabled. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
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
  const authenticated = await fetch(`http://127.0.0.1:3081/?token=${encodeURIComponent(token)}`, {
    headers: { host: authority }, redirect: 'manual', signal: AbortSignal.timeout(5_000),
  })
  const cookie = authenticated.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  await authenticated.body?.cancel()
  assert.ok(cookie, 'Native Web must create an authenticated browser cookie')
  headers = { host: authority, cookie }
  const page = await fetch('http://127.0.0.1:3081/', { headers })
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(html, /<!doctype html>/iu)
  const paths = [...html.matchAll(/(?:src|href)="([^"]*plugins\/[^"]+)"/gu)].map(match => match[1].replaceAll('&amp;', '&'))
  assert.ok(paths.length > 0, 'Native Web must preload plugin clients')
  for (const path of paths) {
    const response = await fetch(new URL(path, 'http://127.0.0.1:3081/'), { headers })
    assert.equal(response.status, 200)
    assert.ok((await response.text()).length > 1_000)
  }
}

try {
  await mkdir(env.DSH_DEFAULT_WORKSPACE)
  await startWeb()
  const response = await fetch('http://127.0.0.1:4874/plugins.json')
  assert.equal(response.status, 200)
  const catalog = await response.json()
  assert.ok(catalog.plugins.length > 0)
  const marketResponse = await fetch('http://127.0.0.1:3081/dsh-market/registry', { headers })
  assert.equal(marketResponse.status, 200)
  assert.deepEqual((await marketResponse.json()).registry.plugins, catalog.plugins)
  for (const item of catalog.plugins) {
    const name = item.npm ?? item.name
    const installed = await fetch('http://127.0.0.1:3081/dsh-market/install', {
      method: 'POST', headers: { ...headers, origin: `http://${authority}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url: item.url, version: item.version }), signal: AbortSignal.timeout(90_000),
    })
    const result = await installed.json()
    assert.equal(installed.status, 200, JSON.stringify(result))
    assert.equal(result.ok, true, JSON.stringify(result))
    const manifest = JSON.parse(await readFile(join(env.DSH_HOME, 'profiles/web/node_modules', name, 'package.json'), 'utf8'))
    assert.equal(manifest.version, item.version)
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
  for (const item of catalog.plugins) {
    const name = item.npm ?? item.name
    const manifest = JSON.parse(await readFile(join(env.DSH_HOME, 'profiles/web/node_modules', name, 'package.json'), 'utf8'))
    assert.equal(manifest.version, item.version)
  }
  console.log('Offline market: cold-cache installation, authenticated native Web, restart persistence and read-only registry passed')
} catch (error) {
  console.error(logs.replace(/([?&]token=)[\w-]+/gu, '$1<redacted>'))
  throw error
} finally {
  await owner?.close()
  await rm(root, { recursive: true, force: true })
}

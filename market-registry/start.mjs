/**
 * Start the local plugin registry: Verdaccio on 127.0.0.1:4873 and the
 * market catalog on 127.0.0.1:4874. Community tarballs in ./tarballs are
 * published when that version is not already in ./storage.
 * Leave this process running, then start Web with `pnpm dsh:private`.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { setTimeout as delay } from 'node:timers/promises'

const root = dirname(fileURLToPath(import.meta.url))
const registry = 'http://127.0.0.1:4873'
const catalogPort = 4874
function tarballFilename(name, version) {
  return `${name.replace(/^@/u, '').replaceAll('/', '-')}-${version}.tgz`
}

/** Catalog rows that must have a tarball. `npm` wins over a display name. */
function listedPackages(file, key) {
  const catalog = JSON.parse(readFileSync(join(root, file), 'utf8'))
  if (!Array.isArray(catalog[key])) throw new Error(`${file} has no ${key} list`)
  return catalog[key].map(entry => {
    const name = typeof entry.npm === 'string' && entry.npm !== '' ? entry.npm : entry.name
    if (typeof name !== 'string' || name === '' || typeof entry.version !== 'string' || entry.version === '') {
      throw new Error(`${file} entry needs a package name and a version`)
    }
    return { name, version: entry.version }
  })
}

function packedManifest(file) {
  const raw = gunzipSync(readFileSync(file))
  let offset = 0
  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const text = (start, end) => header.subarray(start, end).toString('utf8').replace(/\0.*$/su, '').trim()
    const name = text(0, 100)
    const prefix = text(345, 500)
    const path = prefix === '' ? name : `${prefix}/${name}`
    const size = Number.parseInt(text(124, 136), 8)
    offset += 512
    if (!Number.isFinite(size) || size < 0) throw new Error(`market registry: ${file} has a bad tar header`)
    if (path === 'package/package.json') return JSON.parse(raw.subarray(offset, offset + size).toString('utf8'))
    offset += Math.ceil(size / 512) * 512
  }
  throw new Error(`market registry: ${file} has no package/package.json`)
}

function assertListed() {
  for (const item of [...listedPackages('plugins.json', 'plugins'), ...listedPackages('workbenches.json', 'workbenches')]) {
    const packed = join(root, 'tarballs', tarballFilename(item.name, item.version))
    if (!existsSync(packed)) throw new Error(`missing ${packed}. See README.zh.md`)
  }
}
/** Local publish account. It exists only in this machine's htpasswd file. */
const publisher = { name: 'zhishu', password: 'zhishu-local', email: 'zhishu@localhost' }

const children = []
let stopping = false

function binary(name) {
  const file = join(root, 'node_modules', name, 'bin', name)
  if (!existsSync(file) && !existsSync(`${file}.js`)) {
    throw new Error(`missing ${name}. From market-registry run: pnpm install --ignore-workspace`)
  }
  return existsSync(file) ? file : `${file}.js`
}

function track(child) {
  children.push(child)
  child.on('exit', (code, signal) => {
    if (stopping || signal === 'SIGTERM' || signal === 'SIGINT') return
    if (code !== 0 && code !== null) {
      console.error(`market registry: ${child.spawnfile} exited ${code}`)
      shutdown(1)
    }
  })
  return child
}

function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill()
  process.exit(code)
}

async function registryToken() {
  const url = `${registry}/-/user/org.couchdb.user:${publisher.name}`
  const created = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(publisher),
  })
  const createdBody = await created.json().catch(() => ({}))
  if (typeof createdBody.token === 'string' && createdBody.token !== '') return createdBody.token
  const authorization = `Basic ${Buffer.from(`${publisher.name}:${publisher.password}`).toString('base64')}`
  const signedIn = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization },
    body: JSON.stringify({ name: publisher.name, password: publisher.password }),
  })
  const signedInBody = await signedIn.json().catch(() => ({}))
  if (typeof signedInBody.token === 'string' && signedInBody.token !== '') return signedInBody.token
  throw new Error(`market registry: could not sign in to Verdaccio (${created.status} then ${signedIn.status})`)
}

async function waitFor(url, label) {
  const deadline = Date.now() + 30_000
  let last = 'not started'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok || response.status === 404) return
      last = `${response.status}`
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await delay(250)
  }
  throw new Error(`${label} did not answer at ${url}: ${last}`)
}

function npmCommand(args, cwd) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  return new Promise((resolve, reject) => {
    const child = spawn(npm, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`npm ${args.join(' ')} exited ${code}`))
    })
  })
}

function writeNpmrc(token) {
  const npmrc = join(root, '.npmrc')
  writeFileSync(npmrc, `registry=${registry}/\n//127.0.0.1:4873/:_authToken=${token}\n`, { mode: 0o600 })
  return npmrc
}

async function alreadyPublished(name, version) {
  const response = await fetch(`${registry}/${name}/${version}`).catch(() => null)
  return response?.ok === true
}

async function ensureMirrored(token) {
  const npmrc = writeNpmrc(token)
  for (const filename of readdirSync(join(root, 'tarballs')).filter(name => name.endsWith('.tgz')).sort()) {
    const packed = join(root, 'tarballs', filename)
    const manifest = packedManifest(packed)
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      throw new Error(`market registry: ${filename} has no package name or version`)
    }
    if (await alreadyPublished(manifest.name, manifest.version)) continue
    await npmCommand(['publish', packed, '--userconfig', npmrc, '--registry', `${registry}/`], root)
  }
}

function serveCatalog() {
  const files = {
    '/plugins.json': readFileSync(join(root, 'plugins.json')),
    '/workbenches.json': readFileSync(join(root, 'workbenches.json')),
  }
  const server = createServer((request, response) => {
    const body = files[request.url?.split('?')[0]]
    if (!body) {
      response.writeHead(404)
      response.end()
      return
    }
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    response.end(body)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(catalogPort, '127.0.0.1', () => resolve(server))
  })
}

const verdaccio = track(spawn(process.execPath, [
  binary('verdaccio'),
  '--config', join(root, 'verdaccio.yaml'),
], { cwd: root, stdio: 'inherit' }))

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

try {
  await waitFor(`${registry}/-/ping`, 'Verdaccio')
  assertListed()
  await ensureMirrored(await registryToken())
  await serveCatalog()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  verdaccio.kill()
  process.exit(1)
}

console.log('')
console.log('private npm:       http://127.0.0.1:4873')
console.log('plugin catalog:    http://127.0.0.1:4874/plugins.json')
console.log('workbench catalog: http://127.0.0.1:4874/workbenches.json')
console.log('start Web with: pnpm dsh:private')
console.log('')

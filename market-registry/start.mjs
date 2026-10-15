/**
 * Start the local plugin registry: Verdaccio on 127.0.0.1:4873 and the
 * market catalog on 127.0.0.1:4874. Community tarballs in ./tarballs are
 * published when that version is not already in ./storage.
 * Leave this process running, then start Web with `pnpm dsh:private`.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = dirname(fileURLToPath(import.meta.url))
const registry = 'http://127.0.0.1:4873'
const catalogPort = 4874
/** Community packages copied into ./tarballs. Versions match plugins.json. */
const mirrored = [
  { name: 'dsh-dream-skin', version: '10.15.0' },
  { name: 'open-sea-skin', version: '1.2.5' },
]
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

async function ensureMirrored(token) {
  const npmrc = writeNpmrc(token)
  for (const item of mirrored) {
    const stored = join(root, 'storage', item.name, `${item.name}-${item.version}.tgz`)
    if (existsSync(stored)) continue
    const packed = join(root, 'tarballs', `${item.name}-${item.version}.tgz`)
    if (!existsSync(packed)) throw new Error(`missing ${packed}. See README.zh.md`)
    await npmCommand(['publish', packed, '--userconfig', npmrc, '--registry', `${registry}/`], root)
  }
}

function serveCatalog() {
  const body = readFileSync(join(root, 'plugins.json'))
  const server = createServer((request, response) => {
    if (request.url?.split('?')[0] !== '/plugins.json') {
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
  await ensureMirrored(await registryToken())
  await serveCatalog()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  verdaccio.kill()
  process.exit(1)
}

console.log('')
console.log('private npm:    http://127.0.0.1:4873')
console.log('private catalog: http://127.0.0.1:4874/plugins.json')
console.log('start Web with: pnpm dsh:private')
console.log('')

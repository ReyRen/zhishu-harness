/** Exercise default memory tools, independent users and persisted SQLite with no model or Internet. */
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { serviceOwner } from './services.mjs'

const directory = dirname(fileURLToPath(import.meta.url))
const repository = dirname(directory)
const root = await mkdtemp(join(process.env.DSH_MEMORY_SMOKE_PARENT ?? tmpdir(), 'dsh-memory-smoke-'))
const content = 'offline-memory-probe survives a Web process restart'

async function probe(user, sessionID, write, expectUntrusted = false) {
  const home = join(root, user, 'dsh-home')
  const workspace = join(root, user, 'workspace')
  await mkdir(workspace, { recursive: true })
  const patch = join(root, user, 'observer.patch.yml')
  await writeFile(patch, JSON.stringify([{ insert: [{ id: 'memory-observer',
    name: pathToFileURL(join(directory, 'tests/memory-observer.mjs')).href }] }]))
  const owner = serviceOwner()
  let logs = '', deadline
  const environment = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(name))),
    HOME: join(root, user), DSH_HOME: home, DSH_WORKSPACE_ROOT: join(root, user),
    DSH_DEFAULT_WORKSPACE: workspace, MEOW_MEMORY_HOME: join(home, 'storages/meow-memory'),
    DSH_TELEMETRY_DISABLED: '1',
  }
  delete environment.VITEST
  const child = owner.start(process.execPath, [join(repository, 'apps/cli/lib/bin.js'),
    '--profile', 'web', '--patch', patch, '--host', '127.0.0.1', '--port', '0', '--no-open'],
  { cwd: workspace, env: environment, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  const completion = new Promise(resolve => child.once('close', (code, signal) => { resolve({ code, signal }) }))
  try {
    const result = await new Promise((resolve, reject) => {
      let sent = false
      deadline = setTimeout(() => { reject(new Error('Default Web memory probe did not become ready')) }, 60_000)
      const aborted = () => { reject(owner.signal.reason) }
      owner.signal.addEventListener('abort', aborted, { once: true })
      child.once('close', () => { owner.signal.removeEventListener('abort', aborted) })
      const remember = chunk => {
        logs = (logs + chunk.toString()).slice(-64_000)
        if (!sent && /dsh web: http:\/\//u.test(logs)) {
          sent = true
          child.send({ command: 'memory-probe', workspace, sessionID, write, content, expectUntrusted }, error => {
            if (error) reject(error)
          })
        }
      }
      child.stdout.on('data', remember)
      child.stderr.on('data', remember)
      child.on('message', message => {
        if (message.error) reject(new Error(message.error))
        else if (message.memory) resolve(message.memory)
      })
    })
    if (expectUntrusted) {
      assert.equal(result.untrustedWriteBlocked, true)
      return result
    }
    assert.equal(result.instances, 1, 'A user-installed bundle must not duplicate the preinstalled instance')
    assert.ok(result.home.note.includes(join(home, 'storages/meow-memory')))
    return result
  } catch (error) {
    throw new Error(`Memory Web smoke failed: ${logs.replace(/([?&]token=)[\w-]+/gu, '$1<redacted>')}`, { cause: error })
  } finally {
    clearTimeout(deadline)
    await owner.close()
    const stopped = await completion
    assert.equal(stopped.signal, null, 'Web must shut down gracefully')
    assert.equal(stopped.code, 0)
  }
}

try {
  const first = await probe('user-a', 'memory-session-one', true)
  assert.ok(first.found.hits.some(hit => hit.content === content))
  const restarted = await probe('user-a', 'memory-session-two', false)
  assert.ok(restarted.found.hits.some(hit => hit.id === first.written.id && hit.content === content))
  const isolated = await probe('user-b', 'memory-session-three', false)
  assert.equal(isolated.found.hits.length, 0, 'Another user must not see the first user memory')
  const manifestPath = join(root, 'user-a/dsh-home/profiles/web/package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.dsh.profile.bundles.push('meow-memory')
  await writeFile(manifestPath, JSON.stringify(manifest))
  const installed = await probe('user-a', 'memory-session-four', false)
  assert.ok(installed.startedBundles.includes('meow-memory'), 'The profile must really own the installed bundle')
  assert.ok(installed.found.hits.some(hit => hit.id === first.written.id))
  const database = new DatabaseSync(join(root, 'user-a/workspace/.dsh-meow/memory.db'), { readOnly: true })
  try {
    assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
    assert.equal(database.prepare('SELECT content FROM fact WHERE id = ?').get(first.written.id).content, content)
  } finally { database.close() }
  await mkdir(join(root, 'user-c/workspace/.dsh-meow'), { recursive: true })
  await copyFile(join(root, 'user-a/workspace/.dsh-meow/memory.db'), join(root, 'user-c/workspace/.dsh-meow/memory.db'))
  await probe('user-c', 'memory-session-untrusted', false, true)
  console.log(JSON.stringify({ plugin: 'meow-memory', offline: true, tools: first.tools,
    sqliteIntegrity: 'ok', restartPersistence: true, userIsolation: true, installedBundleDeduplicated: true,
    importedDatabaseTrustEnforced: true }))
} finally {
  await rm(root, { recursive: true, force: true })
}

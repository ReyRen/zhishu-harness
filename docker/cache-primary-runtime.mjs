/** Cache official locked archives with curl; the upstream builder still assembles and verifies the payload. */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const [target, directory] = process.argv.slice(2)
assert.ok(target && directory, 'Expected a primary runtime target and cache directory')
const lock = JSON.parse(await readFile(new URL('../scripts/primary-runtime/lock.json', import.meta.url), 'utf8'))
const selected = lock.targets[target]
assert.ok(selected, `Unsupported primary runtime target: ${target}`)
const timeout = Number(process.env.DSH_RESOURCE_DOWNLOAD_TIMEOUT_MS ?? '600000')
assert.ok(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 2_147_483_647, 'Invalid runtime download timeout')
const cache = resolve(directory)
await mkdir(cache, { recursive: true })
const python = `cpython-${lock.pythonVersion}+${lock.pythonRelease}-${selected.pythonTarget}-install_only_stripped.tar.gz`
const archives = [
  { url: `https://nodejs.org/dist/v${lock.nodeVersion}/node-v${lock.nodeVersion}-${selected.nodeArchive}`, sha256: selected.nodeSha256 },
  { url: `https://github.com/astral-sh/python-build-standalone/releases/download/${lock.pythonRelease}/${encodeURIComponent(python)}`, sha256: selected.pythonSha256 },
  ...selected.wheels, ...lock.wheels,
]
for (const archive of archives) {
  assert.match(archive.sha256, /^[a-f0-9]{64}$/u)
  assert.equal(new URL(archive.url).protocol, 'https:')
  const destination = join(cache, archive.sha256)
  const checksum = (bytes) => createHash('sha256').update(bytes).digest('hex')
  try {
    assert.equal(checksum(await readFile(destination)), archive.sha256, `Invalid cached archive: ${archive.url}`)
    continue
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const temporary = await mkdtemp(join(cache, '.archive-'))
  try {
    const path = join(temporary, 'download')
    console.log(`Cache primary runtime archive: ${new URL(archive.url).pathname.split('/').at(-1)}`)
    execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2',
      '--max-time', String(timeout / 1000), '--output', path, archive.url],
    { stdio: 'inherit', timeout: Math.min(2_147_483_647, 3 * timeout + 30_000) })
    assert.equal(checksum(await readFile(path)), archive.sha256, `Archive checksum mismatch: ${archive.url}`)
    await rename(path, destination)
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

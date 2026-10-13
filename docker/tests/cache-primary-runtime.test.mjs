/** Reject invalid runtime cache/configuration before starting any network download. */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const script = fileURLToPath(new URL('../cache-primary-runtime.mjs', import.meta.url))
const lock = JSON.parse(await readFile(new URL('../../scripts/primary-runtime/lock.json', import.meta.url), 'utf8'))
for (const scenario of ['unsupported-target', 'invalid-timeout', 'corrupt-cache']) {
  test(scenario, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-cache-negative-'))
    try {
      if (scenario === 'corrupt-cache') await writeFile(join(root, lock.targets['linux-x64'].nodeSha256), 'not the locked archive')
      const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(name)))
      const result = spawnSync(process.execPath, [script, scenario === 'unsupported-target' ? 'unknown-target' : 'linux-x64', root],
        { env: { ...environment, DSH_RESOURCE_DOWNLOAD_TIMEOUT_MS: scenario === 'invalid-timeout' ? '0' : '600000' },
          timeout: 20_000, encoding: 'utf8' })
      assert.equal(result.error, undefined)
      assert.equal(result.signal, null)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /Unsupported primary runtime target|Invalid runtime download timeout|Invalid cached archive/u)
      assert.ok(!result.stdout.includes('Cache primary runtime archive:'))
    } finally { await rm(root, { recursive: true, force: true }) }
  })
}

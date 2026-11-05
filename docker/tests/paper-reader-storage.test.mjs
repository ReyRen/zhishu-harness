import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const entrypoint = resolve(import.meta.dirname, '../container-entrypoint.sh')

for (const custom of [false, true]) {
  test(custom ? 'preserves the configured paper library directory' : 'stores each paper library under its persistent DSH home',
    { skip: process.platform === 'win32' }, async t => {
      const root = await mkdtemp(join(tmpdir(), 'dsh-paper-storage-'))
      t.after(() => rm(root, { recursive: true, force: true }))
      const runtime = join(root, 'runtime/primary-runtime')
      const bin = join(root, 'bin')
      for (const file of ['runtime.json', 'dependencies/python/bin/python3', 'dependencies/node/bin/node',
        '../office-skills/office/SKILL.md']) {
        const path = join(runtime, file)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, '')
        await chmod(path, 0o700)
      }
      await mkdir(bin)
      await writeFile(join(bin, 'node'), '#!/usr/bin/env bash\nprintf "%s" "$DSH_PAPER_READER_DATA"\n', { mode: 0o700 })
      const results = []
      for (const user of ['first', 'second']) {
        const home = join(root, user, 'dsh-home')
        const chosen = join(root, user, 'chosen-library')
        const { stdout } = await execute('bash', [entrypoint], { env: { ...process.env,
          PATH: `${bin}:${process.env.PATH}`, DSH_HOME: home, DSH_PRIMARY_RUNTIME: runtime,
          DSH_PUBLIC_AUTHORITY: 'offline.localhost:3081', DSH_DEFAULT_WORKSPACE: join(root, user, 'workspace'),
          DSH_PAPER_READER_DATA: custom ? chosen : '' } })
        assert.equal(stdout, custom ? chosen : join(home, 'storages/dsh-paper-reader'))
        results.push(stdout)
      }
      assert.notEqual(results[0], results[1])
    })
}

/** Prepare the container's immutable registry using the Desktop package metadata writer. Run with tsx. */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pluginMarketPackages, seedPluginMarketStorage, workbenchMarketPackages } from '../apps/desktop/src/plugin-market.ts'

const source = resolve(import.meta.dirname, '../market-registry')
const output = resolve(process.argv[2])
const staging = mkdtempSync(join(tmpdir(), 'dsh-market-prepare-'))
try {
  const packages = []
  const versions = new Set()
  for (const filename of readdirSync(join(source, 'tarballs')).sort()) {
    if (!filename.endsWith('.tgz')) continue
    const packed = join(source, 'tarballs', filename)
    const result = spawnSync('tar', ['-xOf', packed, 'package/package.json'], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
    })
    if (result.error || result.status !== 0) throw new Error(`Cannot read bundled package ${filename}`, { cause: result.error })
    const { name, version } = JSON.parse(result.stdout)
    if (typeof name !== 'string' || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(name)
      || typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/u.test(version)) {
      throw new Error(`Invalid package name/version in ${filename}`)
    }
    const key = `${name}@${version}`
    if (versions.has(key)) throw new Error(`Duplicate bundled package ${key}`)
    versions.add(key)
    const alias = join(staging, `${name.replace(/^@/u, '').replaceAll('/', '-')}-${version}.tgz`)
    mkdirSync(dirname(alias), { recursive: true })
    copyFileSync(packed, alias)
    packages.push({ name, version })
  }
  for (const item of [...pluginMarketPackages(join(source, 'plugins.json')), ...workbenchMarketPackages(join(source, 'workbenches.json'))]) {
    if (!versions.has(`${item.name}@${item.version}`)) throw new Error(`Missing catalog tarball: ${item.name}@${item.version}`)
  }
  mkdirSync(output, { recursive: true })
  seedPluginMarketStorage(join(output, 'storage'), staging, packages)
  copyFileSync(join(source, 'plugins.json'), join(output, 'plugins.json'))
  copyFileSync(join(source, 'workbenches.json'), join(output, 'workbenches.json'))
  console.log(`Prepared offline registry: ${packages.length} package versions`)
} finally {
  rmSync(staging, { recursive: true, force: true })
}

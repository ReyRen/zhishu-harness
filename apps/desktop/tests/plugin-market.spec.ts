import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  packagedPluginMarketRoot,
  pluginMarketHostEnvironment,
  pluginMarketPackages,
  seedPluginMarketStorage,
} from '../src/plugin-market.ts'

const SOURCE = resolve(import.meta.dirname, '..', '..', '..', 'market-registry')
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('desktop plugin market', () => {
  it('points the host at the loopback source after any inherited peer-install setting', () => {
    const environment = pluginMarketHostEnvironment({
      PATH: 'kept',
      npm_config_auto_install_peers: 'true',
      DSH_HOME: 'home',
    })
    expect(environment.PATH).toBe('kept')
    expect(environment.DSH_HOME).toBe('home')
    expect(environment.DSHM_REGISTRY_URL).toBe('http://127.0.0.1:4874/plugins.json')
    expect(environment.DSHM_NPM_MIRROR).toBe('http://127.0.0.1:4873')
    expect(environment.npm_config_auto_install_peers).toBe('false')
    expect(environment.pnpm_config_auto_install_peers).toBe('false')
  })

  it('ignores a resources directory that does not carry verdaccio', () => {
    expect(packagedPluginMarketRoot(undefined)).toBeUndefined()
    expect(packagedPluginMarketRoot(join(import.meta.dirname, 'missing-market'))).toBeUndefined()
  })

  it('seeds installable metadata from the catalog tarballs', () => {
    const storage = mkdtempSync(join(tmpdir(), 'plugin-market-'))
    directories.push(storage)
    const packages = pluginMarketPackages(join(SOURCE, 'plugins.json'))
    expect(packages.map(item => `${item.name}@${item.version}`)).toEqual([
      'open-sea-skin@1.2.5',
    ])
    seedPluginMarketStorage(storage, join(SOURCE, 'tarballs'), packages)
    const metadata = JSON.parse(readFileSync(join(storage, 'open-sea-skin', 'package.json'), 'utf8')) as {
      versions: Record<string, { dist: { tarball: string } }>
      'dist-tags': { latest: string }
    }
    expect(metadata['dist-tags'].latest).toBe('1.2.5')
    expect(metadata.versions['1.2.5']?.dist.tarball).toBe('http://127.0.0.1:4873/open-sea-skin/-/open-sea-skin-1.2.5.tgz')
    expect(readFileSync(join(storage, 'open-sea-skin', 'open-sea-skin-1.2.5.tgz')).byteLength).toBeGreaterThan(0)
    const index = JSON.parse(readFileSync(join(storage, '.verdaccio-db.json'), 'utf8')) as { list: string[]; secret: string }
    expect(index.list).toEqual(['open-sea-skin'])
    expect(index.secret).toHaveLength(32)
  })
})

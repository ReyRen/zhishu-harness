import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  packagedPluginMarketRoot,
  pluginMarketHostEnvironment,
  pluginMarketPackages,
  seedPluginMarketStorage,
  tarballMarketPackages,
  workbenchMarketPackages,
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
      'open-sea-skin@1.2.6',
      '@zhishu/dsh-paper-reader@1.6.0',
    ])
    seedPluginMarketStorage(storage, join(SOURCE, 'tarballs'), packages)
    const metadata = JSON.parse(readFileSync(join(storage, 'open-sea-skin', 'package.json'), 'utf8')) as {
      versions: Record<string, { dist: { tarball: string } }>
      'dist-tags': { latest: string }
    }
    expect(metadata['dist-tags'].latest).toBe('1.2.6')
    expect(metadata.versions['1.2.6']?.dist.tarball).toBe('http://127.0.0.1:4873/open-sea-skin/-/open-sea-skin-1.2.6.tgz')
    expect(readFileSync(join(storage, 'open-sea-skin', 'open-sea-skin-1.2.6.tgz')).byteLength).toBeGreaterThan(0)
    const paper = JSON.parse(readFileSync(join(storage, '@zhishu', 'dsh-paper-reader', 'package.json'), 'utf8')) as {
      versions: Record<string, { dist: { tarball: string } }>
      'dist-tags': { latest: string }
    }
    expect(paper['dist-tags'].latest).toBe('1.6.0')
    expect(paper.versions['1.6.0']?.dist.tarball).toBe(
      'http://127.0.0.1:4873/@zhishu/dsh-paper-reader/-/zhishu-dsh-paper-reader-1.6.0.tgz',
    )
    const index = JSON.parse(readFileSync(join(storage, '.verdaccio-db.json'), 'utf8')) as { list: string[]; secret: string }
    expect(index.list).toEqual(['open-sea-skin', '@zhishu/dsh-paper-reader'])
    expect(index.secret).toHaveLength(32)
  })

  it('names the workbench packages published from the private catalog', () => {
    expect(workbenchMarketPackages(join(SOURCE, 'workbenches.json')).map(item => `${item.name}@${item.version}`)).toEqual([
      'deepseek-harness-daily@0.4.10',
      'dsh-mind-workbench@1.0.15',
      'dsh-xiaohongshu-note-workbench@0.1.1',
      'dsh-bianqu-workbench@0.1.1',
    ])
  })

  it('uses npm-pack filenames for scoped packages', () => {
    const root = mkdtempSync(join(tmpdir(), 'scoped-market-'))
    directories.push(root)
    const manifest = Buffer.from(JSON.stringify({ name: '@example/skin', version: '1.0.0' }))
    const archive = Buffer.alloc(2048)
    archive.write('package/package.json', 0)
    archive.write(`${manifest.length.toString(8).padStart(11, '0')}\0`, 124)
    manifest.copy(archive, 512)
    writeFileSync(join(root, 'example-skin-1.0.0.tgz'), gzipSync(archive))
    seedPluginMarketStorage(join(root, 'storage'), root, [{ name: '@example/skin', version: '1.0.0' }])
    const stored = join(root, 'storage', '@example', 'skin')
    expect(readFileSync(join(stored, 'example-skin-1.0.0.tgz'))).toEqual(gzipSync(archive))
    const metadata = JSON.parse(readFileSync(join(stored, 'package.json'), 'utf8')) as {
      versions: Record<string, { dist: { tarball: string } }>
    }
    expect(metadata.versions['1.0.0']?.dist.tarball).toBe('http://127.0.0.1:4873/@example/skin/-/example-skin-1.0.0.tgz')
  })

  it('preserves registry publication times and signatures for locked dependency metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'policy-market-'))
    directories.push(root)
    const bytes = Buffer.from('integrity-locked registry archive')
    const filename = 'example-runtime-1.0.0.tgz'
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
    const signatures = [{ keyid: 'registry-key', sig: 'registry-signature' }]
    const manifest = { name: '@example/runtime', version: '1.0.0', dist: { integrity, signatures } }
    writeFileSync(join(root, filename), bytes)
    writeFileSync(join(root, 'registry-metadata.json'), JSON.stringify({ [filename]: {
      manifest, publishedAt: '2026-01-01T00:00:00.000Z',
    } }))
    const packages = tarballMarketPackages(root)
    seedPluginMarketStorage(join(root, 'storage'), root, packages)
    const result = JSON.parse(readFileSync(join(root, 'storage', '@example/runtime/package.json'), 'utf8')) as {
      time: Record<string, string>
      versions: Record<string, { dist: { integrity: string; signatures: typeof signatures; tarball: string } }>
    }
    expect(result.time['1.0.0']).toBe('2026-01-01T00:00:00.000Z')
    expect(result.versions['1.0.0']?.dist).toEqual({ integrity, signatures,
      shasum: createHash('sha1').update(bytes).digest('hex'),
      tarball: 'http://127.0.0.1:4873/@example/runtime/-/example-runtime-1.0.0.tgz',
    })
    writeFileSync(join(root, filename), 'modified bytes')
    expect(() => { seedPluginMarketStorage(join(root, 'other-storage'), root, packages) }).toThrow(/integrity mismatch/u)
  })
})

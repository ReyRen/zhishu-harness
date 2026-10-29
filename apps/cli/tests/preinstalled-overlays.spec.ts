/** Installed bundles and preinstalled overlays must not duplicate their Loader rows. */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { profileOwnsOverlayBundle } from '../src/preinstalled-overlays.ts'

describe('platform plugin distribution', () => {
  const root = new URL('../../../', import.meta.url)
  const cli = new URL('apps/cli/package.json', root)
  const cliRequire = createRequire(cli)
  const hostRequire = createRequire(new URL('apps/desktop-host/package.json', root))
  const source = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
  const host = JSON.parse(readFileSync(new URL('apps/desktop-host/package.json', root), 'utf8'))
  const published = JSON.parse(readFileSync(cli, 'utf8'))

  it.each([['dshmarket', '1.66.22'], ['meow-memory', '0.32.1']])(
    'ships %s through platform assemblies and shares the Host runtime', (name, version) => {
      expect(source.devDependencies[name]).toBe(version)
      expect(host.dependencies[name]).toBe(version)
      expect(published.dependencies[name]).toBeUndefined()
      for (const resolveFrom of [cliRequire, hostRequire]) {
        const installed = resolveFrom.resolve(`${name}/package.json`)
        expect(JSON.parse(readFileSync(installed, 'utf8')).version).toBe(version)
        const pluginRequire = createRequire(installed)
        for (const peer of name === 'dshmarket'
          ? ['@deepseek-ai/cordis', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-settings']
          : ['@deepseek-ai/schemastery', '@deepseek-ai/dsh-llm']) {
          expect(realpathSync(pluginRequire.resolve(peer))).toBe(realpathSync(cliRequire.resolve(peer)))
        }
      }
    },
  )
})

function directory(manifest?: object): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-preinstalled-overlay-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const overlay = join(root, 'overlay')
  mkdirSync(overlay)
  if (manifest !== undefined) writeFileSync(join(overlay, 'package.json'), JSON.stringify(manifest))
  return overlay
}

describe('preinstalled bundle ownership', () => {
  it.each(['dshmarket', 'meow-memory'])('defers to the installed %s bundle', (name) => {
    const overlay = directory({ name, dsh: { bundle: { patch: './cordis.patch.yml' } } })
    expect(profileOwnsOverlayBundle(overlay, [{ packageName: name }])).toBe(true)
    expect(profileOwnsOverlayBundle(overlay, [{ packageName: 'another-bundle' }])).toBe(false)
  })

  it('keeps ordinary overlays even when their package name matches a profile', () => {
    const overlay = directory({ name: 'brand', dsh: { client: { platform: 'web' } } })
    expect(profileOwnsOverlayBundle(overlay, [{ packageName: 'brand' }])).toBe(false)
    expect(profileOwnsOverlayBundle(directory(), [])).toBe(false)
  })

  it('rejects a bundle manifest without its identity', () => {
    const overlay = directory({ dsh: { bundle: { patch: './cordis.patch.yml' } } })
    expect(() => profileOwnsOverlayBundle(overlay, [])).toThrow('Overlay bundle has no package name')
  })
})

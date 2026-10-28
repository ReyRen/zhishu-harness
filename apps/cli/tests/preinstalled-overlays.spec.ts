/** Installed bundles and preinstalled overlays must not duplicate their Loader rows. */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { profileOwnsOverlayBundle } from '../src/preinstalled-overlays.ts'

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

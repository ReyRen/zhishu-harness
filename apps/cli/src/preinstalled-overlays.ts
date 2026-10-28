/** Preinstalled bundle overlays defer to a profile's installed copy. */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Read the overlay's standard bundle manifest to avoid mounting a bundle twice.
 * @param directory - Overlay directory whose package may declare a bundle.
 * @param layers - Effective profile bundle identities.
 * @returns Whether a profile layer already owns this overlay's bundle.
 */
export function profileOwnsOverlayBundle(
  directory: string,
  layers: readonly { packageName: string }[],
): boolean {
  const filename = join(directory, 'package.json')
  if (!existsSync(filename)) return false
  const manifest: unknown = JSON.parse(readFileSync(filename, 'utf8'))
  if (typeof manifest !== 'object' || manifest === null) throw new Error(`Invalid overlay manifest: ${filename}`)
  if (!('dsh' in manifest) || typeof manifest.dsh !== 'object' || manifest.dsh === null
    || !('bundle' in manifest.dsh)) return false
  if (!('name' in manifest) || typeof manifest.name !== 'string' || manifest.name === '') {
    throw new Error(`Overlay bundle has no package name: ${filename}`)
  }
  return layers.some(layer => layer.packageName === manifest.name)
}

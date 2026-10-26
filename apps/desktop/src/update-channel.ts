/** Resolve the update channel sealed into the installed application manifest. */

/** Installer-owned channel, independent of release version and upload environment. */
export type DesktopUpdateChannel = 'nightly' | 'latest'

/**
 * Read the packaged channel; older manifests retain their existing nightly behavior.
 * @param manifest Parsed application manifest.
 * @returns Validated channel. Invalid explicit values reject instead of changing feeds.
 */
export function desktopUpdateChannel(manifest: unknown): DesktopUpdateChannel {
  if (typeof manifest !== 'object' || manifest === null) throw new Error('desktop update: invalid application manifest')
  if (!('dshDesktopUpdateChannel' in manifest)) return 'nightly'
  const channel = manifest.dshDesktopUpdateChannel
  if (channel !== 'nightly' && channel !== 'latest') throw new Error('desktop update: invalid packaged channel')
  return channel
}

/**
 * Unsigned Windows packages opt out because they have no publisher certificate.
 * Older and signed manifests keep verification.
 * @param manifest Parsed application manifest.
 * @returns Whether the downloaded installer must match a publisher signature.
 */
export function desktopUpdateVerifiesCodeSignature(manifest: unknown): boolean {
  if (typeof manifest !== 'object' || manifest === null) throw new Error('desktop update: invalid application manifest')
  if (!('dshDesktopVerifyUpdateSignature' in manifest)) return true
  if (typeof manifest.dshDesktopVerifyUpdateSignature !== 'boolean') {
    throw new Error('desktop update: invalid packaged signature verification')
  }
  return manifest.dshDesktopVerifyUpdateSignature
}

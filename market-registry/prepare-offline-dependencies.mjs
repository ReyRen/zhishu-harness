/** Download integrity-locked registry dependencies at packaging time, without running package scripts. */
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Prepare tarballs and original npm metadata for dependencies of existing user profiles.
 * Downloads happen only while packaging. A missing version or integrity mismatch fails the build.
 * @param {{ lockPath: string, tarballsDir: string, cacheDir?: string, fetchImpl?: typeof fetch }} options - Locked inputs and packaging-owned output/cache directories.
 * @returns {Promise<number>} Number of prepared package versions.
 */
export async function prepareOfflineDependencies({ lockPath, tarballsDir, cacheDir = tarballsDir, fetchImpl = fetch }) {
  const lock = JSON.parse(await readFile(lockPath, 'utf8'))
  if (lock.version !== 1 || !Array.isArray(lock.packages)) throw new Error(`Invalid offline dependency lock: ${lockPath}`)
  const seen = new Set()
  for (const item of lock.packages) {
    if (typeof item.name !== 'string' || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(item.name)
      || typeof item.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/u.test(item.version)
      || typeof item.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(item.integrity)) {
      throw new Error(`Invalid locked offline dependency in ${lockPath}`)
    }
    const key = `${item.name}@${item.version}`
    if (seen.has(key)) throw new Error(`Duplicate offline dependency: ${key}`)
    seen.add(key)
  }
  await mkdir(tarballsDir, { recursive: true })
  await mkdir(cacheDir, { recursive: true })
  const documents = new Map()
  const metadata = {}
  for (const item of lock.packages) {
    let document = documents.get(item.name)
    if (document === undefined) {
      const response = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(item.name)}`, {
        signal: AbortSignal.timeout(120_000),
      })
      if (!response.ok) throw new Error(`Offline dependency metadata unavailable: ${item.name} (HTTP ${response.status})`)
      document = await response.json()
      if (document.name !== item.name) throw new Error(`Offline dependency metadata names another package: ${item.name}`)
      documents.set(item.name, document)
    }
    const manifest = document.versions?.[item.version]
    const publishedAt = document.time?.[item.version]
    if (manifest?.name !== item.name || manifest.version !== item.version || manifest.dist?.integrity !== item.integrity
      || typeof publishedAt !== 'string' || !Number.isFinite(Date.parse(publishedAt))) {
      throw new Error(`Offline dependency metadata does not match the lock: ${item.name}@${item.version}`)
    }
    const tarball = new URL(manifest.dist.tarball)
    if (tarball.protocol !== 'https:' || tarball.hostname !== 'registry.npmjs.org' || tarball.username || tarball.password) {
      throw new Error(`Offline dependency tarball is outside the npm registry: ${item.name}@${item.version}`)
    }
    const filename = `${item.name.replace(/^@/u, '').replaceAll('/', '-')}-${item.version}.tgz`
    const cached = join(cacheDir, filename)
    let bytes
    try {
      bytes = await readFile(cached)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      const response = await fetchImpl(tarball.href, { signal: AbortSignal.timeout(120_000) })
      if (!response.ok) throw new Error(`Offline dependency tarball unavailable: ${item.name}@${item.version} (HTTP ${response.status})`)
      bytes = Buffer.from(await response.arrayBuffer())
    }
    if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== item.integrity) {
      throw new Error(`Offline dependency integrity mismatch: ${item.name}@${item.version}`)
    }
    const destination = join(tarballsDir, filename)
    if (cached !== destination) {
      await writeFile(cached, bytes)
      await copyFile(cached, destination)
    } else {
      await writeFile(destination, bytes)
    }
    metadata[filename] = { manifest, publishedAt }
  }
  const destination = join(tarballsDir, 'registry-metadata.json')
  const temporary = `${destination}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(metadata)}\n`)
  await rename(temporary, destination)
  return lock.packages.length
}

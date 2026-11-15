/** Build the versioned Zhishu mind-map package from the pinned upstream archive. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create, extract } from 'tar'

/** Private-registry version of the reviewed Web compatibility patch. */
export const mindWorkbenchVersion = '1.0.16-zhishu.1'

/**
 * Prepare a reproducible archive beside the original upstream package.
 * @param tarballsDir - directory containing the pinned upstream archive and receiving the patched archive.
 * @returns the prepared archive path.
 */
export async function prepareMindWorkbench(tarballsDir) {
  const base = join(tarballsDir, 'dsh-mind-workbench-1.0.15.tgz')
  const original = await readFile(base)
  const hash = createHash('sha256').update(original).digest('hex')
  if (hash !== 'c293cd7554c239d61d0dd1d0672c9413b9c0e5a80ddf58b473886b4ee2952d07') throw new Error('Mind-map upstream archive does not match the reviewed patch')
  const stage = await mkdtemp(join(tmpdir(), 'dsh-mind-package-'))
  const packed = join(tarballsDir, `dsh-mind-workbench-${mindWorkbenchVersion}.tgz`)
  const temporary = join(stage, 'patched.tgz')
  try {
    await extract({ file: base, cwd: stage })
    const root = join(stage, 'package')
    // The reviewed upstream archive contains CRLF sources; patch matching must not depend on Git's host defaults.
    for (const file of ['app/bridge.js', 'lib/client.js', 'dsh/index.js']) {
      const path = join(root, file)
      await writeFile(path, (await readFile(path, 'utf8')).replaceAll('\r\n', '\n'))
    }
    const patch = join(import.meta.dirname, 'patches/dsh-mind-workbench-1.0.15.patch')
    execFileSync('git', ['-c', 'core.autocrlf=false', 'apply', '--unidiff-zero', '--whitespace=error', '--', patch], {
      cwd: root, timeout: 10_000, stdio: 'pipe',
    })
    const manifestPath = join(root, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (manifest.name !== 'dsh-mind-workbench' || manifest.version !== '1.0.15') throw new Error('Unexpected mind-map upstream manifest')
    manifest.version = mindWorkbenchVersion
    manifest.description += '（智枢 Web 兼容版）'
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    const files = []
    async function visit(path) {
      files.push(path)
      for (const item of (await readdir(join(stage, path), { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        const child = `${path}/${item.name}`
        if (item.isDirectory()) await visit(child)
        else if (item.isFile()) files.push(child)
        else throw new Error(`Mind-map archive contains an unsupported entry: ${child}`)
      }
    }
    await visit('package')
    await create({ file: temporary, cwd: stage, gzip: true, portable: true, noDirRecurse: true, mtime: new Date(0) }, files)
    // The temporary package can be on another filesystem than the artifact directory.
    await writeFile(packed + '.tmp', await readFile(temporary))
    await rename(packed + '.tmp', packed)
    return packed
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

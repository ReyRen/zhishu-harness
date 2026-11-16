/** Package Workflow's prebuilt CPU dependencies without installation hooks or changes to runtime code. */
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create, extract } from 'tar'

const originals = {
  '@huggingface/transformers': '4.2.0',
  'onnxruntime-node': '1.24.3',
  'onnxruntime-web': '1.26.0-dev.20260416-b7804b056c',
  sharp: '0.34.5',
  protobufjs: '7.6.6',
}

/** Exact versions whose compiled payload is delivered without installation hooks. */
export const workflowRuntimeVersions = Object.freeze(Object.fromEntries(Object.entries(originals).map(([name, version]) =>
  [name, `${version}${version.includes('-') ? '.' : '-'}zhishu-runtime.1`])))

/**
 * Preserve the runtime manifest while selecting the reviewed, script-free dependency graph.
 * @param {{name: string, version: string, gypfile?: boolean, dependencies?: Record<string, string>, optionalDependencies?: Record<string, string>, [key: string]: unknown}} original - Manifest from a hash-verified npm archive.
 * @returns {Record<string, unknown>} Private-release manifest retaining exports, licenses, platform binaries and optional packages.
 */
export function offlineWorkflowManifest(original) {
  if (originals[original.name] !== original.version) throw new Error('Unexpected Workflow runtime manifest')
  if (original.gypfile === true) throw new Error(`Workflow runtime requires an unreviewed native build: ${original.name}`)
  const manifest = { ...original, version: workflowRuntimeVersions[original.name] }
  delete manifest.scripts
  delete manifest.devDependencies
  delete manifest.dist
  for (const section of ['dependencies', 'optionalDependencies']) {
    if (original[section] === undefined) continue
    manifest[section] = Object.fromEntries(Object.entries(original[section]).map(([name, version]) =>
      [name, workflowRuntimeVersions[name] ?? version]))
  }
  manifest.zhishuSource = { name: original.name, version: original.version, runtime: 'prebuilt-cpu', installationScripts: 'omitted' }
  return manifest
}

/**
 * Prepare distinct private versions from integrity-locked npm payloads; no scripts run and no public metadata is overwritten.
 * @param {string} tarballsDir - Verified dependency archives and metadata produced by prepareOfflineDependencies.
 * @returns {Promise<number>} Number of prepared private runtime packages.
 */
export async function prepareWorkflowRuntime(tarballsDir) {
  const lock = JSON.parse(await readFile(new URL('./offline-dependencies.lock.json', import.meta.url), 'utf8'))
  const metadataPath = join(tarballsDir, 'registry-metadata.json')
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
  for (const [name, version] of Object.entries(originals)) {
    const entry = lock.packages.find(item => item.name === name && item.version === version)
    if (!entry) throw new Error(`Workflow runtime is absent from the dependency lock: ${name}@${version}`)
    const filename = `${name.replace(/^@/u, '').replaceAll('/', '-')}-${version}.tgz`
    const source = join(tarballsDir, filename)
    const bytes = await readFile(source)
    if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== entry.integrity) throw new Error(`Workflow runtime integrity mismatch: ${name}`)
    const stage = await mkdtemp(join(tmpdir(), 'workflow-runtime-'))
    const outputName = `${name.replace(/^@/u, '').replaceAll('/', '-')}-${workflowRuntimeVersions[name]}.tgz`
    const temporary = join(tarballsDir, `${outputName}.${randomUUID()}.tmp`)
    try {
      await extract({ file: source, cwd: stage })
      const manifestPath = join(stage, 'package/package.json')
      const manifest = offlineWorkflowManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
      const files = []
      async function visit(path) {
        if (path === 'package/binding.gyp') throw new Error(`Workflow runtime requires an unreviewed native build: ${name}`)
        files.push(path)
        for (const item of (await readdir(join(stage, path), { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
          const child = `${path}/${item.name}`
          if (item.isDirectory()) await visit(child)
          else if (item.isFile()) {
            if (child === 'package/binding.gyp') throw new Error(`Workflow runtime requires an unreviewed native build: ${name}`)
            files.push(child)
          } else throw new Error(`Unsupported Workflow runtime archive entry: ${child}`)
        }
      }
      await visit('package')
      const archive = join(stage, 'runtime.tgz')
      await create({ file: archive, cwd: stage, gzip: true, portable: true, noDirRecurse: true, mtime: new Date(0) }, files)
      const packed = await readFile(archive)
      await copyFile(archive, temporary)
      await rename(temporary, join(tarballsDir, outputName))
      metadata[outputName] = { manifest: { ...manifest, dist: { integrity: `sha512-${createHash('sha512').update(packed).digest('base64')}` } },
        publishedAt: '2026-11-16T00:00:00.000Z' }
    } finally {
      await rm(temporary, { force: true })
      await rm(stage, { recursive: true, force: true })
    }
  }
  const temporary = `${metadataPath}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(metadata)}\n`)
  await rename(temporary, metadataPath)
  return Object.keys(originals).length
}

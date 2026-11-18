/** Assemble the reviewed Workflow plugin and its integrity-locked local embedding model. */
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { create, extract } from 'tar'
import { workflowRuntimeVersions } from './prepare-workflow-runtime.mjs'

/** Private-registry release of the Web-authenticated, offline Workflow package. */
export const visualWorkflowVersion = '1.4.0-zhishu.1'

const retainedReleases = [{
  version: '0.11.1-zhishu.1', upstreamVersion: '0.11.0',
  archive: new URL('./sources/dsh-visual-workflow-420d89c.tgz', import.meta.url),
  sourceHash: '92b45a5e6b8fed52cbe4e832725b1871a7a673735883aee2ca72a828e9fb3f0e',
  outputHash: 'c3f9879948fbef5cb0ccb5296bfdb771c6e47f5bdfc410d5257df6548eea53ac',
}, {
  version: '1.1.1-zhishu.1', upstreamVersion: '1.1.1',
  archive: new URL('./sources/dsh-visual-workflow-e3d9335.tgz', import.meta.url),
  sourceHash: '770e216de494bbb3a91493559305df42e3e9aad94c3e796cde5ed778aa8f142f',
  outputHash: '0bb7d2ece3d32c9afb6517568191d14046449edff80e64f96618838193ffa064',
}, {
  version: '1.3.0-zhishu.1', upstreamVersion: '1.3.0',
  archive: new URL('./sources/dsh-visual-workflow-ffda808.tgz', import.meta.url),
  sourceHash: 'f43dc3dd7ce82af93b144304378bed23e6ceeb3ab05e18037026b7a4aa6f3791',
  outputHash: '20dd81725c020d7598407c1bb7dcdc9cd5326fba00444da46a471ca7173e7033',
  dependencies: { 'dsh-dify-migrator': '0.3.0-zhishu.1', yaml: '2.8.1' },
}]
const currentRelease = {
  version: visualWorkflowVersion, upstreamVersion: '1.4.0',
  archive: new URL('./sources/dsh-visual-workflow-3d35005.tgz', import.meta.url),
  sourceHash: '2446bcbb9f1e7cef1fb4c6cc6b0f682536af4c165a0e050996d0182fd3d6c355',
  dependencies: { 'dsh-dify-migrator': '0.4.0-zhishu.1', yaml: '2.8.1' },
}
const modelWeight = 'onnx/model_quantized.onnx'

/**
 * Write the current plugin archive and retain byte-identical releases referenced by installed profile lockfiles.
 * @param {string} tarballsDir - Output directory for the installable package.
 * @param {{cacheDir?: string, allowDownload?: boolean}} [options] - Verified model cache and packaging-only download permission.
 * @returns {Promise<string>} Prepared archive path. Missing or altered resources reject the operation.
 */
export async function prepareVisualWorkflow(tarballsDir, { cacheDir = process.env.DSH_MARKET_CACHE ?? join(tarballsDir, '.cache'), allowDownload = false } = {}) {
  const options = { cacheDir, allowDownload }
  for (const release of retainedReleases) await prepareRelease(tarballsDir, release, options)
  return prepareRelease(tarballsDir, currentRelease, options)
}

/**
 * Preserve the reviewed payload and reject any change to an archive referenced by existing lockfiles.
 * @param {string} tarballsDir - Output directory.
 * @param {{version: string, upstreamVersion: string, archive: URL, sourceHash: string, outputHash?: string, dependencies?: Record<string, string>}} release - Pinned source, dependencies, and retained archive checksum.
 * @param {{cacheDir: string, allowDownload: boolean}} options - Packaging cache and download permission.
 * @returns {Promise<string>} Complete installable archive.
 */
async function prepareRelease(tarballsDir, release, { cacheDir, allowDownload }) {
  const original = await readFile(release.archive)
  if (sha256(original) !== release.sourceHash) throw new Error('Workflow source archive does not match the reviewed release')
  const stage = await mkdtemp(join(tmpdir(), 'dsh-workflow-package-'))
  const packed = join(tarballsDir, `dsh-visual-workflow-${release.version}.tgz`)
  const temporary = `${packed}.${randomUUID()}.tmp`
  try {
    await extract({ file: fileURLToPath(release.archive), cwd: stage })
    const root = join(stage, 'package')
    const model = join(root, 'assets/models/bge-small-zh-v1.5')
    const modelManifestPath = join(model, 'manifest.json')
    const modelManifest = JSON.parse(await readFile(modelManifestPath, 'utf8'))
    const expected = modelManifest.files[modelWeight]
    const cached = join(cacheDir, `visual-workflow-model-${expected.sha256}.onnx`)
    let weight
    try {
      weight = await readFile(cached)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      if (!allowDownload) throw new Error(`Workflow model is missing from ${cacheDir}; prepare it on the packaging machine before offline deployment`)
      const response = await fetch(modelManifest.onnxSourceUrl, { signal: AbortSignal.timeout(600_000) })
      if (!response.ok) throw new Error(`Workflow model download failed (HTTP ${response.status})`)
      weight = Buffer.from(await response.arrayBuffer())
    }
    if (weight.length !== expected.bytes || sha256(weight) !== expected.sha256) throw new Error('Workflow model integrity mismatch')
    await mkdir(cacheDir, { recursive: true })
    await writeFile(cached, weight)
    await mkdir(join(model, 'onnx'), { recursive: true })
    await writeFile(join(model, modelWeight), weight)
    for (const [file, entry] of Object.entries(modelManifest.files)) {
      const bytes = await readFile(join(model, file))
      if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw new Error(`Workflow model integrity mismatch: ${file}`)
    }
    modelManifest.source = 'https://huggingface.co/BAAI/bge-small-zh-v1.5; https://huggingface.co/Xenova/bge-small-zh-v1.5'
    await writeFile(modelManifestPath, `${JSON.stringify(modelManifest, null, 2)}\n`)
    await copyFile(new URL('./patches/visual-workflow-web-server.mjs', import.meta.url), join(root, 'lib/web-server.js'))
    await rm(join(root, 'lib/web-server.js.map'), { force: true })
    const manifestPath = join(root, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (manifest.name !== 'dsh-visual-workflow' || manifest.version !== release.upstreamVersion) throw new Error('Unexpected Workflow source manifest')
    manifest.version = release.version
    Object.assign(manifest.dependencies, release.dependencies)
    manifest.dependencies['@huggingface/transformers'] = workflowRuntimeVersions['@huggingface/transformers']
    manifest.repository = { type: 'git', url: 'https://github.com/etoilestar/dsh-Visual-Workflow.git' }
    manifest.engines = { ...manifest.engines, dsh: '>=0.2.2-rc.2 <0.3.0-0' }
    manifest.optionalDependencies = { mysql2: '3.24.6', pg: '8.23.1' }
    delete manifest.private
    delete manifest.devDependencies
    delete manifest.scripts
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const files = []
    async function visit(path) {
      files.push(path)
      for (const entry of (await readdir(join(stage, path), { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        const child = `${path}/${entry.name}`
        if (entry.isDirectory()) await visit(child)
        else if (entry.isFile()) files.push(child)
        else throw new Error(`Workflow archive contains an unsupported entry: ${child}`)
      }
    }
    await visit('package')
    await mkdir(tarballsDir, { recursive: true })
    await create({ file: join(stage, 'plugin.tgz'), cwd: stage, gzip: true, portable: true, noDirRecurse: true, mtime: new Date(0) }, files)
    if (release.outputHash !== undefined && sha256(await readFile(join(stage, 'plugin.tgz'))) !== release.outputHash) {
      throw new Error('Workflow retained archive integrity changed; existing profile lockfiles cannot use it')
    }
    await copyFile(join(stage, 'plugin.tgz'), temporary)
    await rename(temporary, packed)
    return packed
  } finally {
    await rm(temporary, { force: true })
    await rm(stage, { recursive: true, force: true })
  }
}

/** @param {Buffer} bytes - Immutable resource bytes. @returns {string} Lowercase SHA-256. */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

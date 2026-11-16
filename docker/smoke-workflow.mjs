/** Verify the installed Workflow package can embed Chinese text using only its bundled local model. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = join(process.env.DSH_HOME, 'profiles/web/node_modules/dsh-visual-workflow')
const model = join(root, 'assets/models/bge-small-zh-v1.5')
const manifest = JSON.parse(await readFile(join(model, 'manifest.json'), 'utf8'))
for (const [file, entry] of Object.entries(manifest.files)) {
  const bytes = await readFile(join(model, file))
  assert.equal(bytes.length, entry.bytes, file)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, file)
}
const { EmbeddingService } = await import(pathToFileURL(join(root, 'lib/embedding/engine.js')).href)
const fromWorkflow = createRequire(join(root, 'package.json'))
const fromTransformers = createRequire(fromWorkflow.resolve('@huggingface/transformers'))
const sharp = fromTransformers('sharp')
const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).png().toBuffer()
assert.equal(png.subarray(1, 4).toString(), 'PNG', 'The prebuilt image library must work without its install hook')
const fromWebRuntime = createRequire(fromTransformers.resolve('onnxruntime-web'))
const protobuf = fromWebRuntime('protobufjs')
const message = protobuf.Root.fromJSON({ nested: { Probe: { fields: { value: { type: 'string', id: 1 } } } } }).lookupType('Probe')
assert.equal(message.decode(message.encode({ value: 'offline' }).finish()).value, 'offline')
const engine = new EmbeddingService({ logger: { warn(message) { throw new Error(message) } } })
try {
  assert.equal(await engine.ensureReady(), 'local', 'The packaged model must not fall back to non-semantic search')
  const [vector] = await engine.embed(['在离线环境中检索工作流知识'])
  assert.equal(vector.length, 512)
  assert.ok([...vector].every(Number.isFinite))
  assert.ok(Math.abs([...vector].reduce((sum, value) => sum + value ** 2, 0) - 1) < 1e-5)
  console.log('Workflow: prebuilt CPU/image libraries, bundled model hashes and offline 512-dimensional embedding passed')
} finally {
  engine.dispose()
}

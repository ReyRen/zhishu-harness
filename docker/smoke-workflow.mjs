/** Verify the installed Workflow package can embed Chinese text using only its bundled local model. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = join(process.env.DSH_HOME, 'profiles/web/node_modules/dsh-visual-workflow')
const { FlowStore } = await import(pathToFileURL(join(root, 'lib/storage/flow-store.js')).href)
const { importWorkflowSource } = await import(pathToFileURL(join(root, 'lib/transfer/import-workflow.js')).href)
const importRoot = await mkdtemp(join(tmpdir(), 'workflow-import-smoke-'))
try {
  const store = new FlowStore(importRoot)
  await store.init()
  const source = `app: {name: Offline Dify, mode: workflow}
kind: app
version: 0.1.0
"workflow":
  "graph":
    nodes:
      - {id: start, data: {type: start, title: Start, variables: []}}
      - id: writer
        data:
          type: llm
          title: Writer
          model: {provider: external, name: external-model}
          prompt_template: [{role: user, text: Offline probe}]
      - {id: answer, data: {type: answer, title: Answer, answer: "{{#writer.text#}}"}}
    edges:
      - {id: first, source: start, target: writer}
      - {id: last, source: writer, target: answer}
`
  const imported = await importWorkflowSource(store, source)
  assert.equal(imported.sourceFormat, 'dify')
  assert.equal(imported.report.status, 'review-required')
  assert.ok(imported.report.dependencies.some(item => item.kind === 'model'))
  const conflict = await importWorkflowSource(store, source, { sourceName: 'workflow.yaml' })
  assert.equal(conflict.conflict, true)
  const renamed = await importWorkflowSource(store, source, { sourceName: 'workflow.yaml', conflictMode: 'rename' })
  assert.notEqual(renamed.template.id, imported.template.id)
  const blocked = await importWorkflowSource(store, source.replace('Offline Dify', 'Unsupported tool')
    .replace('type: llm', 'type: tool'))
  assert.equal(blocked.report.status, 'blocked')
  assert.ok(blocked.report.issues.some(item => item.code === 'DIFY_NODE_UNSUPPORTED'))
  await assert.rejects(importWorkflowSource(store, '"workflow": [', { sourceName: 'broken.YAML' }),
    error => error.code === 'TRANSFER_INVALID_JSON' && error.message.includes('Dify'))
  const native = await importWorkflowSource(store, JSON.stringify({ format: 'dsh-vw-bundle', version: 2, mode: 'mode1',
    workflow: { name: 'Existing native workflow', nodes: [], lines: [] }, embedded: {} }))
  assert.equal(native.template.name, 'Existing native workflow')
  assert.equal((await store.listFlowTemplates()).length, 4)
  console.log('Workflow: Dify quoted YAML detection, filename errors/conflict retry, unsupported-node review and native JSON import passed')
} finally {
  await rm(importRoot, { recursive: true, force: true })
}
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

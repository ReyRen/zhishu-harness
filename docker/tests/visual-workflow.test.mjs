/** Offline assembly refuses incomplete resources; GUI routes use the Host's current authorization. */
import assert from 'node:assert/strict'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { prepareVisualWorkflow, visualWorkflowVersion } from '../../market-registry/prepare-visual-workflow.mjs'
import { webServerOf } from '../../market-registry/patches/visual-workflow-web-server.mjs'
import { offlineWorkflowManifest } from '../../market-registry/prepare-workflow-runtime.mjs'

test('the private runtime keeps binaries and optional packages while selecting only the reviewed script-free graph', () => {
  const source = { name: '@huggingface/transformers', version: '4.2.0', license: 'Apache-2.0',
    exports: { '.': './dist/transformers.node.mjs' }, files: ['dist', 'src'], scripts: { build: 'builder' },
    dependencies: { 'onnxruntime-node': '1.24.3', sharp: '^0.34.5', '@huggingface/tokenizers': '^0.1.3' },
    optionalDependencies: { 'optional-platform-package': '1.0.0' } }
  const result = offlineWorkflowManifest(source)
  assert.equal(result.version, '4.2.0-zhishu-runtime.1')
  assert.equal(result.dependencies['onnxruntime-node'], '1.24.3-zhishu-runtime.1')
  assert.equal(result.dependencies.sharp, '0.34.5-zhishu-runtime.1')
  assert.equal(result.dependencies['@huggingface/tokenizers'], '^0.1.3')
  assert.deepEqual(result.exports, source.exports)
  assert.deepEqual(result.files, source.files)
  assert.deepEqual(result.optionalDependencies, source.optionalDependencies)
  assert.equal(result.license, source.license)
  assert.equal(result.scripts, undefined)
  assert.equal(source.scripts.build, 'builder')
  assert.throws(() => offlineWorkflowManifest({ ...source, version: '4.3.0' }), /Unexpected Workflow runtime manifest/u)
  assert.throws(() => offlineWorkflowManifest({ ...source, gypfile: true }), /unreviewed native build/u)
})

test('offline assembly refuses a missing model without attempting to download it', async t => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-offline-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(prepareVisualWorkflow(root, { cacheDir: root }), /prepare it on the packaging machine/u)
  await assert.rejects(access(join(root, `dsh-visual-workflow-${visualWorkflowVersion}.tgz`)))
})

test('a corrupt cached model cannot enter an installable archive', async t => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-corrupt-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'visual-workflow-model-15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc.onnx'), 'changed model')
  await assert.rejects(prepareVisualWorkflow(root, { cacheDir: root }), /model integrity mismatch/u)
})

test('GUI and file handlers reject unauthorized requests before reading or writing user data', () => {
  for (const path of ['/visual-workflow', '/visual-workflow/files/example']) {
    for (const status of [401, 403, 503]) {
      let registered, called = false, checked
      const disposer = () => {}
      const server = webServerOf({ get(name) {
        if (name === 'webServer') return { register(route) { registered = route; return disposer } }
        if (status !== 503) return { requestRejection(request) { checked = request; return status } }
      } })
      assert.equal(server.register({ kind: 'exact', path, handler() { called = true } }), disposer)
      const request = {}, response = { writeHead(value, headers) {
        assert.equal(value, status); assert.equal(headers['cache-control'], 'no-store')
      }, end(message) { assert.ok(message.length > 0) } }
      registered.handler(request, response)
      assert.equal(called, false)
      if (status !== 503) assert.equal(checked, request)
    }
  }
})

test('authorized requests reach the GUI handler and independent service routes retain their own authentication', async () => {
  let registered, calls = 0
  const server = webServerOf({ get(name) {
    return name === 'webServer' ? { register(route) { registered = route; return () => {} } }
      : { requestRejection() { return undefined } }
  } })
  const handler = async () => { calls++; return 'response' }
  server.register({ kind: 'prefix', path: '/visual-workflow/files', handler })
  assert.equal(await registered.handler({}, {}), 'response')
  assert.equal(calls, 1)
  const serviceRoute = { kind: 'prefix', path: '/v1/workflow-service', handler }
  server.register(serviceRoute)
  assert.equal(registered, serviceRoute)
})

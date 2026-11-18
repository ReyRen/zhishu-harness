/** Verify migration through the installed Workflow bundle and its authenticated Web Host. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const buildFixture = String.raw`
import io, sys, zipfile

def package(kind):
    version = "draft" if kind == "invalid" else "0.0.1"
    name = "direct" if kind == "direct" else "echo"
    capability = "models" if kind == "model" else "tools"
    content = io.BytesIO()
    with zipfile.ZipFile(content, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.yaml", f"""author: fixture
name: {name}
version: {version}
type: plugin
meta: {{runner: {{language: python}}}}
plugins: {{{capability}: [provider/echo.yaml]}}
""")
        archive.writestr("provider/echo.yaml", """identity: {name: echo, label: {en_US: Echo}}
tools: [tools/echo.yaml]
extra: {python: {source: provider/echo.py}}
""")
        archive.writestr("tools/echo.yaml", """identity: {name: echo, label: {en_US: Echo}}
description: {llm: Echo fixture text.}
parameters:
  - {name: query, type: string, required: true, form: llm, llm_description: Fixture text}
extra: {python: {source: tools/echo.py}}
""")
        archive.writestr("tools/echo.py", """import os
from pathlib import Path
from dify_plugin import Tool

class Echo(Tool):
    def _invoke(self, tool_parameters):
        assert "DSH_HOME" not in os.environ
        assert not Path("/storage-root-jfs/user").exists()
        assert not Path("/opt/dsh").exists()
        yield self.create_text_message("echo:" + tool_parameters["query"])
""")
    return content.getvalue()

if sys.argv[1] == "single":
    sys.stdout.buffer.write(package("direct"))
else:
    batch = io.BytesIO()
    echo = package("tool")
    with zipfile.ZipFile(batch, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("echo.difypkg", echo)
        archive.writestr("echo-copy.difypkg", echo)
        archive.writestr("model.difypkg", package("model"))
        xinference = io.BytesIO()
        with zipfile.ZipFile(xinference, "w", zipfile.ZIP_DEFLATED) as model:
            model.writestr("manifest.yaml", """author: fixture
name: xinference
version: 0.0.1
type: plugin
plugins: {models: [provider/xinference.yaml]}
""")
            model.writestr("provider/xinference.yaml", """provider: xinference
label: {en_US: Xinference}
supported_model_types: [llm, text-embedding, rerank, speech2text, tts]
model_credential_schema:
  credential_form_schemas:
    - {variable: api_key, type: secret-input, default: fixture-secret-value}
""")
        archive.writestr("xinference.difypkg", xinference.getvalue())
        archive.writestr("invalid.difypkg", package("invalid"))
    sys.stdout.buffer.write(batch.getvalue())
`

async function fixture(mode) {
  const { stdout } = await promisify(execFile)('/usr/bin/python3', ['-c', buildFixture, mode], { encoding: 'buffer', timeout: 10_000 })
  return stdout
}

/**
 * Scan a tool package with the independently installed market bundle.
 * @param {string} root - Disposable smoke directory.
 * @param {string} home - Disposable Web profile home.
 * @returns {Promise<void>} Resolves when the installed compiler reports one package.
 */
export async function verifyStandaloneDifyCompiler(root, home) {
  const profile = join(home, 'profiles/web')
  const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
  assert.ok(manifest.dsh.profile.bundles.includes('dsh-dify-migrator'))
  assert.equal(manifest.dependencies['dsh-visual-workflow'], undefined)
  const compiler = join(profile, 'node_modules/dsh-dify-migrator/dist/cli.js')
  const input = join(root, 'standalone-dify.difypkg')
  await writeFile(input, await fixture('single'))
  const { stdout } = await promisify(execFile)(process.execPath, [compiler, 'scan', input], { timeout: 10_000 })
  const report = JSON.parse(stdout)
  assert.equal(report.summary.discovered, 1)
  assert.equal(report.summary.failed, 0)
  console.log('Dify migrator: standalone compiler scanned the fixture offline')
}

/**
 * Check offline conversion and package registration through the authenticated Web Host.
 * @param {Function} request - Native Web smoke request with the current owner cookie.
 * @param {string} authority - Public authority for authenticated writes.
 * @param {string} home - Disposable Web profile home.
 * @param {boolean} exerciseWorker - Invoke Python under the production Docker sandbox policy.
 * @returns {Promise<void>} Resolves when both upload modes and their private installation succeed.
 */
export async function verifyDifyMigration(request, authority, home, exerciseWorker) {
  const plugin = join(home, 'profiles/web/node_modules/dsh-visual-workflow')
  const imported = createRequire(join(plugin, 'package.json'))
  const entry = pathToFileURL(imported.resolve('dsh-dify-migrator'))
  const manifest = JSON.parse(await readFile(new URL('../package.json', entry), 'utf8'))
  assert.equal(manifest.version, '0.4.0-zhishu.1')
  const upload = async (name, mode) => {
    const archive = await fixture(mode)
    return { method: 'POST', body: JSON.stringify({ args: { name, base64: archive.toString('base64') } }),
      extraHeaders: { origin: `http://${authority}`, 'content-type': 'application/json' } }
  }
  const endpoint = '/visual-workflow/migrateDifyTools'
  const single = await upload('echo.difypkg', 'single')
  assert.equal((await request(endpoint, { ...single, extraHeaders: { ...single.extraHeaders, cookie: '' } })).status, 401)
  const direct = await request(endpoint, single)
  assert.equal(direct.status, 200, direct.body)
  const first = JSON.parse(direct.body)
  assert.equal(first.ok, true, direct.body)
  assert.equal(first.value.summary.installed, 1)

  const batch = await request(endpoint, await upload('tools.zip', 'batch'))
  assert.equal(batch.status, 200, batch.body)
  const migrated = JSON.parse(batch.body)
  assert.equal(migrated.ok, true, batch.body)
  assert.deepEqual(migrated.value.summary, { discovered: 5, installed: 2, converted: 0, skipped: 1, duplicates: 1, failed: 1 })
  assert.ok(migrated.value.packages.some(x => x.status === 'failed' && x.error.code === 'MANIFEST_INVALID'))
  const data = join(home, 'visual-workflow')
  assert.deepEqual((await readdir(join(data, 'migrated-tools'))).sort(), [
    'dsh_dify__fixture__direct@0.0.1', 'dsh_dify__fixture__echo@0.0.1',
  ])
  const model = await readFile(join(data, 'migrated-models/dsh_dify__fixture__xinference@0.0.1/dsh-model-package.json'), 'utf8')
  assert.ok(!model.includes('fixture-secret-value'))
  const [provider] = JSON.parse(model).providers
  assert.equal(provider.adapter, 'xinference-openai-compatible')
  assert.deepEqual(provider.supportedModelTypes, ['llm', 'text-embedding', 'rerank', 'speech2text', 'tts'])
  const tool = 'dsh_migrated__fixture__echo__echo'
  const { MigratedToolRegistry } = await import(pathToFileURL(join(plugin, 'lib/migrated-tools/registry.js')).href)
  const registry = new MigratedToolRegistry(data)
  await registry.load()
  assert.ok(registry.has(tool, 'fixture/echo:0.0.1'))
  if (exerciseWorker) {
    const value = await registry.invoke(tool, { query: 'offline' }, undefined, 'fixture/echo:0.0.1')
    assert.equal(value.text, 'echo:offline')
  }
  console.log(`Dify migrator: authenticated offline tool/Xinference conversion passed${exerciseWorker ? ', including isolated Python execution' : ''}`)
}

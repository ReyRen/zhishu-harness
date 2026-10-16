/** Validate immutable Office resources, actual built Web composition, and document conversion without JFS. */

import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const directory = dirname(fileURLToPath(import.meta.url))
const repository = resolve(directory, '..')
const source = process.env.DSH_PRIMARY_RUNTIME
assert.ok(source, 'DSH_PRIMARY_RUNTIME must select the image payload')
const root = await mkdtemp(join(tmpdir(), 'dsh-office-smoke-'))
const environment = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(name))),
  HOME: root, DSH_HOME: join(root, 'home'), DSH_AGENTS_HOME: join(root, 'agents'),
  DSH_WORKSPACE_ROOT: root, DSH_DEFAULT_WORKSPACE: join(root, 'workspace'),
  DSH_TELEMETRY_DISABLED: '1', PYTHONDONTWRITEBYTECODE: '1',
}
let child
let completion
let forced = false
try {
  await mkdir(environment.DSH_DEFAULT_WORKSPACE)
  const patch = join(root, 'observer.patch.yml')
  await writeFile(patch, JSON.stringify([{ insert: [{
    id: 'office-image-observer', name: pathToFileURL(join(directory, 'tests/office-observer.mjs')).href,
  }] }]), { flag: 'wx', mode: 0o600 })
  child = spawn(process.execPath, [join(repository, 'apps/cli/lib/bin.js'),
    '--profile', 'web', '--patch', join(directory, 'office.cordis.patch.yml'), '--patch', patch,
    '--host', '127.0.0.1', '--port', '0', '--no-open'],
  { cwd: environment.DSH_DEFAULT_WORKSPACE, env: environment, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  completion = new Promise((accept, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => { accept({ code, signal }) })
  })
  const probe = new Promise((accept, reject) => {
    let output = '', sent = false
    const deadline = setTimeout(() => { reject(new Error('Built Web Office probe did not become ready')) }, 60_000)
    const clear = () => { clearTimeout(deadline) }
    child.once('error', (error) => { clear(); reject(error) })
    child.once('close', () => { clear(); reject(new Error('Built Web exited before the Office probe')) })
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk
      if (!sent && /dsh web: http:\/\//u.test(output)) {
        sent = true
        child.send('office-probe', (error) => { if (error) { clear(); reject(error) } })
      }
    })
    child.on('message', (message) => {
      clear()
      if (message.error) reject(new Error(message.error))
      else if (message.office) accept(message.office)
      else reject(new Error('Unexpected Office probe reply'))
    })
  })
  let diagnostics = ''
  child.stderr.setEncoding('utf8').on('data', (chunk) => { diagnostics += chunk })
  let office
  try { office = await probe } catch (error) { throw new Error(`Office Web probe failed: ${diagnostics}`, { cause: error }) }
  const { runtime, skills } = office
  assert.ok(runtime.python.startsWith(source + '/'))
  assert.ok(runtime.node.startsWith(source + '/'))
  assert.ok(runtime.pnpm.startsWith(source + '/'))
  for (const skill of skills) {
    assert.equal(skill.provider, 'dsh-office')
    assert.ok(skill.content.includes('Installed LibreOffice Kit'))
    assert.ok(skill.resourceBase.path.startsWith(resolve(source, '..', 'office-skills') + '/'))
  }
  const renderSkill = skills.find(skill => skill.name === 'office-render')
  assert.ok(renderSkill, 'The Web profile must load the Office render skill')
  const kit = /\{\s*"libreofficeKit"[\s\S]*?\n\}/u.exec(renderSkill.content)
  assert.ok(kit, 'Loaded skill must provide the installed CLI paths')
  const { libreofficeKit } = JSON.parse(kit[0])
  assert.equal(libreofficeKit.node, runtime.node)
  const execute = (command, args) => execFileSync(command, args, {
    cwd: root, env: environment, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
  })
  const capabilities = JSON.parse(execute(runtime.node, [libreofficeKit.cli, 'capabilities', '--json']))
  assert.ok(capabilities.conversions.length > 0)
  execute(runtime.python, ['-I', '-B', join(directory, 'tests/create-office.py'), root])
  for (const extension of ['docx', 'pptx', 'xlsx']) {
    const input = join(root, `sample.${extension}`)
    const output = join(root, `${extension}.pdf`)
    execute(runtime.node, [libreofficeKit.cli, 'convert', '--input', input, '--output', output])
    assert.equal((await readFile(output)).subarray(0, 5).toString(), '%PDF-')
  }
  execute(runtime.node, [libreofficeKit.cli, 'recalculate', '--input', join(root, 'sample.xlsx'),
    '--output', join(root, 'recalculated.xlsx')])
  execute(runtime.python, ['-I', '-B', '-c',
    'from openpyxl import load_workbook; import sys; assert load_workbook(sys.argv[1], data_only=True).active["C2"].value == 5',
    join(root, 'recalculated.xlsx')])
  const preview = join(root, 'preview')
  execute(runtime.node, [libreofficeKit.cli, 'render', '--input', join(root, 'sample.docx'),
    '--output-dir', preview, '--pages', '1', '--dpi', '96'])
  const images = (await readdir(preview)).filter(name => name.endsWith('.png'))
  assert.ok(images.length > 0, 'LibreOffice render must produce a PNG')
  assert.deepEqual((await readFile(join(preview, images[0]))).subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  assert.equal(await readFile(join(environment.DSH_HOME, 'dsh-runtimes/dsh-primary-runtime/runtime.json')).then(() => true,
    (error) => { if (error.code === 'ENOENT') return false; throw error }), false)
  console.log(JSON.stringify({ webOfficeSkills: skills.map(skill => skill.name),
    python: runtime.python, pythonDistributions: runtime.pythonDistributions,
    libreofficeBackend: capabilities.runtime.backend, documents: ['docx', 'pptx', 'xlsx'],
    pdfConversion: 'passed', formulaRecalculation: 'passed', imageRendering: 'passed', copiedToUserHome: false }))
} finally {
  if (child && completion) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    const deadline = setTimeout(() => { forced = true; child.kill('SIGKILL') }, 10_000)
    try {
      const result = await completion
      assert.equal(forced, false, 'Web did not shut down gracefully')
      assert.equal(result.signal, null)
      assert.equal(result.code, 0)
    } finally { clearTimeout(deadline); await rm(root, { recursive: true, force: true }) }
  } else await rm(root, { recursive: true, force: true })
}

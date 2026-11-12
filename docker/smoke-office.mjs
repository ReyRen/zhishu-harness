/** Validate immutable Office resources, actual built Web composition, and document conversion without JFS. */

import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
    const deadline = setTimeout(() => { reject(new Error('Built Web Office conversions did not complete')) }, 180_000)
    const clear = () => { clearTimeout(deadline) }
    child.once('error', (error) => { clear(); reject(error) })
    child.once('close', () => { clear(); reject(new Error('Built Web exited before the Office probe')) })
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk
      if (!sent && /dsh web: http:\/\//u.test(output)) {
        sent = true
        child.send({ command: 'office-probe', directory: root }, (error) => { if (error) { clear(); reject(error) } })
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
    assert.ok(skill.resourceBase.path.startsWith(join(repository, 'packages/skill/skill-office/assets') + '/'))
  }
  assert.deepEqual(office.tools, ['office_render', 'office_convert', 'office_recalculate'])
  const execute = (command, args) => execFileSync(command, args, {
    cwd: root, env: environment, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
  })
  for (const output of office.converted) {
    assert.equal((await readFile(output)).subarray(0, 5).toString(), '%PDF-')
  }
  execute(runtime.python, ['-I', '-B', '-c',
    'from openpyxl import load_workbook; import sys; assert load_workbook(sys.argv[1], data_only=True).active["C2"].value == 5',
    office.recalculated])
  assert.deepEqual((await readFile(office.preview)).subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  assert.equal(await readFile(join(environment.DSH_HOME, 'dsh-runtimes/dsh-primary-runtime/runtime.json')).then(() => true,
    (error) => { if (error.code === 'ENOENT') return false; throw error }), false)
  console.log(JSON.stringify({ webOfficeSkills: skills.map(skill => skill.name),
    python: runtime.python, pythonDistributions: runtime.pythonDistributions,
    officeTools: office.tools, documents: ['docx', 'pptx', 'xlsx'],
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

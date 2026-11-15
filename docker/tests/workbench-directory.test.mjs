/** Workbench directory requests settle without calling a platform-specific picker early. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { pathToFileURL } from 'node:url'

const source = await readFile(new URL('../../overlay/workbenches/client.js', import.meta.url), 'utf8')
const React = createRequire(new URL('../../apps/web/package.json', import.meta.url))('react')
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url))
const { SlotCore } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-ui-slots')).href)
let Workbenches
let apply
runInNewContext(source, {
  window: { localStorage: { getItem() { return null } }, __ModuleLoader__: { load(definition) {
    const plugin = definition.factory(name => name === 'react' ? React : name === '@deepseek-ai/cordis' ? { Service: { tracker: Symbol() } } : {})
    Workbenches = plugin.Workbenches
    apply = plugin.apply
  } } },
  document: { documentElement: { lang: 'zh' } },
})

test('the directory chooser registers in the real list-slot registry during workbench startup', t => {
  const core = new SlotCore()
  const release = core.register({ name: 'root', children: { 'shell.overlay': { kind: 'list', scope: 'root' } } }, () => null)
  t.after(release)
  const dispose = []
  t.after(() => { for (const release of dispose.reverse()) release() })
  const ctx = {
    effect() {}, uiWorkspace: {}, sessions: {}, workspaces: {},
    slots: {
      inject(name, setup) { if (name === 'shell.overlay') setup() },
      register(options, Component) { const release = core.register(options, Component); dispose.push(release); return release },
    },
  }
  apply(ctx)
  assert.equal(core.entries('shell.overlay').length, 1)
})

function chooser() {
  const calls = []
  const service = Object.create(Workbenches.prototype)
  Object.assign(service, {
    disposed: false, directoryRequest: null, publish() {},
    ctx: {
      locale: { bind: () => key => key },
      uiWorkspace: { pickDirectory() { calls.push('native'); throw new Error('Web has no native picker') },
        listDirectory(path) { calls.push(path); return Promise.resolve({ path }) },
        createDirectory(path, name) { return Promise.resolve(`${path}/${name}`) } },
    },
  })
  return { service, calls }
}

test('workbenches let the composed dialog pick a directory before creating a workspace', async () => {
  const { service, calls } = chooser()
  const signal = new AbortController()
  const picked = service.chooseDirectory(signal.signal)
  const request = service.directoryRequest
  assert.equal(request.open, true)
  assert.deepEqual(calls, [])
  await request.listDirectory('/storage-root-jfs/user')
  request.onPicked('/storage-root-jfs/user/project')
  assert.equal(await picked, '/storage-root-jfs/user/project')
  assert.equal(service.directoryRequest, null)
  assert.deepEqual(calls, ['/storage-root-jfs/user'])
})

test('navigation cancellation closes the chooser and ignores its late result', async () => {
  const { service } = chooser()
  const signal = new AbortController()
  const picked = service.chooseDirectory(signal.signal)
  const late = service.directoryRequest
  signal.abort()
  assert.equal(await picked, null)
  late.onPicked('/late')
  assert.equal(service.directoryRequest, null)
})

test('picker cancellation and failures settle the pending owner request', async () => {
  const { service } = chooser()
  const cancelled = service.chooseDirectory(new AbortController().signal)
  service.directoryRequest.onCancel()
  assert.equal(await cancelled, null)
  const failed = service.chooseDirectory(new AbortController().signal)
  service.directoryRequest.onError('directory unavailable')
  await assert.rejects(failed, /directory unavailable/)
  assert.equal(service.directoryRequest, null)
})

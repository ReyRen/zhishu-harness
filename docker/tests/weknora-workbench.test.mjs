/** Knowledge navigation uses main sessions and preserves retired workbench chats. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../../overlay/knowledge-base/client.js', import.meta.url), 'utf8')
const workbenchSource = await readFile(new URL('../../overlay/workbenches/client.js', import.meta.url), 'utf8')
const legacy = 'local:@zhishu/dsh-overlay-knowledge-base'
const turn = () => new Promise(resolve => setImmediate(resolve))

function fixture(t, { ready = true, added = false, bound = false, loadGate, releaseGate, failure } = {}) {
  let plugin, panel = null
  const calls = [], errors = [], tasks = [], cleanups = [], slots = [], listeners = new Set()
  const React = { createElement(type, props, ...children) { return { type, props, children } } }
  const host = {
    ready, state: { added: added ? [legacy] : [], sessionBindings: bound ? { historical: legacy } : {} },
    async load() { calls.push('load'); await loadGate; this.ready = true },
    async remove(id, options) { calls.push({ remove: id, options: JSON.parse(JSON.stringify(options)) }) },
    async releaseToMainSession() { calls.push('release'); await releaseGate; if (failure) throw new Error(failure) },
    report(error) { errors.push(error.message) },
    run(task) { tasks.push(task.catch(error => this.report(error))) },
  }
  const ctx = {
    desktopWorkbenches: host,
    locale: { bind() { return key => key } },
    uiWorkspace: { startSession() { calls.push('start-session') } },
    layout: { panelInfo: { getSnapshot: () => ({ activePanelId: panel }),
      subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback) } } },
    slots: { inject(_name, setup) { setup() }, register(definition, Component) { slots.push({ definition, Component }); return () => {} } },
    effect(setup, label) {
      if (!['knowledge-base: migrate legacy workbench entry', 'knowledge-base: release workbench when panel opens'].includes(label)) return
      const cleanup = setup()
      if (cleanup) cleanups.push(cleanup)
    },
  }
  const window = { __ModuleLoader__: { load(definition) { plugin = definition.factory(() => React) } } }
  runInNewContext(source, { window, document: { getElementById() { return {} } }, AbortController })
  const dispose = () => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() }
  t.after(dispose)
  plugin.apply(ctx)
  const main = slots.find(slot => slot.definition.name === 'main')
  return { calls, errors, slots, dispose,
    open() { panel = 'zhishu-knowledge'; for (const listener of listeners) listener() },
    start() { main.definition.inject().startAssistant() },
    async settle() { await Promise.all(tasks); await turn() },
  }
}

test('knowledge is a global panel without installing a workbench for a new user', async t => {
  const f = fixture(t)
  assert.equal(f.slots.find(slot => slot.definition.name === 'main').definition.key, 'zhishu-knowledge')
  assert.equal(f.slots.find(slot => slot.definition.name === 'sidebar.panellist').definition.label, '知识库')
  f.open()
  await f.settle()
  assert.deepEqual(f.calls, ['release'])
  assert.deepEqual(f.errors, [])
})

test('legacy launchers and chats migrate even when the launcher was already removed', t => {
  for (const options of [{ added: true }, { bound: true }]) {
    const f = fixture(t, options)
    assert.deepEqual(f.calls, [{ remove: legacy, options: { moveSessionsToMain: true } }])
  }
})

test('unloading while stored workbenches load prevents a late migration', async t => {
  const gate = Promise.withResolvers()
  const f = fixture(t, { ready: false, added: true, loadGate: gate.promise })
  f.dispose()
  gate.resolve()
  await f.settle()
  assert.deepEqual(f.calls, ['load'])
})

test('AI assistant waits for the saved transition to main sessions before creating a chat', async t => {
  const gate = Promise.withResolvers()
  const f = fixture(t, { releaseGate: gate.promise })
  f.start()
  await turn()
  assert.deepEqual(f.calls, ['release'])
  gate.resolve()
  await f.settle()
  assert.deepEqual(f.calls, ['release', 'start-session'])
})

test('a failed transition reports the failure and cannot create a chat in the wrong workbench', async t => {
  const f = fixture(t, { failure: 'state write unavailable' })
  f.start()
  await f.settle()
  assert.deepEqual(f.calls, ['release'])
  assert.deepEqual(f.errors, ['state write unavailable'])
})

test('moving retired chats to main persists only their ownership change and retains unrelated data', async () => {
  let exports
  const window = { __ModuleLoader__: { load(definition) {
    exports = definition.factory(() => ({ Component: class {}, Service: { tracker: Symbol('tracker') } }))
  } } }
  runInNewContext(workbenchSource, { window, document: { documentElement: { lang: 'zh' } }, console })
  const writes = []
  const service = new exports.Workbenches({ layout: { beginNavigation() {} } }, async (_url, init) => {
    writes.push(JSON.parse(init.body))
    return Response.json({ revision: 1 })
  })
  service.ready = true
  service.state.added = [legacy, 'other']
  service.state.pinned = [legacy, 'other']
  service.state.active = legacy
  service.state.sessionBindings = { history: legacy, separate: 'other' }
  service.state.recentSessions = { [legacy]: 'history', other: 'separate' }
  service.state.notes = { [legacy]: 'preserved note', other: 'other note' }
  await service.remove(legacy, { moveSessionsToMain: true })
  assert.deepEqual(writes[0].state.sessionBindings, { separate: 'other' })
  assert.deepEqual(writes[0].state.recentSessions, { other: 'separate' })
  assert.deepEqual(writes[0].state.notes, { [legacy]: 'preserved note', other: 'other note' })
  assert.deepEqual(writes[0].state.added, ['other'])
  assert.equal(writes[0].state.active, null)
  service.dispose()
})

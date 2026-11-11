/** Exercise Ask AI through the registered component with caller-scoped actions. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../../overlay/knowledge-base/client.js', import.meta.url), 'utf8')
const turn = () => new Promise(resolve => setImmediate(resolve))

function fixture({ owned = false, failure, ownershipFailure, added = true, ready = true, addFailure, addGate } = {}) {
  let plugin, Component, opener, dispose, cursor = 0, created = 0
  const workbenchId = 'local:@zhishu/dsh-overlay-knowledge-base'
  const calls = [], reported = [], tasks = []
  // The platform has already authenticated. Effects unrelated to this click are not mounted.
  const state = [true, false, false, '', '']
  const React = {
    createSnapshotStore(value) { return { getSnapshot: () => value, set(next) { value = next } } },
    createElement(type, props, ...children) { return { type, props: props || {}, children } },
    useState(initial) { const id = cursor++; if (!(id in state)) state[id] = initial; return [state[id], value => { state[id] = value }] },
    useRef(value) { return { current: value } }, useEffect() {}, useLayoutEffect() {},
  }
  const parent = { postMessage() {} }
  const window = { parent, top: parent,
    __ModuleLoader__: { load(definition) { plugin = definition.factory(() => React) } } }
  const scoped = {
    ready, state: { added: added ? [workbenchId] : [] },
    async load() { calls.push('load'); this.ready = true },
    async add(id) {
      assert.equal(id, workbenchId)
      calls.push('add')
      await addGate
      if (addFailure) throw new Error(addFailure)
      this.state.added.push(id)
    },
    async open(id) {
      calls.push('open')
      assert.ok(this.state.added.includes(id), 'workbench must be added before opening')
    },
    run(task) { tasks.push(task.catch(error => { reported.push(error.message) })) },
    register(_descriptor, component) { Component = component; return () => {} },
    currentSession() { assert.equal(this, scoped); return 'current-session' },
    ownsSession(id) { assert.equal(this, scoped); assert.equal(id, 'current-session'); if (ownershipFailure) throw new Error(ownershipFailure); return owned },
    async newSession() { assert.equal(this, scoped); created++; if (failure) throw new Error(failure); return 'new-session' },
  }
  const ctx = {
    desktopWorkbenches: scoped, sidebarSoftPanels: { registerOpener(_id, action) { opener = action; return () => {} } },
    effect(effect, label) { if (label === 'knowledge-base: unregister workbench') dispose = effect() },
    slots: { inject() {} }, locale: { bind() { return key => key } },
  }
  runInNewContext(source, { window, document: { getElementById() { return {} } }, AbortController, console })
  plugin.apply(ctx)
  const raw = { currentSession() { return 'current-session' }, ownsSession() { throw new Error('Workbench registration requires a client package entry name.') } }
  const render = () => {
    cursor = 0
    let node = Component({ service: raw, active: true, conversation: 'conversation' })
    while (typeof node.type === 'function') node = node.type(node.props)
    return node
  }
  const nodes = node => [node, ...(node?.children || []).flatMap(child => child && typeof child === 'object' ? nodes(child) : [])]
  const button = () => nodes(render()).find(node => node.type === 'button')
  const text = () => nodes(render()).flatMap(node => node.children.filter(child => typeof child === 'string')).join(' ')
  return { click: () => button().props.onClick(), button, text, created: () => created,
    async openWorkbench() { opener(); await tasks.at(-1) }, calls, reported, dispose: () => dispose() }
}

test('the built-in knowledge entry initializes the current user before opening and reuses existing membership', async () => {
  const fresh = fixture({ added: false, ready: false })
  await fresh.openWorkbench()
  assert.deepEqual(fresh.calls, ['load', 'add', 'open'])
  assert.deepEqual(fresh.reported, [])
  await fresh.openWorkbench()
  assert.deepEqual(fresh.calls, ['load', 'add', 'open', 'open'])
  const existing = fixture()
  await existing.openWorkbench()
  assert.deepEqual(existing.calls, ['open'])
})

test('failed initialization is reported and does not open a partially initialized knowledge workbench', async () => {
  const f = fixture({ added: false, addFailure: 'storage write unavailable' })
  await f.openWorkbench()
  assert.deepEqual(f.calls, ['add'])
  assert.deepEqual(f.reported, ['storage write unavailable'])
})

test('concurrent clicks share initialization and disposal prevents a late navigation', async () => {
  let release
  const addGate = new Promise(resolve => { release = resolve })
  const f = fixture({ added: false, addGate })
  const first = f.openWorkbench()
  const second = f.openWorkbench()
  let closing
  try {
    await turn()
    assert.deepEqual(f.calls, ['add'])
    closing = f.dispose()
  } finally {
    release()
    await Promise.all([first, second])
    await closing
  }
  assert.deepEqual(f.calls, ['add'])
})

test('Ask AI uses caller-scoped ownership and creates a conversation only when it is not owned', async () => {
  for (const owned of [false, true]) {
    const f = fixture({ owned })
    assert.doesNotThrow(() => f.click())
    await turn()
    assert.equal(f.created(), owned ? 0 : 1)
    assert.equal(f.button().children[0], '收起会话')
  }
})

test('Ask AI reports synchronous ownership and asynchronous creation failures without leaving the action busy', async () => {
  for (const options of [{ failure: 'creation unavailable' }, { ownershipFailure: 'ownership unavailable' }]) {
    const f = fixture(options)
    assert.doesNotThrow(() => f.click())
    await turn()
    assert.ok(f.text().includes(options.failure || options.ownershipFailure))
    f.button().props.onClick() // close, then reopen
    assert.equal(f.button().props.disabled, false)
  }
})

/** Exercise Ask AI through the registered component with caller-scoped actions. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../../overlay/knowledge-base/client.js', import.meta.url), 'utf8')
const turn = () => new Promise(resolve => setImmediate(resolve))

function fixture({ owned = false, failure, ownershipFailure } = {}) {
  let plugin, Component, cursor = 0, created = 0
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
    register(_descriptor, component) { Component = component; return () => {} },
    currentSession() { assert.equal(this, scoped); return 'current-session' },
    ownsSession(id) { assert.equal(this, scoped); assert.equal(id, 'current-session'); if (ownershipFailure) throw new Error(ownershipFailure); return owned },
    async newSession() { assert.equal(this, scoped); created++; if (failure) throw new Error(failure); return 'new-session' },
  }
  const ctx = {
    desktopWorkbenches: scoped, sidebarSoftPanels: { registerOpener() { return () => {} } },
    effect() {}, slots: { inject() {} }, locale: { bind() { return key => key } },
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
  return { click: () => button().props.onClick(), button, text, created: () => created }
}

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

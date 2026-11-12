/** Native slash-picker registration and authoritative selection acknowledgments. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../../overlay/knowledge-base/client.js', import.meta.url), 'utf8')

async function fixture(t) {
  const effects = [], registrations = [], slots = [], calls = [], selected = new Map([['session-a', []], ['session-b', ['kb-b']]])
  let plugin, rejectSelection = false, catalogStatus = 200
  const parent = { postMessage() {} }
  const window = { parent, top: parent, setTimeout, clearTimeout,
    setInterval() { return 1 }, clearInterval() {}, addEventListener() {}, removeEventListener() {},
    __ModuleLoader__: { load(definition) { plugin = definition.factory(() => ({ createElement() {},
      createSnapshotStore(value) { return { getSnapshot: () => value, set(next) { value = next } } } })) } },
  }
  const ctx = {
    effect(setup) { const cleanup = setup(); if (cleanup) effects.push(cleanup) },
    on() { return () => {} },
    locale: { register(namespace, dictionaries) { this.dictionary = dictionaries.zh; return () => {} },
      bind() { return key => this.dictionary[key] } },
    commandUi: { decorate(value) { registrations.push(value); return () => {} }, dismiss() {},
      openPopup(name, sessionID, signal) { calls.push({ popup: name, sessionID, signal }) } },
    desktopWorkbenches: { ready: true, state: { added: [], sessionBindings: {} }, report(error) { throw error } },
    layout: { panelInfo: { getSnapshot() { return { activePanelId: null } }, subscribe() { return () => {} } } },
    slots: { inject(name, setup) { setup() }, register(definition, component) { slots.push({ definition, component }); return () => {} } },
    sessions: { binding(id) {
      if (!selected.has(id)) return undefined
      return { session: {
        projections: { faceOf() { return { getSnapshot: () => ({ knowledgeBaseIds: selected.get(id) }) } } },
      } }
    } },
    remote: { commands: { async execute(id, line) {
      calls.push({ sessionID: id, line })
      if (!rejectSelection) selected.set(id, line.endsWith(' off') ? [] : line.split(' ').slice(1))
      return { ok: true, value: { result: { kind: rejectSelection ? 'error' : 'success' } } }
    } } },
  }
  const request = async (path, options) => {
    calls.push({ path, options })
    options.signal?.throwIfAborted()
    if (path.endsWith('/auth')) return Response.json({ mode: 'api-key', authenticated: true })
    if (path.endsWith('/catalog')) return Response.json({ knowledgeBases: [{ id: 'kb-a', name: '资料 A' }, { id: 'kb-b', name: '资料 B' }] }, { status: catalogStatus })
    throw new Error('Unexpected request '+path)
  }
  runInNewContext(source, { window, document: { getElementById() { return {} } }, fetch: request,
    AbortController, AbortSignal, location: { origin: 'https://harness.test' }, console })
  plugin.apply(new Proxy(ctx, { get(target, key) {
    if (key === 'remote') assert.ok(plugin.inject.includes('remote'), 'Cordis requires the parent remote service injection')
    return target[key]
  } }))
  t.after(() => { for (const dispose of effects.reverse()) dispose() })
  await new Promise(resolve => setImmediate(resolve))
  return { picker: registrations[0], slots, selected, calls,
    rejectSelection() { rejectSelection = true }, denyCatalog() { catalogStatus = 401 } }
}

test('slash menu uses the native inline multi-picker with only the Chinese title', async t => {
  const f = await fixture(t), session = { sessionId: 'session-a' }
  assert.equal(f.picker.name, 'knowledge')
  assert.equal(f.picker.label(), '知识库')
  assert.equal(f.picker.hideAlias, true)
  assert.equal(f.picker.available(session), true)
  assert.equal(f.picker.available({ sessionId: 'not-open' }), false)
  assert.equal(f.picker.ui.kind, 'popupSelect')
  assert.equal(f.picker.ui.multiple, true)
  assert.equal(f.slots.some(slot => slot.definition.name === 'shell.overlay'), false, 'no separate dialog')
  const options = await f.picker.ui.options(session, AbortSignal.timeout(1000))
  assert.deepEqual(Array.from(options, row => row.id), ['kb-a', 'kb-b'])
  assert.equal(options[0].label, '资料 A')
  assert.equal(options[0].active, false)
})

test('each acknowledged toggle commits the complete set through the native human command, with session-local clear actions', async t => {
  const f = await fixture(t), session = { sessionId: 'session-a' }
  const options = await f.picker.ui.options(session, AbortSignal.timeout(1000))
  await f.picker.ui.onSelect(options[0], session, [options[0]])
  await f.picker.ui.onSelect(options[1], session, [options[1], options[0]])
  assert.deepEqual(Array.from(f.selected.get('session-a')), ['kb-a', 'kb-b'])
  assert.deepEqual(f.selected.get('session-b'), ['kb-b'])
  assert.ok(f.calls.some(call => call.line === '/knowledge kb-a kb-b' && call.sessionID === 'session-a'))
  assert.equal(f.calls.some(call => call.path?.includes('/selection?')), false)
  await f.picker.ui.onSelect(options[0], session, [options[1]])
  assert.deepEqual(Array.from(f.selected.get('session-a')), ['kb-b'])
  await f.picker.ui.onClear(session)
  assert.deepEqual(Array.from(f.selected.get('session-a')), [])
  assert.deepEqual(f.selected.get('session-b'), ['kb-b'])
  const summary = f.slots.find(slot => slot.definition.id === 'zhishu-knowledge-selection')
  const signal = AbortSignal.timeout(1000)
  await summary.definition.inject('session-a').open(signal)
  assert.ok(f.calls.some(call => call.popup === 'knowledge' && call.sessionID === 'session-a' && call.signal === signal))
})

test('rejected changes retain the previous selection and failed or aborted catalogs cannot produce stale options', async t => {
  const f = await fixture(t), session = { sessionId: 'session-b' }
  const options = await f.picker.ui.options(session, AbortSignal.timeout(1000))
  f.rejectSelection()
  await assert.rejects(f.picker.ui.onSelect(options[0], session, options), /切换知识库失败/u)
  assert.deepEqual(f.selected.get('session-b'), ['kb-b'])
  f.denyCatalog()
  await assert.rejects(f.picker.ui.options(session, AbortSignal.timeout(1000)), /知识库暂不可用/u)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(f.picker.ui.options(session, controller.signal), { name: 'AbortError' })
})

test('a stale open picker cannot overwrite a selection changed elsewhere', async t => {
  const f = await fixture(t), session = { sessionId: 'session-a' }
  const options = await f.picker.ui.options(session, AbortSignal.timeout(1000))
  f.selected.set('session-a', ['kb-b'])
  await assert.rejects(f.picker.ui.onSelect(options[0], session, [options[0]]), /已更改/u)
  await assert.rejects(f.picker.ui.onClear(session), /已更改/u)
  assert.equal(f.calls.some(call => call.line), false)
})

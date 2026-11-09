/** Native slash-picker registration and authoritative selection acknowledgments. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../../overlay/knowledge-base/client.js', import.meta.url), 'utf8')

async function fixture(t) {
  const effects = [], registrations = [], slots = [], calls = [], selected = new Map([['session-a', null], ['session-b', 'kb-b']])
  let plugin, rejectSelection = false, catalogStatus = 200
  const parent = { postMessage() {} }
  const window = { parent, top: parent, setTimeout, clearTimeout,
    setInterval() { return 1 }, clearInterval() {}, addEventListener() {}, removeEventListener() {},
    __ModuleLoader__: { load(definition) { plugin = definition.factory(() => ({ createElement() {} })) } },
  }
  const ctx = {
    effect(setup) { const cleanup = setup(); if (cleanup) effects.push(cleanup) },
    on() { return () => {} },
    locale: { register(namespace, dictionaries) { this.dictionary = dictionaries.zh; return () => {} },
      bind() { return key => this.dictionary[key] } },
    commandUi: { decorate(value) { registrations.push(value); return () => {} } },
    desktopWorkbenches: { register() { return () => {} } }, sidebarSoftPanels: { registerOpener() { return () => {} } },
    slots: { inject(name, setup) { setup() }, register(definition, component) { slots.push({ definition, component }); return () => {} } },
    sessions: { binding(id) {
      if (!selected.has(id)) return undefined
      return { session: {
        projections: { faceOf() { return { getSnapshot: () => ({ knowledgeBaseId: selected.get(id) }) } } },
        async command(line) {
          calls.push({ sessionID: id, line })
          if (!rejectSelection) selected.set(id, line.endsWith(' off') ? null : line.split(' ').at(-1))
          return { ok: true, value: { matched: true } }
        },
      } }
    } },
    remote: { commands: { async execute(id, line) {
      calls.push({ sessionID: id, line })
      if (!rejectSelection) selected.set(id, line.endsWith(' off') ? null : line.split(' ').at(-1))
      return { ok: true, value: { result: { kind: rejectSelection ? 'error' : 'success' } } }
    } } },
  }
  const request = async (path, options) => {
    calls.push({ path, options })
    options.signal?.throwIfAborted()
    if (path.endsWith('/auth')) return Response.json({ mode: 'api-key', authenticated: true })
    if (path.endsWith('/catalog')) return Response.json({ knowledgeBases: [{ id: 'kb-a', name: '资料 A' }, { id: 'kb-b', name: '资料 B' }] }, { status: catalogStatus })
    const id = new URL(path, 'http://host').searchParams.get('sessionID')
    return Response.json({ knowledgeBaseId: selected.get(id) })
  }
  runInNewContext(source, { window, document: { getElementById() { return {} } }, fetch: request,
    AbortController, location: { origin: 'https://harness.test' }, console })
  plugin.apply(new Proxy(ctx, { get(target, key) {
    if (key === 'remote') assert.ok(plugin.inject.includes('remote'), 'Cordis requires the parent remote service injection')
    return target[key]
  } }))
  t.after(() => { for (const dispose of effects.reverse()) dispose() })
  await new Promise(resolve => setImmediate(resolve))
  return { picker: registrations[0], slots, selected, calls,
    rejectSelection() { rejectSelection = true }, denyCatalog() { catalogStatus = 401 } }
}

test('slash menu discovers only materialized sessions and lists current-user choices with off selected initially', async t => {
  const f = await fixture(t)
  assert.equal(f.picker.name, 'knowledge')
  assert.equal(f.picker.available({ sessionId: 'session-a' }), true)
  assert.equal(f.picker.available({ sessionId: 'not-open' }), false)
  const choices = await f.picker.ui.options({ sessionId: 'session-a' }, AbortSignal.timeout(1000))
  assert.deepEqual(Array.from(choices, row => row.id), ['off', 'kb-a', 'kb-b'])
  assert.equal(choices[0].active, true)
  assert.equal(choices[1].label, '资料 A')
  assert.equal(f.picker.ui.searchLabels().placeholder, '搜索可用知识库')
})

test('selection uses the human command path for one session and requires an authoritative read acknowledgment', async t => {
  const f = await fixture(t)
  await f.picker.ui.onSelect({ id: 'kb-a' }, { sessionId: 'session-a' })
  assert.equal(f.selected.get('session-a'), 'kb-a')
  assert.equal(f.selected.get('session-b'), 'kb-b')
  assert.ok(f.calls.some(call => call.line === '/knowledge kb-a' && call.sessionID === 'session-a'))
  assert.equal(f.calls.some(call => call.path?.includes('/selection?')), false, 'Session state uses its projection, not a second HTTP reader')
  const chip = f.slots.find(slot => slot.definition.id === 'zhishu-knowledge-selection')
  await chip.definition.inject('session-a').clear()
  assert.equal(f.selected.get('session-a'), null)
  assert.equal(f.selected.get('session-b'), 'kb-b')
})

test('rejected host changes keep the previous selection and failed catalogs never supply stale options', async t => {
  const f = await fixture(t)
  f.rejectSelection()
  await assert.rejects(f.picker.ui.onSelect({ id: 'kb-a' }, { sessionId: 'session-b' }), /切换知识库失败/u)
  assert.equal(f.selected.get('session-b'), 'kb-b')
  f.denyCatalog()
  await assert.rejects(f.picker.ui.options({ sessionId: 'session-b' }, AbortSignal.timeout(1000)), /知识库暂不可用/u)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(f.picker.ui.options({ sessionId: 'session-b' }, controller.signal), { name: 'AbortError' })
})

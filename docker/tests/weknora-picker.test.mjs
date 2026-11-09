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
    commandUi: { decorate(value) { registrations.push(value); return () => {} } },
    desktopWorkbenches: { register() { return () => {} } }, sidebarSoftPanels: { registerOpener() { return () => {} } },
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
    AbortController, location: { origin: 'https://harness.test' }, console })
  plugin.apply(new Proxy(ctx, { get(target, key) {
    if (key === 'remote') assert.ok(plugin.inject.includes('remote'), 'Cordis requires the parent remote service injection')
    return target[key]
  } }))
  t.after(() => { for (const dispose of effects.reverse()) dispose() })
  await new Promise(resolve => setImmediate(resolve))
  const dialog = slots.find(slot => slot.definition.id === 'zhishu-knowledge-picker').definition.inject()
  return { picker: registrations[0], dialog, slots, selected, calls,
    rejectSelection() { rejectSelection = true }, denyCatalog() { catalogStatus = 401 } }
}

test('slash menu displays only the localized knowledge label and opens a session-specific multi-select draft', async t => {
  const f = await fixture(t)
  assert.equal(f.picker.name, 'knowledge')
  assert.equal(f.picker.label(), '知识库')
  assert.equal(f.picker.hideAlias, true)
  assert.equal(f.picker.available({ sessionId: 'session-a' }), true)
  assert.equal(f.picker.available({ sessionId: 'not-open' }), false)
  f.picker.ui.run({ sessionId: 'session-a' })
  assert.deepEqual(Array.from(f.dialog.hooks.knowledgeRequest.getSnapshot().ids), [])
  const catalog = await f.dialog.loadCatalog(AbortSignal.timeout(1000))
  assert.deepEqual(Array.from(catalog.knowledgeBases, row => row.id), ['kb-a', 'kb-b'])
  assert.equal(catalog.knowledgeBases[0].name, '资料 A')
})

test('selection uses the human command path for one session and requires an authoritative read acknowledgment', async t => {
  const f = await fixture(t)
  f.picker.ui.run({ sessionId: 'session-a' })
  await f.dialog.save(f.dialog.hooks.knowledgeRequest.getSnapshot(), ['kb-b', 'kb-a'])
  assert.deepEqual(Array.from(f.selected.get('session-a')), ['kb-a', 'kb-b'])
  assert.deepEqual(f.selected.get('session-b'), ['kb-b'])
  assert.ok(f.calls.some(call => call.line === '/knowledge kb-a kb-b' && call.sessionID === 'session-a'))
  assert.equal(f.dialog.hooks.knowledgeRequest.getSnapshot(), null)
  assert.equal(f.calls.some(call => call.path?.includes('/selection?')), false, 'Session state uses its projection, not a second HTTP reader')
  const chip = f.slots.find(slot => slot.definition.id === 'zhishu-knowledge-selection')
  await chip.definition.inject('session-a').remove('kb-a')
  assert.deepEqual(Array.from(f.selected.get('session-a')), ['kb-b'])
  await chip.definition.inject('session-a').clear()
  assert.deepEqual(Array.from(f.selected.get('session-a')), [])
  assert.deepEqual(f.selected.get('session-b'), ['kb-b'])
})

test('rejected host changes keep the previous selection and failed catalogs never supply stale options', async t => {
  const f = await fixture(t)
  f.picker.ui.run({ sessionId: 'session-b' })
  f.rejectSelection()
  const request = f.dialog.hooks.knowledgeRequest.getSnapshot()
  await assert.rejects(f.dialog.save(request, ['kb-a', 'kb-b']), /切换知识库失败/u)
  assert.equal(f.dialog.hooks.knowledgeRequest.getSnapshot(), request, 'failure keeps the picker draft')
  assert.deepEqual(f.selected.get('session-b'), ['kb-b'])
  f.denyCatalog()
  await assert.rejects(f.dialog.loadCatalog(AbortSignal.timeout(1000)), /知识库暂不可用/u)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(f.dialog.loadCatalog(controller.signal), { name: 'AbortError' })
})

test('cancel discards only its draft and stale drafts cannot overwrite another client selection', async t => {
  const f = await fixture(t)
  f.picker.ui.run({ sessionId: 'session-a' })
  const old = f.dialog.hooks.knowledgeRequest.getSnapshot()
  f.selected.set('session-a', ['kb-b'])
  await assert.rejects(f.dialog.save(old, ['kb-a']), /已更改/u)
  f.picker.ui.run({ sessionId: 'session-b' })
  const current = f.dialog.hooks.knowledgeRequest.getSnapshot()
  f.dialog.dismiss(old)
  assert.equal(f.dialog.hooks.knowledgeRequest.getSnapshot(), current)
  f.dialog.dismiss(current)
  assert.equal(f.dialog.hooks.knowledgeRequest.getSnapshot(), null)
  assert.equal(f.calls.some(call => call.line), false)
})

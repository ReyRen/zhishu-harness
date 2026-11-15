/** The packaged canvas bridge preserves dirty edits and skips redundant writes. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { extract } from 'tar'
import { prepareMindWorkbench, mindWorkbenchVersion } from '../../market-registry/prepare-mind-workbench.mjs'

let root, bridge, packed
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'mind-bridge-test-'))
  await copyFile(new URL('../../market-registry/tarballs/dsh-mind-workbench-1.0.15.tgz', import.meta.url), join(root, 'dsh-mind-workbench-1.0.15.tgz'))
  packed = await prepareMindWorkbench(root)
  await extract({ file: packed, cwd: root })
  bridge = await readFile(join(root, 'package/app/bridge.js'), 'utf8')
})
after(async () => { if (root) await rm(root, { recursive: true, force: true }) })
const settled = () => new Promise(resolve => setImmediate(resolve))

function canvas() {
  const messages = [], writes = [], beacons = [], timers = new Map(), events = {}, documentEvents = {}
  let busReady
  const origin = 'http://canvas.test'
  const window = {
    location: { origin }, localStorage: { getItem() { return '1' } },
    parent: { postMessage(message) { messages.push(message) } },
    addEventListener(type, fn) { events[type] = fn },
    $bus: { $on(_name, fn) { busReady = fn } }, initApp() { busReady({}) },
  }
  const document = { visibilityState: 'visible', addEventListener(type, fn) { documentEvents[type] = fn } }
  runInNewContext(bridge, {
    window, document, Blob,
    navigator: { sendBeacon(...args) { beacons.push(args); return true } },
    setTimeout(fn) { const id = timers.size + 1; timers.set(id, fn); return id },
    clearTimeout(id) { timers.delete(id) },
    fetch: async (_url, options) => {
      if (options.method !== 'POST') return { ok: true, json: async () => ({ documentId: 'default', document: { data: { root: { data: { text: 'root' } } } }, updatedAt: '2026-01-01T00:00:00.000Z' }) }
      const gate = Promise.withResolvers()
      writes.push({ body: JSON.parse(options.body), gate })
      return gate.promise
    },
  })
  return { window, document, documentEvents, messages, writes, beacons, events,
    async ready() { window.onload(); await settled() },
    async save(index) { writes[index].gate.resolve({ ok: true, json: async () => ({ updatedAt: `2026-01-01T00:00:0${index + 1}.000Z` }) }); await settled() },
  }
}

test('preparing the reviewed patch is reproducible and keeps a distinct version', async () => {
  const first = createHash('sha256').update(await readFile(packed)).digest('hex')
  await prepareMindWorkbench(root)
  assert.equal(createHash('sha256').update(await readFile(packed)).digest('hex'), first)
  assert.equal(JSON.parse(await readFile(join(root, 'package/package.json'), 'utf8')).version, mindWorkbenchVersion)
})

test('document revisions advance when writes share a clock tick or the clock moves backward', async () => {
  const source = await readFile(join(root, 'package/dsh/index.js'), 'utf8')
  const write = source.slice(source.indexOf('async function writeDocument('), source.indexOf('\nasync function listDocuments('))
  const writes = []
  const writeDocument = runInNewContext(write + '\nwriteDocument', {
    Date: class extends Date { static now() { return Date.parse('2026-01-01T00:00:00.000Z') } },
    documentFile: (_root, id) => id, writeJsonAtomic: async (_path, document) => { writes.push(document) },
  })
  const current = { id: 'default', data: { root: {} }, updatedAt: '2026-01-01T00:00:00.000Z' }
  const sameTick = await writeDocument('/scratch', current)
  assert.equal(sameTick.updatedAt, '2026-01-01T00:00:00.001Z')
  const afterRollback = await writeDocument('/scratch', { ...current, updatedAt: '2027-01-01T00:00:00.000Z' })
  assert.equal(afterRollback.updatedAt, '2027-01-01T00:00:00.001Z')
  assert.equal(writes.length, 2)
  assert.equal(writes[1].data, current.data)
})

test('an idle canvas publishes its loaded version and never writes on hiding or manual flush', async () => {
  const c = canvas(); await c.ready()
  assert.equal(c.messages.find(item => item.type === 'ready').updatedAt, '2026-01-01T00:00:00.000Z')
  c.window.dshMindWorkbench.flush()
  c.events.pagehide()
  c.document.visibilityState = 'hidden'; c.documentEvents.visibilitychange()
  assert.equal(c.writes.length, 0)
  assert.equal(c.beacons.length, 0)
})

test('edits made while saving stay dirty until their own save succeeds', async () => {
  const c = canvas(); await c.ready()
  c.window.takeOverAppMethods.saveMindMapData({ root: { data: { text: 'first' } } })
  c.window.dshMindWorkbench.flush()
  assert.equal(c.messages.at(-1).type, 'saving')
  assert.equal(c.writes[0].body.expectedUpdatedAt, '2026-01-01T00:00:00.000Z')
  c.window.takeOverAppMethods.saveMindMapData({ root: { data: { text: 'second' } } })
  await c.save(0)
  assert.equal(c.messages.at(-1).pending, true)
  c.window.dshMindWorkbench.flush()
  assert.equal(c.writes[1].body.expectedUpdatedAt, '2026-01-01T00:00:01.000Z')
  await c.save(1)
  assert.equal(c.messages.at(-1).pending, false)
  assert.equal(c.writes[1].body.data.root.data.text, 'second')
  c.events.pagehide()
  assert.equal(c.beacons.length, 0)
})

test('an unrelated same-origin frame cannot make the canvas flush', async () => {
  const c = canvas(); await c.ready()
  c.window.takeOverAppMethods.saveMindMapData({ root: {} })
  c.events.message({ origin: c.window.location.origin, source: {}, data: { channel: 'dsh-mind-workbench', type: 'flush' } })
  assert.equal(c.writes.length, 0)
  c.events.message({ origin: c.window.location.origin, source: c.window.parent, data: { channel: 'dsh-mind-workbench', type: 'flush' } })
  assert.equal(c.writes.length, 1)
  await c.save(0)
})

test('a conflicting save preserves local edits and stops background writes', async () => {
  const c = canvas(); await c.ready()
  c.window.takeOverAppMethods.saveMindMapData({ root: { data: { text: 'unsaved' } } })
  c.window.dshMindWorkbench.flush()
  c.writes[0].gate.resolve({ status: 409, ok: false })
  await settled()
  assert.equal(c.messages.at(-1).type, 'conflict')
  assert.equal(c.window.dshMindWorkbench.state.data.root.data.text, 'unsaved')
  c.window.dshMindWorkbench.flush()
  c.events.pagehide()
  assert.equal(c.writes.length, 1)
  assert.equal(c.beacons.length, 0)
})

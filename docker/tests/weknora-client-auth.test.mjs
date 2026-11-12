/** Platform tickets reach tool authentication independently of the knowledge panel. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../../overlay/knowledge-base/client.js', import.meta.url), 'utf8')
const turn = () => new Promise(resolve => setImmediate(resolve))

async function fixture(t, { mode = 'sso', status = 200, deferTicket = false } = {}) {
  const effects = [], listeners = new Set(), intervals = new Set(), calls = [], logs = []
  let plugin, respond, account, picker, disposed = false, defer = deferTicket, catalogUnauthorized = false, authenticated = false
  const parent = { postMessage(message) {
    respond = () => {
      for (const listener of [...listeners]) listener({ source: parent, origin: 'https://platform.test',
        data: { type: 'zhishu:sso-response', nonce: message.nonce, access_token: 'private-platform-ticket', user_id: '369' } })
    }
    if (!defer) queueMicrotask(respond)
  } }
  const window = {
    parent, top: parent,
    __ModuleLoader__: { load(definition) { plugin = definition.factory(() => ({ createElement() {},
      createSnapshotStore(value) { return { getSnapshot: () => value, set(next) { value = next } } } })) } },
    addEventListener(type, callback) { if (type === 'message') listeners.add(callback) },
    removeEventListener(type, callback) { if (type === 'message') listeners.delete(callback) },
    setTimeout, clearTimeout,
    setInterval(callback) { intervals.add(callback); return callback },
    clearInterval(callback) { intervals.delete(callback) },
    dshModelSpace: { async state() { return { authenticated: true } },
      onStateChanged(callback) { account = callback; return () => { account = undefined } } },
  }
  const document = { getElementById() { return {} } }
  const request = async (path, options) => {
    assert.equal(disposed, false)
    calls.push({ path, options })
    if (path.endsWith('/catalog')) {
      if (catalogUnauthorized) { catalogUnauthorized = false; return new Response(null, { status: 401 }) }
      return Response.json({ knowledgeBases: [{ id: 'kb-one', name: '资料' }] })
    }
    if (options.method === 'POST') { authenticated = true; return Response.json({ authenticated: true }) }
    return Response.json({ mode, authenticated }, { status })
  }
  runInNewContext(source, { window, document, fetch: request, AbortController, AbortSignal,
    location: { origin: 'https://harness.test' }, console: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
  })
  const ctx = {
    effect(setup) { const cleanup = setup(); if (cleanup) effects.push(cleanup) },
    on() { return () => {} },
    desktopWorkbenches: { ready: true, state: { added: [], sessionBindings: {} }, report(error) { throw error } },
    layout: { panelInfo: { getSnapshot() { return { activePanelId: null } }, subscribe() { return () => {} } } },
    sidebarSoftPanels: { registerOpener() { return () => {} } },
    slots: { inject() {} },
    commandUi: { decorate(value) { picker = value; return () => {} }, dismiss() {} },
    sessions: { binding() {} },
    locale: { register() { return () => {} }, bind() { return key => key } },
  }
  t.after(async () => {
    for (const effect of effects.reverse()) effect()
    await turn()
    disposed = true
    assert.equal(listeners.size, 0)
    assert.equal(intervals.size, 0)
  })
  plugin.apply(ctx)
  await turn()
  return { calls, logs, window, listeners, picker, respond: () => respond?.(), account: value => account(value),
    deferNextTicket() { defer = true; authenticated = false }, unauthorizedCatalog() { catalogUnauthorized = true },
    dispose() { for (const effect of effects.reverse()) effect(); effects.length = 0 } }
}

test('a signed-in Web user authenticates tools without mounting the knowledge panel', async t => {
  const f = await fixture(t)
  assert.equal(f.calls.length, 2)
  assert.deepEqual(JSON.parse(f.calls[1].options.body), { access_token: 'private-platform-ticket', user_id: '369' })
  assert.equal(f.calls[1].options.credentials, 'same-origin')
  assert.equal(JSON.stringify(f.logs).includes('private-platform-ticket'), false)
})

test('explicit API-key profiles do not request platform credentials', async t => {
  const f = await fixture(t, { mode: 'api-key' })
  assert.equal(f.calls.length, 1)
  assert.equal(f.listeners.size, 0)
})

test('profile-owned upstream bundles keep their own authentication', async t => {
  const f = await fixture(t, { status: 404 })
  assert.equal(f.calls.length, 1)
  assert.equal(f.listeners.size, 0)
})

test('signout cancels a pending handoff before clearing Host credentials', async t => {
  const f = await fixture(t, { deferTicket: true })
  f.account({ authenticated: false })
  f.respond()
  await turn()
  assert.equal(f.calls.length, 2)
  assert.deepEqual(JSON.parse(f.calls[1].options.body), { action: 'logout' })
})

test('unloading cancels the pending ticket and all timer/message registrations', async t => {
  const f = await fixture(t, { deferTicket: true })
  f.dispose()
  await turn()
  assert.equal(f.calls.length, 1)
  assert.equal(f.listeners.size, 0)
})

test('repeated signed-in snapshots do not invalidate an in-flight picker authentication', async t => {
  const f = await fixture(t, { deferTicket: true })
  f.account({ authenticated: true })
  const options = f.picker.ui.options({ sessionId: 'session-one' }, AbortSignal.timeout(1000))
  f.respond()
  assert.equal((await options)[0].id, 'kb-one')
})

test('closing one picker does not cancel another caller sharing the SSO handoff', async t => {
  const f = await fixture(t)
  f.deferNextTicket()
  const first = new AbortController()
  const cancelled = f.picker.ui.options({ sessionId: 'session-one' }, first.signal)
  const cancellation = assert.rejects(cancelled, { name: 'AbortError' })
  await turn()
  const other = f.picker.ui.options({ sessionId: 'session-one' }, AbortSignal.timeout(1000))
  first.abort()
  f.respond()
  await cancellation
  assert.equal((await other)[0].id, 'kb-one')
})

test('a catalog 401 obtains a fresh ticket even when Host still reports authenticated', async t => {
  const f = await fixture(t)
  f.unauthorizedCatalog()
  const options = await f.picker.ui.options({ sessionId: 'session-one' }, AbortSignal.timeout(1000))
  assert.equal(options[0].id, 'kb-one')
  assert.equal(f.calls.filter(call => call.path.endsWith('/auth') && call.options.method === 'POST').length, 2)
})

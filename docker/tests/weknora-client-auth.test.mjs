/** The platform ticket reaches tool authentication before opening the KB workbench. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../../overlay/knowledge-base/client.js', import.meta.url), 'utf8')
const turn = () => new Promise(resolve => setImmediate(resolve))

async function fixture(t, { mode = 'sso', status = 200, deferTicket = false } = {}) {
  const effects = [], listeners = new Set(), intervals = new Set(), calls = [], logs = []
  let plugin, respond, account, disposed = false
  const parent = { postMessage(message) {
    respond = () => {
      for (const listener of [...listeners]) listener({ source: parent, origin: 'https://platform.test',
        data: { type: 'zhishu:sso-response', nonce: message.nonce, access_token: 'private-platform-ticket', user_id: '369' } })
    }
    if (!deferTicket) queueMicrotask(respond)
  } }
  const window = {
    parent, top: parent,
    __ModuleLoader__: { load(definition) { plugin = definition.factory(() => ({ createElement() {} })) } },
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
    if (options.method === 'POST') return Response.json({ authenticated: true })
    return Response.json({ mode, authenticated: false }, { status })
  }
  runInNewContext(source, { window, document, fetch: request, AbortController,
    location: { origin: 'https://harness.test' }, console: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
  })
  const ctx = {
    effect(setup) { const cleanup = setup(); if (cleanup) effects.push(cleanup) },
    on() { return () => {} },
    desktopWorkbenches: { register() { return () => {} } },
    sidebarSoftPanels: { registerOpener() { return () => {} } },
    slots: { inject() {} },
  }
  plugin.apply(ctx)
  t.after(async () => {
    for (const effect of effects.reverse()) effect()
    await turn()
    disposed = true
    assert.equal(listeners.size, 0)
    assert.equal(intervals.size, 0)
  })
  await turn()
  return { calls, logs, window, listeners, respond: () => respond?.(), account: value => account(value),
    dispose() { for (const effect of effects.reverse()) effect(); effects.length = 0 } }
}

test('a signed-in Web user authenticates tools without mounting the knowledge workbench', async t => {
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

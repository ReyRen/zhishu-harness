/** Built-artifact Session lifecycle checks for knowledge-selection cancellation. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '../../packages/core/session/lib/index.js'
import SessionProjectionRegistry from '../../packages/session/session-projection/lib/index.js'
import { installSelection } from '../../overlay/weknora/selection.mjs'

test('real Session projections gate new calls, cancel active retrieval after clearing, and stop work on unload', { timeout: 5000 }, async t => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  t.after(() => ctx.fiber.dispose())
  let command, revoked = false, catalogs = 0
  const selection = await installSelection({
    sessionProjections: ctx.sessionProjections,
    effect: setup => ctx.effect(setup),
    commands: { register(value) { command = value; return () => {} } },
    connection: { fetch: { register() { return () => {} } } },
  }, { async listKnowledgeBases(signal) {
    signal.throwIfAborted(); catalogs++
    return revoked ? [] : [{ id: 'kb-a', name: 'A' }, { id: 'kb-b', name: 'B' }]
  } }, ['kb-a'])
  const session = ctx.sessions.create()
  const agent = { id: session.id, session }
  const exec = { agent, signal: AbortSignal.timeout(4000) }
  await assert.rejects(selection.run(exec, () => assert.fail('unselected retrieval started')), { code: 'knowledge_selection_required' })
  assert.equal(catalogs, 0)
  let sequence = 0
  const choose = async id => {
    const commandId = `selection-${++sequence}`
    session.append('command/run', { commandId, name: 'knowledge', args: id, source: { kind: 'user' } })
    const result = await command.handler({ rawInput: id, signal: exec.signal })
    session.append('command/done', { commandId, kind: result.kind })
    return result
  }
  assert.equal((await choose('kb-b')).kind, 'error', 'deployment allowlist cannot be expanded by selection')
  await choose('kb-a')
  assert.equal(selection.selectionOf(agent), 'kb-a')
  const other = ctx.sessions.create()
  assert.equal(selection.selectionOf({ id: other.id, session: other }), null)
  const start = Promise.withResolvers()
  const active = selection.run(exec, (_id, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    start.resolve()
  }))
  const cancelled = assert.rejects(active, { name: 'AbortError' })
  await start.promise
  await choose('kb-a')
  await choose('off')
  await cancelled
  assert.equal(selection.selectionOf(agent), null)
  await choose('kb-a'); revoked = true
  await assert.rejects(selection.run(exec, () => assert.fail('revoked retrieval started')), { code: 'knowledge_scope_denied' })
  revoked = false
  const beforeUnload = Promise.withResolvers()
  const unloading = selection.run(exec, (_id, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true }); beforeUnload.resolve()
  }))
  const stopped = assert.rejects(unloading, { name: 'AbortError' })
  await beforeUnload.promise
  await ctx.fiber.dispose()
  await stopped
})

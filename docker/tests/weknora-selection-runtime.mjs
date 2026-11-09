/** Built-artifact Session lifecycle checks for knowledge-selection cancellation. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SESSION_FORMAT_VERSION } from '../../packages/core/session/lib/index.js'
import SessionProjectionRegistry from '../../packages/session/session-projection/lib/index.js'
import { installSelection, selectionProjection } from '../../overlay/weknora/selection.mjs'

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
  } }, [])
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
  assert.equal((await choose('kb-c')).kind, 'error', 'unavailable choices cannot expand selection')
  await choose('kb-a kb-b')
  assert.deepEqual(selection.selectionOf(agent), ['kb-a', 'kb-b'])
  const other = ctx.sessions.create()
  assert.deepEqual(selection.selectionOf({ id: other.id, session: other }), [])
  const start = Promise.withResolvers()
  const active = selection.run(exec, (_id, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    start.resolve()
  }))
  const cancelled = assert.rejects(active, { name: 'AbortError' })
  await start.promise
  await choose('kb-a kb-b')
  await choose('kb-b')
  await choose('off')
  await cancelled
  assert.deepEqual(selection.selectionOf(agent), [])
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

test('real cold restore discards the old single-selection checkpoint and refolds unchanged command history', async t => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  t.after(() => ctx.fiber.dispose())
  await ctx.sessionProjections.register(selectionProjection)
  const rows = { zhishuKnowledge: { ver: 1, seq: 1, val: { selection: { knowledgeBaseId: 'kb-a' }, pending: {} } } }
  assert.equal(ctx.sessionProjections.restoreFloor(rows), 0)
  const events = [
    { seq: 0, time: 0, type: 'command/run', data: { commandId: 'old', name: 'knowledge', args: ' kb-a' } },
    { seq: 1, time: 1, type: 'command/done', data: { commandId: 'old', kind: 'success' } },
  ]
  const header = { version: SESSION_FORMAT_VERSION, id: 'knowledge-restore', createdAt: 0, isSeeded: false }
  const restored = ctx.sessionProjections.restore(rows, events, 0, header, 0)
  assert.deepEqual(restored.snapshot.values.zhishuKnowledge, { knowledgeBaseIds: ['kb-a'] })
  assert.equal(restored.checkpoint.zhishuKnowledge.ver, 2)
})

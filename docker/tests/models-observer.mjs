/** Exercise the shipped Web composition through a complete unified-model tool round. */
import assert from 'node:assert/strict'
import { createUserMessage } from '../../packages/llm/llm/lib/index.js'

export const inject = ['loader', 'llm', 'agents', 'commands']

export function apply(ctx) {
  const events = []
  ctx.on('session/event', (session, event) => {
    if (session.id === 'unified-models-smoke') events.push(event)
  }, { global: true })
  const receive = message => {
    if (message?.command !== 'models-probe') return
    void (async () => {
      await ctx.loader.await()
      const handle = await ctx.agents.create({ sessionId: 'unified-models-smoke',
        meta: { cwd: message.workspace, agentPreset: 'standard' },
        agentOptions: { provider: 'ds-utcs', model: 'legacy-fixture-chat' } })
      try {
        assert.deepEqual(handle.agent.model.current(), { provider: 'zhishu-models', model: '10004:fixture-chat' })
        const chosen = await ctx.commands.execute(handle.agent, '/knowledge kb-a', [], AbortSignal.timeout(5000))
        assert.equal(chosen.result.kind, 'success')
        handle.agent.followup(createUserMessage({ source: { kind: 'user' },
          content: [{ type: 'text', text: 'List the selected knowledge bases and report the result.' }] }))
        await handle.agent.whenIdle()
        const answers = events.filter(event => event.type === 'assistant/message')
        assert.match(JSON.stringify(answers), /UNIFIED_MODELS_OK/u)
        assert.equal(events.filter(event => event.type === 'tool/call').length, 1)
        assert.equal(events.filter(event => event.type === 'tool/result').length, 1)
        assert.ok(events.some(event => event.type === 'model/selection'), 'migration uses the native logged selection')
        process.send({ models: { selection: handle.agent.model.current(), tools: 1, answer: 'UNIFIED_MODELS_OK' } })
      } finally { await handle.dispose() }
    })().catch(error => process.send({ error: error.stack || error.message }))
  }
  ctx.effect(() => { process.on('message', receive); return () => process.off('message', receive) })
}

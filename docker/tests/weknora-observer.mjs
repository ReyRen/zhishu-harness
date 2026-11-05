/** Drive the built Web agent through the installation's unmodified WeKnora tools. */
import assert from 'node:assert/strict'
import { createUserMessage } from '../../packages/llm/llm/lib/index.js'
import { calls, KnowledgeModel } from './weknora-model.mjs'

export const inject = ['loader', 'llm', 'tools', 'agents', 'profileContext']

/** Register a deterministic model and observe one real conversation after Web readiness. */
export function apply(ctx) {
  ctx.llm.registerAdapter(['weknora-smoke'], new KnowledgeModel())
  const events = []
  ctx.on('session/event', (session, event) => {
    if (session.id.startsWith('weknora-smoke')) events.push(event)
  }, { global: true })
  const receive = message => {
    if (message?.command !== 'weknora-probe') return
    void (async () => {
      await ctx.loader.await()
      const instances = [...ctx.loader.entries()].filter(entry => entry.options.name === '@wxg-prc-cpg/dsh-weknora')
      assert.equal(instances.length, 1)
      const handle = await ctx.agents.create({
        sessionId: message.sessionId, meta: { cwd: message.workspace, agentPreset: 'standard' },
        agentOptions: { provider: 'weknora-smoke', model: 'weknora-smoke' },
      })
      try {
        handle.agent.followup(createUserMessage({ source: { kind: 'user' },
          content: [{ type: 'text', text: 'Consult the knowledge base and explain the backup policy.' }] }))
        await handle.agent.whenIdle()
        const toolCalls = events.filter(event => event.type === 'tool/call').map(event => event.data)
        const results = events.filter(event => event.type === 'tool/result').map(event => event.data)
        const answers = events.filter(event => event.type === 'assistant/message').map(event => event.data)
        assert.equal(toolCalls.length, 4)
        assert.equal(results.length, 4)
        assert.match(JSON.stringify(answers), /Backups are retained for 30 days/u)
        let denied
        try {
          await ctx.tools.get('weknora_search').execute({ query: 'secret', knowledge_base_ids: ['forbidden'] },
            { signal: AbortSignal.timeout(5_000) })
        } catch (error) { denied = error.message }
        assert.match(denied, /HTTP 403/u)
        const fiber = instances[0].fiber
        await fiber.dispose()
        for (const [name] of calls) assert.equal(ctx.tools.get(name), undefined, 'Unloading removes every tool')
        process.send({ weknora: { names: calls.map(([name]) => name), toolCalls, results, answers,
          denied, unloaded: true, startedBundles: ctx.profileContext.startedBundles } })
      } finally { await handle.dispose() }
    })().catch(error => { process.send({ error: error.stack ?? error.message }) })
  }
  ctx.effect(() => {
    process.on('message', receive)
    return () => { process.off('message', receive) }
  })
}

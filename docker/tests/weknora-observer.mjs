/** Drive the built Web agent through the installation's unmodified WeKnora tools. */
import assert from 'node:assert/strict'
import { createUserMessage } from '../../packages/llm/llm/lib/index.js'
import { calls, KnowledgeModel } from './weknora-model.mjs'

export const inject = ['loader', 'llm', 'tools', 'agents', 'profileContext', 'commands']

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
      const instances = [...ctx.loader.entries()].filter(entry => entry.options.name === '@wxg-prc-cpg/dsh-weknora'
        || entry.options.name.replaceAll('\\', '/').endsWith('/weknora/index.mjs'))
      assert.equal(instances.length, 1)
      const handle = await ctx.agents.create({
        sessionId: message.sessionId, meta: { cwd: message.workspace, agentPreset: 'standard' },
        agentOptions: { provider: 'weknora-smoke', model: 'weknora-smoke' },
      })
      try {
        const managed = ctx.commands.find(handle.agent, 'knowledge') !== undefined
        const resolveTools = () => ctx.tools.resolve({ agent: handle.agent,
          modelSelection: { provider: 'weknora-smoke', model: 'weknora-smoke' }, signal: AbortSignal.timeout(5_000) })
        if (managed) {
          const before = await resolveTools()
          try { for (const [name] of calls) assert.equal(before.view(handle.agent).has(name), false, 'Unselected KB tools are absent') }
          finally { before.dispose() }
          const selected = await ctx.commands.execute(handle.agent, `/knowledge ${message.knowledgeBaseId}`, [], AbortSignal.timeout(5_000))
          assert.equal(selected.result.kind, 'success')
        }
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
            { agent: handle.agent, callId: 'denied-probe', signal: AbortSignal.timeout(5_000) })
        } catch (error) { denied = error.message }
        assert.match(denied, managed ? /Only the knowledge base selected/u : /HTTP 403/u)
        if (managed) {
          const disabled = await ctx.commands.execute(handle.agent, '/knowledge off', [], AbortSignal.timeout(5_000))
          assert.equal(disabled.result.kind, 'success')
          const after = await resolveTools()
          try { for (const [name] of calls) assert.equal(after.view(handle.agent).has(name), false, 'Clearing hides KB tools again') }
          finally { after.dispose() }
          await assert.rejects(ctx.tools.get('weknora_search').execute({ query: 'not selected' },
            { agent: handle.agent, callId: 'unselected-probe', signal: AbortSignal.timeout(5_000) }), { code: 'knowledge_selection_required' })
        }
        const fiber = instances[0].fiber
        await fiber.dispose()
        for (const [name] of calls) assert.equal(ctx.tools.get(name), undefined, 'Unloading removes every tool')
        process.send({ weknora: { names: calls.map(([name]) => name), toolCalls, results, answers,
          denied, selectionRequired: managed, unloaded: true, startedBundles: ctx.profileContext.startedBundles } })
      } finally { await handle.dispose() }
    })().catch(error => { process.send({ error: error.stack ?? error.message }) })
  }
  ctx.effect(() => {
    process.on('message', receive)
    return () => { process.off('message', receive) }
  })
}

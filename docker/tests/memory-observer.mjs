/** Test-only probe of real memory tools mounted by the built Web profile. */
import { createUserMessage } from '../../packages/llm/llm/lib/index.js'

export const inject = ['loader', 'tools', 'sessions', 'profileContext']

/**
 * Execute memory tools in explicit session workspaces without calling a model.
 * @param ctx - Live Web Loader context.
 */
export function apply(ctx) {
  const receive = (message) => {
    if (message?.command !== 'memory-probe') return
    void (async () => {
      await ctx.loader.await()
      const names = ['memory_remember', 'memory_search', 'memory_find_similar', 'memory_read',
        'memory_update', 'memory_project', 'memory_home', 'memory_dream']
      for (const name of names) {
        if (!ctx.tools.get(name)) throw new Error(`Default Web did not register ${name}`)
      }
      const session = ctx.sessions.create(message.sessionID, { meta: { cwd: message.workspace } })
      session.append('turn/start', { turn: 1 })
      session.append('user/message', createUserMessage({
        source: { kind: 'user' }, content: [{ type: 'text', text: 'Recall offline-memory-probe' }],
      }), { surfaceOp: 'append' })
      const execution = { agent: { session } }
      if (message.expectUntrusted) {
        try {
          await ctx.tools.get('memory_remember').execute({ level: 'fact', content: message.content }, execution)
        } catch (error) {
          if (!error.message.includes('/meow-trust')) throw error
          process.send({ memory: { untrustedWriteBlocked: true } })
          return
        }
        throw new Error('An imported memory database accepted a write without user trust')
      }
      let written
      if (message.write) {
        written = await ctx.tools.get('memory_remember').execute({
          level: 'fact', content: message.content, project: 'offline-smoke',
          keywords: ['offline-memory-probe'], importance: 8,
        }, execution)
        if (!written.ok) throw new Error('Memory write failed')
      }
      const found = await ctx.tools.get('memory_search').execute({ query: 'offline-memory-probe' }, execution)
      const home = await ctx.tools.get('memory_home').execute({})
      const entries = [...ctx.loader.entries()].filter(entry => entry.options.name === 'meow-memory')
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      process.send({ memory: { tools: names, written, found, home, instances: entries.length,
        startedBundles: ctx.profileContext.startedBundles } })
    })().catch((error) => { process.send({ error: error.stack ?? error.message }) })
  }
  ctx.effect(() => {
    process.on('message', receive)
    return () => { process.off('message', receive) }
  })
}

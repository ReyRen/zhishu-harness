/** Test-only IPC probe of the built Web profile's Office plugins. */

/** Live services inspected by this test-only probe. */
export const inject = ['loader', 'tools', 'skills']

/**
 * Register an owned listener whose reply reports live tool and skill state.
 * @param ctx - Context in the built Web Loader tree.
 */
export function apply(ctx) {
  const receive = (message) => {
    if (message !== 'office-probe') return
    void (async () => {
      await ctx.loader.await()
      const definition = ctx.tools.get('load_workspace_dependencies')
      if (!definition) throw new Error('Web did not register load_workspace_dependencies')
      const runtime = await definition.execute({})
      const skills = await Promise.all(['office-docx', 'office-pptx', 'office-xlsx'].map(async (name) => {
        const skill = await ctx.skills.get(name)
        if (!skill) throw new Error(`Web did not register ${name}`)
        return { name, provider: skill.provider, resourceBase: skill.resourceBase, content: skill.content }
      }))
      process.send({ office: { runtime, skills } })
    })().catch((error) => { process.send({ error: error.message }) })
  }
  ctx.effect(() => {
    process.on('message', receive)
    return () => { process.off('message', receive) }
  })
}

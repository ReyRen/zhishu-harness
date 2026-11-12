/** Test-only IPC probe of shipped Office skills, agent tools and the real Host converter. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Live services inspected by this test-only probe. */
export const inject = ['loader', 'tools', 'skills', 'agents', 'officeKit']

/**
 * Register an owned listener whose reply reports live tool and skill state.
 * @param ctx - Context in the built Web Loader tree.
 */
export function apply(ctx) {
  const receive = (message) => {
    if (message?.command !== 'office-probe') return
    void (async () => {
      await ctx.loader.await()
      const definition = ctx.tools.get('load_workspace_dependencies')
      if (!definition) throw new Error('Web did not register load_workspace_dependencies')
      const runtime = await definition.execute({})
      const names = ['office', 'office-docx', 'office-pptx', 'office-xlsx']
      const skills = await Promise.all(names.map(async (name) => {
        const skill = await ctx.skills.get(name)
        if (!skill) throw new Error(`Web did not register ${name}`)
        return { name, provider: skill.provider, resourceBase: skill.resourceBase, content: skill.content }
      }))
      execFileSync(runtime.python, ['-I', '-B', join(import.meta.dirname, 'create-office.py'), message.directory],
        { timeout: 60000, stdio: 'pipe' })
      const handle = await ctx.agents.create({ sessionId: 'office-image-smoke',
        meta: { cwd: message.directory, agentPreset: 'standard' } })
      try {
        const tools = ['office_render', 'office_convert', 'office_recalculate']
        for (const name of tools) assert.ok(handle.agent.ctx.tools.get(name), `Standard preset must register ${name}`)
        const source = async (extension) => {
          const path = join(message.directory, `sample.${extension}`)
          const info = await stat(path)
          return { key: path, version: 'immutable-smoke-fixture', bytes: info.size,
            async read(signal, maxBytes) {
              const bytes = await readFile(path, { signal })
              assert.ok(bytes.byteLength <= maxBytes)
              return { bytes, version: 'immutable-smoke-fixture' }
            } }
        }
        const converted = []
        for (const extension of ['docx', 'pptx', 'xlsx']) {
          const result = await ctx.officeKit.convertTo({ extension, format: 'pdf', source: await source(extension),
            output: { owner: handle.agent.session.id, name: `${extension}.pdf` } })
          const path = join(message.directory, `${extension}.pdf`)
          await copyFile(result.path, path)
          converted.push(path)
        }
        const calculated = await ctx.officeKit.recalculate({ extension: 'xlsx', format: 'xlsx', source: await source('xlsx'),
          output: { owner: handle.agent.session.id, name: 'recalculated.xlsx' } })
        const recalculated = join(message.directory, 'recalculated.xlsx')
        await copyFile(calculated.path, recalculated)
        const rendered = await ctx.officeKit.renderImages({ extension: 'docx', source: await source('docx'), pages: [1], dpi: 96,
          maxImages: 2, maxPixels: 10000000, maxDimension: 10000, maxBytes: 8000000 })
        assert.ok(rendered.images.length > 0)
        const preview = join(message.directory, 'preview.png')
        await writeFile(preview, rendered.images[0].png)
        process.send({ office: { runtime, skills, tools, converted, recalculated, preview } })
      } finally { await handle.dispose() }
    })().catch((error) => { process.send({ error: error.message }) })
  }
  ctx.effect(() => {
    process.on('message', receive)
    return () => { process.off('message', receive) }
  })
}

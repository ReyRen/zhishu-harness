/** Mock only the external backend; the original plugin and Harness tool pipeline execute normally. */
import { KnowledgeModel } from '../../../docker/tests/weknora-model.mjs'

export const inject = ['llm']

/** Provide deterministic WeKnora responses and, for initial capture, a deterministic model. */
export function apply(ctx, config) {
  if (config.model) ctx.llm.registerAdapter(['weknora-smoke'], new KnowledgeModel())
  ctx.effect(() => {
    const previous = globalThis.fetch
    globalThis.fetch = async (input, options) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      if (url.origin !== 'http://weknora.test') return previous(input, options)
      const text = 'Backups are retained for 30 days.'
      const chunk = { id: 'chunk-backups', knowledge_id: 'doc-backups', knowledge_title: 'Backup policy',
        chunk_index: 0, score: 0.95, content: text }
      const json = data => Response.json(data)
      switch (url.pathname) {
        case '/api/v1/knowledge-bases': return json({ data: [{ id: 'kb-backups', name: 'Backup policies' }] })
        case '/api/v1/knowledge-search': return json({ data: [chunk] })
        case '/api/v1/knowledge/search': return json({ data: [] })
        case '/api/v1/knowledge/doc-backups': return json({ data: { title: 'Backup policy', description: 'Retention policy' } })
        case '/api/v1/chunks/doc-backups': return json({ data: [chunk], total: 1, page: 1, page_size: 30 })
        case '/api/v1/sessions': return json({ data: { id: 'answer-backups' } })
        case '/api/v1/knowledge-chat/answer-backups':
          return new Response([
            { response_type: 'answer', content: text },
            { response_type: 'references', knowledge_references: [chunk] },
            { response_type: 'complete' },
          ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
        default: return Response.json({ error: 'Unknown fixture route' }, { status: 404 })
      }
    }
    return () => { globalThis.fetch = previous }
  })
}

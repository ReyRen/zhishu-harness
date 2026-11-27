/** Read Wiki evidence through the current user's selected knowledge bases. */
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { ToolArgsError } from '@deepseek-ai/dsh-tools'
import { WeknoraApiError } from '@wxg-prc-cpg/dsh-weknora'
import { rewriteKnowledgeImages } from './media.mjs'

const string = { type: 'string' }
const references = { type: 'array', items: string }
const identity = { knowledge_base_id: string, slug: string, title: string }
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
const clip = (text, limit) => text.slice(0, limit)
const slugParts = slug => typeof slug === 'string' && slug.length <= 512 && slug.split('/').every(part =>
  part && part === part.trim() && part !== '.' && part !== '..' && !/[\p{Cc}\p{Cs}\\%?#]/u.test(part))

/** Optional Wiki evidence attached to a search result. */
export const wikiSchema = { type: 'object', properties: {
  status: { type: 'string', enum: ['matches', 'no_matches'] },
  query: string,
  pages: { type: 'array', items: { type: 'object', properties: { ...identity, summary: string, snippet: string },
    required: [...Object.keys(identity), 'summary', 'snippet'], additionalProperties: false } },
}, required: ['status', 'query', 'pages'], additionalProperties: false }

function invalidWikiResponse() {
  return new HarnessError('The knowledge backend returned an invalid Wiki response.', 'knowledge_backend_unavailable')
}

async function requestWiki(client, path, options, signal) {
  try { return await client.fetchJson(path, options, signal) }
  catch (error) {
    signal.throwIfAborted()
    if (!(error instanceof WeknoraApiError)) throw error
    if (error.status === 401) throw new HarnessError('Reopen the signed-in platform session.', 'knowledge_login_required', { cause: error })
    if (error.status === 403) throw new HarnessError('Access to the requested Wiki content was refused.', 'knowledge_access_denied', { cause: error })
    if (error.status === 404 && options.method === 'GET') {
      throw new HarnessError('The Wiki page is no longer available.', 'knowledge_wiki_page_unavailable', { cause: error })
    }
    if (error.status === 404) throw new HarnessError('A selected Wiki is no longer available.', 'knowledge_scope_denied', { cause: error })
    throw new HarnessError('Wiki retrieval failed. Try the request again.', 'knowledge_backend_unavailable', { cause: error })
  }
}

/** Search Wiki pages using literal phrases and a bounded keyword fallback.
 * @param client Current selected-scope client.
 * @param config Deployment result and excerpt limits.
 * @param question Human question or model search query.
 * @param signal Retrieval lifetime.
 * @param maxResults Requested page count, capped by deployment and API limits.
 * @returns Bounded Wiki references, or undefined when no Wiki is selected.
 */
export async function searchWiki(client, config, question, signal, maxResults = config.maxResults) {
  if (!client.wikiBaseIds.length) return undefined
  // PostgreSQL treats the search query as a regex. These literal terms also
  // work with SQLite's substring matching.
  const focus = clip(question, config.maxChunkChars).split(/[?？!！。\r\n]/u).find(part => part.trim()) ?? ''
  const phrase = focus.replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, ' ').trim().replace(/\s+/gu, ' ')
  const keywords = [...segmenter.segment(phrase)].filter(({ isWordLike, segment }) => isWordLike && segment.length >= 2)
    .map(({ segment }) => segment).sort((a, b) => b.length - a.length)
  const terms = [...new Set([phrase, ...keywords])].filter(Boolean).slice(0, 3)
  const limit = Math.min(config.maxResults, maxResults, 50)
  for (const query of terms) {
    const pages = []
    // The backend accepts at most 32 KBs in a single Wiki search.
    for (let start = 0; start < client.wikiBaseIds.length; start += 32) {
      const ids = client.wikiBaseIds.slice(start, start + 32)
      const value = await requestWiki(client, '/wiki-search',
        { method: 'POST', body: { query, knowledge_base_ids: ids, limit } }, signal)
      if (value?.success !== true || !Array.isArray(value.data) || value.data.some(page =>
        !ids.includes(page?.knowledge_base_id) || !slugParts(page.slug) || typeof page.title !== 'string'
        || typeof page.summary !== 'string' || (page.match_snippet !== undefined && typeof page.match_snippet !== 'string'))) {
        throw invalidWikiResponse()
      }
      pages.push(...value.data.map(page => ({ knowledge_base_id: page.knowledge_base_id, slug: page.slug,
        title: clip(page.title, config.maxChunkChars), summary: clip(page.summary, config.maxChunkChars),
        snippet: clip(page.match_snippet ?? '', config.maxChunkChars) })))
    }
    if (pages.length) return { status: 'matches', query, pages: pages.slice(0, limit) }
  }
  return { status: 'no_matches', query: phrase, pages: [] }
}

/** Define the read-only Wiki page tool.
 * @param config Deployment tool name, timeout and excerpt limits.
 * @param run Executor that rechecks selected scope and current access.
 * @returns A tool returning a page excerpt with source references.
 */
export function wikiReadTool(config, run) {
  return { name: config.toolPrefix + '_wiki_read_page',
    description: 'Read a Wiki page and its source references using the knowledge base ID and slug returned by search.',
    parameters: { type: 'object', properties: {
      knowledge_base_id: { ...string, description: 'Knowledge base ID of the matched Wiki page.' },
      slug: { ...string, description: 'Page slug from the Wiki search result, including its type prefix when present.' },
    }, required: ['knowledge_base_id', 'slug'], additionalProperties: false },
    timeoutMs: config.requestTimeoutMs, isConcurrencySafe: () => true,
    output: { schema: { type: 'object', properties: { ...identity, content: string, content_truncated: { type: 'boolean' },
      source_refs: references }, required: [...Object.keys(identity), 'content', 'content_truncated', 'source_refs'],
    additionalProperties: false },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, context) => run(context, async (client, signal) => {
      const { knowledge_base_id: id, slug } = args
      if (!client.wikiBaseIds.includes(id)) throw new ToolArgsError(['knowledge_base_id: choose a Wiki-enabled base from the current selection'])
      if (!slugParts(slug)) throw new ToolArgsError(['slug: use the page slug from a Wiki search result'])
      const path = '/knowledgebase/' + encodeURIComponent(id) + '/wiki/pages/' + slug.split('/').map(encodeURIComponent).join('/')
      const page = await requestWiki(client, path, { method: 'GET' }, signal)
      if (page?.knowledge_base_id !== id || page.slug !== slug || typeof page.title !== 'string'
        || typeof page.content !== 'string' || (page.source_refs != null
          && (!Array.isArray(page.source_refs) || page.source_refs.some(ref => typeof ref !== 'string')))) {
        throw invalidWikiResponse()
      }
      return { knowledge_base_id: id, slug, title: clip(page.title, config.maxChunkChars),
        content: rewriteKnowledgeImages(clip(page.content, config.maxChunkChars), id),
        content_truncated: page.content.length > config.maxChunkChars,
        source_refs: (page.source_refs ?? []).slice(0, config.maxResults).map(ref => clip(ref, config.maxChunkChars)) }
    }),
  }
}

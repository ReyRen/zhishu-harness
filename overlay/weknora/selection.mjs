/** User-selected, Session-owned retrieval scope over the installed WeKnora client. */
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { WeknoraClient, WeknoraApiError } from '@wxg-prc-cpg/dsh-weknora'

export const SELECTION_KEY = 'zhishuKnowledge'
export const SELECT_COMMAND = 'knowledge'
const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u)
const idsSchema = z.array(idSchema)
const selectionSchema = z.object({ knowledgeBaseIds: idsSchema }).strict()
const EMPTY = Object.freeze([])
const sameIds = (left, right) => left.length === right.length && left.every((id, index) => id === right[index])

/** Canonical full selections; single-ID historical commands retain their meaning. */
function parseSelection(rawInput) {
  const raw = rawInput?.trim()
  if (raw === 'off') return []
  if (!raw) return null
  const parsed = idsSchema.safeParse(raw.split(/\s+/u))
  return parsed.success ? [...new Set(parsed.data)].sort() : null
}

/** Stable refusals; never contain backend credentials or retrieved document content. */
export class KnowledgeScopeError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

/** Reconstruct selections only from successfully completed human commands. */
export const selectionProjection = {
  key: SELECTION_KEY, stateVersion: 2,
  stateSchema: z.object({ selection: selectionSchema,
    pending: z.record(z.string(), idsSchema) }).strict(),
  init: () => ({ selection: { knowledgeBaseIds: [] }, pending: {} }),
  apply(state, event) {
    if (event.type === 'command/run' && event.data.name === SELECT_COMMAND) {
      const ids = parseSelection(event.data.args)
      return ids ? { ...state, pending: { ...state.pending, [event.data.commandId]: ids } } : state
    }
    if (event.type !== 'command/done' || !Object.hasOwn(state.pending, event.data.commandId)) return state
    const { [event.data.commandId]: ids, ...pending } = state.pending
    return { selection: event.data.kind === 'success' && !sameIds(state.selection.knowledgeBaseIds, ids)
      ? { knowledgeBaseIds: ids } : state.selection, pending }
  },
  wire: { viewSchema: selectionSchema, view: state => state.selection },
}

/** Discover owned and shared KBs using the same credential and tenant scope. */
export class AccessibleKnowledgeClient extends WeknoraClient {
  async listKnowledgeBases(signal) {
    const owned = await super.listKnowledgeBases(signal)
    const shared = await this.fetchJson('/shared-knowledge-bases', { method: 'GET' }, signal)
    if (!Array.isArray(shared?.data) || shared.data.some(row =>
      typeof row?.knowledge_base?.id !== 'string')) {
      throw new WeknoraApiError('Invalid shared knowledge catalog response', 502)
    }
    const unique = new Map(owned.map(base => [base.id, base]))
    for (const row of shared.data) {
      const base = row.knowledge_base
      if (!unique.has(base.id)) unique.set(base.id, base)
    }
    return [...unique.values()]
  }
}

/** Resolve only the catalog the current credential and deployment allow. */
export async function visibleBases(client, allowedIds, signal) {
  const bases = await client.listKnowledgeBases(signal)
  return bases.filter(base => idSchema.safeParse(base.id).success
    && (!allowedIds.length || allowedIds.includes(base.id)))
    .map(base => ({ id: base.id, name: typeof base.name === 'string' && base.name.trim() ? base.name : base.id }))
}

/** All retrieval methods enforce the selected KB set, including document-only calls. */
export class SelectedKnowledgeClient extends AccessibleKnowledgeClient {
  constructor(config, knowledgeBaseIds, requestID) {
    super(config)
    this.knowledgeBaseIds = knowledgeBaseIds
    this.requestID = requestID
  }
  headers() { return { ...super.headers(), 'X-Request-ID': this.requestID } }
  async listKnowledgeBases(signal) {
    return (await super.listKnowledgeBases(signal)).filter(base => this.knowledgeBaseIds.includes(base.id))
  }
  checkScope(ids) {
    if (!Array.isArray(ids) || ids.some(id => !this.knowledgeBaseIds.includes(id))) {
      throw new KnowledgeScopeError('knowledge_scope_denied', 'Only the knowledge bases selected by the user may be searched.')
    }
  }
  async getDocument(id, signal) {
    const document = await super.getDocument(id, signal)
    if (!this.knowledgeBaseIds.includes(document.knowledge_base_id)) {
      throw new KnowledgeScopeError('knowledge_scope_denied', 'This document is outside the selected knowledge bases.')
    }
    return document
  }
  async listChunks(input, signal) {
    await this.getDocument(input.knowledgeId, signal)
    return super.listChunks(input, signal)
  }
  async search(input, signal) {
    this.checkScope(input.knowledgeBaseIds)
    for (const id of input.knowledgeIds) await this.getDocument(id, signal)
    return super.search({ ...input, knowledgeBaseIds: this.knowledgeBaseIds }, signal)
  }
  // The upstream title endpoint searches every visible KB; do not issue that unscoped request.
  async findDocuments() { return [] }
  async ask(input, signal) {
    this.checkScope(input.knowledgeBaseIds)
    if (input.agentId !== undefined || input.webSearch) {
      throw new KnowledgeScopeError('knowledge_scope_denied', 'Selected knowledge uses the scoped RAG pipeline without web search.')
    }
    return super.ask({ ...input, knowledgeBaseIds: this.knowledgeBaseIds }, signal)
  }
}

/** Correlate actual backend requests using its existing X-Request-ID logging. */
export function knowledgeRequestID(user, session, call) {
  const hash = value => createHash('sha256').update(String(value)).digest('hex').slice(0, 16)
  return `harness.${user || 'standalone'}.${hash(session)}.${hash(call)}.${randomUUID()}`
}

/** Reject options that can reuse another KB's chat context or expand the scoped RAG. */
export function selectedArguments(args, ids) {
  if (args && typeof args === 'object' && !Array.isArray(args)
    && (args.session_id !== undefined || args.agent_id !== undefined || args.web_search === true)) {
    throw new KnowledgeScopeError('knowledge_scope_denied', 'Do not supply session_id, agent_id or web_search for selected knowledge.')
  }
  if (args?.knowledge_base_ids !== undefined && (!Array.isArray(args.knowledge_base_ids)
    || args.knowledge_base_ids.some(value => !ids.includes(value)))) {
    throw new KnowledgeScopeError('knowledge_scope_denied', 'Only the knowledge bases selected by the user may be searched.')
  }
  return args?.knowledge_base_ids === undefined ? args : { ...args, knowledge_base_ids: ids }
}

/** Install logged selection commands, owner-only reads and per-call cancellation. */
export async function installSelection(ctx, client, allowedIds) {
  const projection = await ctx.sessionProjections.register(selectionProjection)
  const active = new Map()
  const selectionOf = agent => agent ? projection.stateOf(agent.session).selection.knowledgeBaseIds : EMPTY
  const catalog = signal => visibleBases(client, allowedIds, signal)
  ctx.effect(() => ctx.commands.register({
    name: SELECT_COMMAND, description: '选择本会话使用的知识库，可多选',
    input: { hint: '<知识库 ID…|off>' },
    async handler({ rawInput, signal }) {
      const ids = parseSelection(rawInput)
      if (!ids) {
        return { kind: 'error', text: '请从“知识库”选择资料，或取消全部选择' }
      }
      const visible = ids.length ? await catalog(signal) : []
      if (ids.some(id => !visible.some(base => base.id === id))) {
        return { kind: 'error', text: '所选知识库不可用或访问权限已取消，请重新选择' }
      }
      // command/done is the authoritative commit; failures leave the previous selection intact.
      return { kind: 'success', text: ids.length ? `已选择 ${ids.length} 个知识库` : '已停用知识库检索' }
    },
  }), 'knowledge: selection command')
  ctx.effect(() => ctx.sessionProjections.onChanged((session, key) => {
    if (key !== SELECTION_KEY) return
    for (const controller of active.get(session.id) || []) controller.abort()
  }), 'knowledge: cancel retrieval after scope changes')
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/zhishu-knowledge/catalog', methods: ['GET'], requestBody: 'buffered',
    async fetch(request) {
      try { return Response.json({ knowledgeBases: await catalog(request.signal) }, { headers: { 'cache-control': 'no-store' } }) }
      catch (error) {
        const status = error instanceof KnowledgeScopeError ? 409 : error.status || 502
        return Response.json({ error: error.code || 'knowledge_catalog_unavailable' }, { status })
      }
    },
  }), 'knowledge: owner-only catalog')
  ctx.effect(() => () => { for (const group of active.values()) for (const controller of group) controller.abort(); active.clear() },
    'knowledge: cancel calls on unload')
  return {
    selectionOf,
    async run(exec, callback) {
      const ids = selectionOf(exec.agent)
      if (!ids.length) throw new KnowledgeScopeError('knowledge_selection_required', 'Choose knowledge bases before using knowledge tools.')
      const controller = new AbortController()
      const group = active.get(exec.agent.id) || new Set()
      active.set(exec.agent.id, group); group.add(controller)
      const signal = AbortSignal.any([exec.signal, controller.signal])
      try {
        const visible = await catalog(signal)
        if (ids.some(id => !visible.some(base => base.id === id))) {
          throw new KnowledgeScopeError('knowledge_scope_denied', 'A selected knowledge base is unavailable or access was revoked.')
        }
        signal.throwIfAborted()
        if (selectionOf(exec.agent) !== ids) throw new KnowledgeScopeError('knowledge_scope_changed', 'Knowledge selection changed; retry the question.')
        return await callback(ids, signal)
      } finally { group.delete(controller); if (!group.size) active.delete(exec.agent.id) }
    },
  }
}

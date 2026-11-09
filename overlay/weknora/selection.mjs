/** User-selected, Session-owned retrieval scope over the installed WeKnora client. */
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { WeknoraClient } from '@wxg-prc-cpg/dsh-weknora'

export const SELECTION_KEY = 'zhishuKnowledge'
export const SELECT_COMMAND = 'knowledge'
const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u)
const selectionSchema = z.object({ knowledgeBaseId: idSchema.nullable() }).strict()

/** Stable refusals; never contain backend credentials or retrieved document content. */
export class KnowledgeScopeError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

/** Reconstruct selections only from successfully completed human commands. */
export const selectionProjection = {
  key: SELECTION_KEY, stateVersion: 1,
  stateSchema: z.object({ selection: selectionSchema,
    pending: z.record(z.string(), idSchema.nullable()) }).strict(),
  init: () => ({ selection: { knowledgeBaseId: null }, pending: {} }),
  apply(state, event) {
    if (event.type === 'command/run' && event.data.name === SELECT_COMMAND) {
      const raw = event.data.args?.trim()
      const parsed = raw === 'off' ? { success: true, data: null } : idSchema.safeParse(raw)
      return parsed.success ? { ...state, pending: { ...state.pending, [event.data.commandId]: parsed.data } } : state
    }
    if (event.type !== 'command/done' || !Object.hasOwn(state.pending, event.data.commandId)) return state
    const { [event.data.commandId]: id, ...pending } = state.pending
    return { selection: event.data.kind === 'success' && state.selection.knowledgeBaseId !== id
      ? { knowledgeBaseId: id } : state.selection, pending }
  },
  wire: { viewSchema: selectionSchema, view: state => state.selection },
}

/** Resolve only the catalog the current credential and deployment allow. */
export async function visibleBases(client, allowedIds, signal) {
  const bases = await client.listKnowledgeBases(signal)
  return bases.filter(base => idSchema.safeParse(base.id).success
    && (!allowedIds.length || allowedIds.includes(base.id)))
    .map(base => ({ id: base.id, name: typeof base.name === 'string' && base.name.trim() ? base.name : base.id }))
}

/** All retrieval methods enforce one selected KB, including document-only calls. */
export class SelectedKnowledgeClient extends WeknoraClient {
  constructor(config, knowledgeBaseId, requestID) {
    super(config)
    this.knowledgeBaseId = knowledgeBaseId
    this.requestID = requestID
  }
  headers() { return { ...super.headers(), 'X-Request-ID': this.requestID } }
  async listKnowledgeBases(signal) {
    return (await super.listKnowledgeBases(signal)).filter(base => base.id === this.knowledgeBaseId)
  }
  checkScope(ids) {
    if (!Array.isArray(ids) || ids.some(id => id !== this.knowledgeBaseId)) {
      throw new KnowledgeScopeError('knowledge_scope_denied', 'Only the knowledge base selected by the user may be searched.')
    }
  }
  async getDocument(id, signal) {
    const document = await super.getDocument(id, signal)
    if (document.knowledge_base_id !== this.knowledgeBaseId) {
      throw new KnowledgeScopeError('knowledge_scope_denied', 'This document is outside the selected knowledge base.')
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
    return super.search({ ...input, knowledgeBaseIds: [this.knowledgeBaseId] }, signal)
  }
  // The upstream title endpoint searches every visible KB; do not issue that unscoped request.
  async findDocuments() { return [] }
  async ask(input, signal) {
    this.checkScope(input.knowledgeBaseIds)
    if (input.agentId !== undefined || input.webSearch) {
      throw new KnowledgeScopeError('knowledge_scope_denied', 'Selected knowledge uses the scoped RAG pipeline without web search.')
    }
    return super.ask({ ...input, knowledgeBaseIds: [this.knowledgeBaseId] }, signal)
  }
}

/** Correlate actual backend requests using its existing X-Request-ID logging. */
export function knowledgeRequestID(user, session, call) {
  const hash = value => createHash('sha256').update(String(value)).digest('hex').slice(0, 16)
  return `harness.${user || 'standalone'}.${hash(session)}.${hash(call)}.${randomUUID()}`
}

/** Reject options that can reuse another KB's chat context or expand the scoped RAG. */
export function selectedArguments(args, id) {
  if (args && typeof args === 'object' && !Array.isArray(args)
    && (args.session_id !== undefined || args.agent_id !== undefined || args.web_search === true)) {
    throw new KnowledgeScopeError('knowledge_scope_denied', 'Do not supply session_id, agent_id or web_search for selected knowledge.')
  }
  if (args?.knowledge_base_ids !== undefined && (!Array.isArray(args.knowledge_base_ids)
    || args.knowledge_base_ids.some(value => value !== id))) {
    throw new KnowledgeScopeError('knowledge_scope_denied', 'Only the knowledge base selected by the user may be searched.')
  }
  return args
}

/** Install logged selection commands, owner-only reads and per-call cancellation. */
export async function installSelection(ctx, client, allowedIds) {
  const projection = await ctx.sessionProjections.register(selectionProjection)
  const active = new Map()
  const selectionOf = agent => agent ? projection.stateOf(agent.session).selection.knowledgeBaseId : null
  const catalog = signal => visibleBases(client, allowedIds, signal)
  ctx.effect(() => ctx.commands.register({
    name: SELECT_COMMAND, description: '知识库：选择本会话使用的资料 / Select knowledge for this conversation',
    input: { hint: '<knowledge-base-id|off>' },
    async handler({ rawInput, signal }) {
      const id = rawInput.trim()
      if (id !== 'off' && !idSchema.safeParse(id).success) {
        return { kind: 'error', text: 'Select a knowledge base from /knowledge, or use off.' }
      }
      if (id !== 'off' && !(await catalog(signal)).some(base => base.id === id)) {
        return { kind: 'error', text: 'This knowledge base is unavailable or access was revoked.' }
      }
      // command/done is the authoritative commit; failures leave the previous selection intact.
      return { kind: 'success', text: id === 'off' ? 'Knowledge retrieval disabled.' : 'Knowledge base selected.' }
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
      const id = selectionOf(exec.agent)
      if (!id) throw new KnowledgeScopeError('knowledge_selection_required', 'Choose a knowledge base with /knowledge before using knowledge tools.')
      const controller = new AbortController()
      const group = active.get(exec.agent.id) || new Set()
      active.set(exec.agent.id, group); group.add(controller)
      const signal = AbortSignal.any([exec.signal, controller.signal])
      try {
        if (!(await catalog(signal)).some(base => base.id === id)) {
          throw new KnowledgeScopeError('knowledge_scope_denied', 'The selected knowledge base is unavailable or access was revoked.')
        }
        signal.throwIfAborted()
        if (selectionOf(exec.agent) !== id) throw new KnowledgeScopeError('knowledge_scope_changed', 'Knowledge selection changed; retry the question.')
        return await callback(id, signal)
      } finally { group.delete(controller); if (!group.size) active.delete(exec.agent.id) }
    },
  }
}

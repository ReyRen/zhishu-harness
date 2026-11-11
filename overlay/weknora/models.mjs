/** Use the authenticated knowledge workspace's model registry without exporting credentials. */
import { LlmAdapter, LlmError, offloadedImageText, projectImagesForTextModel, projectOffloadedImages, projectToolUpdates, requestImageHandleText, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'

export const UNIFIED_PROVIDER = 'zhishu-models'

function failure(code, status) {
  const messages = {
    MODEL_LOGIN_REQUIRED: 'Sign in to the platform again, then retry the model request.',
    MODEL_ACCESS_DENIED: 'This workspace no longer allows the selected model. Select an available model.',
    MODEL_NOT_FOUND: 'The selected model was removed. Select an available model in Settings.',
    MODEL_WORKSPACE_REQUIRED: 'Open model settings and select a workspace before choosing a model.',
    MODEL_CONFIGURATION_CHANGED: 'The model configuration changed. Select the model again and retry.',
    MODEL_STREAM_INTERRUPTED: 'The model response was interrupted. Check the conversation before retrying.',
    MODEL_STOP_SEQUENCES_UNSUPPORTED: 'The unified model service does not support explicit stop sequences. Remove this request option.',
  }
  return new LlmError(messages[code] || 'The unified model service is unavailable. Check model settings and retry.', code, status ? { status } : undefined)
}

function scopeID(value) {
  const id = String(value ?? '')
  if (!/^[1-9]\d*$/u.test(id)) throw failure('MODEL_WORKSPACE_REQUIRED')
  return id
}

export function parseModelID(id) {
  const match = /^([1-9]\d*):([A-Za-z0-9][A-Za-z0-9._-]{0,63})$/u.exec(id)
  if (!match) throw failure('INVALID_UNIFIED_MODEL')
  return { tenant: match[1], id: match[2] }
}

/** The scope belongs to the caller; built-in rows can have another storage tenant. */
export function describeModel(row, tenant) {
  if (!row || typeof row.id !== 'string' || typeof row.name !== 'string'
    || row.type !== 'KnowledgeQA' || row.status !== 'active' || typeof row.updated_at !== 'string') {
    throw failure('INVALID_MODEL_CATALOG')
  }
  const id = `${scopeID(tenant)}:${row.id}`
  parseModelID(id)
  const caps = row.capabilities || {}, params = row.parameters || {}
  const context = params.context_window || caps.context_window
  const output = params.max_output_tokens || caps.max_output_tokens
  const efforts = Array.isArray(caps.thinking_levels) ? caps.thinking_levels : []
  return {
    provider: UNIFIED_PROVIDER, id, name: row.display_name || row.name,
    ...(Number.isSafeInteger(context) && context > 0 ? { context: { contextWindow: context } } : {}),
    ...(Number.isSafeInteger(output) && output > 0 ? { defaultMaxTokens: output } : {}),
    inputModalities: params.supports_vision || caps.input?.includes('image') ? ['text', 'image'] : ['text'],
    ...(caps.reasoning && efforts.length ? { reasoning: { efforts: efforts.map(id => ({ id, name: id })) } } : {}),
  }
}

async function jsonResponse(response) {
  if (!response.ok) {
    await response.body?.cancel()
    throw failure(response.status === 401 ? 'MODEL_LOGIN_REQUIRED'
      : response.status === 403 ? 'MODEL_ACCESS_DENIED'
      : response.status === 404 ? 'MODEL_NOT_FOUND' : 'MODEL_BACKEND_UNAVAILABLE', response.status)
  }
  let body
  try { body = await response.json() } catch { throw failure('INVALID_MODEL_CATALOG') }
  if (!body || typeof body !== 'object' || body.success === false || !('data' in body)) throw failure('INVALID_MODEL_CATALOG')
  return body.data
}

/** Translate DSH's logged history to the existing protocol-neutral backend runtime. */
export async function modelRequest(options, row, ctx) {
  if (options.stop?.length) throw failure('MODEL_STOP_SEQUENCES_UNSUPPORTED')
  const info = describeModel(row, parseModelID(options.model).tenant)
  const projected = projectToolUpdates(options.messages, options.tools, undefined, options.toolHistory)
  let history = info.inputModalities.includes('image') ? projected.messages : projectImagesForTextModel(projected.messages)
  history = projectOffloadedImages(history, ref => offloadedImageText(ref))
  const messages = []
  if (options.system) messages.push({ role: 'system', content: options.system })
  const toolNames = new Map()
  for (const message of history) {
    const converted = { role: message.role, content: '' }
    const previous = message.source?.replayState?.response
    const replay = message.source?.kind === 'model' && message.source.provider === UNIFIED_PROVIDER
      && message.source.model === options.model && previous?.kind === 'zhishu-model'
      && previous.modelName === row.name
      && previous.protocol === row.capabilities?.api ? previous : undefined
    const text = [], reasoning = [], parts = [], calls = []
    for (const block of message.content) {
      switch (block.type) {
        case 'text': text.push(block.text); parts.push({ type: 'text', text: block.text }); break
        case 'reasoning': reasoning.push(block.text); break
        case 'tool-call': {
          const call = { id: block.id, type: 'function', function: { name: block.name, arguments: block.arguments } }
          if (replay?.tools?.[block.id]) call.provider_metadata = replay.tools[block.id]
          calls.push(call); toolNames.set(block.id, block.name)
          break
        }
        case 'image': {
          const attachments = ctx.get('attachments')
          if (!attachments) throw failure('MODEL_IMAGE_STORAGE_UNAVAILABLE')
          const target = { width: block.attachment.width, height: block.attachment.height, maxBytes: block.attachment.bytes }
          const image = await attachments.readImageRequest(block.attachment, target, options.signal)
          const access = resolveImageAttachmentAccess(attachments, path => ctx.get('fs')?.processPathFromHostPath(path), block.attachment)
          parts.push({ type: 'text', text: requestImageHandleText(block.attachment, image, access) })
          parts.push({ type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${Buffer.from(image.data).toString('base64')}` } })
          break
        }
        default: throw failure('MODEL_CONTENT_UNSUPPORTED')
      }
    }
    converted.content = text.join('')
    if (parts.some(part => part.type === 'image_url')) converted.multi_content = parts
    if (calls.length) converted.tool_calls = calls
    if (reasoning.length && (row.capabilities?.api !== 'anthropic-messages' || replay)) converted.reasoning_content = reasoning.join('')
    if (replay?.reasoning_signature) converted.reasoning_signature = replay.reasoning_signature
    if (replay?.reasoning_metadata) converted.reasoning_metadata = replay.reasoning_metadata
    if (message.role === 'tool') {
      converted.tool_call_id = message.source.callId
      converted.name = toolNames.get(message.source.callId) || ''
    }
    messages.push(converted)
  }
  return {
    model_revision: row.updated_at,
    messages,
    options: {
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
      ...(options.reasoningEffort === undefined ? {} : { reasoning_effort: options.reasoningEffort }),
      tools: (projected.tools || []).map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
    },
  }
}

async function* events(response) {
  if (!response.body) throw failure('MODEL_STREAM_INTERRUPTED')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let pending = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      pending += decoder.decode(value, { stream: !done }).replaceAll('\r\n', '\n')
      let end
      while ((end = pending.indexOf('\n\n')) !== -1) {
        const frame = pending.slice(0, end); pending = pending.slice(end + 2)
        const type = frame.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim()
        const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (!type || !data) continue
        let item
        try { item = JSON.parse(data) } catch { throw failure('INVALID_MODEL_STREAM') }
        yield { type, data: item }
      }
      if (done) break
      if (pending.length > 32 * 1024 * 1024) throw failure('INVALID_MODEL_STREAM')
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

/** Convert streamed output while preserving tool JSON, replay artifacts and disjoint usage. */
export async function* modelStream(response, row) {
  if (!response.ok) {
    await response.body?.cancel()
    throw failure(response.status === 409 ? 'MODEL_CONFIGURATION_CHANGED' : 'MODEL_REQUEST_FAILED', response.status)
  }
  const blocks = new Map()
  let next = 0, terminal = false, last = {}, sawError = false
  for await (const event of events(response)) {
    if (event.type === 'end') { terminal = true; break }
    if (event.type !== 'chunk' || !event.data || typeof event.data !== 'object') throw failure('INVALID_MODEL_STREAM')
    const chunk = event.data
    if (chunk.response_type === 'error') sawError = true
    if (chunk.done && chunk.response_type === 'answer') last = { ...last, ...chunk }
    const kind = chunk.response_type === 'thinking' ? 'reasoning' : chunk.response_type === 'answer' ? 'text' : undefined
    if (!kind || !chunk.content) continue
    if (!blocks.has(kind)) {
      const index = next++
      blocks.set(kind, { index, type: kind, text: '' })
      yield { type: 'block-start', index, blockType: kind }
    }
    const block = blocks.get(kind)
    block.text += chunk.content
    yield { type: kind === 'text' ? 'text-delta' : 'reasoning-delta', index: block.index, text: chunk.content }
  }
  if (sawError || !terminal || !last.finish_reason || last.finish_reason === 'incomplete') throw failure('MODEL_STREAM_INTERRUPTED')
  for (const { index, type, text } of blocks.values()) yield { type: 'block-end', index, block: { type, text } }
  const toolMetadata = {}
  for (const tool of last.tool_calls || []) {
    if (!tool.id || !tool.function?.name || typeof tool.function.arguments !== 'string') throw failure('INVALID_MODEL_TOOL_CALL')
    const index = next++
    yield { type: 'block-start', index, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index, id: tool.id, name: tool.function.name, argumentsDelta: tool.function.arguments }
    yield { type: 'block-end', index, block: { type: 'tool-call', id: tool.id, name: tool.function.name, arguments: tool.function.arguments } }
    if (tool.provider_metadata) toolMetadata[tool.id] = tool.provider_metadata
  }
  if (last.usage) {
    const u = last.usage, read = u.cache_read_tokens || u.cached_tokens || 0, write = u.cache_write_tokens || 0
    yield { type: 'usage', usage: {
      inputTokens: Math.max(0, u.prompt_tokens - read - write), outputTokens: u.completion_tokens,
      cacheReadTokens: read, cacheWriteTokens: write,
      ...(u.total_tokens === u.prompt_tokens + u.completion_tokens ? { totalTokens: u.total_tokens } : {}),
    } }
  }
  let reason
  switch (last.finish_reason) {
    case 'stop': case 'end_turn': case 'completed': reason = (last.tool_calls?.length ? 'tool-calls' : 'stop'); break
    case 'tool_calls': case 'tool_use': case 'function_call': reason = 'tool-calls'; break
    case 'length': case 'max_tokens': reason = 'max-tokens'; break
    default: throw failure('MODEL_STREAM_INTERRUPTED')
  }
  yield { type: 'finish', reason: { kind: reason }, replayState: { response: {
    kind: 'zhishu-model', modelName: row.name, protocol: row.capabilities?.api,
    ...last.data?.reasoning_signature ? { reasoning_signature: last.data.reasoning_signature } : {},
    ...last.data?.reasoning_metadata ? { reasoning_metadata: last.data.reasoning_metadata } : {},
    tools: toolMetadata,
  } } }
}

export class UnifiedModelsAdapter extends LlmAdapter {
  constructor(ctx, runtime, legacySelections = []) { super(); this.ctx = ctx; this.runtime = runtime; this.legacySelections = legacySelections; this.tenant = undefined; this.refreshGeneration = 0 }
  providerInfo() { return { id: UNIFIED_PROVIDER, name: '统一模型' } }
  async request(path, init = {}, tenant) {
    try { return await this.runtime.fetchModels(path, init, tenant) }
    catch (error) {
      if (init.signal?.aborted || error.name === 'AbortError') throw error
      throw failure(error.status === 401 ? 'MODEL_LOGIN_REQUIRED' : 'MODEL_BACKEND_UNAVAILABLE', error.status)
    }
  }
  migratable(before) {
    return before?.provider !== UNIFIED_PROVIDER && !this.ctx.get('llm')?.listProviders().some(row => row.id === before?.provider)
  }
  async scope() {
    if (this.tenant) return this.tenant
    const me = await jsonResponse(await this.request('/auth/me'))
    return scopeID(me.tenant?.id)
  }
  async listModels() {
    if (!this.runtime.state().authenticated) return []
    const me = await jsonResponse(await this.request('/auth/me'))
    const spaces = new Map((me.memberships || []).map(member => [scopeID(member.tenant_id), member.tenant_name || '']))
    if (me.tenant?.id) spaces.set(scopeID(me.tenant.id), me.tenant.name || '')
    if (this.tenant && !spaces.has(this.tenant)) throw failure('MODEL_ACCESS_DENIED')
    const catalogs = await Promise.all([...spaces].map(async ([tenant, name]) => {
      const rows = await jsonResponse(await this.request('/models', {}, tenant))
      if (!Array.isArray(rows)) throw failure('INVALID_MODEL_CATALOG')
      return rows.filter(row => row.type === 'KnowledgeQA' && row.status === 'active').map(row => {
        const { provider, id, name: label, inputModalities } = describeModel(row, tenant)
        return { provider, id, name: label, inputModalities, ...(spaces.size > 1 && name ? { badge: { text: name, tone: 'neutral' } } : {}) }
      })
    }))
    return catalogs.flat()
  }
  async refresh(tenant, signal) {
    const generation = ++this.refreshGeneration
    const next = tenant === undefined ? await this.scope() : scopeID(tenant)
    const rows = await jsonResponse(await this.request('/models', { signal }, next))
    if (!Array.isArray(rows)) throw failure('INVALID_MODEL_CATALOG')
    if (generation !== this.refreshGeneration) return
    this.tenant = next
    this.ctx.emit('llm/models-updated', UNIFIED_PROVIDER)
    await this.migrateDefaults(rows, next)
  }
  async migrateDefaults(rows, tenant) {
    const generation = this.refreshGeneration
    const defaults = this.ctx.get('agentDefaultModel')
    const before = defaults?.currentSelection()
    const next = this.migratable(before) ? await this.selectionFor(before, rows, tenant) : undefined
    if (generation !== this.refreshGeneration || !this.runtime.state().authenticated) return
    if (defaults && next && sameSelection(before, defaults.currentSelection())) await defaults.saveSelection(next)
    if (generation !== this.refreshGeneration || !this.runtime.state().authenticated) return
    const agents = this.ctx.get('agents')?.list() || []
    for (const agent of agents) {
      if (agent.status !== 'idle') continue
      const before = agent.model.current()
      const selection = this.migratable(before) ? await this.selectionFor(before, rows, tenant) : undefined
      if (selection && generation === this.refreshGeneration && sameSelection(before, agent.model.current())) agent.model.select(selection)
    }
  }
  async migrateAgent(agent) {
    const before = agent.model.current()
    if (!this.runtime.state().authenticated || !this.migratable(before)) return
    const generation = this.refreshGeneration
    const selected = await this.selectionFor(before)
    if (selected && generation === this.refreshGeneration && sameSelection(before, agent.model.current())) agent.model.select(selected)
  }
  async selectionFor(before, rows, tenant) {
    const mapped = this.legacySelections.find(item => item.provider === before?.provider && item.model === before?.model)
    const target = mapped ? scopeID(mapped.tenantID) : tenant || await this.scope()
    if (!rows || target !== tenant) rows = await jsonResponse(await this.request('/models', {}, target))
    if (!Array.isArray(rows)) throw failure('INVALID_MODEL_CATALOG')
    return migrateSelection(before, rows, target, this.legacySelections)
  }
  async row(model, signal) {
    const { id, tenant } = parseModelID(model)
    return jsonResponse(await this.request(`/models/${encodeURIComponent(id)}`, { signal }, tenant))
  }
  async resolveModel(_provider, model, signal) {
    return describeModel(await this.row(model, signal), parseModelID(model).tenant)
  }
  async prepareCall(_provider, model, signal) {
    const row = await this.row(model, signal)
    return { model: describeModel(row, parseModelID(model).tenant), stream: options => this.streamSnapshot(options, row) }
  }
  async *stream(options) { yield* this.streamSnapshot(options, await this.row(options.model, options.signal)) }
  async *streamSnapshot(options, row) {
    const { id, tenant } = parseModelID(options.model)
    const body = await modelRequest(options, row, this.ctx)
    const response = await this.request(`/models/${encodeURIComponent(id)}/harness-chat`, {
      method: 'POST', body: JSON.stringify(body), signal: options.signal,
    }, tenant)
    yield* modelStream(response, row)
  }
}

function sameSelection(left, right) { return left?.provider === right?.provider && left?.model === right?.model }

/** Migrate references, never credentials. Ambiguous catalogs require a human choice. */
export function migrateSelection(before, rows, tenant, legacySelections = []) {
  if (before?.provider === UNIFIED_PROVIDER) return undefined
  const chat = rows.filter(row => row.type === 'KnowledgeQA' && row.status === 'active')
  const mapped = legacySelections.find(item => item.provider === before?.provider && item.model === before?.model)
  if (mapped) {
    const row = String(mapped.tenantID) === tenant ? chat.find(row => row.id === mapped.id) : undefined
    return row ? { provider: UNIFIED_PROVIDER, model: describeModel(row, tenant).id } : undefined
  }
  const matches = chat.filter(row => row.name === before?.model || row.id === before?.model)
  const defaults = chat.filter(row => row.is_default || row.default_for?.includes('chat'))
  const selected = matches.length === 1 ? matches[0] : matches.length > 1 ? undefined
    : defaults.length === 1 ? defaults[0] : defaults.length === 0 && chat.length === 1 ? chat[0] : undefined
  return selected ? { provider: UNIFIED_PROVIDER, model: describeModel(selected, tenant).id } : undefined
}

export function installUnifiedModels(ctx, runtime, legacySelections = []) {
  const adapter = new UnifiedModelsAdapter(ctx, runtime, legacySelections)
  ctx.llm.registerAdapter([UNIFIED_PROVIDER], adapter)
  ctx.effect(() => runtime.onStateChanged(() => {
    adapter.tenant = undefined
    adapter.refreshGeneration++
    ctx.emit('llm/models-updated', UNIFIED_PROVIDER)
    if (runtime.state().authenticated) void adapter.refresh().catch(() => {
      ctx.logger.warn('Unified model catalog could not be initialized; no replacement model was selected')
    })
  }), 'unified-models: authorization invalidation')
  ctx.on('agent/created', async ({ agent }) => {
    try { await adapter.migrateAgent(agent) }
    catch { ctx.logger.warn('The conversation model could not be migrated; select a model explicitly') }
  })
  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle') void adapter.migrateAgent(agent).catch(() => {
      ctx.logger.warn('The conversation model could not be migrated; select a model explicitly')
    })
  })
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/zhishu-models/refresh', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      try {
        const body = await request.json()
        await adapter.refresh(body?.tenantId, request.signal)
        return Response.json({ success: true }, { headers: { 'cache-control': 'no-store' } })
      } catch {
        return Response.json({ error: 'model_catalog_refresh_failed' }, { status: 502, headers: { 'cache-control': 'no-store' } })
      }
    },
  }), 'unified-models: owner-only catalog refresh')
  return adapter
}

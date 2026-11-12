/** Owner-authenticated model administration for the native Harness settings page. */
import { KnowledgeAuthError } from '../weknora/runtime.mjs'

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u
const MODEL_TYPES = new Set(['KnowledgeQA', 'Embedding', 'Rerank', 'VLLM', 'ASR'])
const TEST_PATHS = {
  KnowledgeQA: '/initialization/remote/check',
  Embedding: '/initialization/embedding/test',
  Rerank: '/initialization/rerank/check',
  VLLM: '/initialization/remote/check',
  ASR: '/initialization/asr/check',
}
const BODY_LIMIT = 1024 * 1024
const HEADERS = { 'cache-control': 'no-store' }
const MODEL_FIELDS = ['id', 'tenant_id', 'name', 'display_name', 'type', 'source', 'description', 'is_builtin',
  'is_default', 'default_for', 'status', 'created_at', 'updated_at', 'credentials', 'capabilities']
const PARAMETER_FIELDS = ['base_url', 'interface_type', 'embedding_parameters', 'parameter_size', 'provider',
  'extra_config', 'custom_headers', 'supports_vision', 'context_window', 'max_output_tokens', 'max_concurrency', 'app_id', 'spec']

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function invalid() { throw new KnowledgeAuthError('invalid_model_settings_request', 400) }
function tenantID(value) {
  const id = String(value ?? '')
  if (!/^[1-9]\d*$/u.test(id)) invalid()
  return id
}
function modelID(value) { if (typeof value !== 'string' || !MODEL_ID.test(value)) invalid(); return value }
function publicModel(value) {
  if (!record(value) || !record(value.parameters)) throw new KnowledgeAuthError('invalid_model_settings_response', 502)
  const result = Object.fromEntries(MODEL_FIELDS.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]))
  result.parameters = Object.fromEntries(PARAMETER_FIELDS.filter(key => Object.hasOwn(value.parameters, key)).map(key => [key, value.parameters[key]]))
  return result
}

async function bodyOf(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) invalid()
  const reader = request.body?.getReader()
  if (!reader) invalid()
  const parts = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > BODY_LIMIT) throw new KnowledgeAuthError('model_settings_request_too_large', 413)
      parts.push(value)
    }
  } finally { await reader.cancel(); reader.releaseLock() }
  let body
  try { body = JSON.parse(Buffer.concat(parts).toString('utf8')) } catch { invalid() }
  if (!record(body)) invalid()
  return body
}

async function backend(runtime, path, method, body, tenant, signal) {
  const response = await runtime.fetchModels(path, {
    method, signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, tenant)
  if (!response.ok) {
    await response.body?.cancel()
    const code = response.status === 401 ? 'model_login_required'
      : response.status === 403 ? 'model_access_denied'
      : response.status === 404 ? 'model_not_found'
      : response.status === 409 && method === 'DELETE' ? 'model_in_use' : 'model_settings_backend_failed'
    throw new KnowledgeAuthError(code, response.status)
  }
  if (response.status === 204) return undefined
  let result
  try { result = await response.json() } catch { throw new KnowledgeAuthError('invalid_model_settings_response', 502) }
  if (!record(result) || result.success !== true || !Object.hasOwn(result, 'data')) {
    throw new KnowledgeAuthError('invalid_model_settings_response', 502)
  }
  return result.data
}

function modelPayload(value) {
  if (!record(value) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 512
    || !MODEL_TYPES.has(value.type) || !['local', 'remote'].includes(value.source) || !record(value.parameters)) invalid()
  return {
    name: value.name, type: value.type, source: value.source, parameters: value.parameters,
    ...(typeof value.display_name === 'string' ? { display_name: value.display_name } : {}),
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
  }
}

/**
 * Handle only the declared settings operations under the current user's SSO.
 * Backend membership, role, credential and model-in-use guards remain authoritative.
 * @param runtime - the per-user authenticated backend transport.
 * @param changed - invalidate the model directory after a committed mutation.
 * @returns a Host fetch handler; no backend token or saved secret is returned.
 */
export function createModelManagement(runtime, changed) {
  return async request => {
    try {
      if (request.method === 'GET') {
        const url = new URL(request.url)
        const operation = url.searchParams.get('operation') || 'context'
        if (operation === 'context') {
          const me = await backend(runtime, '/auth/me', 'GET', undefined, undefined, request.signal)
          if (!record(me) || !Array.isArray(me.memberships)) throw new KnowledgeAuthError('invalid_model_settings_response', 502)
          const spaces = me.memberships.map(member => {
            if (!record(member) || typeof member.tenant_name !== 'string' || typeof member.role !== 'string') {
              throw new KnowledgeAuthError('invalid_model_settings_response', 502)
            }
            return { id: tenantID(member.tenant_id), name: member.tenant_name, role: member.role }
          })
          return Response.json({ data: { spaces, homeTenantId: tenantID(me.user?.tenant_id),
            systemAdmin: me.user?.is_system_admin === true } }, { headers: HEADERS })
        }
        if (!['models', 'providers'].includes(operation)) invalid()
        const tenant = operation === 'providers' ? tenantID(url.searchParams.get('tenantId')) : undefined
        const data = await backend(runtime, operation === 'models' ? '/models/available' : '/models/providers', 'GET', undefined, tenant, request.signal)
        if (!Array.isArray(data)) throw new KnowledgeAuthError('invalid_model_settings_response', 502)
        return Response.json({ data: operation === 'models' ? data.map(publicModel) : data }, { headers: HEADERS })
      }
      if (request.method !== 'POST') throw new KnowledgeAuthError('unsupported_model_settings_operation', 405)
      const body = await bodyOf(request)
      const tenant = tenantID(body.tenantId)
      const signal = request.signal
      let data
      switch (body.operation) {
        case 'create': data = await backend(runtime, '/models', 'POST', modelPayload(body.model), tenant, signal); break
        case 'update': data = await backend(runtime, `/models/${modelID(body.id)}`, 'PUT', modelPayload(body.model), tenant, signal); break
        case 'delete': data = await backend(runtime, `/models/${modelID(body.id)}`, 'DELETE', undefined, tenant, signal); break
        case 'copy': {
          if (typeof body.displayName !== 'string' || !body.displayName.trim()) invalid()
          data = await backend(runtime, `/models/${modelID(body.id)}/copy`, 'POST', { display_name: body.displayName }, tenant, signal)
          break
        }
        case 'credentials': {
          if (!record(body.values) || !Object.keys(body.values).length || Object.entries(body.values).some(([key, value]) =>
            !['api_key', 'app_secret'].includes(key) || typeof value !== 'string' || !value || value.length > 32768)) invalid()
          data = await backend(runtime, `/models/${modelID(body.id)}/credentials`, 'PUT', body.values, tenant, signal)
          break
        }
        case 'clearCredential': {
          if (!['api_key', 'app_secret'].includes(body.field)) invalid()
          data = await backend(runtime, `/models/${modelID(body.id)}/credentials/${body.field}`, 'DELETE', undefined, tenant, signal)
          break
        }
        case 'test': {
          if (!MODEL_TYPES.has(body.type) || !record(body.draft) || typeof body.draft.modelName !== 'string') invalid()
          if (body.draft.source === 'local' && ['ASR', 'Rerank'].includes(body.type)) invalid()
          if (body.draft.modelId !== undefined) modelID(body.draft.modelId)
          const localChat = body.draft.source === 'local' && body.type !== 'Embedding'
          const result = await backend(runtime, localChat ? '/initialization/ollama/models/check' : TEST_PATHS[body.type],
            'POST', localChat ? { models: [body.draft.modelName] } : body.draft, tenant, signal)
          if (!record(result)) throw new KnowledgeAuthError('invalid_model_settings_response', 502)
          // Test details can contain provider bodies. Return only availability and discovered dimension.
          const available = localChat ? result.models?.[body.draft.modelName] : result.available
          if (typeof available !== 'boolean') throw new KnowledgeAuthError('invalid_model_settings_response', 502)
          return Response.json({ data: { available, ...(typeof result.dimension === 'number' ? { dimension: result.dimension } : {}) } }, { headers: HEADERS })
        }
        default: throw new KnowledgeAuthError('unsupported_model_settings_operation', 404)
      }
      changed()
      return Response.json({ data: ['create', 'update', 'copy'].includes(body.operation) ? publicModel(data) : null }, { headers: HEADERS })
    } catch (error) {
      const failure = error instanceof KnowledgeAuthError ? error : new KnowledgeAuthError('model_settings_unavailable', 502)
      return Response.json({ error: failure.code }, { status: failure.status, headers: HEADERS })
    }
  }
}

/**
 * Register the native model-settings API on the owner-authenticated Host.
 * @param ctx - Host connection and model-event owner.
 * @param runtime - per-user SSO transport, disposed after its consumers.
 */
export function installModelManagement(ctx, runtime) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/zhishu-models/manage', methods: ['GET', 'POST'], requestBody: 'buffered',
    fetch: createModelManagement(runtime, () => ctx.emit('llm/models-updated', 'zhishu-models')),
  }), 'unified-models: native settings operations')
}

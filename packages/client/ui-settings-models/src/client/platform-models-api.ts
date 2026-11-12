/** Native model-settings requests and validation of the shared model service's JSON. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import { isJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'

/** A model row in the shared registry. */
export type PlatformModelId = Branded<'PlatformModelId'>
/** An authorized shared-registry workspace. */
export type PlatformModelTenantId = Branded<'PlatformModelTenantId'>
/** Model kinds supported by the shared service. */
export const platformModelTypes = ['KnowledgeQA', 'Embedding', 'Rerank', 'VLLM', 'ASR'] as const
/** A shared model's inference task. */
export type PlatformModelType = typeof platformModelTypes[number]
/** JSON model parameters; saved credentials are excluded from reads. */
export type PlatformModelParameters = Record<string, JsonValue>
/** Expected failures rendered by the native settings owner. */
export type PlatformModelFailureCode = 'loginRequired' | 'accessDenied' | 'unavailable' | 'invalidResponse'
  | 'invalidDraft' | 'modelInUse' | 'modelMissing' | 'saveUnconfirmed' | 'credentialsIncomplete'

/** An actionable failure without provider bodies or credential values. */
export class PlatformModelFailure extends Error {
  constructor(readonly code: PlatformModelFailureCode, readonly status?: number, options?: ErrorOptions) {
    super(code, options)
    this.name = 'PlatformModelFailure'
  }
}

/** The shared registry's non-secret row used by settings and editors. */
export interface PlatformModel {
  id: PlatformModelId
  ownerTenantId: PlatformModelTenantId
  name: string
  displayName: string
  type: PlatformModelType
  source: string
  description: string
  parameters: PlatformModelParameters
  builtin: boolean
  status: string
  credentials: Readonly<Record<string, boolean>>
  capabilities: PlatformModelParameters
}

/** An editable workspace and its authoritative membership role. */
export interface PlatformModelSpace {
  id: PlatformModelTenantId
  name: string
  role: string
}
/** Current-user authorization for the model settings page. */
export interface PlatformModelsContext {
  spaces: PlatformModelSpace[]
  homeTenantId: PlatformModelTenantId
  systemAdmin: boolean
}

/** A provider-specific setting from backend metadata. */
export interface PlatformProviderField {
  key: string
  label: string
  labels: Record<string, string>
  type: string
  required: boolean
  secret: boolean
  defaultValue: string
  modelTypes: string[]
  options: Array<{ value: string; label: string }>
}
/** Provider presentation and supported capabilities from the shared service. */
export interface PlatformModelProvider {
  id: string
  label: string
  labels: Record<string, string>
  modelTypes: string[]
  defaultUrls: Record<string, string>
  api: string
  requiresAuth: boolean
  fields: PlatformProviderField[]
  models: Array<{ name: string; type: string }>
}

/** Model definition submitted separately from later credential updates. */
export interface PlatformModelDefinition {
  name: string
  display_name: string
  type: PlatformModelType
  source: 'local' | 'remote'
  description: string
  parameters: PlatformModelParameters
}

/** Test outcome; provider responses and saved secrets stay on the backend. */
export interface PlatformModelTestResult { available: boolean; dimension?: number }

/**
 * Narrow an untrusted JSON object from the shared service or platform bridge.
 * @param value - parsed JSON value.
 * @returns whether it is a non-null, non-array record.
 */
export function platformModelRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalidResponse(): never { throw new PlatformModelFailure('invalidResponse') }
function stringMap(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {}
  if (!platformModelRecord(value) || Object.values(value).some(item => typeof item !== 'string')) invalidResponse()
  return value as Record<string, string>
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) invalidResponse()
  return value
}
function jsonParameters(value: unknown): PlatformModelParameters {
  if (!platformModelRecord(value) || !isJsonValue(value)) invalidResponse()
  return value as PlatformModelParameters
}
function optionalString(value: unknown): string { return typeof value === 'string' ? value : '' }
function providerTask(value: string): string {
  const types: Record<string, PlatformModelType> = { chat: 'KnowledgeQA', embedding: 'Embedding', rerank: 'Rerank', vllm: 'VLLM', asr: 'ASR' }
  return types[value] || value
}

/**
 * Validate an internal configuration owner id from a wire response.
 * @param value - untrusted configuration owner identifier.
 * @returns the validated configuration owner id.
 */
export function platformModelTenantId(value: unknown): PlatformModelTenantId {
  if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value)) invalidResponse()
  return value as PlatformModelTenantId
}

/**
 * Validate a task kind read from the backend or a form selector.
 * @param value - untrusted task kind.
 * @returns the supported kind.
 */
export function platformModelType(value: unknown): PlatformModelType {
  for (const type of platformModelTypes) if (value === type) return type
  return invalidResponse()
}

/**
 * Validate a redacted model response before it enters the settings store.
 * @param value - model DTO from the shared service.
 * @returns a non-secret native model row.
 */
export function parsePlatformModel(value: unknown): PlatformModel {
  if (!platformModelRecord(value) || typeof value.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value.id)
    || typeof value.name !== 'string' || typeof value.source !== 'string' || typeof value.status !== 'string') invalidResponse()
  const configured: Record<string, boolean> = {}
  if (value.credentials !== undefined) {
    if (!platformModelRecord(value.credentials)) invalidResponse()
    for (const [key, info] of Object.entries(value.credentials)) {
      if (!platformModelRecord(info) || typeof info.configured !== 'boolean') invalidResponse()
      configured[key] = info.configured
    }
  }
  const parameters = jsonParameters(value.parameters)
  if ('api_key' in parameters || 'app_secret' in parameters) invalidResponse()
  return {
    id: value.id as PlatformModelId, ownerTenantId: platformModelTenantId(typeof value.tenant_id === 'number' && Number.isSafeInteger(value.tenant_id) ? String(value.tenant_id) : value.tenant_id), name: value.name, displayName: optionalString(value.display_name),
    type: platformModelType(value.type), source: value.source, description: optionalString(value.description), parameters,
    builtin: value.is_builtin === true, status: value.status, credentials: configured,
    capabilities: value.capabilities === undefined || value.capabilities === null ? {} : jsonParameters(value.capabilities),
  }
}

function parseContext(value: unknown): PlatformModelsContext {
  if (!platformModelRecord(value) || !Array.isArray(value.spaces) || typeof value.systemAdmin !== 'boolean') invalidResponse()
  const spaces = value.spaces.map((item): PlatformModelSpace => {
    if (!platformModelRecord(item) || typeof item.name !== 'string' || typeof item.role !== 'string') invalidResponse()
    return { id: platformModelTenantId(item.id), name: item.name, role: item.role }
  })
  return { spaces, systemAdmin: value.systemAdmin,
    homeTenantId: platformModelTenantId(value.homeTenantId) }
}

function parseProvider(value: unknown): PlatformModelProvider {
  if (!platformModelRecord(value) || typeof value.value !== 'string' || typeof value.label !== 'string') invalidResponse()
  const fields = value.extraFields === undefined || value.extraFields === null ? [] : value.extraFields
  if (!Array.isArray(fields)) invalidResponse()
  const catalog = value.models === undefined || value.models === null ? [] : value.models
  if (!Array.isArray(catalog)) invalidResponse()
  return {
    id: value.value, label: value.label, labels: stringMap(value.labels),
    defaultUrls: Object.fromEntries(Object.entries(stringMap(value.defaultUrls)).map(([type, url]) => [providerTask(type), url])),
    api: optionalString(value.api), requiresAuth: value.requiresAuth === true, modelTypes: strings(value.modelTypes).map(providerTask),
    fields: fields.map((field): PlatformProviderField => {
      if (!platformModelRecord(field) || typeof field.key !== 'string' || typeof field.label !== 'string' || typeof field.type !== 'string') invalidResponse()
      const options = field.options === undefined || field.options === null ? [] : field.options
      if (!Array.isArray(options)) invalidResponse()
      return { key: field.key, label: field.label, labels: stringMap(field.labels), type: field.type,
        required: field.required === true, secret: field.secret === true || field.type === 'password',
        defaultValue: optionalString(field.default),
        modelTypes: field.model_types === undefined || field.model_types === null ? [] : strings(field.model_types).map(providerTask),
        options: options.map((option) => {
          if (!platformModelRecord(option) || typeof option.value !== 'string' || typeof option.label !== 'string') invalidResponse()
          return { value: option.value, label: option.label }
        }) }
    }),
    models: catalog.map((item) => {
      if (!platformModelRecord(item) || typeof item.id !== 'string' || typeof item.type !== 'string') invalidResponse()
      return { name: item.id, type: providerTask(item.type) }
    }),
  }
}

function savedModel(value: unknown): PlatformModel {
  try { return parsePlatformModel(value) } catch (error) {
    throw new PlatformModelFailure('saveUnconfirmed', undefined, { cause: error })
  }
}

/** Owner-authenticated native settings client; it never accepts a backend token. */
export class PlatformModelsApi {
  constructor(private readonly request: typeof fetch = (input, init) => fetch(input, init)) {}

  private async call(
    query: string, body: { operation: string; [key: string]: unknown } | undefined, signal: AbortSignal,
  ): Promise<unknown> {
    const mutation = body !== undefined && body.operation !== 'test'
    let response: Response
    try { response = await this.request(`/api/zhishu-models/manage${query}`, {
      credentials: 'same-origin', cache: 'no-store', signal,
      ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    }) } catch (error) {
      if (signal.aborted) throw error
      throw new PlatformModelFailure(mutation ? 'saveUnconfirmed' : 'unavailable', undefined, { cause: error })
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new PlatformModelFailure(response.status === 401 ? 'loginRequired' : response.status === 403 ? 'accessDenied'
        : response.status === 404 ? 'modelMissing' : response.status === 409 ? 'modelInUse'
          : response.status === 400 || response.status === 422 ? 'invalidDraft' : mutation ? 'saveUnconfirmed' : 'unavailable', response.status)
    }
    let value: unknown
    try { value = await response.json() } catch (error) {
      throw new PlatformModelFailure(mutation ? 'saveUnconfirmed' : 'invalidResponse', undefined, { cause: error })
    }
    if (!platformModelRecord(value) || !Object.hasOwn(value, 'data')) throw new PlatformModelFailure(mutation ? 'saveUnconfirmed' : 'invalidResponse')
    return value.data
  }

  /**
   * Read the current user's model configuration permissions.
   * @param signal - consumer cancellation.
   * @returns authoritative ownership permissions and personal configuration destination.
   */
  async context(signal: AbortSignal): Promise<PlatformModelsContext> { return parseContext(await this.call('', undefined, signal)) }
  /**
   * Read every model available to the current user.
   * @param signal - consumer cancellation.
   * @returns models without saved credential values.
   */
  async models(signal: AbortSignal): Promise<PlatformModel[]> {
    const result = await this.call('?operation=models', undefined, signal)
    if (!Array.isArray(result)) invalidResponse()
    return result.map(parsePlatformModel)
  }
  /**
   * Read backend-owned provider metadata using the personal configuration scope.
   * @param tenantId - authorized workspace to query.
   * @param signal - consumer cancellation.
   * @returns providers with normalized task names and editor metadata.
   */
  async providers(tenantId: PlatformModelTenantId, signal: AbortSignal): Promise<PlatformModelProvider[]> {
    const result = await this.call(`?operation=providers&tenantId=${tenantId}`, undefined, signal)
    if (!Array.isArray(result)) invalidResponse()
    return result.map(parseProvider)
  }
  /**
   * Save a definition separately from its write-only credentials.
   * @param tenantId - authorized workspace receiving the write.
   * @param model - validated definition.
   * @param id - saved model id, or undefined when creating.
   * @param signal - consumer cancellation.
   * @returns the redacted saved definition.
   */
  async save(
    tenantId: PlatformModelTenantId, model: PlatformModelDefinition, id: PlatformModelId | undefined, signal: AbortSignal,
  ): Promise<PlatformModel> {
    return savedModel(await this.call('', { operation: id === undefined ? 'create' : 'update', tenantId, id, model }, signal))
  }
  /**
   * Copy a definition without reading its stored credentials.
   * @param tenantId - authorized destination workspace.
   * @param id - original model id.
   * @param displayName - name of the new copy.
   * @param signal - consumer cancellation.
   * @returns the redacted copied definition.
   */
  async copy(tenantId: PlatformModelTenantId, id: PlatformModelId, displayName: string, signal: AbortSignal): Promise<PlatformModel> {
    return savedModel(await this.call('', { operation: 'copy', tenantId, id, displayName }, signal))
  }
  /**
   * Delete a model subject to the backend's reference guards.
   * @param tenantId - authorized workspace owning the model.
   * @param id - model to delete.
   * @param signal - consumer cancellation.
   */
  async remove(tenantId: PlatformModelTenantId, id: PlatformModelId, signal: AbortSignal): Promise<void> {
    await this.call('', { operation: 'delete', tenantId, id }, signal)
  }
  /**
   * Replace only explicitly entered credentials without reading saved values.
   * @param tenantId - authorized workspace owning the model.
   * @param id - model receiving the credentials.
   * @param values - nonempty newly entered secrets; omitted fields retain saved values.
   * @param signal - consumer cancellation.
   */
  async credentials(
    tenantId: PlatformModelTenantId, id: PlatformModelId, values: Partial<Record<'api_key' | 'app_secret', string>>, signal: AbortSignal,
  ): Promise<void> {
    await this.call('', { operation: 'credentials', tenantId, id, values }, signal)
  }
  /**
   * Remove one explicitly selected saved credential.
   * @param tenantId - authorized workspace owning the model.
   * @param id - model receiving the change.
   * @param field - saved credential to clear.
   * @param signal - consumer cancellation.
   */
  async clearCredential(tenantId: PlatformModelTenantId, id: PlatformModelId, field: 'api_key' | 'app_secret', signal: AbortSignal): Promise<void> {
    await this.call('', { operation: 'clearCredential', tenantId, id, field }, signal)
  }
  /**
   * Test the exact editor values without returning provider bodies.
   * @param tenantId - authorized workspace for saved credential lookup.
   * @param type - inference task being tested.
   * @param draft - validated connection settings and newly entered credentials.
   * @param signal - consumer cancellation.
   * @returns availability and discovered embedding dimension.
   */
  async test(
    tenantId: PlatformModelTenantId, type: PlatformModelType, draft: PlatformModelParameters, signal: AbortSignal,
  ): Promise<PlatformModelTestResult> {
    const result = await this.call('', { operation: 'test', tenantId, type, draft }, signal)
    if (!platformModelRecord(result) || typeof result.available !== 'boolean'
      || result.dimension !== undefined && (typeof result.dimension !== 'number' || !Number.isSafeInteger(result.dimension) || result.dimension < 1)) invalidResponse()
    return { available: result.available, ...(typeof result.dimension === 'number' ? { dimension: result.dimension } : {}) }
  }
}

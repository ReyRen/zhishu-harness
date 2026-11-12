/** Native editor values and the matching shared-service definition and connection test. */
import { isJsonValue } from '@deepseek-ai/dsh-util-values'
import {
  PlatformModelFailure, platformModelRecord, type PlatformModel, type PlatformModelDefinition,
  type PlatformModelParameters, type PlatformModelProvider, type PlatformModelType,
} from './platform-models-api.ts'

/** An in-memory draft; secret inputs are never initialized from saved credentials. */
export interface PlatformModelDraft {
  id?: PlatformModel['id']
  type: PlatformModelType
  name: string
  displayName: string
  source: 'local' | 'remote'
  description: string
  provider: string
  baseUrl: string
  interfaceType: string
  contextWindow: string
  maxOutputTokens: string
  maxConcurrency: string
  dimension: string
  supportsVision: boolean
  dimensionOverride: boolean
  headers: string
  extra: string
  spec: string
  apiKey: string
  appSecret: string
  clearApiKey: boolean
  clearAppSecret: boolean
  savedApiKey: boolean
  savedAppSecret: boolean
  original: PlatformModelParameters
}

const text = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const json = (value: unknown): string => JSON.stringify(value || {}, null, 2)

/**
 * Open a new or existing model without copying any saved secret into the client.
 * @param type - requested task for a new model.
 * @param model - existing redacted model, when editing.
 * @returns the editable values and preserved parameters.
 */
export function createPlatformModelDraft(type: PlatformModelType, model?: PlatformModel): PlatformModelDraft {
  const p = model?.parameters || {}
  const embedding = platformModelRecord(p.embedding_parameters) ? p.embedding_parameters : {}
  return {
    ...(model ? { id: model.id } : {}), type: model?.type || type, name: model?.name || '',
    displayName: model?.displayName || '', source: model?.source === 'local' ? 'local' : 'remote',
    description: model?.description || '', provider: text(p.provider), baseUrl: text(p.base_url),
    interfaceType: text(p.interface_type), contextWindow: text(p.context_window), maxOutputTokens: text(p.max_output_tokens),
    maxConcurrency: text(p.max_concurrency), dimension: text(embedding.dimension),
    supportsVision: p.supports_vision === true, dimensionOverride: embedding.supports_dimension_override === true,
    headers: json(p.custom_headers), extra: json(p.extra_config), spec: json(p.spec),
    apiKey: '', appSecret: '', clearApiKey: false, clearAppSecret: false,
    savedApiKey: model?.credentials.api_key === true, savedAppSecret: model?.credentials.app_secret === true, original: p,
  }
}

function objectJson(value: string, stringsOnly = false): PlatformModelParameters {
  let parsed: unknown
  try { parsed = JSON.parse(value || '{}') } catch (error) { throw new PlatformModelFailure('invalidDraft', undefined, { cause: error }) }
  if (!platformModelRecord(parsed) || !isJsonValue(parsed)
    || stringsOnly && Object.values(parsed).some(item => typeof item !== 'string')) throw new PlatformModelFailure('invalidDraft')
  return parsed as PlatformModelParameters
}

function integer(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  if (!/^\d+$/u.test(value.trim()) || !Number.isSafeInteger(parsed) || parsed < 1) throw new PlatformModelFailure('invalidDraft')
  return parsed
}

/**
 * Construct the same non-secret parameters used by save and connection tests.
 * @param draft - current in-memory editor.
 * @param provider - metadata for required provider-specific fields.
 * @param purpose - tests may discover an unspecified embedding dimension; saves require it.
 * @returns a shared-service model definition; credentials use a separate API.
 */
export function platformModelDefinition(draft: PlatformModelDraft, provider?: PlatformModelProvider, purpose: 'save' | 'test' = 'save'): PlatformModelDefinition {
  if (!draft.name.trim() || draft.name.length > 512) throw new PlatformModelFailure('invalidDraft')
  if (draft.source === 'local' && (draft.type === 'Rerank' || draft.type === 'ASR')) throw new PlatformModelFailure('invalidDraft')
  const baseUrl = draft.baseUrl.trim()
  if (draft.source === 'remote' && baseUrl) {
    let url: URL
    try { url = new URL(baseUrl) } catch (error) { throw new PlatformModelFailure('invalidDraft', undefined, { cause: error }) }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new PlatformModelFailure('invalidDraft')
  }
  if (draft.source === 'remote' && !baseUrl && draft.provider !== 'weknoracloud') throw new PlatformModelFailure('invalidDraft')
  const extra = objectJson(draft.extra, true)
  for (const field of provider?.fields || []) {
    if (field.modelTypes.length && !field.modelTypes.includes(draft.type)) continue
    if (field.secret) { Reflect.deleteProperty(extra, field.key); continue }
    if (field.required && !text(extra[field.key]).trim()) throw new PlatformModelFailure('invalidDraft')
  }
  const parameters: PlatformModelParameters = {
    ...draft.original, base_url: baseUrl, provider: draft.provider, interface_type: draft.interfaceType,
    custom_headers: objectJson(draft.headers, true), extra_config: extra,
    spec: objectJson(draft.spec), supports_vision: draft.supportsVision,
  }
  const limits: Array<[string, string]> = [
    ['context_window', draft.contextWindow], ['max_output_tokens', draft.maxOutputTokens], ['max_concurrency', draft.maxConcurrency],
  ]
  for (const [key, value] of limits) {
    const parsed = integer(value)
    if (parsed === undefined) Reflect.deleteProperty(parameters, key)
    else parameters[key] = parsed
  }
  if (draft.type === 'Embedding') {
    const dimension = integer(draft.dimension)
    if (dimension === undefined && purpose === 'save') throw new PlatformModelFailure('invalidDraft')
    parameters.embedding_parameters = {
      ...(platformModelRecord(draft.original.embedding_parameters) ? draft.original.embedding_parameters : {}),
      ...(dimension === undefined ? {} : { dimension }), supports_dimension_override: draft.dimensionOverride,
    }
  }
  delete parameters.api_key
  delete parameters.app_secret
  return { name: draft.name.trim(), display_name: draft.displayName.trim(), description: draft.description.trim(),
    type: draft.type, source: draft.source, parameters }
}

/**
 * Map a validated definition to the backend's connection-test DTO.
 * @param draft - current editor, including only newly entered secrets.
 * @param definition - the exact values that save would submit.
 * @returns a write-only test request; saved keys are resolved by model id on the backend.
 */
export function platformModelTestDraft(draft: PlatformModelDraft, definition: PlatformModelDefinition): PlatformModelParameters {
  if (draft.clearApiKey || draft.clearAppSecret) throw new PlatformModelFailure('credentialsIncomplete')
  const p = definition.parameters
  return {
    modelName: definition.name, source: definition.source, baseUrl: p.base_url || '', provider: p.provider || '',
    interfaceType: p.interface_type || '', customHeaders: p.custom_headers || {}, extraConfig: p.extra_config || {}, spec: p.spec || {},
    ...(draft.id ? { modelId: draft.id } : {}), ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
    ...(draft.appSecret ? { appSecret: draft.appSecret } : {}),
    ...(draft.type === 'Embedding' ? { ...(draft.dimension ? { dimension: Number(draft.dimension) } : {}), supportsDimensionOverride: draft.dimensionOverride } : {}),
  }
}

/**
 * Update a non-secret vendor field while retaining other advanced entries.
 * @param draft - current editor.
 * @param key - backend-declared field name.
 * @param value - selected or typed value.
 * @returns the updated advanced JSON.
 */
export function platformModelExtra(draft: PlatformModelDraft, key: string, value: string): string {
  const extra = objectJson(draft.extra, true)
  if (value) extra[key] = value
  else Reflect.deleteProperty(extra, key)
  return json(extra)
}

/**
 * Read vendor fields without replacing malformed advanced input with defaults.
 * @param value - current advanced vendor JSON.
 * @returns parsed string fields, or null while the user must repair that JSON.
 */
export function platformModelExtraValues(value: string): Record<string, string> | null {
  try { return objectJson(value, true) as Record<string, string> } catch (error) {
    if (error instanceof PlatformModelFailure) return null
    throw error
  }
}

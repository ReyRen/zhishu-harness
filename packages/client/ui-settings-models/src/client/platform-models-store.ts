/** Plugin-owned native settings state; section switches do not reload data or discard drafts. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  PlatformModelFailure, type PlatformModelFailureCode, type PlatformModel, type PlatformModelsApi,
  type PlatformModelProvider, type PlatformModelsContext, type PlatformModelTenantId, type PlatformModelType,
} from './platform-models-api.ts'
import type { PlatformModelsAuthentication } from './platform-models-auth.ts'
import { createPlatformModelDraft, platformModelDefinition, platformModelTestDraft, type PlatformModelDraft } from './platform-models-draft.ts'

/** Serializable page values; credential drafts live only in this plugin instance's memory. */
export interface PlatformModelsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  refreshing: boolean
  context: PlatformModelsContext | null
  homeTenantId: PlatformModelTenantId | null
  rows: PlatformModel[]
  providers: PlatformModelProvider[]
  filter: PlatformModelType | 'all'
  query: string
  error: PlatformModelFailureCode | null
  draft: PlatformModelDraft | null
  editorError: PlatformModelFailureCode | null
  uncertain: boolean
  busy: 'save' | 'test' | 'delete' | 'copy' | null
  tested: 'available' | 'unavailable' | null
  deleting: PlatformModel | null
}

const initial = (): PlatformModelsState => ({ status: 'idle', refreshing: false, context: null, homeTenantId: null,
  rows: [], providers: [], filter: 'all', query: '', error: null, draft: null, editorError: null,
  uncertain: false, busy: null, tested: null, deleting: null })
const failureCode = (error: unknown): PlatformModelFailureCode => error instanceof PlatformModelFailure ? error.code : 'unavailable'

/**
 * Whether membership and builtin policy permit changing a row.
 * @param state - current authoritative model permissions.
 * @param model - optional row whose builtin policy must also be checked.
 * @returns whether the native editor may offer mutation actions; the backend enforces authorization again.
 */
export function canManagePlatformModels(state: PlatformModelsState, model?: PlatformModel): boolean {
  if (model?.builtin) return state.context?.systemAdmin === true
  const owner = model?.ownerTenantId || state.homeTenantId
  const role = state.context?.spaces.find(space => space.id === owner)?.role
  return role === 'admin' || role === 'owner'
}

/** Owns authenticated requests, cached rows and drafts until plugin disposal. */
export class PlatformModelsStore {
  /** Native settings snapshot retained across section mounts and cleared on signout. */
  readonly store = createSnapshotStore<PlatformModelsState>(initial())
  private readonly lifetime = new AbortController()
  private reads: AbortController | undefined
  private operation: AbortController | undefined
  private generation = 0
  private readonly tasks = new Set<Promise<void>>()
  private readonly stopAccount: () => void

  constructor(private readonly api: PlatformModelsApi, private readonly auth: Pick<PlatformModelsAuthentication, 'ready' | 'subscribe'>) {
    this.stopAccount = auth.subscribe((signedIn) => {
      if (!signedIn) {
        this.generation++
        this.reads?.abort()
        this.operation?.abort()
        this.store.set({ ...initial(), status: 'error', error: 'loginRequired' })
      } else if (this.store.getSnapshot().status !== 'idle') this.refresh()
    })
  }

  private own(task: Promise<void>): void {
    this.tasks.add(task)
    void task.finally(() => { this.tasks.delete(task) }).catch((error: unknown) => {
      if (!this.lifetime.signal.aborted) this.store.update((state) => { state.error = failureCode(error) })
    })
  }

  /** Load once on first opening; revisiting another settings tab retains the snapshot and draft. */
  open(): void { if (this.store.getSnapshot().status === 'idle') this.refresh() }

  /** Refetch an opened page after an explicit retry or pushed catalog invalidation. */
  refresh(): void {
    if (this.lifetime.signal.aborted || this.store.getSnapshot().busy) return
    this.own(this.load())
  }

  private async load(): Promise<void> {
    this.reads?.abort()
    const reads = new AbortController()
    this.reads = reads
    const signal = AbortSignal.any([reads.signal, this.lifetime.signal])
    const generation = ++this.generation
    this.store.update((state) => { state.refreshing = true; state.error = null; if (!state.rows.length) state.status = 'loading' })
    try {
      await this.auth.ready(signal)
      const context = await this.api.context(signal)
      const tenant = context.homeTenantId
      if (!tenant) throw new PlatformModelFailure('accessDenied')
      const [rows, providers] = await Promise.all([this.api.models(signal), this.api.providers(tenant, signal)])
      if (signal.aborted || generation !== this.generation) return
      this.store.update((state) => { state.context = context; state.homeTenantId = tenant; state.rows = rows
        state.providers = providers; state.status = 'ready'; state.refreshing = false })
      this.store.update((state) => {
        const edited = state.draft?.id ? state.rows.find(model => model.id === state.draft?.id) : undefined
        if (state.draft && (state.draft.id && !edited || !canManagePlatformModels(state, edited))) {
          state.draft = null; state.editorError = null; state.error = 'accessDenied'
        }
        const deleting = state.deleting
        if (deleting && (!state.rows.some(model => model.id === deleting.id) || !canManagePlatformModels(state, deleting))) {
          state.deleting = null
        }
      })
    } catch (error) {
      if (!signal.aborted && generation === this.generation) this.store.update((state) => {
        state.status = state.rows.length ? 'ready' : 'error'; state.refreshing = false; state.error = failureCode(error)
        if (state.error === 'accessDenied' || state.error === 'loginRequired') {
          state.rows = []; state.draft = null; state.deleting = null; state.context = null; state.providers = []; state.status = 'error'
        }
      })
    }
  }

  /**
   * Apply a local category or search query without fetching again.
   * @param values - changed filter or search value.
   */
  filter(values: Partial<Pick<PlatformModelsState, 'filter' | 'query'>>): void { this.store.update((state) => { Object.assign(state, values) }) }

  /**
   * Open an authorized new model or saved model editor.
   * @param type - task for a new model.
   * @param model - existing row, when editing.
   */
  edit(type: PlatformModelType, model?: PlatformModel): void {
    const state = this.store.getSnapshot()
    if (state.busy || !canManagePlatformModels(state, model)) return
    this.store.update((value) => {
      value.draft = createPlatformModelDraft(type, model); value.editorError = null; value.tested = null; value.uncertain = false
    })
  }

  /** Close an idle editor, erasing newly entered credentials. */
  closeEditor(): void {
    if (this.store.getSnapshot().busy) return
    this.store.update((state) => { state.draft = null; state.editorError = null; state.tested = null; state.uncertain = false })
  }

  /**
   * Replace draft values and invalidate results belonging to older values.
   * @param patch - explicit field edits; identity and preserved parameters are not editable.
   */
  patchDraft(patch: Partial<Omit<PlatformModelDraft, 'id' | 'ownerTenantId' | 'original' | 'savedApiKey' | 'savedAppSecret'>>): void {
    if (this.store.getSnapshot().busy || this.store.getSnapshot().uncertain) return
    this.store.update((state) => { if (state.draft) { Object.assign(state.draft, patch); state.tested = null; state.editorError = null } })
  }

  /** Validate and save a definition, then update only explicitly changed credentials. */
  save(): void { this.own(this.withDraft('save')) }

  /** Test the exact current draft using saved backend credentials only by id. */
  test(): void { this.own(this.withDraft('test')) }

  private async withDraft(kind: 'save' | 'test'): Promise<void> {
    const state = this.store.getSnapshot()
    const draft = state.draft
    const model = draft?.id ? state.rows.find(row => row.id === draft.id) : undefined
    const tenant = model?.builtin ? state.homeTenantId : draft?.ownerTenantId || state.homeTenantId
    const role = state.context?.spaces.find(space => space.id === tenant)?.role
    if (!draft || !tenant || state.busy || state.uncertain
      || !(model?.builtin ? state.context?.systemAdmin : role === 'owner' || role === 'admin')) return
    const operation = new AbortController()
    this.operation = operation
    const signal = AbortSignal.any([this.lifetime.signal, operation.signal])
    this.store.update((value) => { value.busy = kind; value.editorError = null; value.tested = null })
    let definitionSaved = false
    try {
      const definition = platformModelDefinition(draft, state.providers.find(provider => provider.id === draft.provider), kind)
      await this.auth.ready(signal)
      if (kind === 'test') {
        const result = await this.api.test(tenant, draft.type, platformModelTestDraft(draft, definition), signal)
        if (!signal.aborted) this.store.update((value) => {
          value.tested = result.available ? 'available' : 'unavailable'
          if (result.available && result.dimension && value.draft?.type === 'Embedding' && !value.draft.dimension) value.draft.dimension = String(result.dimension)
        })
        return
      }
      const model = await this.api.save(tenant, definition, draft.id, signal)
      definitionSaved = true
      if (signal.aborted) return
      this.store.update((value) => { if (value.draft) { value.draft.id = model.id; value.draft.ownerTenantId = tenant } })
      const values = { ...(draft.apiKey ? { api_key: draft.apiKey } : {}), ...(draft.appSecret ? { app_secret: draft.appSecret } : {}) }
      if (Object.keys(values).length) await this.api.credentials(tenant, model.id, values, signal)
      if (draft.clearApiKey) await this.api.clearCredential(tenant, model.id, 'api_key', signal)
      if (draft.clearAppSecret) await this.api.clearCredential(tenant, model.id, 'app_secret', signal)
      signal.throwIfAborted()
      this.store.update((value) => { value.draft = null })
    } catch (error) {
      if (!signal.aborted) this.store.update((value) => {
        value.editorError = definitionSaved ? 'credentialsIncomplete' : failureCode(error)
        value.uncertain = !definitionSaved && value.editorError === 'saveUnconfirmed'
      })
    } finally {
      if (!signal.aborted) {
        this.store.update((value) => { value.busy = null })
        if (kind === 'save' && definitionSaved) this.refresh()
      }
    }
  }

  /**
   * Copy a model using backend-owned credentials without exposing their values.
   * @param model - authorized source row; stored credentials stay on the backend.
   * @param displayName - localized initial name for the copy.
   */
  copy(model: PlatformModel, displayName: string): void { this.own(this.mutateRow('copy', model, displayName)) }

  /**
   * Request or cancel deletion confirmation without mutating the model.
   * @param model - row to confirm, or null to cancel.
   */
  confirmDelete(model: PlatformModel | null): void {
    if (!this.store.getSnapshot().busy) this.store.update((state) => { state.deleting = model; state.error = null })
  }

  /** Delete the confirmed row; the backend rejects references from knowledge bases or agents. */
  remove(): void { const model = this.store.getSnapshot().deleting; if (model) this.own(this.mutateRow('delete', model)) }

  private async mutateRow(kind: 'copy' | 'delete', model: PlatformModel, displayName = ''): Promise<void> {
    const state = this.store.getSnapshot()
    const tenant = model.builtin ? state.homeTenantId : model.ownerTenantId
    if (!tenant || state.busy || state.error === 'saveUnconfirmed'
      || !canManagePlatformModels(state, model)) return
    const operation = new AbortController()
    this.operation = operation
    const signal = AbortSignal.any([operation.signal, this.lifetime.signal])
    this.store.update((value) => { value.busy = kind; value.error = null })
    let committed = false
    try {
      await this.auth.ready(signal)
      if (kind === 'copy') await this.api.copy(tenant, model.id, displayName, signal)
      else await this.api.remove(tenant, model.id, signal)
      committed = true
      if (!signal.aborted) this.store.update((value) => { value.deleting = null })
    } catch (error) {
      if (!signal.aborted) this.store.update((value) => { value.error = failureCode(error) })
    } finally {
      if (!signal.aborted) { this.store.update((value) => { value.busy = null }); if (committed) this.refresh() }
    }
  }

  /** Stop consumers and await their settlement before the authentication owner is disposed. */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    this.reads?.abort()
    this.operation?.abort()
    this.stopAccount()
    await Promise.allSettled(this.tasks)
    this.store.set(initial())
  }
}

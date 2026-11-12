// @vitest-environment jsdom
/** Native model settings: cached navigation, shared writes, credentials and permission failures. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { PlatformModelsSection } from '../src/client/PlatformModelsSection.tsx'
import { PlatformModelsApi, parsePlatformModel, platformModelRecord, platformModelTenantId } from '../src/client/platform-models-api.ts'
import { PlatformModelsStore } from '../src/client/platform-models-store.ts'
import { platformModelsZh } from '../src/client/platform-models-locales.ts'
import { createPlatformModelDraft, platformModelDefinition, platformModelTestDraft } from '../src/client/platform-models-draft.ts'

afterEach(cleanup)
const saved = { id: 'model-one', tenant_id: 10002, name: 'Qwen-test', display_name: '对话测试', type: 'KnowledgeQA', source: 'remote',
  status: 'active', parameters: { base_url: 'http://model.test/v1', provider: 'openai', context_window: 10000,
    extra_config: { api: 'openai-completions' }, spec: { reasoning: true } }, credentials: { api_key: { configured: true } } }

async function bench(options: {
  role?: string
  rejectCredential?: boolean
  rejectDelete?: boolean
  loseSave?: boolean
  multiSpace?: boolean
} = {}) {
  const rows = [{ ...saved }, ...(options.multiSpace ? [{ ...saved, id: 'shared-model', tenant_id: 10003, display_name: '协作模型' }] : [])]
  const writes: Array<Record<string, unknown>> = []
  let reads = 0
  let signout: ((value: boolean) => void) | undefined
  const request: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input, 'http://harness.test')
    if (init?.method === 'POST') {
      if (typeof init.body !== 'string') throw new Error('Expected a JSON request body')
      const body: unknown = JSON.parse(init.body)
      if (!platformModelRecord(body)) throw new Error('Expected a JSON object')
      writes.push(body)
      if (body.operation === 'credentials' && options.rejectCredential) return new Response(null, { status: 503 })
      if (body.operation === 'delete' && options.rejectDelete) return new Response(null, { status: 409 })
      if (body.operation === 'test') return Response.json({ data: { available: true } })
      if (body.operation === 'create' || body.operation === 'update') {
        if (options.loseSave) throw new TypeError('Network disconnected')
        const model = { ...saved, ...(body.model as object), id: typeof body.id === 'string' ? body.id : 'new-model' }
        const index = rows.findIndex(row => row.id === model.id)
        if (index < 0) rows.push(model)
        else rows[index] = model
        return Response.json({ data: model })
      }
      return Response.json({ data: null })
    }
    if (url.searchParams.get('operation') === 'models') { reads++; return Response.json({ data: rows }) }
    if (url.searchParams.get('operation') === 'providers') return Response.json({ data: [] })
    return Response.json({ data: { spaces: [{ id: '10002', name: '私有空间', role: options.role || 'owner' },
      ...(options.multiSpace ? [{ id: '10003', name: '业务空间', role: 'viewer' }] : [])],
    homeTenantId: '10002', currentTenantId: options.multiSpace ? '10003' : '10002', systemAdmin: false } })
  }
  const controller = new PlatformModelsStore(new PlatformModelsApi(request), {
    ready: async (signal) => { signal.throwIfAborted() },
    subscribe: (listener) => { signout = listener; return () => { signout = undefined } },
  })
  onTestFinished(async () => { await controller.dispose() })
  controller.open()
  await vi.waitFor(() => { expect(controller.store.getSnapshot().status).toBe('ready') })
  return { controller, rows, writes, reads: () => reads, signout: () => { signout?.(false) } }
}

function page(controller: PlatformModelsStore) {
  return render(<PlatformModelsSection controller={controller}
    useSnapshot={bindSnapshotSelector(controller.store)} t={key => platformModelsZh[key]} />)
}

describe('native shared-model settings', () => {
  it('shows all user-available models without space navigation and creates personal models independently of the active business space', async () => {
    const { controller, rows, writes } = await bench({ multiSpace: true })
    page(controller)
    expect(screen.queryByRole('combobox', { name: '空间' })).toBeNull()
    expect(screen.getByRole('heading', { name: '对话测试' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '协作模型' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '编辑' })).toHaveLength(1)
    act(() => { controller.edit('KnowledgeQA', parsePlatformModel(rows[1]!)) })
    expect(controller.store.getSnapshot().draft).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '添加模型' }))
    fireEvent.change(screen.getByLabelText('模型 ID'), { target: { value: 'new-personal-model' } })
    fireEvent.change(screen.getByLabelText('API 地址'), { target: { value: 'http://model.test/v1' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await vi.waitFor(() => { expect(writes).toHaveLength(1) })
    expect(writes[0]).toMatchObject({ operation: 'create', tenantId: '10002' })
  })

  it('clears an unfinished credential draft when model configuration permissions are revoked', async () => {
    const permissions = { role: 'owner' }
    const { controller, writes } = await bench(permissions)
    controller.edit('KnowledgeQA', parsePlatformModel(saved))
    controller.patchDraft({ apiKey: 'unsaved-secret' })
    permissions.role = 'viewer'
    controller.refresh()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().draft).toBeNull() })
    expect(controller.store.getSnapshot().error).toBe('accessDenied')
    expect(writes).toEqual([])
  })

  it('renders native categories and cards without an iframe, retaining drafts and cached rows across settings switches', async () => {
    const { controller, reads } = await bench()
    const first = page(controller)
    expect(first.container.querySelector('iframe')).toBeNull()
    expect(screen.getByRole('heading', { name: '模型设置' })).toBeTruthy()
    expect(screen.getByText('openai')).toBeTruthy()
    expect(screen.getByText((10000).toLocaleString())).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: '保留我的草稿' } })
    first.unmount()
    page(controller)
    expect(screen.getByLabelText<HTMLInputElement>('显示名称').value).toBe('保留我的草稿')
    expect(reads()).toBe(1)
    fireEvent.click(screen.getAllByRole('button', { name: '取消' }).at(-1)!)
    fireEvent.change(screen.getByRole('textbox', { name: '搜索模型' }), { target: { value: '不存在' } })
    expect(screen.getByText('没有匹配的模型')).toBeTruthy()
    expect(reads()).toBe(1)
  })

  it('keeps saved credentials on blank edits and tests the exact draft using only its saved model id', async () => {
    const { controller, writes } = await bench()
    controller.edit('KnowledgeQA', parsePlatformModel(saved))
    controller.patchDraft({ name: 'Qwen-renamed', contextWindow: '20000' })
    controller.test()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().tested).toBe('available') })
    expect(writes[0]).toMatchObject({ operation: 'test', draft: { modelId: 'model-one', modelName: 'Qwen-renamed', extraConfig: { api: 'openai-completions' } } })
    expect(writes[0]?.draft).not.toHaveProperty('apiKey')
    controller.save()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().draft).toBeNull() })
    expect(writes.filter(body => body.operation === 'credentials')).toEqual([])
    expect(writes[1]).toMatchObject({ operation: 'update', model: { parameters: { context_window: 20000, spec: { reasoning: true } } } })
    expect(JSON.stringify(writes)).not.toContain('configured')
  })

  it('retains the committed id when a later credential write fails, so retry updates instead of creating a duplicate', async () => {
    const { controller, writes } = await bench({ rejectCredential: true })
    controller.edit('KnowledgeQA')
    controller.patchDraft({ name: 'new-qwen', baseUrl: 'http://model.test/v1', apiKey: 'new-secret' })
    controller.save()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().editorError).toBe('credentialsIncomplete') })
    expect(controller.store.getSnapshot().draft?.id).toBe('new-model')
    controller.save()
    await vi.waitFor(() => { expect(writes.filter(body => body.operation === 'update')).toHaveLength(1) })
    expect(writes.filter(body => body.operation === 'create')).toHaveLength(1)
  })

  it('does not retry a create whose network result is unknown', async () => {
    const { controller, writes } = await bench({ loseSave: true })
    controller.edit('KnowledgeQA')
    controller.patchDraft({ name: 'unknown', baseUrl: 'http://model.test/v1' })
    controller.save()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().uncertain).toBe(true) })
    controller.save()
    expect(writes).toHaveLength(1)
    expect(controller.store.getSnapshot().editorError).toBe('saveUnconfirmed')
  })

  it('preserves an in-use row and its deletion error, and denies local mutation to viewers', async () => {
    const owner = await bench({ rejectDelete: true })
    owner.controller.confirmDelete(parsePlatformModel(saved))
    owner.controller.remove()
    await vi.waitFor(() => { expect(owner.controller.store.getSnapshot().error).toBe('modelInUse') })
    expect(owner.controller.store.getSnapshot().rows).toHaveLength(1)
    const viewer = await bench({ role: 'viewer' })
    viewer.controller.edit('KnowledgeQA')
    viewer.controller.confirmDelete(parsePlatformModel(saved))
    viewer.controller.remove()
    expect(viewer.controller.store.getSnapshot().draft).toBeNull()
    expect(viewer.writes).toEqual([])
  })

  it('drops cached rows and typed secrets immediately on platform signout', async () => {
    const test = await bench()
    test.controller.edit('KnowledgeQA', parsePlatformModel(saved))
    test.controller.patchDraft({ apiKey: 'typed-secret' })
    await act(async () => { test.signout() })
    expect(test.controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'loginRequired', draft: null, rows: [] })
  })

  it('validates numeric and JSON configuration before sending requests and never mixes credentials into definitions', () => {
    const draft = createPlatformModelDraft('Embedding')
    Object.assign(draft, { name: 'bge-m3', baseUrl: 'http://model.test/v1', dimension: '1024', apiKey: 'new-secret' })
    const definition = platformModelDefinition(draft)
    expect(definition.parameters.embedding_parameters).toMatchObject({ dimension: 1024 })
    expect(JSON.stringify(definition)).not.toContain('new-secret')
    expect(platformModelTestDraft(draft, definition)).toMatchObject({ apiKey: 'new-secret', dimension: 1024 })
    expect(() => platformModelDefinition({ ...draft, dimension: '1.5' })).toThrow('invalidDraft')
    expect(() => platformModelDefinition({ ...draft, headers: '{bad}' })).toThrow('invalidDraft')
    expect(() => platformModelDefinition({ ...draft, baseUrl: 'http://user:secret@model.test' })).toThrow('invalidDraft')
    expect(() => platformModelTestDraft({ ...draft, clearApiKey: true }, definition)).toThrow('credentialsIncomplete')
    expect(() => parsePlatformModel({ ...saved, parameters: { api_key: 'must-not-read' } })).toThrow('invalidResponse')
  })

  it('normalizes provider task metadata and uses inference ids instead of catalog display names', async () => {
    const api = new PlatformModelsApi(async () => Response.json({ data: [{ value: 'openai', label: 'OpenAI',
      modelTypes: ['chat', 'embedding'], defaultUrls: { chat: 'https://model.test/v1' },
      extraFields: [{ key: 'region', label: 'Region', type: 'text', model_types: ['KnowledgeQA'] }],
      models: [{ id: 'actual-inference-id', name: 'Human model name', type: 'chat' }],
    }] }))
    const [provider] = await api.providers(platformModelTenantId('10002'), new AbortController().signal)
    expect(provider?.modelTypes).toEqual(['KnowledgeQA', 'Embedding'])
    expect(provider?.defaultUrls.KnowledgeQA).toBe('https://model.test/v1')
    expect(provider?.models[0]?.name).toBe('actual-inference-id')
    expect(provider?.fields[0]?.modelTypes).toEqual(['KnowledgeQA'])
  })
})

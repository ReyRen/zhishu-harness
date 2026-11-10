// @vitest-environment jsdom
/** Shipped overlay registration through the native command controller and rendered inline shell. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import * as React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { PopupSelectController, type PopupSpec } from '@deepseek-ai/dsh-client-ui-commands/client'
import { PopupSelectView } from '@deepseek-ai/dsh-client-ui-commands/src/client/PopupSelectView.tsx'
import { zh } from '@deepseek-ai/dsh-client-ui-commands/src/client/locales.ts'

const source = await readFile(resolve(import.meta.dirname, '../../../overlay/knowledge-base/client.js'), 'utf8')
const disposers: Array<() => void> = []
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })
afterEach(() => { cleanup(); disposers.splice(0).reverse().forEach((dispose) => { dispose() }) })

function fixture() {
  type Session = { sessionId: string }
  let apply: (ctx: object) => void
  let decoration: { label(): string; hideAlias: boolean; ui: PopupSpec<Session> }
  let dictionary: Record<string, string>
  let summary: React.ComponentType<Record<string, unknown>>
  let summaryProps: (sessionID: string) => Record<string, unknown>
  const state = createSnapshotStore({ knowledgeBaseIds: [] as string[] })
  const useSelection = bindSnapshotSelector(state)
  const useProjection = () => useSelection(value => value)
  let catalogFails = false, commandFails = false
  const execute = vi.fn(async (_session: string, line: string) => {
    if (!commandFails) state.set({ knowledgeBaseIds: line.endsWith(' off') ? [] : line.split(' ').slice(1) })
    return { ok: true, value: { result: { kind: commandFails ? 'error' : 'success' } } }
  })
  const parent = { postMessage() {} }
  const fakeWindow = { parent, top: parent, setTimeout, clearTimeout,
    setInterval() { return 1 }, clearInterval() {}, addEventListener() {}, removeEventListener() {},
    __ModuleLoader__: { load(entry: { factory: (require: (id: string) => unknown) => { apply: typeof apply } }) {
      apply = entry.factory((id) => {
        if (id === 'react') return React
        if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
        throw new Error('Unexpected module '+id)
      }).apply
    } },
  }
  runInNewContext(source, { window: fakeWindow, document, AbortController, console,
    location: { origin: 'https://harness.test' },
    fetch: async (path: string) => path.endsWith('/auth')
      ? Response.json({ mode: 'api-key', authenticated: true })
      : Response.json({ knowledgeBases: [{ id: 'kb-a', name: '资料甲' }, { id: 'kb-b', name: '资料乙' }] }, { status: catalogFails ? 401 : 200 }),
  })
  const consume = vi.fn(() => true)
  const popup = new PopupSelectController<Session>({ consume, focusComposer() {} })
  disposers.push(() => { popup.dispose() })
  apply!({
    effect(setup: () => undefined | (() => void)) { const dispose = setup(); if (dispose) disposers.push(dispose) },
    on() { return () => {} },
    commandUi: { decorate(value: typeof decoration) { decoration = value; return () => {} }, dismiss() { popup.dismiss() },
      async openPopup(name: string, sessionID: string, signal: AbortSignal) {
        signal.throwIfAborted()
        popup.open(name, decoration.ui, { sessionId: sessionID })
      } },
    locale: {
      register(_ns: string, dictionaries: { zh: typeof dictionary }) { dictionary = dictionaries.zh; return () => {} },
      bind() { return (key: string, params: Record<string, string | number> = {}) =>
        dictionary[key]!.replace(/\{(\w+)\}/gu, (_, name: string) => String(params[name])) },
    },
    sessions: { binding() {
      return { session: { projections: { faceOf() { return state } } } }
    } },
    remote: { commands: { execute } },
    desktopWorkbenches: { register() { return () => {} } }, sidebarSoftPanels: { registerOpener() { return () => {} } },
    slots: { inject(_name: string, setup: () => void) { setup() },
      register(definition: { id: string; inject: typeof summaryProps }, component: typeof summary) {
        if (definition.id === 'zhishu-knowledge-selection') { summaryProps = definition.inject; summary = component }
        return () => {}
      } },
  })
  const translate = (key: string, params: Record<string, string | number> = {}) =>
    dictionary[key]!.replace(/\{(\w+)\}/gu, (_, name: string) => String(params[name]))
  const Summary = summary!
  render(<><textarea aria-label="草稿" defaultValue="未发送的内容" /><span data-testid="attachment">附件.pdf</span>
    <Summary {...summaryProps!('session-a')} useProjection={useProjection} t={translate} />
    <PopupSelectView popup={popup} t={makeTranslate(zh, commonZh)} /></>)
  return { execute, consume, popup, open() {
    act(() => { popup.open('knowledge', decoration!.ui, { sessionId: 'session-a' }, { via: 'enter', token: '/知识库' }) })
  }, decoration: () => decoration!, selected: () => state.getSnapshot().knowledgeBaseIds,
  setSelected(ids: string[]) { act(() => { state.set({ knowledgeBaseIds: ids }) }) },
  failCatalog(value: boolean) { catalogFails = value }, failCommand(value: boolean) { commandFails = value } }
}

it('uses the native inline dropdown and immediately applies several toggles without a separate dialog or save', async () => {
  const f = fixture()
  expect(f.decoration().label()).toBe('知识库')
  expect(f.decoration().hideAlias).toBe(true)
  f.open()
  await screen.findByRole('option', { name: '资料甲' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBe('true')
  fireEvent.click(screen.getByRole('option', { name: '资料甲' }))
  await waitFor(() => { expect(f.selected()).toEqual(['kb-a']) })
  fireEvent.change(screen.getByRole('textbox', { name: '筛选选项' }), { target: { value: '乙' } })
  fireEvent.click(screen.getByRole('option', { name: '资料乙' }))
  await waitFor(() => { expect(f.selected()).toEqual(['kb-a', 'kb-b']) })
  expect(f.consume).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('option', { name: '资料乙' }).getAttribute('aria-selected')).toBe('true')
  fireEvent.keyDown(screen.getByRole('textbox', { name: '筛选选项' }), { key: 'Escape' })
  expect(screen.queryByRole('listbox')).toBeNull()
  f.open()
  await screen.findByRole('option', { name: '资料甲' })
  fireEvent.click(screen.getByRole('option', { name: '资料甲' }))
  await waitFor(() => { expect(f.selected()).toEqual(['kb-b']) })
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(f.execute).toHaveBeenLastCalledWith('session-a', '/knowledge kb-b', [])
})

it('retries catalog failures and leaves rejected toggles unchecked while retaining the open dropdown', async () => {
  const f = fixture()
  f.failCatalog(true); f.open()
  await screen.findByRole('alert')
  f.failCatalog(false)
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  await screen.findByRole('option', { name: '资料甲' })
  f.failCommand(true)
  fireEvent.click(screen.getByRole('option', { name: '资料甲' }))
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('切换知识库失败') })
  expect(screen.getByRole('option', { name: '资料甲' }).getAttribute('aria-selected')).toBe('false')
  expect(f.selected()).toEqual([])
  f.failCommand(false)
  fireEvent.click(screen.getByRole('option', { name: '资料乙' }))
  await waitFor(() => { expect(f.selected()).toEqual(['kb-b']) })
  expect(screen.queryByRole('alert')).toBeNull()
})

it('keeps one compact control for any selection and opens the same picker without changing the draft or attachment', async () => {
  const f = fixture()
  expect(screen.getByRole('button', { name: '知识库' })).toBeTruthy()
  f.setSelected(['kb-a'])
  await screen.findByRole('button', { name: '知识库：资料甲' })
  f.setSelected(Array.from({ length: 60 }, (_, index) => `kb-${index}`))
  expect(screen.getAllByRole('button')).toHaveLength(1)
  expect(screen.getByRole('button', { name: '知识库 · 已选 60 个' })).toBeTruthy()
  f.setSelected(['kb-a', 'kb-b'])
  fireEvent.click(screen.getByRole('button', { name: '知识库 · 已选 2 个' }))
  await screen.findByRole('option', { name: '资料甲' })
  fireEvent.click(screen.getByRole('button', { name: '已选（2）' }))
  expect(screen.getAllByRole('option')).toHaveLength(2)
  fireEvent.change(screen.getByRole('textbox', { name: '筛选选项' }), { target: { value: '甲' } })
  f.failCommand(true)
  fireEvent.click(screen.getByRole('button', { name: '清空选择' }))
  await screen.findByRole('alert')
  expect(f.selected()).toEqual(['kb-a', 'kb-b'])
  f.failCommand(false)
  fireEvent.click(screen.getByRole('button', { name: '清空选择' }))
  await waitFor(() => { expect(f.selected()).toEqual([]) })
  expect(screen.getByText('尚未选择任何选项')).toBeTruthy()
  expect(screen.getByRole('button', { name: '知识库' })).toBeTruthy()
  expect(f.execute).toHaveBeenLastCalledWith('session-a', '/knowledge off', [])
  expect(f.consume).not.toHaveBeenCalled()
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: '草稿' }).value).toBe('未发送的内容')
  expect(screen.getByTestId('attachment').textContent).toBe('附件.pdf')
})

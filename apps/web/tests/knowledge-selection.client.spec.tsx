// @vitest-environment jsdom
/** Render the shipped platform overlay through its registered multi-select component. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import * as React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

const source = await readFile(resolve(import.meta.dirname, '../../../overlay/knowledge-base/client.js'), 'utf8')
const disposers: Array<() => void> = []
afterEach(() => { cleanup(); disposers.splice(0).reverse().forEach((dispose) => { dispose() }) })

function fixture() {
  let apply: (ctx: object) => void
  let decoration: { label(): string; hideAlias: boolean; ui: { run(session: { sessionId: string }): void } }
  let definition: { inject(): {
    hooks: { knowledgeRequest: ReturnType<typeof createSnapshotStore> }
    save(request: object, ids: readonly string[]): Promise<void>
    dismiss(request: object): void
    loadCatalog(signal: AbortSignal): Promise<{ knowledgeBases: Array<{ id: string; name: string }> }>
  } }
  let Component: React.ComponentType<Record<string, unknown>>
  let dictionary: Record<string, string>
  let selected: string[] = []
  let catalogFails = false, commandFails = false
  const t = (key: string) => dictionary[key]
  const execute = vi.fn(async (_session: string, line: string) => {
    if (!commandFails) selected = line.endsWith(' off') ? [] : line.split(' ').slice(1)
    return { ok: true, value: { result: { kind: commandFails ? 'error' : 'success' } } }
  })
  const parent = { postMessage() {} }
  const fakeWindow = { parent, top: parent, setTimeout, clearTimeout,
    setInterval() { return 1 }, clearInterval() {}, addEventListener() {}, removeEventListener() {},
    __ModuleLoader__: { load(entry: { factory: (require: (id: string) => unknown) => { apply: typeof apply } }) {
      apply = entry.factory((id) => {
        if (id === 'react') return React
        if (id === '@deepseek-ai/dsh-client-store') return { createSnapshotStore }
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
  apply!({
    effect(setup: () => undefined | (() => void)) { const dispose = setup(); if (dispose) disposers.push(dispose) },
    on() { return () => {} },
    commandUi: { decorate(value: typeof decoration) { decoration = value; return () => {} } },
    locale: {
      register(_ns: string, dictionaries: { zh: typeof dictionary }) { dictionary = dictionaries.zh; return () => {} }, bind() { return t },
    },
    sessions: { binding() {
      return { session: { projections: { faceOf() { return { getSnapshot: () => ({ knowledgeBaseIds: selected }) } } } } }
    } },
    remote: { commands: { execute } },
    desktopWorkbenches: { register() { return () => {} } }, sidebarSoftPanels: { registerOpener() { return () => {} } },
    slots: { inject(_name: string, setup: () => void) { setup() },
      register(value: typeof definition & { id: string }, component: typeof Component) {
        if (value.id === 'zhishu-knowledge-picker') { definition = value; Component = component }
        return () => {}
      } },
  })
  const injected = definition!.inject()
  const store = injected.hooks.knowledgeRequest
  function FixtureRoot() {
    // This test adapter supplies the framework's hook seat to the actual registered component.
    const useKnowledgeRequest = () => React.useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())
    return React.createElement(Component!, { ...injected, useKnowledgeRequest, t })
  }
  render(<FixtureRoot />)
  return { execute, open() { act(() => { decoration!.ui.run({ sessionId: 'session-a' }) }) },
    decoration: () => decoration!, selected: () => selected,
    failCatalog(value: boolean) { catalogFails = value }, failCommand(value: boolean) { commandFails = value } }
}

it('shows a Chinese menu label and commits multiple checked bases together; search and cancel preserve the draft rules', async () => {
  const f = fixture()
  expect(f.decoration().label()).toBe('知识库')
  expect(f.decoration().hideAlias).toBe(true)
  f.open()
  await screen.findByRole('checkbox', { name: '资料甲' })
  fireEvent.click(screen.getByRole('checkbox', { name: '资料甲' }))
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '乙' } })
  fireEvent.click(screen.getByRole('checkbox', { name: '资料乙' }))
  expect(f.execute).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  expect(f.execute).toHaveBeenCalledWith('session-a', '/knowledge kb-a kb-b', [])
  f.open()
  await screen.findByRole('checkbox', { name: '资料甲' })
  expect(screen.getByRole('checkbox', { name: '资料甲' }).checked).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: '资料甲' }))
  fireEvent.click(screen.getByText('取消', { selector: 'button' }))
  expect(f.selected()).toEqual(['kb-a', 'kb-b'])
})

it('keeps failed loads retryable and rejected multi-selections visible without replacing the saved scope', async () => {
  const f = fixture()
  f.failCatalog(true); f.open()
  await screen.findByRole('alert')
  expect(screen.getByRole('button', { name: '保存' }).disabled).toBe(true)
  f.failCatalog(false)
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  await screen.findByRole('checkbox', { name: '资料甲' })
  fireEvent.click(screen.getByRole('checkbox', { name: '资料甲' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '资料乙' }))
  f.failCommand(true)
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('切换知识库失败') })
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(screen.getByRole('checkbox', { name: '资料乙' }).checked).toBe(true)
  expect(f.selected()).toEqual([])
})

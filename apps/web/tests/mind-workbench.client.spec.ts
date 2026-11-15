// @vitest-environment jsdom
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { extract } from 'tar'
import { prepareMindWorkbench } from '../../../market-registry/prepare-mind-workbench.mjs'

const { act } = React

let root: string, source: string
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mind-panel-test-'))
  await copyFile(resolve(import.meta.dirname, '../../../market-registry/tarballs/dsh-mind-workbench-1.0.15.tgz'), join(root, 'dsh-mind-workbench-1.0.15.tgz'))
  await extract({ file: await prepareMindWorkbench(root), cwd: root })
  source = await readFile(join(root, 'package/lib/client.js'), 'utf8')
})
const mounted: { root: ReturnType<typeof createRoot>; container: HTMLElement }[] = []
afterEach(() => {
  for (const item of mounted.splice(0)) { act(() => { item.root.unmount() }); item.container.remove() }
})
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }) })

const initial = '2026-01-01T00:00:00.000Z'
const ownSave = '2026-01-01T00:00:02.000Z'
const external = '2026-01-01T00:00:03.000Z'
const documents = (updatedAt: string) => ({ activeDocumentId: 'default', documents: [{ id: 'default', name: 'Test map', updatedAt }] })

async function panel() {
  let Component: React.ComponentType<{ service: object; entry: { id: string } }> | undefined
  let dictionary: Record<string, string> = {}
  let reads = 0
  let nextRead: Promise<Response> | undefined
  const polls = new Set<() => void>()
  const context = {
    effect(setup: () => void) { setup() },
    locale: {
      register(_ns: string, dict: { zh: Record<string, string> }) { dictionary = dict.zh },
      bind() { return (key: string) => dictionary[key] ?? key },
    },
    desktopWorkbenches: {
      register(_entry: object, value: typeof Component) { Component = value },
    },
  }
  const vmWindow = {
    location: window.location, localStorage: window.localStorage,
    addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window),
    __ModuleLoader__: { load(definition: {
      factory: (require: (name: string) => typeof React) => { apply: (ctx: typeof context) => void }
    }) {
      definition.factory(() => React).apply(context)
    } },
  }
  runInNewContext(source, {
    window: vmWindow, document, URL, Blob, setTimeout, clearTimeout,
    setInterval(fn: () => void) { polls.add(fn); return fn }, clearInterval(fn: () => void) { polls.delete(fn) },
    fetch: async () => { reads++; return nextRead ?? Response.json(documents(initial)) },
  })
  if (Component === undefined) throw new Error('Mind-map component was not registered')
  const Panel = Component
  const container = document.createElement('div')
  document.body.appendChild(container)
  const rendered = createRoot(container)
  mounted.push({ root: rendered, container })
  await act(async () => { rendered.render(React.createElement(Panel, { service: {}, entry: { id: 'mind-map' } })) })
  const frame = container.querySelector('iframe')
  if (frame == null) throw new Error('Mind-map canvas was not mounted')
  const emit = async (type: string, detail: object = {}, sender = frame.contentWindow) => {
    await act(async () => { window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin, source: sender,
      data: { channel: 'dsh-mind-workbench', type, documentId: 'default', ...detail },
    })) })
  }
  await emit('ready', { updatedAt: initial })
  return {
    emit,
    reads: () => reads,
    defer() { const gate = Promise.withResolvers<Response>(); nextRead = gate.promise; return gate },
    async poll() { await act(async () => { for (const fn of polls) fn() }) },
  }
}

describe('mind-map external update notice', () => {
  it('ignores a directory poll overtaken by its own save and keeps real external changes visible', async () => {
    const p = await panel()
    const older = p.defer()
    await p.poll()
    const count = p.reads()
    await p.poll()
    expect(p.reads()).toBe(count)
    await p.emit('saving')
    await p.emit('saved', { updatedAt: ownSave, pending: false })
    await act(async () => { older.resolve(Response.json(documents(initial))) })
    expect(document.body.textContent).not.toContain('当前导图已被外部更新')
    const changed = p.defer()
    await p.poll()
    await act(async () => { changed.resolve(Response.json(documents(external))) })
    expect(document.body.textContent).toContain('当前导图已被外部更新')
  })

  it('does not confuse another same-origin canvas with this map', async () => {
    const p = await panel()
    await p.emit('saved', { updatedAt: external }, window)
    const changed = p.defer()
    await p.poll()
    await act(async () => { changed.resolve(Response.json(documents(external))) })
    expect(document.body.textContent).toContain('当前导图已被外部更新')
  })
})

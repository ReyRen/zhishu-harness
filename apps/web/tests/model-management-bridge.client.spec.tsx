// @vitest-environment jsdom
/** Embedded applications delegate model administration to the native Harness settings owner. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import * as React from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'

it('accepts settings requests only from the knowledge frame and releases model-update listeners on unmount', async () => {
  const disposers: Array<() => void> = []
  let apply: (ctx: object) => void = () => { throw new Error('Plugin not loaded') }
  let modelsChanged: (() => void) | undefined
  let KnowledgePanel: React.ComponentType<Record<string, unknown>> = () => null
  let AccountLauncher: React.ComponentType<{ openSettings(section: string): void }> = () => null
  let panelProps: Record<string, unknown> = {}
  const carrier = {
    parent: {}, top: {}, setTimeout, clearTimeout,
    addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window),
    dispatchEvent: window.dispatchEvent.bind(window), setInterval() { return 1 }, clearInterval() {},
    __ModuleLoader__: { load(entry: { factory(require: (name: string) => unknown): { apply: (ctx: object) => void } }) {
      apply = entry.factory(name => name === 'react' ? React : primitives).apply
    } },
  }
  const load = async (path: string) => {
    runInNewContext(await readFile(resolve(import.meta.dirname, '../../../overlay', path), 'utf8'), {
      window: carrier, document, location: window.location, Event: window.Event, URL,
      console, AbortController, AbortSignal, fetch: async () => Response.json({ mode: 'api-key', authenticated: true }),
    })
  }
  try {
    await load('knowledge-base/client.js')
    apply({
      effect(setup: () => (() => void) | undefined) { const stop = setup(); if (stop) disposers.push(stop) },
      on() { return () => {} },
      locale: { register() { return () => {} }, bind() { return (key: string) => key } },
      commandUi: { decorate() { return () => {} }, dismiss() {} }, sessions: { binding() {} },
      remote: { $on(_event: string, listener: () => void) { modelsChanged = listener; return () => { modelsChanged = undefined } } },
      desktopWorkbenches: { ready: true, state: { added: [], sessionBindings: {} }, report(error: Error) { throw error } },
      layout: { panelInfo: { getSnapshot: () => ({ activePanelId: null }), subscribe: () => () => {} } },
      sidebarSoftPanels: { registerOpener() { return () => {} } },
      slots: {
        inject(_name: string, setup: () => void) { setup() },
        register(definition: { name: string; inject?(): Record<string, unknown> }, component: typeof KnowledgePanel) {
          if (definition.name === 'main') { KnowledgePanel = component; panelProps = definition.inject?.() || {} }
          return () => {}
        },
      },
    })
    await load('platform-account/client.js')
    apply({ slots: {
      inject(_name: string, setup: () => Generator) { return Array.from(setup()) },
      register(_definition: object, component: typeof AccountLauncher) { AccountLauncher = component; return () => {} },
    } })
    const openSettings = vi.fn()
    const page = render(<><AccountLauncher openSettings={openSettings} /><KnowledgePanel {...panelProps} /></>)
    await waitFor(() => { expect(page.container.querySelector('iframe')).not.toBeNull() })
    const frame = page.container.querySelector('iframe')!
    const request = (origin: string, source: Window | null) => {
      window.dispatchEvent(new MessageEvent('message', { origin, source, data: { type: 'weknora:open-model-settings' } }))
    }
    act(() => { request('http://172.18.36.230:5175', window); request('https://evil.test', frame.contentWindow) })
    expect(openSettings).not.toHaveBeenCalled()
    act(() => { request('http://172.18.36.230:5175', frame.contentWindow) })
    expect(openSettings).toHaveBeenCalledExactlyOnceWith('models')
    const post = vi.spyOn(frame.contentWindow!, 'postMessage')
    act(() => { modelsChanged?.() })
    expect(post).toHaveBeenCalledWith({ type: 'weknora:models-updated' }, 'http://172.18.36.230:5175')
    page.unmount()
    expect(modelsChanged).toBeUndefined()
    act(() => { carrier.dispatchEvent(new Event('zhishu:open-model-settings')) })
    expect(openSettings).toHaveBeenCalledTimes(1)
  } finally {
    cleanup()
    disposers.reverse().forEach((stop) => { stop() })
  }
})

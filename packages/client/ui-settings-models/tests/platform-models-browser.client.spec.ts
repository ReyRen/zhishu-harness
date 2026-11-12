// @vitest-environment jsdom
/** Parent-window tickets are accepted only from the requested origin, source and nonce. */
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { createPlatformModelBrowser } from '../src/client/platform-models-auth.ts'
import { platformModelRecord } from '../src/client/platform-models-api.ts'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('ignores unrelated SSO messages and removes the ticket listener after its matching reply', async () => {
  const parent = window
  const sent: unknown[] = []
  const post = vi.spyOn(parent, 'postMessage').mockImplementation((message: unknown) => { sent.push(message) })
  let receive: ((event: MessageEvent) => void) | undefined
  const remove = vi.fn()
  vi.stubGlobal('window', { parent, location: { ancestorOrigins: { 0: 'https://platform.test' } },
    addEventListener(_type: string, listener: (event: MessageEvent) => void) { receive = listener }, removeEventListener: remove })
  const controller = new AbortController()
  const ticket = createPlatformModelBrowser(30000).ticket(controller.signal)
  onTestFinished(async () => { controller.abort(); await ticket.catch(() => { /* Fixture cancellation owns an unfinished wait. */ }) })
  const request = sent[0]
  expect(platformModelRecord(request)).toBe(true)
  if (!platformModelRecord(request)) throw new Error('Expected the parent SSO request')
  expect(request.type).toBe('zhishu:sso-request')
  expect(request.client_id).toBe('gcs-webnora')
  expect(post).toHaveBeenCalledWith(expect.any(Object), 'https://platform.test')
  const dispatch = (origin: string, nonce: unknown, source: Window | null) => {
    if (!receive) throw new Error('Missing SSO listener')
    receive(new MessageEvent('message', { origin, source,
      data: { type: 'zhishu:sso-response', nonce, access_token: 'current-test-ticket', user_id: '369' } }))
  }
  let settled = false
  void ticket.then(() => { settled = true }, () => { /* The assertion or fixture teardown observes rejection. */ })
  dispatch('https://other.test', request.nonce, parent)
  dispatch('https://platform.test', 'other-request', parent)
  dispatch('https://platform.test', request.nonce, null)
  await Promise.resolve()
  expect(settled).toBe(false)
  dispatch('https://platform.test', request.nonce, parent)
  await expect(ticket).resolves.toEqual({ access_token: 'current-test-ticket', user_id: '369' })
  expect(remove).toHaveBeenCalledWith('message', expect.any(Function))
})

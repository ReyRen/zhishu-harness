/** Authentication ownership and cancellation for native model settings. */
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { PlatformModelsAuthentication } from '../src/client/platform-models-auth.ts'

afterEach(() => { vi.unstubAllGlobals() })

it('cancels an individual wait without cancelling another settings consumer, and closes owned authentication on disposal', async () => {
  const ticket = Promise.withResolvers<{ access_token: string }>()
  const requested = Promise.withResolvers<undefined>()
  const calls: string[] = []
  const auth = new PlatformModelsAuthentication({ ticket: async (signal) => {
    requested.resolve(undefined)
    signal.addEventListener('abort', () => { ticket.reject(signal.reason) }, { once: true })
    return ticket.promise
  } }, async (_input, init) => {
    calls.push(init?.method || 'GET')
    return Response.json({ authenticated: init?.method === 'POST' })
  })
  onTestFinished(async () => { await auth.dispose() })
  const consumer = new AbortController()
  const first = auth.ready(consumer.signal)
  const second = auth.ready(new AbortController().signal)
  await requested.promise
  const aborted = expect(first).rejects.toHaveProperty('name', 'AbortError')
  consumer.abort()
  await aborted
  ticket.resolve({ access_token: 'current-ticket' })
  await second
  expect(calls).toEqual(['GET', 'POST'])
})

it('does not hand off a stale ticket after platform signout, and waits for Host logout before a later login', async () => {
  const ticket = Promise.withResolvers<{ access_token: string }>()
  const requested = Promise.withResolvers<undefined>()
  let notify: (signedIn: boolean) => void = () => {}
  const posts: unknown[] = []
  const auth = new PlatformModelsAuthentication({
    account: { state: async () => true, subscribe: (listener) => { notify = listener; return () => { notify = () => {} } } },
    ticket: async () => { requested.resolve(undefined); return ticket.promise },
  }, async (_input, init) => {
    if (init?.method === 'POST') {
      if (typeof init.body !== 'string') throw new Error('Expected a JSON request body')
      const body: unknown = JSON.parse(init.body)
      posts.push(body)
    }
    return Response.json({ authenticated: false })
  })
  onTestFinished(async () => { await auth.dispose() })
  auth.start()
  await requested.promise
  notify(false)
  ticket.resolve({ access_token: 'expired-ticket' })
  await vi.waitFor(() => { expect(posts).toEqual([{ action: 'logout' }]) })
  await expect(auth.ready(new AbortController().signal)).rejects.toThrow('loginRequired')
  expect(JSON.stringify(posts)).not.toContain('expired-ticket')
})

it('rejects malformed auth status before asking the parent for a ticket', async () => {
  const auth = new PlatformModelsAuthentication({ ticket: async () => { throw new Error('unexpected ticket request') } }, async () => Response.json({ authenticated: 'yes' }))
  onTestFinished(async () => { await auth.dispose() })
  await expect(auth.ready(new AbortController().signal)).rejects.toThrow('invalidResponse')
})

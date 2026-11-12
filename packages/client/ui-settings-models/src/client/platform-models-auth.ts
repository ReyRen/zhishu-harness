/** Current-platform SSO for native model settings, independent of embedded knowledge pages. */
import { PlatformModelFailure, platformModelRecord } from './platform-models-api.ts'

/** A fresh platform ticket handed only to the authenticated Harness Host. */
export interface PlatformModelTicket { access_token: string; refresh_token?: string; user_id?: string }
/** The browser carrier's account state; it does not grant backend permissions. */
export interface PlatformModelAccount {
  state(): Promise<boolean>
  subscribe(listener: (signedIn: boolean) => void): () => void
}
/** Native browser transport; tests can supply an isolated carrier. */
export interface PlatformModelBrowser {
  ticket(signal: AbortSignal): Promise<PlatformModelTicket>
  account?: PlatformModelAccount
}

function callable(value: unknown): value is (...args: unknown[]) => unknown { return typeof value === 'function' }
function errorValue(value: unknown): Error {
  return value instanceof Error ? value : new PlatformModelFailure('unavailable', undefined, { cause: value })
}
function cancellation(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  return reason instanceof Error ? reason : new DOMException('Model settings request cancelled', 'AbortError')
}

function readTicket(value: unknown): PlatformModelTicket {
  if (!platformModelRecord(value) || typeof value.access_token !== 'string' || !value.access_token.trim()
    || value.access_token.length > 32768
    || value.refresh_token !== undefined && (typeof value.refresh_token !== 'string' || value.refresh_token.length > 32768)) {
    throw new PlatformModelFailure('loginRequired')
  }
  const id = value.user_id
  if (id !== undefined && typeof id !== 'string' && typeof id !== 'number') throw new PlatformModelFailure('invalidResponse')
  return { access_token: value.access_token,
    ...(typeof value.refresh_token === 'string' ? { refresh_token: value.refresh_token } : {}),
    ...(id === undefined ? {} : { user_id: String(id) }) }
}

/**
 * Bind platform tickets to their exact parent window and a fresh nonce.
 * @param ticketTimeoutMs - validated profile deadline for the ticket reply.
 * @returns the current browser carrier; no credential is persisted.
 */
export function createPlatformModelBrowser(ticketTimeoutMs: number): PlatformModelBrowser {
  const accountValue: unknown = Reflect.get(window, 'dshModelSpace')
  const desktopValue: unknown = Reflect.get(window, 'zhishuPlatform')
  const readAccount = (value: unknown): boolean => {
    if (!platformModelRecord(value) || typeof value.authenticated !== 'boolean') throw new PlatformModelFailure('invalidResponse')
    return value.authenticated
  }
  const account = platformModelRecord(accountValue) ? accountValue : undefined
  const state = account?.state
  const observe = account?.onStateChanged
  return {
    ...(account === undefined || !callable(state) || !callable(observe) ? {} : { account: {
      async state() { const result: unknown = await state.call(account); return readAccount(result) },
      subscribe(listener: (signedIn: boolean) => void) {
        const stop: unknown = observe.call(account, (state: unknown) => {
          listener(platformModelRecord(state) && state.authenticated === true)
        })
        if (!callable(stop)) throw new PlatformModelFailure('invalidResponse')
        return () => { stop() }
      },
    } }),
    ticket(signal) {
      return new Promise((resolve, reject) => {
        signal.throwIfAborted()
        const nonce = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('')
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); window.removeEventListener('message', receive) }
        const finish = (value: unknown) => { cleanup(); try { resolve(readTicket(value)) } catch (error) { reject(errorValue(error)) } }
        const abort = () => { cleanup(); reject(cancellation(signal)) }
        const timer = setTimeout(() => { cleanup(); reject(new PlatformModelFailure('loginRequired')) }, ticketTimeoutMs)
        const ancestors: unknown = Reflect.get(window.location, 'ancestorOrigins')
        const ancestor: unknown = platformModelRecord(ancestors) ? Reflect.get(ancestors, '0') : undefined
        const parentOrigin = typeof ancestor === 'string' ? ancestor : undefined
        const receive = (event: MessageEvent) => {
          const data: unknown = event.data
          if (event.source !== window.parent || parentOrigin && event.origin !== parentOrigin
            || !platformModelRecord(data) || data.type !== 'zhishu:sso-response' || data.nonce !== nonce) return
          finish(data)
        }
        signal.addEventListener('abort', abort, { once: true })
        if (platformModelRecord(desktopValue) && callable(desktopValue.getSsoToken)) {
          const getSsoToken = desktopValue.getSsoToken
          void Promise.resolve().then(() => getSsoToken.call(desktopValue, 'gcs-webnora')).then(finish, () => {
            cleanup(); reject(new PlatformModelFailure('loginRequired'))
          })
        } else if (window.parent !== window) {
          window.addEventListener('message', receive)
          window.parent.postMessage({ type: 'zhishu:sso-request', nonce, client_id: 'gcs-webnora' }, parentOrigin || '*')
        } else { cleanup(); reject(new PlatformModelFailure('loginRequired')) }
      })
    },
  }
}

/** Per-plugin authentication; switching settings tabs retains this owner. */
export class PlatformModelsAuthentication {
  private readonly lifetime = new AbortController()
  private session = new AbortController()
  private pending: Promise<void> | undefined
  private clearing: Promise<void> = Promise.resolve()
  private signedIn = true
  private generation = 0
  private stopAccount: (() => void) | undefined
  private readonly listeners = new Set<(signedIn: boolean) => void>()

  constructor(
    private readonly browser: PlatformModelBrowser,
    private readonly request: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  /** Initialize account observation and perform the first owner-authenticated handoff. */
  start(): void {
    if (this.browser.account) {
      this.stopAccount = this.browser.account.subscribe((value) => { this.accountChanged(value) })
      void this.browser.account.state().then((value) => { this.accountChanged(value) }, () => { this.accountChanged(false) })
    } else void this.ready(this.lifetime.signal).catch(() => { /* The page exposes a retryable authentication error. */ })
  }

  /**
   * Observe signout so stores release cached rows and credential drafts.
   * @param listener - account change consumer.
   * @returns its disposer.
   */
  subscribe(listener: (signedIn: boolean) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener) }
  }

  private accountChanged(signedIn: boolean): void {
    if (this.lifetime.signal.aborted) return
    this.signedIn = signedIn
    if (!signedIn) {
      this.generation++
      this.session.abort()
      this.session = new AbortController()
      const pending = this.pending
      const clearing = this.clearing
      this.pending = undefined
      const clear = async () => {
        const response = await this.request('/api/zhishu-models/auth', { method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'logout' }), signal: this.lifetime.signal })
        if (!response.ok) throw new PlatformModelFailure('unavailable')
      }
      this.clearing = Promise.allSettled([pending, clearing]).then(clear)
      void this.clearing.catch(() => { /* A later ready() cannot use an uncleared session. */ })
    } else void this.ready(this.lifetime.signal).catch(() => { /* The page owns the visible retry path. */ })
    for (const listener of this.listeners) listener(signedIn)
  }

  /**
   * Await the Host's current-user authentication before reading or mutating models.
   * @param signal - consumer cancellation; it never cancels another caller's handoff.
   */
  async ready(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    this.lifetime.signal.throwIfAborted()
    if (!this.signedIn) throw new PlatformModelFailure('loginRequired')
    if (!this.pending) {
      const generation = this.generation
      const active = AbortSignal.any([this.lifetime.signal, this.session.signal])
      const task = (async () => {
        await this.clearing
        active.throwIfAborted()
        const response = await this.request('/api/zhishu-models/auth', { credentials: 'same-origin', cache: 'no-store', signal: active })
        if (!response.ok) throw new PlatformModelFailure('unavailable')
        const status: unknown = await response.json()
        if (!platformModelRecord(status) || typeof status.authenticated !== 'boolean') throw new PlatformModelFailure('invalidResponse')
        if (status.authenticated) return
        const ticket = await this.browser.ticket(active)
        active.throwIfAborted()
        if (!this.signedIn || generation !== this.generation) throw new PlatformModelFailure('loginRequired')
        const result = await this.request('/api/zhishu-models/auth', { method: 'POST', credentials: 'same-origin', signal: active,
          headers: { 'content-type': 'application/json' }, body: JSON.stringify(ticket) })
        if (!result.ok) throw new PlatformModelFailure(result.status === 403 ? 'accessDenied' : 'loginRequired')
      })()
      this.pending = task
      void task.finally(() => { if (this.pending === task) this.pending = undefined }).catch(() => {
        /* Rejection remains observable on ready(). */
      })
    }
    const pending = this.pending
    await new Promise<void>((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(cancellation(signal)) }
      signal.addEventListener('abort', abort, { once: true })
      void pending.then(() => { signal.removeEventListener('abort', abort); resolve() }, (error: unknown) => {
        signal.removeEventListener('abort', abort); reject(errorValue(error))
      })
      if (signal.aborted) abort()
    })
    signal.throwIfAborted()
  }

  /** Stop the browser observers and await all owned requests without clearing active Host model calls. */
  async dispose(): Promise<void> {
    this.generation++
    this.lifetime.abort()
    this.stopAccount?.()
    this.listeners.clear()
    await Promise.allSettled([this.pending, this.clearing])
  }
}

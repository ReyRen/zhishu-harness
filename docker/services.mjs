/** Own container subprocess groups and await their termination before releasing runtime state. */
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * Create one process-group owner. Any unexpected child exit aborts dependent startup and running services.
 * @returns An abort signal, a child launcher, a stop request and an awaited teardown operation.
 */
export function serviceOwner() {
  const controller = new AbortController()
  const children = []
  let closing
  const stop = reason => controller.abort(reason)
  return {
    signal: controller.signal,
    stop,
    start(command, args, options = {}) {
      controller.signal.throwIfAborted()
      const child = spawn(command, args, { stdio: 'inherit', ...options, detached: true })
      const closed = new Promise(resolve => {
        child.once('error', error => stop(new Error(`Cannot start ${command}`, { cause: error })))
        child.once('close', (code, signal) => {
          resolve()
          if (!closing) stop(new Error(`${command} exited unexpectedly (${code ?? signal})`))
        })
      })
      children.push({ child, closed })
      return child
    },
    close() {
      closing ??= (async () => {
        const kill = signal => {
          for (const { child } of children) {
            if (child.pid === undefined) continue
            try { process.kill(-child.pid, signal) } catch (error) {
              if (error.code !== 'ESRCH') throw error
            }
          }
        }
        kill('SIGTERM')
        const timer = setTimeout(() => kill('SIGKILL'), 5_000)
        try {
          await Promise.all(children.map(({ closed }) => closed))
          const deadline = Date.now() + 10_000
          while (children.some(({ child }) => {
            if (child.pid === undefined) return false
            try { process.kill(-child.pid, 0); return true } catch (error) {
              if (error.code !== 'ESRCH') throw error
              return false
            }
          })) {
            if (Date.now() >= deadline) throw new Error('Owned process group did not terminate; runtime state was not released')
            await delay(20)
          }
        } finally { clearTimeout(timer) }
      })()
      return closing
    },
  }
}

/**
 * Wait for an owned HTTP service; a non-2xx response, timeout or process failure cannot count as readiness.
 * @param url - Loopback endpoint.
 * @param signal - Owner cancellation signal.
 * @param timeoutMs - Total startup deadline.
 */
export async function waitForService(url, signal, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    signal.throwIfAborted()
    try {
      const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(1_000)]) })
      await response.body?.cancel()
      if (response.ok) return
      last = new Error(`HTTP ${response.status}`)
    } catch (error) { last = error }
    await delay(100, undefined, { signal })
  }
  throw new Error(`Service unavailable at ${url}; inspect container startup logs`, { cause: last })
}

/** What a model-page address means for the conversation cover. */
export type ModelAddressDecision = 'signed-out' | 'pending' | 'signed-in' | 'ignore'

const SIGNED_OUT = new Set(['/', '/login', '/register', '/404'])
const PENDING = new Set(['/desktop-entry', '/complete-identity'])

/**
 * Classify the model view's main-frame address.
 * Login, the cold-start entry, and any http(s) page outside this origin keep
 * the conversation covered. Only a later same-origin workspace path opens it.
 * @param pageUrl - main-frame URL.
 * @param origin - packaged or dev model origin, without a path.
 */
export function classifyModelAddress(pageUrl: string, origin: string): ModelAddressDecision {
  let parsed: URL
  try { parsed = new URL(pageUrl) } catch { return 'ignore' }
  if (parsed.origin !== origin) {
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? 'signed-out' : 'ignore'
  }
  const path = parsed.pathname.length > 1 && parsed.pathname.endsWith('/')
    ? parsed.pathname.slice(0, -1)
    : parsed.pathname
  if (SIGNED_OUT.has(path)) return 'signed-out'
  if (PENDING.has(path)) return 'pending'
  return 'signed-in'
}

/** Model site baked into a packaged desktop build. Dev uses the local server instead. */

export const DEVELOPMENT_MODEL_ORIGIN = 'http://127.0.0.1:8888'
/** Page origin of a packaged app. Backend addresses live in model-gateway.json, not here. */
export const PACKAGED_MODEL_ORIGIN = 'http://127.0.0.1:17321'

/**
 * @param {string} raw - Candidate origin.
 * @param {string} label - Error prefix.
 * @returns {string} Origin without a path.
 */
export function parseModelOrigin(raw, label) {
  let url
  try { url = new URL(raw) }
  catch { throw new Error(`${label} must be an http(s) origin`) }
  if (url.username || url.password || url.hash || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new Error(`${label} must be an http(s) origin`)
  }
  return url.origin
}

/**
 * Origin written into the installer. The page is the local gateway.
 * Changing a backend address is a model-gateway.json edit, not a rebuild.
 * @returns {string} Model site origin.
 */
export function resolvePackagedModelOrigin() {
  return PACKAGED_MODEL_ORIGIN
}

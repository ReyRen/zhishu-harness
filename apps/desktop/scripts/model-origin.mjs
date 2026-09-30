/** Model site baked into a packaged desktop build. Dev uses the local server instead. */

export const DEVELOPMENT_MODEL_ORIGIN = 'http://127.0.0.1:8888'
export const PRODUCTION_MODEL_ORIGIN = 'https://172.18.127.67'

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
 * Origin written into the installer. An empty setting keeps the production default.
 * @param {NodeJS.ProcessEnv} env - File-owned packaging environment.
 * @returns {string} Model site origin.
 */
export function resolvePackagedModelOrigin(env = {}) {
  const configured = env.DSH_MODEL_ORIGIN?.trim()
  return parseModelOrigin(configured || PRODUCTION_MODEL_ORIGIN, 'desktop package: DSH_MODEL_ORIGIN')
}

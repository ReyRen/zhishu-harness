/** Publish the knowledge panel's browser-facing SSO URL at page load. */
const SSO_PATH = '/sso/platform'

/**
 * Expose the configured page URL to the client through the Host's index rows.
 * @param ctx - Host context serving the Harness page.
 * @param config - Browser base or SSO page URL, with the API URL as a fallback.
 * @throws If the configured address is not an absolute HTTP(S) URL or includes credentials, query or fragment.
 */
export function apply(ctx, { webUrl, baseUrl } = {}) {
  const web = webUrl?.trim()
  const address = web || baseUrl?.trim()
  if (!address) return
  const url = URL.parse(address)
  if (!url || !/^https?:\/\//iu.test(address) || !['http:', 'https:'].includes(url.protocol)
    || url.username || url.password || url.href.includes('?') || url.href.includes('#')) {
    const variable = web ? 'WEKNORA_WEB_URL' : 'WEKNORA_BASE_URL'
    throw new Error(`${variable} must be an absolute HTTP(S) URL without credentials, query or fragment`)
  }
  const path = url.pathname.replace(/\/+$/u, '')
  const webPath = web ? path : path.replace(/\/api\/v1$/u, '')
  url.pathname = webPath.endsWith(SSO_PATH) ? webPath : webPath + SSO_PATH
  const iframeUrl = url.href
  ctx.on('webserver/index-inject', table => {
    table.push({ kind: 'global', name: '__DSH_WEKNORA_IFRAME_URL__', value: iframeUrl })
  })
}

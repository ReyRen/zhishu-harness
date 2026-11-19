/** Publish the SSO destination for the native Desktop renderer. */

/**
 * Expose the desktop knowledge page through the Host's index rows.
 * @param ctx - Host context serving the native renderer.
 * @param config - Configured API base for the Desktop Host.
 * @throws If the base is not an absolute HTTP(S) URL or includes credentials, query or fragment.
 */
export function apply(ctx, { desktopBaseUrl } = {}) {
  if (!desktopBaseUrl?.trim()) return
  const url = URL.parse(desktopBaseUrl)
  if (!url || !['http:', 'https:'].includes(url.protocol)
    || url.username || url.password || url.href.includes('?') || url.href.includes('#')) {
    throw new Error('WEKNORA_BASE_URL must be an absolute HTTP(S) URL without credentials, query or fragment')
  }
  url.pathname = url.pathname.replace(/\/+$/u, '').replace(/\/api\/v1$/u, '') + '/sso/platform'
  const iframeUrl = url.href
  ctx.on('webserver/index-inject', table => {
    table.push({ kind: 'global', name: '__DSH_WEKNORA_DESKTOP_URL__', value: iframeUrl })
  })
}

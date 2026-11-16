/** Authenticate the Workflow GUI and managed-file routes with the current Harness Host. */

/**
 * Resolve the Host server and register Workflow routes with Host request authorization.
 * @param {{get(name: string): unknown}} ctx - Workflow context and current Host services.
 * @returns {{register(route: {kind: string, path: string, handler: Function}): Function} | null} Registration wrapper, or null when the server is unavailable.
 */
export function webServerOf(ctx) {
  const server = ctx.get('webServer')
  if (server === null || typeof server !== 'object' || typeof server.register !== 'function') return null
  return {
    register(route) {
      if (route.path !== '/visual-workflow' && !route.path.startsWith('/visual-workflow/')) return server.register(route)
      return server.register({
        ...route,
        handler(request, response) {
          const connection = ctx.get('connection')
          const status = typeof connection?.requestRejection === 'function' ? connection.requestRejection(request) : 503
          if (status !== undefined) {
            response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
            response.end(status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'Host authentication unavailable')
            return
          }
          return route.handler(request, response)
        },
      })
    },
  }
}

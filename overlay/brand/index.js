/** Host half: serve the sidebar brand images. The browser half occupies the slots. */
import { createReadStream } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const assets = join(dirname(fileURLToPath(import.meta.url)), 'assets')

/** Public paths. The browser plugin requests these same URLs. */
const files = {
  '/overlay/zhishu-brand/logo.png': 'logo.png',
  '/overlay/zhishu-brand/logo-mark.png': 'logo-mark.png',
}

/** Required service: the page origin that also serves the Harness UI. */
export const inject = ['webServer']

/**
 * Publish the brand images on the Harness origin so the sidebar slots can
 * load them without copying files into the upstream frontend dist.
 * @param ctx - host context whose webServer owns exact routes.
 */
export function apply(ctx) {
  for (const [path, file] of Object.entries(files)) {
    const absolute = join(assets, file)
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path,
      handler(req, res) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405
          res.end()
          return
        }
        res.setHeader('Content-Type', 'image/png')
        res.setHeader('Cache-Control', 'no-cache')
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        createReadStream(absolute).pipe(res)
      },
    }), `zhishu-brand: ${path}`)
  }
}

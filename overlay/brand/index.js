/** Host half: serve the sidebar brand images. The browser half occupies the slots. */
import { createReadStream } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const assets = join(dirname(fileURLToPath(import.meta.url)), 'assets')

/** Public paths. The browser plugin requests these same URLs. */
const files = {
  '/overlay/zhishu-brand/logo.png': { file: 'logo.png', type: 'image/png' },
  '/overlay/zhishu-brand/logo-mark.png': { file: 'logo-mark.png', type: 'image/png' },
  '/overlay/zhishu-brand/hero.webp': { file: 'zhishu-hero.webp', type: 'image/webp' },
  '/overlay/zhishu-brand/hero-loop.webp': { file: 'zhishu-hero-loop.webp', type: 'image/webp' },
  '/overlay/zhishu-brand/loader.gif': { file: 'zhishu.gif', type: 'image/gif' },
}

/** Required service: the page origin that also serves the Harness UI. */
export const inject = ['webServer']

/**
 * Publish the brand images on the Harness origin so the sidebar slots can
 * load them without copying files into the upstream frontend dist.
 * @param ctx - host context whose webServer owns exact routes.
 */
export function apply(ctx) {
  for (const [path, asset] of Object.entries(files)) {
    const absolute = join(assets, asset.file)
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path,
      handler(req, res) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405
          res.end()
          return
        }
        res.setHeader('Content-Type', asset.type)
        res.setHeader('Cache-Control', 'no-cache')
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        createReadStream(absolute).pipe(res)
      },
    }), `zhishu-brand: ${path}`)
  }
  ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'style',
      text: '[data-zhishu-boot-mark]{display:inline-flex;align-items:center;gap:8px}[data-zhishu-boot-logo]{height:64px;width:auto;display:block}',
    })
    table.push({
      kind: 'script',
      placement: 'body',
      text: `(function () {
        var src = '/overlay/zhishu-brand/hero-loop.webp'
        function attach(root) {
          var card = root.firstElementChild
          var word = card && card.firstElementChild
          if (!word || word.querySelector('[data-zhishu-boot-logo]')) return
          word.setAttribute('data-zhishu-boot-mark', '')
          var img = document.createElement('img')
          img.setAttribute('data-zhishu-boot-logo', '')
          img.alt = ''
          img.setAttribute('aria-hidden', 'true')
          img.src = src
          word.insertBefore(img, word.firstChild)
        }
        function scan() {
          var nodes = document.querySelectorAll('[data-dsh-boot]')
          for (var i = 0; i < nodes.length; i++) attach(nodes[i])
        }
        new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true })
        scan()
      })()`,
    })
  })
}

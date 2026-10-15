window.__ModuleLoader__.load({
  id: '@zhishu/dsh-overlay-running-status',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const STYLE_ID = 'zhishu-overlay-running-status-style'
    const MARK_URL = '/overlay/zhishu-brand/logo-mark.png'
    const PHRASES = [
      ['深度求索中', '正在思考'],
      ['Deep diving', 'Thinking'],
    ]

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.dataset.plugin = '@zhishu/dsh-overlay-running-status'
      style.textContent = `
        [data-chat-running] [class*="_runningWhaleAnimated"],
        [data-chat-running] [class*="_runningWhaleStill"] { display: none !important; }
        [data-chat-running] [class*="_runningIcon"] {
          background: url("${MARK_URL}") center / contain no-repeat;
        }
        [data-conversation-scroll] { overflow-x: hidden; }
        html body [data-shell-bottom] { overflow-x: hidden; }
        html, body { overflow: hidden; }
      `
      document.head.appendChild(style)
    }

    function rewriteText(value) {
      let next = value
      for (const pair of PHRASES) {
        if (next.includes(pair[0])) next = next.split(pair[0]).join(pair[1])
      }
      return next
    }

    function rewrite(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node) {
        const value = node.nodeValue
        if (value) {
          const next = rewriteText(value)
          if (next !== value) node.nodeValue = next
        }
        node = walker.nextNode()
      }
      root.querySelectorAll('[data-shimmer-text]').forEach((el) => {
        const value = el.getAttribute('data-shimmer-text')
        if (!value) return
        const next = rewriteText(value)
        if (next !== value) el.setAttribute('data-shimmer-text', next)
      })
    }

    function bind(el) {
      if (el.dataset.zhishuRunning === '1') return
      el.dataset.zhishuRunning = '1'
      rewrite(el)
      const observer = new MutationObserver(() => rewrite(el))
      observer.observe(el, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-shimmer-text'],
      })
    }

    function scan(root) {
      if (root.nodeType !== 1) return
      if (root.matches('[data-chat-running]')) bind(root)
      root.querySelectorAll('[data-chat-running]').forEach(bind)
    }

    function start() {
      installStyles()
      scan(document.body)
      const page = new MutationObserver((records) => {
        for (const record of records) {
          record.addedNodes.forEach((node) => scan(node))
        }
      })
      page.observe(document.body, { childList: true, subtree: true })
    }

    const inject = []
    function apply() {
      if (document.body) start()
      else document.addEventListener('DOMContentLoaded', start, { once: true })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})

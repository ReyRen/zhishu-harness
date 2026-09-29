window.__ModuleLoader__.load({
  id: '@zhishu/dsh-overlay-brand',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const LOCKUP_URL = '/overlay/zhishu-brand/logo.png'
    const MARK_URL = '/overlay/zhishu-brand/logo-mark.png'
    const HERO_MARK_URL = '/overlay/zhishu-brand/hero.webp'
    const HERO_LOOP_URL = '/overlay/zhishu-brand/hero-loop.webp'
    const STYLE_ID = 'zhishu-overlay-brand-style'

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.dataset.plugin = '@zhishu/dsh-overlay-brand'
      style.textContent = `
        .zhishuBrandLockup{height:36px;width:auto;max-width:180px;object-fit:contain;display:block}
        .zhishuBrandMark{width:24px;height:24px;object-fit:contain;display:block}
        div:has([data-slot="sidebar.brand.name"]){overflow:visible!important}
        span:has(> span [data-slot="sidebar.brand.mark"]){height:36px!important;overflow:visible!important;align-items:center!important}
        span:has(> span [data-slot="sidebar.brand.name"]){height:36px!important;overflow:visible!important}
        span:has(+ span [data-slot="sidebar.brand.name"]){display:none!important}
        .zhishuHeroBrand{display:inline-flex;align-items:center;gap:10px}
        .zhishuHeroBrandMark{height:32px;width:auto;object-fit:contain;display:block;animation:none!important;transform:none!important;cursor:pointer}
        .zhishuHeroBrandDot{width:8px;height:8px;border-radius:50%;background:#000;flex:none}
        body[data-ds-dark-theme] .zhishuHeroBrandDot{background:#fff}
        span:has([data-slot="conversation.hero.brand.mark"]) + span > span:last-child{display:none!important}
      `
      document.head.appendChild(style)
    }

    function BrandMark() {
      return React.createElement('img', {
        className: 'zhishuBrandMark',
        src: MARK_URL,
        alt: '',
        'aria-hidden': 'true',
      })
    }

    function BrandName() {
      return React.createElement('img', {
        className: 'zhishuBrandLockup',
        src: LOCKUP_URL,
        alt: '智枢',
      })
    }

    function HeroBrandMark() {
      const state = React.useState(HERO_MARK_URL)
      const src = state[0]
      const setSrc = state[1]
      return React.createElement(
        'span',
        { className: 'zhishuHeroBrand' },
        React.createElement('img', {
          className: 'zhishuHeroBrandMark',
          src: src,
          alt: '',
          'aria-hidden': 'true',
          onMouseEnter: function () { setSrc(HERO_LOOP_URL + '?play=' + Date.now()) },
          onMouseLeave: function () { setSrc(HERO_MARK_URL) },
        }),
        React.createElement('span', { className: 'zhishuHeroBrandDot', 'aria-hidden': 'true' }),
      )
    }

    const inject = ['slots']
    function apply(ctx) {
      installStyles()
      ctx.slots.inject('sidebar.brand.mark', () =>
        ctx.slots.inject('sidebar.brand.name', () =>
          ctx.slots.inject('conversation.hero.brand.mark', function* () {
            yield ctx.slots.register({ name: 'sidebar.brand.mark' }, BrandMark)
            yield ctx.slots.register({ name: 'sidebar.brand.name' }, BrandName)
            yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, HeroBrandMark)
          })))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})

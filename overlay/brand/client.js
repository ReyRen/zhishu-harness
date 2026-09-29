window.__ModuleLoader__.load({
  id: '@zhishu/dsh-overlay-brand',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const LOCKUP_URL = '/overlay/zhishu-brand/logo.png'
    const MARK_URL = '/overlay/zhishu-brand/logo-mark.png'
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

    const inject = ['slots']
    function apply(ctx) {
      installStyles()
      ctx.slots.inject('sidebar.brand.mark', () =>
        ctx.slots.inject('sidebar.brand.name', function* () {
          yield ctx.slots.register({ name: 'sidebar.brand.mark' }, BrandMark)
          yield ctx.slots.register({ name: 'sidebar.brand.name' }, BrandName)
        }))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})

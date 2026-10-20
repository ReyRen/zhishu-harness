window.__ModuleLoader__.load({
  id: '@zhishu/dsh-overlay-hide-product-onboarding',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    function SkipWelcome(props) {
      const done = React.useRef(false)
      React.useEffect(() => {
        if (done.current) return
        done.current = true
        props.complete()
      }, [props.complete])
      return null
    }

    const inject = ['slots']
    function apply(ctx) {
      ctx.slots.inject('settings.onboarding', function* () {
        yield ctx.slots.register({
          name: 'settings.onboarding',
          id: 'welcome-notice',
          priority: -1,
          order: -100,
        }, SkipWelcome)
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})

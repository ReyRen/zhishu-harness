window.__ModuleLoader__.load({
  id: '@zhishu/dsh-overlay-platform-account',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const STYLE_ID = 'zhishu-overlay-platform-account-style'

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.dataset.plugin = '@zhishu/dsh-overlay-platform-account'
      style.textContent = `
        .zhishuAccount{position:relative;display:flex;min-width:0}
        .zhishuAccountTrigger{display:flex;align-items:center;gap:8px;width:100%;min-width:0;
          height:36px;padding:0 8px;border:0;border-radius:8px;background:transparent;
          color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;text-align:left}
        .zhishuAccountTrigger:hover,.zhishuAccountTrigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}
        .zhishuAccountTrigger[data-collapsed=true]{width:36px;padding:0;justify-content:center}
        .zhishuAccountAvatar{display:inline-flex;align-items:center;justify-content:center;flex:none;
          width:24px;height:24px;border-radius:50%;background:#4c6fff;color:#fff;font-size:12px;font-weight:600}
        .zhishuAccountLabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .zhishuAccountMenu{position:fixed;z-index:1200;min-width:180px;padding:6px;border-radius:10px;
          background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-label-primary);
          box-shadow:0 8px 24px rgba(0,0,0,.16);border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08))}
        .zhishuAccountItem{display:flex;align-items:center;justify-content:space-between;gap:12px;
          width:100%;height:32px;padding:0 8px;border:0;border-radius:6px;background:transparent;
          color:inherit;font:inherit;font-size:13px;cursor:pointer;text-align:left}
        .zhishuAccountItem:hover{background:var(--dsw-alias-interactive-bg-hover)}
        .zhishuAccountShortcut{color:var(--dsw-alias-label-tertiary);font-size:12px}
      `
      document.head.appendChild(style)
    }

    function labelOf(account) {
      if (!account) return '账号'
      return account.userAccount || account.userName || '账号'
    }

    function initialOf(account) {
      const label = labelOf(account)
      return (label[0] || '账').toUpperCase()
    }

    function AccountLauncher(props) {
      const openState = React.useState(false)
      const open = openState[0]
      const setOpen = openState[1]
      const accountState = React.useState(null)
      const account = accountState[0]
      const setAccount = accountState[1]
      const buttonRef = React.useRef(null)
      const menuRef = React.useRef(null)
      const placeState = React.useState(null)
      const place = placeState[0]
      const setPlace = placeState[1]
      const wide = props.wide !== false
      const shortcut = props.settingsShortcut && typeof props.settingsShortcut.aria === 'string'
        ? props.settingsShortcut.aria
        : ''

      React.useEffect(function () {
        const api = window.zhishuPlatform
        if (!api) return undefined
        let alive = true
        const unsubscribe = api.onAccount(function (value) { if (alive) setAccount(value) })
        api.account().then(function (value) { if (alive) setAccount(value) }).catch(function () {})
        return function () {
          alive = false
          unsubscribe()
        }
      }, [])

      React.useEffect(function () {
        if (!open) return undefined
        const close = function (event) {
          const target = event.target
          if (buttonRef.current && buttonRef.current.contains(target)) return
          if (menuRef.current && menuRef.current.contains(target)) return
          setOpen(false)
        }
        const onKey = function (event) {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', close, true)
        document.addEventListener('keydown', onKey)
        return function () {
          document.removeEventListener('pointerdown', close, true)
          document.removeEventListener('keydown', onKey)
        }
      }, [open])

      const toggle = function () {
        const button = buttonRef.current
        if (button) {
          const rect = button.getBoundingClientRect()
          setPlace({ left: rect.left, bottom: window.innerHeight - rect.top + 6, width: Math.max(180, rect.width) })
        }
        setOpen(function (value) { return !value })
      }

      const chooseSettings = function () {
        setOpen(false)
        if (typeof props.openSettings === 'function') props.openSettings()
      }

      const chooseLogout = function () {
        setOpen(false)
        const api = window.zhishuPlatform
        if (api) api.logout().catch(function () {})
      }

      return React.createElement(
        'div',
        { className: 'zhishuAccount' },
        React.createElement(
          'button',
          {
            ref: buttonRef,
            type: 'button',
            className: 'zhishuAccountTrigger',
            'data-collapsed': wide ? 'false' : 'true',
            'aria-haspopup': 'menu',
            'aria-expanded': open,
            'aria-label': labelOf(account),
            onClick: toggle,
          },
          React.createElement('span', { className: 'zhishuAccountAvatar', 'aria-hidden': 'true' }, initialOf(account)),
          wide ? React.createElement('span', { className: 'zhishuAccountLabel' }, labelOf(account)) : null,
        ),
        open && place ? React.createElement(
          'div',
          {
            ref: menuRef,
            className: 'zhishuAccountMenu',
            role: 'menu',
            style: { left: place.left + 'px', bottom: place.bottom + 'px', minWidth: place.width + 'px' },
          },
          React.createElement(
            'button',
            { type: 'button', className: 'zhishuAccountItem', role: 'menuitem', onClick: chooseSettings },
            React.createElement('span', null, '设置'),
            shortcut ? React.createElement('span', { className: 'zhishuAccountShortcut' }, shortcut) : null,
          ),
          React.createElement(
            'button',
            { type: 'button', className: 'zhishuAccountItem', role: 'menuitem', onClick: chooseLogout },
            React.createElement('span', null, '退出登录'),
          ),
        ) : null,
      )
    }

    const inject = ['slots']
    function apply(ctx) {
      installStyles()
      ctx.slots.inject('settings.launcher', function* () {
        yield ctx.slots.register({ name: 'settings.launcher' }, AccountLauncher)
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})

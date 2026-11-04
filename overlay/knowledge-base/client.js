window.__ModuleLoader__.load({
  id: '@zhishu/dsh-overlay-knowledge-base',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    const IFRAME_URL = 'http://172.18.36.230:5175/weknora/sso/platform'
    const SSO_CLIENT_ID = 'gcs-webnora'
    const READY_TYPE = 'weknora:sso-ready'
    const TOKEN_TYPE = 'weknora:sso-token'
    const WORKBENCH_ID = 'local:@zhishu/dsh-overlay-knowledge-base'
    const STYLE_ID = 'zhishu-overlay-knowledge-base-style'
    const PANEL_ORDER = 10

    function iframeOrigin() {
      try { return new URL(IFRAME_URL).origin } catch { return '' }
    }

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.dataset.plugin = '@zhishu/dsh-overlay-knowledge-base'
      style.textContent = `
        .zhishuKb{display:flex;flex:1;min-width:0;min-height:0;height:100%;flex-direction:column;background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-label-primary)}
        .zhishuKbToolbar{display:flex;align-items:center;gap:8px;flex:none;min-height:40px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08))}
        .zhishuKbToolbarTitle{flex:1;min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .zhishuKbToolbarBtn{height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.12));border-radius:6px;background:var(--dsw-alias-bg-primary,#fff);color:inherit;font:inherit;font-size:12px;cursor:pointer}
        .zhishuKbToolbarBtn[data-primary=true]{border-color:transparent;background:var(--dsw-alias-interactive-bg-primary,#2f6bff);color:#fff}
        .zhishuKbToolbarBtn:disabled{opacity:.55;cursor:default}
        .zhishuKbBody{display:flex;flex:1;min-width:0;min-height:0}
        .zhishuKbFrame{flex:1;min-width:0;min-height:0;border:0;background:#fff}
        .zhishuKbChat{display:flex;flex-direction:column;flex:none;width:min(42%,420px);min-width:280px;min-height:0;border-left:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08));background:var(--dsw-alias-bg-primary,#fff)}
        .zhishuKbChatHead{display:flex;align-items:center;gap:8px;flex:none;min-height:36px;padding:0 10px;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08));font-size:12px;font-weight:600}
        .zhishuKbChatBody{display:flex;flex:1;min-width:0;min-height:0;flex-direction:column}
        .zhishuKbStatus{padding:10px 12px;font-size:12px;color:var(--dsw-alias-label-secondary)}
        .zhishuKbStatus[data-error=true]{color:#b42318}
      `
      document.head.appendChild(style)
    }

    function KnowledgeIcon(props) {
      const size = props.size || 18
      const stroke = props.active ? 'currentColor' : 'currentColor'
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        'aria-hidden': 'true',
      }, h('path', {
        d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H12v18H6.5A2.5 2.5 0 0 1 4 18.5v-13Zm8-2.5h5.5A2.5 2.5 0 0 1 20 5.5v13a2.5 2.5 0 0 1-2.5 2.5H12V3Z',
        stroke,
        strokeWidth: 1.6,
        strokeLinejoin: 'round',
      }))
    }

    async function fetchSsoTicket() {
      const api = window.zhishuPlatform
      if (!api || typeof api.getSsoToken !== 'function') {
        throw new Error('当前环境无法领取平台登录票据。请在智枢桌面端登录后使用知识库。')
      }
      // Renderer only invokes IPC. Main mints the ticket inside the signed-in
      // model BrowserView (page fetch), so it will not show in Network panels.
      console.info('[knowledge-base sso] invoke zhishuPlatform.getSsoToken', { clientId: SSO_CLIENT_ID })
      const ticket = await api.getSsoToken(SSO_CLIENT_ID)
      const access = typeof ticket?.access_token === 'string' ? ticket.access_token.trim() : ''
      console.info('[knowledge-base sso] getSsoToken ipc result', {
        hasAccessToken: !!access,
        hasRefreshToken: typeof ticket?.refresh_token === 'string',
        user_id: ticket?.user_id,
      })
      if (!access) throw new Error('领取登录票据失败。')
      return {
        access_token: access,
        refresh_token: typeof ticket?.refresh_token === 'string' ? ticket.refresh_token : undefined,
        user_id: ticket?.user_id != null ? String(ticket.user_id) : undefined,
      }
    }

    function KnowledgeWorkbench(props) {
      const service = props.service
      const active = props.active === true
      const conversation = props.conversation
      const frameRef = React.useRef(null)
      const nonceRef = React.useRef('')
      const [signedIn, setSignedIn] = React.useState(false)
      const [chatOpen, setChatOpen] = React.useState(false)
      const [asking, setAsking] = React.useState(false)
      const [status, setStatus] = React.useState('')
      const [error, setError] = React.useState('')

      React.useLayoutEffect(installStyles, [])

      React.useEffect(() => {
        const space = window.dshModelSpace
        if (!space || typeof space.state !== 'function') {
          setSignedIn(true)
          return undefined
        }
        let alive = true
        const apply = (state) => {
          if (alive) setSignedIn(state?.authenticated === true)
        }
        space.state().then(apply).catch(() => { if (alive) setSignedIn(false) })
        const unsubscribe = typeof space.onStateChanged === 'function'
          ? space.onStateChanged(apply)
          : undefined
        return () => {
          alive = false
          unsubscribe?.()
        }
      }, [])

      React.useEffect(() => {
        if (!active) {
          setChatOpen(false)
          setAsking(false)
          setStatus('')
          setError('')
          nonceRef.current = ''
        }
      }, [active])

      React.useEffect(() => {
        if (!active || !signedIn) return undefined
        const allowed = iframeOrigin()
        const mask = (token) => (typeof token === 'string' && token ? `${token.slice(0, 8)}…(${token.length})` : token)
        const onMessage = (event) => {
          console.info('[knowledge-base sso] parent received message', {
            origin: event.origin,
            expectedOrigin: allowed,
            parentOrigin: location.origin,
            data: event.data,
          })
          if (allowed && event.origin !== allowed) {
            console.warn('[knowledge-base sso] ignored: origin mismatch', event.origin, '!==', allowed)
            return
          }
          const frame = frameRef.current
          if (!frame || event.source !== frame.contentWindow) {
            console.warn('[knowledge-base sso] ignored: source is not the knowledge-base iframe')
            return
          }
          const data = event.data
          if (!data || typeof data !== 'object' || Array.isArray(data)) return
          if (data.type !== READY_TYPE) {
            console.info('[knowledge-base sso] ignored: type is not', READY_TYPE)
            return
          }
          if (typeof data.nonce !== 'string' || data.nonce === '') {
            console.warn('[knowledge-base sso] ignored: missing nonce')
            return
          }
          if (typeof data.client_id === 'string' && data.client_id !== '' && data.client_id !== SSO_CLIENT_ID) {
            console.warn('[knowledge-base sso] ignored: client_id mismatch', data.client_id, '!==', SSO_CLIENT_ID)
            return
          }
          nonceRef.current = data.nonce
          setStatus('正在领取登录票据…')
          setError('')
          console.info('[knowledge-base sso] ready accepted, fetching platform token', { nonce: data.nonce, clientId: SSO_CLIENT_ID })
          void fetchSsoTicket().then((ticket) => {
            if (nonceRef.current !== data.nonce || !frameRef.current) return
            const message = {
              type: TOKEN_TYPE,
              nonce: data.nonce,
              access_token: ticket.access_token,
            }
            if (ticket.refresh_token) message.refresh_token = ticket.refresh_token
            if (ticket.user_id) message.user_id = ticket.user_id
            const target = allowed || '*'
            console.info('[knowledge-base sso] posting token to iframe', {
              targetOrigin: target,
              type: message.type,
              nonce: message.nonce,
              access_token: mask(message.access_token),
              hasRefreshToken: !!message.refresh_token,
              user_id: message.user_id,
            })
            frameRef.current.contentWindow?.postMessage(message, target)
            setStatus('')
          }).catch((err) => {
            if (nonceRef.current !== data.nonce) return
            console.error('[knowledge-base sso] fetch token failed', err)
            setStatus('')
            setError(err instanceof Error ? err.message : String(err))
          })
        }
        window.addEventListener('message', onMessage)
        console.info('[knowledge-base sso] parent listening', {
          allowedIframeOrigin: allowed,
          parentOrigin: location.origin,
          signedIn: true,
        })
        return () => window.removeEventListener('message', onMessage)
      }, [active, signedIn])

      const askAi = () => {
        if (!service || asking) return
        setChatOpen(true)
        setAsking(true)
        setError('')
        const current = typeof service.currentSession === 'function' ? service.currentSession() : null
        const owned = current && typeof service.ownsSession === 'function' ? service.ownsSession(current) : false
        void (async () => {
          try {
            if (!owned) await service.newSession()
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
          } finally {
            setAsking(false)
          }
        })()
      }

      const closeChat = () => setChatOpen(false)
      const showChat = chatOpen
      const frameReady = active && signedIn
      const gateHint = active && !signedIn ? '请先登录平台，登录后将自动加载知识库。' : ''

      return h(
        'div',
        { className: 'zhishuKb', 'data-dsh-workbench-toolbar': '', hidden: !active },
        h(
          'div',
          { className: 'zhishuKbToolbar' },
          h('div', { className: 'zhishuKbToolbarTitle' }, '知识库'),
          showChat
            ? h('button', { type: 'button', className: 'zhishuKbToolbarBtn', onClick: closeChat }, '收起会话')
            : h('button', {
              type: 'button',
              className: 'zhishuKbToolbarBtn',
              'data-primary': 'true',
              disabled: asking || !signedIn,
              onClick: askAi,
            }, asking ? '准备会话…' : '问 AI'),
        ),
        (status || error || gateHint) ? h('div', {
          className: 'zhishuKbStatus',
          'data-error': error ? 'true' : 'false',
        }, error || status || gateHint) : null,
        h(
          'div',
          { className: 'zhishuKbBody' },
          h('iframe', {
            ref: frameRef,
            className: 'zhishuKbFrame',
            title: '知识库',
            src: frameReady ? IFRAME_URL : 'about:blank',
            allow: 'clipboard-read; clipboard-write',
          }),
          showChat ? h(
            'aside',
            { className: 'zhishuKbChat', 'aria-label': '知识库会话' },
            h('div', { className: 'zhishuKbChatHead' }, 'AI 会话'),
            h('div', { className: 'zhishuKbChatBody' }, conversation || h('div', { className: 'zhishuKbStatus' }, '正在关联会话…')),
          ) : null,
        ),
      )
    }

    const inject = ['slots', 'desktopWorkbenches', 'sidebarSoftPanels']
    function apply(ctx) {
      installStyles()

      const disposeRegister = ctx.desktopWorkbenches.register({
        title: '知识库',
        titleEn: 'Knowledge Base',
        description: '接入 WeKnora 知识库，需要时再打开 AI 会话。',
        descriptionEn: 'Embed the WeKnora knowledge base and open an AI session when needed.',
        category: '知识',
        customFrame: true,
        headerLayout: 'compact',
      }, KnowledgeWorkbench)

      const disposeOpener = ctx.sidebarSoftPanels.registerOpener(WORKBENCH_ID, () => {
        ctx.desktopWorkbenches.run(ctx.desktopWorkbenches.open(WORKBENCH_ID))
      })

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: WORKBENCH_ID,
        order: PANEL_ORDER,
        label: '知识库',
      }, KnowledgeIcon))

      ctx.effect(() => () => {
        disposeOpener?.()
        disposeRegister?.()
      }, 'knowledge-base: unregister workbench')
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})

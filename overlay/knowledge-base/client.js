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
    // Container harness sits in a model iframe and has no zhishuPlatform IPC.
    // Ask the embedding model page to mint the same client id over postMessage.
    const HOST_SSO_REQUEST = 'zhishu:sso-request'
    const HOST_SSO_RESPONSE = 'zhishu:sso-response'
    const HOST_SSO_TIMEOUT_MS = 30_000
    const WORKBENCH_ID = 'local:@zhishu/dsh-overlay-knowledge-base'
    const STYLE_ID = 'zhishu-overlay-knowledge-base-style'
    const PANEL_ORDER = 10
    // Two postMessage hops — filter console by these tags:
    //   hop1 = model page ↔ harness (zhishu:sso-*)
    //   hop2 = harness ↔ weknora iframe (weknora:sso-*)
    //   hop0 = desktop IPC (zhishuPlatform.getSsoToken), no model postMessage
    const LOG_HOP0 = '[SSO hop0 desktop-ipc]'
    const LOG_HOP1 = '[SSO hop1 model↔harness]'
    const LOG_HOP2 = '[SSO hop2 harness↔weknora]'

    function iframeOrigin() {
      try { return new URL(IFRAME_URL).origin } catch { return '' }
    }

    function newNonce() {
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    }

    function maskToken(token) {
      return typeof token === 'string' && token ? '[redacted]' : undefined
    }

    function readTicket(ticket) {
      const access = typeof ticket?.access_token === 'string' ? ticket.access_token.trim() : ''
      if (!access) throw new Error('领取登录票据失败。')
      return {
        access_token: access,
        refresh_token: typeof ticket?.refresh_token === 'string' ? ticket.refresh_token : undefined,
        user_id: ticket?.user_id != null ? String(ticket.user_id) : undefined,
      }
    }

    /** Desktop conversation page: Electron IPC into the signed-in model view. */
    async function fetchSsoTicketFromDesktop() {
      const api = window.zhishuPlatform
      console.info(`${LOG_HOP0} harness → desktop IPC getSsoToken`, { clientId: SSO_CLIENT_ID })
      const ticket = await api.getSsoToken(SSO_CLIENT_ID)
      console.info(`${LOG_HOP0} desktop IPC ← ticket`, {
        hasAccessToken: typeof ticket?.access_token === 'string' && !!ticket.access_token.trim(),
        access_token: maskToken(ticket?.access_token),
        hasRefreshToken: typeof ticket?.refresh_token === 'string',
        user_id: ticket?.user_id,
      })
      return readTicket(ticket)
    }

    /**
     * Container / private web: postMessage the embedding model page.
     * Message types differ from weknora:sso-* (separate hop, separate origin).
     */
    function fetchSsoTicketFromHost(signal) {
      return new Promise((resolve, reject) => {
        if (window.parent === window) {
          reject(new Error('当前环境无法领取平台登录票据。请在智枢桌面端或平台 Harness 页使用知识库。'))
          return
        }
        const nonce = newNonce()
        const timer = window.setTimeout(() => {
          signal?.removeEventListener('abort', onAbort)
          window.removeEventListener('message', onMessage)
          console.error(`${LOG_HOP1} harness ⏱ waiting model response timed out`, {
            direction: 'harness → model (no reply)',
            type: HOST_SSO_REQUEST,
            nonce,
            clientId: SSO_CLIENT_ID,
            harnessOrigin: location.origin,
          })
          reject(new Error('向平台宿主领取登录票据超时。'))
        }, HOST_SSO_TIMEOUT_MS)
        const onAbort = () => {
          window.clearTimeout(timer)
          window.removeEventListener('message', onMessage)
          reject(new Error('Knowledge authentication cancelled'))
        }
        const onMessage = (event) => {
          if (event.source !== window.parent) return
          const data = event.data
          if (!data || typeof data !== 'object' || Array.isArray(data)) return
          if (data.type !== HOST_SSO_RESPONSE) return
          if (data.nonce !== nonce) {
            console.warn(`${LOG_HOP1} harness ← model ignored (nonce mismatch)`, {
              direction: 'model → harness',
              expected: nonce,
              got: data.nonce,
            })
            return
          }
          window.clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          window.removeEventListener('message', onMessage)
          console.info(`${LOG_HOP1} harness ← model ${HOST_SSO_RESPONSE}`, {
            direction: 'model → harness',
            origin: event.origin,
            nonce: data.nonce,
            error: data.error,
            hasAccessToken: typeof data.access_token === 'string' && !!data.access_token.trim(),
            access_token: maskToken(data.access_token),
            user_id: data.user_id,
          })
          if (typeof data.error === 'string' && data.error !== '') {
            reject(new Error(data.error))
            return
          }
          try {
            resolve(readTicket(data))
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)))
          }
        }
        window.addEventListener('message', onMessage)
        signal?.addEventListener('abort', onAbort, { once: true })
        if (signal?.aborted) { onAbort(); return }
        console.info(`${LOG_HOP1} harness → model ${HOST_SSO_REQUEST}`, {
          direction: 'harness → model',
          type: HOST_SSO_REQUEST,
          clientId: SSO_CLIENT_ID,
          nonce,
          harnessOrigin: location.origin,
          targetOrigin: '*',
          parentIsTop: window.parent === window.top,
        })
        window.parent.postMessage({
          type: HOST_SSO_REQUEST,
          nonce,
          client_id: SSO_CLIENT_ID,
        }, '*')
      })
    }

    async function fetchSsoTicket(signal) {
      const api = window.zhishuPlatform
      if (api && typeof api.getSsoToken === 'function') return fetchSsoTicketFromDesktop()
      return fetchSsoTicketFromHost(signal)
    }

    /** Authenticate tools even when the knowledge-base workbench is closed. */
    function installToolAuthentication(ctx) {
      ctx.effect(() => {
        const lifetime = new AbortController()
        const endpoint = '/api/zhishu-knowledge/auth'
        let pending, signedIn = true, revision = 0
        const request = (init = {}) => fetch(endpoint, { credentials: 'same-origin', cache: 'no-store',
          ...init, signal: lifetime.signal })
        const sync = () => {
          if (pending || !signedIn || lifetime.signal.aborted) return pending
          const current = revision
          pending = (async () => {
            const status = await request()
            // A profile-owned upstream bundle keeps its own configured authentication.
            if (status.status === 404) return
            if (!status.ok) throw new Error('knowledge_auth_status_failed')
            const state = await status.json()
            if (state.mode !== 'sso' || state.authenticated) return
            const ticket = await fetchSsoTicket(lifetime.signal)
            if (revision !== current || lifetime.signal.aborted) return
            const response = await request({ method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify(ticket) })
            if (!response.ok) throw new Error('knowledge_auth_handoff_failed')
          })().catch(() => {
            if (!lifetime.signal.aborted && signedIn) console.warn('[Knowledge tools] Authentication unavailable; reopen the platform session and retry.')
          }).finally(() => { pending = undefined })
          return pending
        }
        const accountChanged = state => {
          signedIn = state?.authenticated === true
          revision++
          if (signedIn) { void sync(); return }
          void Promise.resolve(pending).then(() => request({ method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'logout' }) })).catch(() => {
            if (!lifetime.signal.aborted) console.warn('[Knowledge tools] Could not clear authentication; close the runtime before switching accounts.')
          })
        }
        const space = window.dshModelSpace
        const unsubscribe = space?.onStateChanged?.(accountChanged)
        if (typeof space?.state === 'function') {
          void space.state().then(accountChanged).catch(() => accountChanged({ authenticated: false }))
        } else void sync()
        const timer = window.setInterval(sync, 30_000)
        const stopReset = ctx.on('connection/reset', sync)
        return () => { revision++; lifetime.abort(); window.clearInterval(timer); unsubscribe?.(); stopReset?.() }
      }, 'knowledge-base: tool authentication')
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
        const onMessage = (event) => {
          const frame = frameRef.current
          const fromWeknora = !!(frame && event.source === frame.contentWindow)
          const data = event.data
          const dataType = data && typeof data === 'object' && !Array.isArray(data) ? data.type : undefined

          // hop1 replies from model arrive on the same window; do not treat as weknora.
          if (!fromWeknora) {
            if (dataType === HOST_SSO_RESPONSE || dataType === HOST_SSO_REQUEST) return
            return
          }

          console.info(`${LOG_HOP2} harness ← weknora message`, {
            direction: 'weknora → harness',
            origin: event.origin,
            expectedOrigin: allowed,
            harnessOrigin: location.origin,
            type: dataType,
            data,
          })
          if (allowed && event.origin !== allowed) {
            console.warn(`${LOG_HOP2} harness ← weknora ignored (origin mismatch)`, {
              direction: 'weknora → harness',
              origin: event.origin,
              expectedOrigin: allowed,
            })
            return
          }
          if (!data || typeof data !== 'object' || Array.isArray(data)) return
          if (data.type !== READY_TYPE) {
            console.info(`${LOG_HOP2} harness ← weknora ignored (not ${READY_TYPE})`, {
              direction: 'weknora → harness',
              type: data.type,
            })
            return
          }
          if (typeof data.nonce !== 'string' || data.nonce === '') {
            console.warn(`${LOG_HOP2} harness ← weknora ignored (missing nonce)`)
            return
          }
          if (typeof data.client_id === 'string' && data.client_id !== '' && data.client_id !== SSO_CLIENT_ID) {
            console.warn(`${LOG_HOP2} harness ← weknora ignored (client_id mismatch)`, {
              got: data.client_id,
              expected: SSO_CLIENT_ID,
            })
            return
          }
          nonceRef.current = data.nonce
          setStatus('正在领取登录票据…')
          setError('')
          console.info(`${LOG_HOP2} harness ← weknora ${READY_TYPE} accepted; will mint ticket then reply`, {
            direction: 'weknora → harness',
            nonce: data.nonce,
            clientId: SSO_CLIENT_ID,
          })
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
            console.info(`${LOG_HOP2} harness → weknora ${TOKEN_TYPE}`, {
              direction: 'harness → weknora',
              targetOrigin: target,
              type: message.type,
              nonce: message.nonce,
              access_token: maskToken(message.access_token),
              hasRefreshToken: !!message.refresh_token,
              user_id: message.user_id,
            })
            frameRef.current.contentWindow?.postMessage(message, target)
            setStatus('')
          }).catch((err) => {
            if (nonceRef.current !== data.nonce) return
            console.error(`${LOG_HOP2} mint/relay ticket failed (after weknora ready)`, err)
            setStatus('')
            setError(err instanceof Error ? err.message : String(err))
          })
        }
        window.addEventListener('message', onMessage)
        console.info(`${LOG_HOP2} harness listening for weknora`, {
          direction: 'weknora → harness (listener on)',
          allowedIframeOrigin: allowed,
          harnessOrigin: location.origin,
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
      installToolAuthentication(ctx)

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

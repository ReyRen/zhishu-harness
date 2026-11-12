window.__ModuleLoader__.load({
  id: '@zhishu/dsh-overlay-knowledge-base',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { IconChevronDownOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')
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
    /** Main panel id (same pattern as plugins / schedules). */
    const PANEL_ID = 'zhishu-knowledge'
    /** Legacy workbench / companion id — cleaned up on load if still present. */
    const LEGACY_WORKBENCH_ID = 'local:@zhishu/dsh-overlay-knowledge-base'
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

    /**
     * Hand gcs-webnora tickets to a Host auth endpoint (knowledge tools or
     * unified platform models). Returns ensureAuthenticated for the picker and
     * sync for background / models-refresh callers.
     */
    function installToolAuthentication(ctx, endpoint = '/api/zhishu-knowledge/auth') {
      let ensureAuthenticated = async () => {
        throw new Error('Knowledge authentication is not ready')
      }
      let syncNow = () => Promise.resolve()
      ctx.effect(() => {
        const lifetime = new AbortController()
        let pending, signedIn = true, revision = 0
        const request = (init = {}, signal) => {
          const signals = [lifetime.signal]
          if (signal && signal !== lifetime.signal) signals.push(signal)
          return fetch(endpoint, {
            credentials: 'same-origin', cache: 'no-store', ...init,
            signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals),
          })
        }
        const authenticate = async (signal, current) => {
          const status = await request({}, signal)
          // A profile-owned upstream bundle keeps its own configured authentication.
          if (status.status === 404) return
          if (!status.ok) throw new Error(`knowledge_auth_status_failed (${status.status})`)
          const state = await status.json()
          if (state.mode !== 'sso' || state.authenticated) return
          const ticket = await fetchSsoTicket(signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal)
          if (revision !== current || !signedIn || lifetime.signal.aborted || signal?.aborted) {
            throw new Error('Knowledge authentication cancelled')
          }
          const response = await request({
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(ticket),
          }, signal)
          if (!response.ok) {
            let detail = ''
            try { detail = await response.text() } catch { /* ignore */ }
            throw new Error(`knowledge_auth_handoff_failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`)
          }
        }
        ensureAuthenticated = async (signal) => {
          if (!signedIn) throw new Error('Platform session is not signed in')
          if (lifetime.signal.aborted) throw new Error('Knowledge authentication cancelled')
          if (pending) return pending
          const current = revision
          pending = (async () => {
            await authenticate(signal, current)
            if (revision !== current) throw new Error('Knowledge authentication superseded')
          })().finally(() => { pending = undefined })
          return pending
        }
        const sync = () => {
          if (!signedIn || lifetime.signal.aborted) return pending
          return ensureAuthenticated(lifetime.signal).catch((err) => {
            if (!lifetime.signal.aborted && signedIn) {
              console.warn('[Knowledge tools] Authentication unavailable; reopen the platform session and retry.', err)
            }
          })
        }
        const accountChanged = state => {
          signedIn = state?.authenticated === true
          revision++
          if (signedIn) { void sync(); return }
          // Clear Host credentials even when the superseded handoff rejects.
          const clear = () => request({ method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'logout' }) })
          void Promise.resolve(pending).then(clear, clear).catch(() => {
            if (!lifetime.signal.aborted) console.warn('[Knowledge tools] Could not clear authentication; close the runtime before switching accounts.')
          })
        }
        syncNow = sync
        const space = window.dshModelSpace
        const unsubscribe = space?.onStateChanged?.(accountChanged)
        if (typeof space?.state === 'function') {
          void space.state().then(accountChanged).catch(() => accountChanged({ authenticated: false }))
        } else void sync()
        const timer = window.setInterval(sync, 30_000)
        const stopReset = ctx.on('connection/reset', sync)
        return () => { revision++; lifetime.abort(); window.clearInterval(timer); unsubscribe?.(); stopReset?.() }
      }, endpoint.includes('zhishu-models')
        ? 'knowledge-base: models authentication'
        : 'knowledge-base: tool authentication')
      return {
        ensureAuthenticated: (signal) => ensureAuthenticated(signal),
        sync: () => syncNow(),
      }
    }

    function installKnowledgePicker(ctx, auth) {
      const namespace = 'zhishu.knowledge-selection'
      const dictionaries = {
        zh: { title: '知识库', placeholder: '搜索可用知识库',
          empty: '暂无可用知识库', noResults: '没有匹配的知识库', selected: '知识库：', multiple: '知识库 · 已选 {count} 个',
          unavailable: '知识库暂不可用，请重新打开平台会话后重试', failed: '切换知识库失败，请重试',
          revoked: '不可用，请取消选择', changed: '会话的知识库选择已更改，请重新打开选择器' },
        en: { title: 'Knowledge bases', placeholder: 'Search available knowledge bases',
          empty: 'No knowledge bases available', noResults: 'No matching knowledge bases', selected: 'Knowledge: ', multiple: 'Knowledge · {count} selected',
          unavailable: 'Knowledge unavailable. Reopen the platform session and retry.', failed: 'Could not change knowledge. Retry.',
          revoked: 'Unavailable; uncheck to continue', changed: 'Knowledge selection changed. Reopen the picker.' },
      }
      ctx.effect(() => ctx.locale.register(namespace, dictionaries), 'knowledge: picker dictionaries')
      const t = ctx.locale.bind(namespace)
      const live = sessionID => ctx.sessions.binding(sessionID)?.session
      const stateOf = sessionID => live(sessionID)?.projections.faceOf('zhishuKnowledge').getSnapshot()
      const request = async (path, signal) => {
        const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal })
        if (!response.ok) {
          const error = new Error(t('unavailable'))
          error.status = response.status
          throw error
        }
        return response.json()
      }
      const catalog = async signal => {
        // Catalog talks to WeKnora through Host SSO credentials; wait for handoff first.
        try {
          await auth.ensureAuthenticated(signal)
        } catch (err) {
          signal?.throwIfAborted()
          console.warn('[Knowledge picker] ensureAuthenticated failed before catalog', err)
          throw new Error(t('unavailable'))
        }
        try {
          const result = await request('/api/zhishu-knowledge/catalog', signal)
          if (!Array.isArray(result?.knowledgeBases) || result.knowledgeBases.some(base =>
            typeof base?.id !== 'string' || typeof base.name !== 'string')) throw new Error(t('unavailable'))
          return result
        } catch (err) {
          // One retry after a forced re-auth if Host still had no credentials.
          if (err?.status !== 401) throw err
          try {
            await auth.ensureAuthenticated(signal)
            const result = await request('/api/zhishu-knowledge/catalog', signal)
            if (!Array.isArray(result?.knowledgeBases) || result.knowledgeBases.some(base =>
              typeof base?.id !== 'string' || typeof base.name !== 'string')) throw new Error(t('unavailable'))
            return result
          } catch (retryErr) {
            signal?.throwIfAborted()
            console.warn('[Knowledge picker] catalog failed after auth retry', retryErr)
            throw new Error(t('unavailable'))
          }
        }
      }
      const selectedOf = sessionID => stateOf(sessionID)?.knowledgeBaseIds || []
      const select = async (sessionID, ids) => {
        const session = live(sessionID)
        if (!session) throw new Error(t('failed'))
        const names = [...new Set(ids)].sort().join(' ') || 'off'
        const result = await ctx.remote.commands.execute(sessionID, `/knowledge ${names}`, [])
        if (!result.ok || result.value?.result.kind !== 'success') throw new Error(t('failed'))
      }
      const openedSelections = new WeakMap()
      const changeSelection = async (session, ids) => {
        if (JSON.stringify(selectedOf(session.sessionId)) !== JSON.stringify(openedSelections.get(session))) throw new Error(t('changed'))
        await select(session.sessionId, ids)
        openedSelections.set(session, ids)
      }
      ctx.effect(() => ctx.commandUi.decorate({
        name: 'knowledge',
        label: () => t('title'), hideAlias: true,
        available: session => stateOf(session.sessionId) !== undefined,
        ui: {
          kind: 'popupSelect', multiple: true,
          searchLabels: () => ({ placeholder: t('placeholder'), empty: t('empty'), noResults: t('noResults') }),
          async options(session, signal) {
            const result = await catalog(signal)
            const ids = selectedOf(session.sessionId)
            openedSelections.set(session, ids)
            return [...result.knowledgeBases.map(base => ({ id: base.id, label: base.name, active: ids.includes(base.id) })),
              ...ids.filter(id => !result.knowledgeBases.some(base => base.id === id))
                .map(id => ({ id, label: id + ' · ' + t('revoked'), active: true }))]
          },
          async onSelect(_option, session, selection) {
            const ids = selection.map(option => option.id).sort()
            await changeSelection(session, ids)
          },
          onClear: session => changeSelection(session, []),
        },
      }), 'knowledge: native multi-select popup')
      ctx.effect(() => () => ctx.commandUi.dismiss('knowledge'), 'knowledge: close picker on unload')

      function KnowledgeSelection({ useProjection, sessionID, open, loadCatalog, t }) {
        const selection = useProjection('zhishuKnowledge')
        const ids = selection?.knowledgeBaseIds || []
        const key = ids.length === 1 ? ids[0] : ''
        const [labels, setLabels] = React.useState({})
        const [error, setError] = React.useState('')
        const [busy, setBusy] = React.useState(false)
        const lifetime = React.useRef(null)
        React.useEffect(() => {
          const controller = new AbortController()
          lifetime.current = controller; setBusy(false); setError('')
          return () => controller.abort()
        }, [sessionID])
        React.useEffect(() => {
          setError(''); setLabels({})
          if (!key) return
          const controller = new AbortController()
          void loadCatalog(controller.signal).then(result => {
            if (controller.signal.aborted) return
            if (!result.knowledgeBases.some(base => base.id === key)) setError(t('unavailable'))
            setLabels(Object.fromEntries(result.knowledgeBases.map(base => [base.id, base.name])))
          }).catch(() => { if (!controller.signal.aborted) setError(t('unavailable')) })
          return () => controller.abort()
        }, [key, sessionID, loadCatalog, t])
        const show = async () => {
          const controller = lifetime.current
          if (!controller || busy) return
          setBusy(true); setError('')
          try { await open(controller.signal) }
          catch { if (!controller.signal.aborted) setError(t('failed')) }
          finally { if (!controller.signal.aborted) setBusy(false) }
        }
        const label = ids.length === 0 ? t('title') : ids.length === 1 && labels[ids[0]]
          ? t('selected') + labels[ids[0]] : t('multiple', { count: ids.length })
        return h('div', { className: 'zhishuKbChoice' },
          h('button', { type: 'button', className: 'zhishuKbChoiceTrigger', disabled: busy, 'aria-haspopup': 'listbox',
            'aria-label': label, 'data-selected': ids.length > 0, onClick: show },
          h(KnowledgeIcon, { size: 14 }), h('span', { className: 'zhishuKbChoiceName' }, label),
          h(IconChevronDownOutlineRegular, { size: 12 })),
          error ? h('span', { role: 'alert', className: 'zhishuKbChoiceError' }, error) : null)
      }
      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left', id: 'zhishu-knowledge-selection',
        locale: namespace,
        inject: sessionID => ({ sessionID, loadCatalog: catalog,
          open: signal => ctx.commandUi.openPopup('knowledge', sessionID, signal) }),
      }, KnowledgeSelection))
    }

    function installStyles() {
      // Always refresh textContent so HMR / plugin rev bumps pick up CSS changes.
      // An early return on STYLE_ID left stale rules after edits (no visible effect).
      let style = document.getElementById(STYLE_ID)
      if (!style) {
        style = document.createElement('style')
        style.id = STYLE_ID
        style.dataset.plugin = '@zhishu/dsh-overlay-knowledge-base'
        document.head.appendChild(style)
      }
      style.textContent = `
        .zhishuKbChoice{display:flex;align-items:center;gap:4px;min-width:0;max-width:100%;font-weight:400}
        .zhishuKbChoiceTrigger{display:inline-flex;align-items:center;gap:4px;min-width:0;max-width:180px;height:28px;padding:0 6px;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
        .zhishuKbChoiceTrigger[data-selected=true]{color:var(--dsw-alias-label-primary)}
        .zhishuKbChoiceTrigger:hover{background:var(--dsw-alias-interactive-bg-hover)}
        .zhishuKbChoiceTrigger:disabled{opacity:.55;cursor:default}
        .zhishuKbChoiceTrigger svg{flex:none}
        .zhishuKbChoiceName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .zhishuKbChoiceError{color:var(--dsw-alias-label-error);font-size:12px;max-width:260px}
        .zhishuKb{display:flex;flex:1;min-width:0;min-height:0;height:100%;flex-direction:column;position:relative;background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-label-primary)}
        /* Host chrome above the iframe — never paints over WeKnora modals. */
        .zhishuKbBar{display:flex;flex:none;align-items:center;justify-content:flex-end;gap:8px;min-height:40px;padding:4px 12px;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08));background:var(--dsw-alias-bg-primary,#fff)}
        .zhishuKbBarStatus{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .zhishuKbBarStatus[data-error=true]{color:#b42318}
        .zhishuKbAiFab{box-sizing:border-box;display:inline-grid;place-items:center;width:32px;height:32px;padding:0;border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.1));border-radius:8px;background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-label-primary,#1f1f1f);cursor:pointer}
        .zhishuKbAiFab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04))}
        .zhishuKbAiFab:focus-visible{outline:2px solid var(--dsw-alias-interactive-bg-primary,#2f6bff);outline-offset:2px}
        .zhishuKbBody{display:flex;flex:1;min-width:0;min-height:0;position:relative}
        .zhishuKbFrame{flex:1;min-width:0;min-height:0;border:0;background:#fff}
      `
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

    /** Compact sparkle/chat mark for the floating AI assistant control. */
    function AiAssistantIcon() {
      return h('svg', {
        width: 18,
        height: 18,
        viewBox: '0 0 24 24',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        'aria-hidden': 'true',
      },
      h('path', {
        d: 'M12 3.5 13.2 8.3 18 9.5 13.2 10.7 12 15.5 10.8 10.7 6 9.5 10.8 8.3 12 3.5Z',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinejoin: 'round',
      }),
      h('path', {
        d: 'M18.5 14.5 19.1 16.9 21.5 17.5 19.1 18.1 18.5 20.5 17.9 18.1 15.5 17.5 17.9 16.9 18.5 14.5Z',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinejoin: 'round',
      }),
      h('path', {
        d: 'M5 14h4v4H5z',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinejoin: 'round',
      }))
    }

    /** Full-page WeKnora UI (main panel), same shell pattern as Plugins. */
    function KnowledgePanel(props) {
      const startAssistant = props.startAssistant
      const frameRef = React.useRef(null)
      const nonceRef = React.useRef('')
      const [signedIn, setSignedIn] = React.useState(false)
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
        if (!signedIn) return undefined
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
        return () => {
          window.removeEventListener('message', onMessage)
          nonceRef.current = ''
        }
      }, [signedIn])

      const gateHint = !signedIn ? '请先登录平台，登录后将自动加载知识库。' : ''
      const barText = error || status || gateHint

      return h(
        'div',
        { className: 'zhishuKb' },
        h(
          'div',
          { className: 'zhishuKbBar' },
          barText
            ? h('div', {
              className: 'zhishuKbBarStatus',
              'data-error': error ? 'true' : 'false',
            }, barText)
            : h('div', { className: 'zhishuKbBarStatus' }),
          h('button', {
            type: 'button',
            className: 'zhishuKbAiFab',
            'aria-label': 'AI助手',
            title: 'AI助手',
            onClick: () => { startAssistant?.() },
          }, h(AiAssistantIcon)),
        ),
        h(
          'div',
          { className: 'zhishuKbBody' },
          h('iframe', {
            ref: frameRef,
            className: 'zhishuKbFrame',
            title: '知识库',
            src: signedIn ? IFRAME_URL : 'about:blank',
            allow: 'clipboard-read; clipboard-write',
          }),
        ),
      )
    }

    const inject = ['slots', 'layout', 'uiWorkspace', 'desktopWorkbenches', 'commandUi', 'sessions', 'locale', 'connection', 'remote', 'remote.commands']
    function apply(ctx) {
      installStyles()
      const auth = installToolAuthentication(ctx)
      installKnowledgePicker(ctx, auth)

      // Drop leftover workbench / companion registration from earlier builds.
      const host = ctx.desktopWorkbenches
      host.closeCompanion?.()
      ctx.effect(() => {
        let cancelled = false
        void (async () => {
          try {
            if (!host.ready) await host.load()
            if (cancelled) return
            if (host.state.added.includes(LEGACY_WORKBENCH_ID)
              || Object.values(host.state.sessionBindings).includes(LEGACY_WORKBENCH_ID)) {
              await host.remove(LEGACY_WORKBENCH_ID, { moveSessionsToMain: true })
            }
          } catch (error) { if (!cancelled) host.report(error) }
        })()
        return () => { cancelled = true }
      }, 'knowledge-base: migrate legacy workbench entry')

      // Opening knowledge from a business workbench must drop workbench mode,
      // otherwise AI助手 / 新会话 still hit registerSessionStarter → workbench session.
      const releaseWorkbench = () => host.run(Promise.resolve().then(() => host.releaseToMainSession()))
      ctx.effect(() => {
        const onPanel = () => {
          if (ctx.layout.panelInfo.getSnapshot().activePanelId === PANEL_ID) releaseWorkbench()
        }
        onPanel()
        return ctx.layout.panelInfo.subscribe(onPanel)
      }, 'knowledge-base: release workbench when panel opens')

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        inject: () => ({
          startAssistant: () => {
            host.run(Promise.resolve().then(() => host.releaseToMainSession())
              .then(() => ctx.uiWorkspace.startSession()))
          },
        }),
      }, KnowledgePanel))

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: PANEL_ORDER,
        label: '知识库',
      }, KnowledgeIcon))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})

/** Windows caption menu labels and native popup anchors, isolated from the Web client. */
import { ipcRenderer } from 'electron'
import { DESKTOP_IPC, SCHEME } from './ipc.ts'
import { resolveDesktopLocale } from './locale.ts'
import { MODEL_SPACE_IPC, type ModelSpaceState } from './model-space/model-space.ts'

/**
 * Mount the Windows caption menubar without moving focus out of the active editor.
 * @returns Language refresh and document teardown operations.
 */
export function installWindowsMenu(): { update(): void; dispose(): void } {
  const host = document.createElement('div')
  host.dataset.windowsMenu = ''
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = `
    :host { position: fixed; top: 0; left: var(--dsh-windows-menu-start, 48px); z-index: 1100;
      height: var(--dsh-windows-titlebar-height); display: flex; align-items: center;
      font-family: var(--dsw-font-family); -webkit-app-region: no-drag; }
    [role=menubar] { display: flex; gap: 2px; }
    button { height: 28px; padding: 0 10px; border: 0; border-radius: 6px;
      background: transparent; color: var(--dsw-alias-label-secondary);
      font: inherit; font-size: 14px; cursor: default; }
    button:hover, button[aria-expanded=true] { background: var(--dsw-alias-interactive-bg-hover);
      color: var(--dsw-alias-label-primary); }
    .workspace { display: flex; align-items: center; margin-left: 2px; }
    .workspace[hidden] { display: none; }
    .workspace button { display: inline-flex; align-items: center; gap: 2px; padding: 0 8px;
      color: var(--dsw-alias-label-primary); font-weight: 600; cursor: pointer; }
    .workspace svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.5;
      stroke-linecap: round; stroke-linejoin: round; }
    .workspace button[aria-expanded=true] svg { transform: rotate(180deg); }
    button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
    :host-context(html[data-input-modality='pointer']) button:focus-visible { outline-color: transparent; }
  `
  const bar = document.createElement('div')
  bar.setAttribute('role', 'menubar')
  let restoreEditor = (): void => {}
  const rememberEditor = (event: FocusEvent): void => {
    const target = event.composedPath()[0]
    if (!(target instanceof HTMLElement) || target === host || shadow.contains(target)) return
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)
      && !target.matches('[contenteditable="true"]')) return
    const selection = document.getSelection()
    const ranges = selection === null ? [] : Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange())
    const input = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target : undefined
    const start = input?.selectionStart
    const end = input?.selectionEnd
    const direction = input?.selectionDirection
    restoreEditor = () => {
      if (!target.isConnected) return
      target.focus({ preventScroll: true })
      if (input !== undefined && start != null && end != null) input.setSelectionRange(start, end, direction ?? undefined)
      else if (selection !== null && ranges.length > 0) {
        selection.removeAllRanges()
        for (const range of ranges) selection.addRange(range)
      }
    }
  }
  document.addEventListener('focusout', rememberEditor, true)
  const createButton = (name: 'application' | 'edit', index: 0 | 1): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('role', 'menuitem')
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-expanded', 'false')
    button.tabIndex = index === 0 ? 0 : -1
    button.addEventListener('pointerdown', (event) => { event.preventDefault() })
    button.addEventListener('mousedown', (event) => { event.preventDefault() })
    const open = async (): Promise<void> => {
      if (button.getAttribute('aria-expanded') === 'true') return
      const rect = button.getBoundingClientRect()
      button.setAttribute('aria-expanded', 'true')
      if (document.activeElement === host) restoreEditor()
      try { await ipcRenderer.invoke(DESKTOP_IPC.windowsMenu, name, rect.left, rect.bottom) }
      catch (error) { console.error('Desktop caption menu failed', error) }
      finally { button.setAttribute('aria-expanded', 'false') }
    }
    button.addEventListener('click', () => { void open() })
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const next = buttons[index === 0 ? 1 : 0]
        button.tabIndex = -1
        next.tabIndex = 0
        next.focus()
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        void open()
      }
    })
    bar.append(button)
    return button
  }
  const buttons = [createButton('application', 0), createButton('edit', 1)] as const
  const workspace = installWorkspaceSwitch()
  shadow.append(style, bar)
  if (workspace !== undefined) shadow.append(workspace.host)
  const mount = (): void => {
    // AppFrame owns this seat; boot readiness alone precedes the rendered application.
    if (document.querySelector('[data-shell-overlay]') === null) return
    document.body.append(host)
    observer.disconnect()
  }
  const observer = new MutationObserver(mount)
  observer.observe(document.body, { childList: true, subtree: true })
  mount()
  const update = (): void => {
    const { messages } = resolveDesktopLocale(document.documentElement.lang)
    bar.setAttribute('aria-label', messages.menuBar)
    buttons[0].textContent = messages.application
    buttons[1].textContent = messages.edit
    workspace?.update()
  }
  update()
  return {
    update,
    dispose: () => {
      observer.disconnect()
      document.removeEventListener('focusout', rememberEditor, true)
      workspace?.dispose()
      host.remove()
    },
  }
}

/** Caption control to the right of Edit. Absent outside the desktop application document. */
function installWorkspaceSwitch(): { host: HTMLElement; update(): void; dispose(): void } | undefined {
  if (location.protocol !== `${SCHEME}:` || location.hostname !== 'app') return undefined
  const host = document.createElement('span')
  host.className = 'workspace'
  host.hidden = true
  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('aria-haspopup', 'menu')
  button.setAttribute('aria-expanded', 'false')
  const label = document.createElement('span')
  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  chevron.setAttribute('viewBox', '0 0 16 16')
  chevron.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'm4.5 6 3.5 3.5L11.5 6')
  chevron.append(path)
  button.append(label, chevron)
  host.append(button)
  let active: ModelSpaceState['active'] = 'conversation'
  const apply = (state: ModelSpaceState): void => {
    if (state == null || typeof state.authenticated !== 'boolean'
      || (state.active !== 'conversation' && state.active !== 'business')) return
    active = state.active
    host.hidden = !state.authenticated
    // Inline display wins over the stylesheet rule that hides [hidden], including
    // when the attribute and the property get out of step across a reload.
    host.style.display = state.authenticated ? 'flex' : 'none'
    paint()
  }
  const paint = (): void => {
    const zh = document.documentElement.lang.toLowerCase().startsWith('zh')
    label.textContent = active === 'business' ? (zh ? '业务' : 'Business') : (zh ? '会话' : 'Conversation')
    button.setAttribute('aria-label', zh ? '切换工作空间' : 'Switch workspace')
  }
  const onState = (_event: Electron.IpcRendererEvent, state: ModelSpaceState): void => { apply(state) }
  ipcRenderer.on(MODEL_SPACE_IPC.changed, onState)
  const pull = (): void => {
    void ipcRenderer.invoke(MODEL_SPACE_IPC.state).then((state: ModelSpaceState) => { apply(state) }).catch(() => undefined)
  }
  pull()
  // The first ask often runs before the gate exists, and the login event can land
  // on a document that is about to be replaced. Keep asking until the switch is shown.
  const timer = setInterval(() => { if (host.hidden) pull() }, 400)
  button.addEventListener('pointerdown', (event) => { event.preventDefault() })
  button.addEventListener('mousedown', (event) => { event.preventDefault() })
  button.addEventListener('click', () => {
    const rect = button.getBoundingClientRect()
    const zh = document.documentElement.lang.toLowerCase().startsWith('zh')
    const dark = document.documentElement.hasAttribute('data-ds-dark-theme')
    if (button.getAttribute('aria-expanded') !== 'true') button.setAttribute('aria-expanded', 'true')
    void ipcRenderer.invoke(MODEL_SPACE_IPC.menu, rect.left, rect.bottom, dark, zh).finally(() => {
      button.setAttribute('aria-expanded', 'false')
    })
  })
  paint()
  return {
    host,
    update: paint,
    dispose: () => {
      clearInterval(timer)
      ipcRenderer.off(MODEL_SPACE_IPC.changed, onState)
    },
  }
}

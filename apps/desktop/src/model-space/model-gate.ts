/**
 * Model-platform login gate. The official welcome window stays unused:
 * this view loads the platform's own /login page, then keeps that same
 * document for the whole model site so the sessionStorage mark survives.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, net, session, shell, WebContentsView, type IpcMainInvokeEvent } from 'electron'
import { MODEL_SITE_ORIGIN } from './model-gateway.ts'
import { MODEL_SPACE_IPC, type ModelSpace, type ModelSpaceState, type PlatformAccount } from './model-space.ts'
import { WINDOWS_TITLEBAR_HEIGHT } from '../windows-layout.ts'
import { workspaceMenuDocument } from './workspace-menu.ts'

const PARTITION = 'persist:zhishu-model'
const DEVELOPMENT_MODEL_ORIGIN = 'http://127.0.0.1:8888'

/** @param raw - candidate model site. @returns origin without a path. */
function parseModelOrigin(raw: string): string {
  const url = new URL(raw)
  if (url.username || url.password || url.hash || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new Error('desktop model login: model origin must be an http(s) origin')
  }
  return url.origin
}

/** Origin embedded by packaging. Absent in local development. */
function packagedModelOrigin(): string | undefined {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'))
    if (typeof manifest !== 'object' || manifest === null || !('dshModelOrigin' in manifest)) return undefined
    const value = manifest.dshModelOrigin
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  } catch {
    return undefined
  }
}

/**
 * Local development loads the model dev server. A packaged app loads the local
 * gateway, which serves the bundled page and proxies APIs to the LAN.
 * @param env - process environment. A shell `DSH_MODEL_ORIGIN` applies only while unpackaged.
 * @param packaged - whether this process is an installed build.
 * @returns origin of the model site, without a path.
 */
export function modelPlatformOrigin(env: NodeJS.ProcessEnv = process.env, packaged = app.isPackaged): string {
  if (!packaged) return parseModelOrigin(env.DSH_MODEL_ORIGIN?.trim() || DEVELOPMENT_MODEL_ORIGIN)
  return parseModelOrigin(packagedModelOrigin() || MODEL_SITE_ORIGIN)
}

/** Pages that stay on the login flow and do not open the Harness workspace yet. */
/** Accept either the display-info response or the fields the model page reports. */
function readPlatformAccount(value: unknown): PlatformAccount | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as { code?: unknown; content?: unknown; userAccount?: unknown; userName?: unknown }
  if (record.code === 2001 || record.code === '2001' || record.code === 2009 || record.code === '2009') return undefined
  const source = typeof record.content === 'object' && record.content !== null
    ? record.content as { userAccount?: unknown; userName?: unknown }
    : record
  const userName = typeof source.userName === 'string' ? source.userName.trim() : ''
  const userAccount = typeof source.userAccount === 'string' ? source.userAccount.trim() : ''
  if (userName === '' && userAccount === '') return undefined
  return { userAccount, userName }
}

function isLoginGatePath(pathname: string): boolean {
  return pathname === '/login'
    || pathname === '/register'
    || pathname === '/desktop-entry'
    || pathname === '/complete-identity'
}

/**
 * Hosts the model site in one persistent partition and tells the shell when
 * the platform session is allowed into the Harness workspace.
 */
export class ModelPlatformGate {
  private readonly origin = modelPlatformOrigin()
  private view: WebContentsView | undefined
  private menuView: WebContentsView | undefined
  private menuDone: (() => void) | undefined
  private menuArmed = false
  private window: BrowserWindow | undefined
  private active: ModelSpace = 'conversation'
  private authenticated = false
  private account: PlatformAccount | null = null
  private publishGeneration = 0
  private readonly onAuthenticated: () => Promise<void>

  /**
   * @param preload - sandboxed preload for the model view.
   * @param onAuthenticated - opens the Harness workspace after platform login.
   */
  constructor(private readonly preload: string, onAuthenticated: () => Promise<void>) {
    this.onAuthenticated = onAuthenticated
    ipcMain.removeHandler(MODEL_SPACE_IPC.state)
    ipcMain.removeHandler(MODEL_SPACE_IPC.switch)
    ipcMain.removeHandler(MODEL_SPACE_IPC.menu)
    ipcMain.removeHandler(MODEL_SPACE_IPC.accountGet)
    ipcMain.removeHandler(MODEL_SPACE_IPC.logout)
    ipcMain.removeHandler(MODEL_SPACE_IPC.businessSidebarToggle)
    ipcMain.removeAllListeners(MODEL_SPACE_IPC.account)
    ipcMain.handle(MODEL_SPACE_IPC.state, (event) => {
      this.assertSender(event)
      return this.state()
    })
    ipcMain.handle(MODEL_SPACE_IPC.switch, (event, space: unknown) => {
      this.assertSender(event)
      const fromMenu = event.sender === this.menuView?.webContents
      if (fromMenu) queueMicrotask(() => { this.closeMenu() })
      if (space !== 'conversation' && space !== 'business') throw new Error('desktop model login: unknown space')
      if (!this.authenticated) return this.state()
      this.show(space)
      return this.state()
    })
    ipcMain.handle(MODEL_SPACE_IPC.accountGet, (event) => {
      this.assertSender(event)
      if (event.sender !== this.window?.webContents) throw new Error('desktop model login: unowned renderer')
      return this.account
    })
    ipcMain.handle(MODEL_SPACE_IPC.logout, (event) => {
      this.assertSender(event)
      if (event.sender !== this.window?.webContents) throw new Error('desktop model login: unowned renderer')
      const view = this.view
      if (view === undefined || view.webContents.isDestroyed()) return
      view.webContents.send(MODEL_SPACE_IPC.logout)
    })
    ipcMain.handle(MODEL_SPACE_IPC.businessSidebarToggle, (event) => {
      this.assertSender(event)
      if (event.sender !== this.window?.webContents) throw new Error('desktop model login: unowned renderer')
      if (this.active !== 'business') return
      const view = this.view
      if (view === undefined || view.webContents.isDestroyed()) return
      view.webContents.send(MODEL_SPACE_IPC.businessSidebarToggle)
    })
    ipcMain.on(MODEL_SPACE_IPC.account, (event, payload: unknown) => {
      if (event.sender !== this.view?.webContents || event.senderFrame !== event.sender.mainFrame) return
      const account = readPlatformAccount(payload)
      if (account === undefined) return
      this.account = account
      this.publishAccount()
    })
    ipcMain.handle(MODEL_SPACE_IPC.menu, (event, x: unknown, y: unknown, dark: unknown, zh: unknown) => {
      this.assertSender(event)
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)
        || x < 0 || y < 0 || x > 100_000 || y > 100_000) throw new Error('desktop model login: invalid menu anchor')
      return this.toggleMenu(x, y, dark === true, zh === true)
    })
  }

  /** @param window - main window that owns both the Harness page and this view. */
  attach(window: BrowserWindow): void {
    if (this.window === window && this.view !== undefined) return
    this.window = window
    const view = new WebContentsView({
      webPreferences: {
        preload: this.preload,
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    this.view = view
    view.setBackgroundColor('#ffffff')
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
      return { action: 'deny' }
    })
    const follow = (_event: unknown, url: string): void => { this.onAddress(url) }
    view.webContents.on('did-navigate', follow)
    view.webContents.on('did-navigate-in-page', follow)
    window.contentView.addChildView(view)
    // The caption asks for state as soon as its document loads. That is often before
    // this gate exists, and a later reload drops the in-flight event. Send again
    // whenever the Harness document is actually on screen.
    window.webContents.on('did-finish-load', () => { this.publish(); this.publishAccount() })
    // While this is set, layout must not attach the cover. Reattaching the child view
    // makes Windows abort minimize and pop the window back onto the desktop.
    let away = false
    let holdMinimizeUntil = 0
    let concealed = false
    const fit = (): void => {
      if (concealed || away || window.isDestroyed() || !window.isVisible() || window.isMinimized()) return
      this.closeMenu()
      this.fit()
    }
    window.on('resize', fit)
    window.on('enter-full-screen', fit)
    window.on('leave-full-screen', fit)
    const fitAgain = (): void => {
      if (away || window.isMinimized()) return
      fit()
      setTimeout(() => { if (!away && !window.isDestroyed() && !window.isMinimized()) fit() }, 100)
    }
    const sendToTaskbar = (): void => {
      if (window.isDestroyed() || window.isMinimized()) return
      if (away && Date.now() < holdMinimizeUntil) return
      away = true
      holdMinimizeUntil = Date.now() + 400
      this.parkCover()
      // Calling minimize inside the caption's WM_SYSCOMMAND cancels it. Do it next turn,
      // after the cover is no longer a child view.
      setTimeout(() => {
        if (!window.isDestroyed() && !window.isMinimized()) window.minimize()
      }, 0)
    }
    window.on('restore', () => {
      // The caption click restores once before the deferred minimize runs. Send it back.
      // A later restore is the user opening the taskbar button; show the login page then.
      if (Date.now() < holdMinimizeUntil) {
        setTimeout(() => {
          if (!window.isDestroyed() && !window.isMinimized()) window.minimize()
        }, 0)
        return
      }
      away = false
      fitAgain()
    })
    window.on('show', () => {
      if (Date.now() < holdMinimizeUntil) return
      concealed = false
      away = false
      fitAgain()
    })
    window.on('hide', () => {
      concealed = true
      this.parkCover()
    })
    window.on('minimize', () => {
      away = true
      this.parkCover()
    })
    if (process.platform === 'win32') {
      window.hookWindowMessage(0x0112, (wParam) => {
        const command = wParam.readUInt32LE(0) & 0xFFF0
        // SC_MINIMIZE. A child view makes Windows keep the window on the desktop.
        if (command === 0xF020) sendToTaskbar()
        // SC_CLOSE. The shell hides the window and leaves the tray icon. Detach the
        // cover first, or the child view cancels that hide.
        if (command === 0xF060) { concealed = true; this.parkCover() }
      })
    }
    this.fit()
    this.openDevelopmentTools()
  }

  /** Unpackaged dev and start open this page's tools beside the conversation tools. */
  private openDevelopmentTools(): void {
    if (app.isPackaged || process.env.DSH_DESKTOP_OPEN_DEVTOOLS === '0') return
    const contents = this.view?.webContents
    if (contents === undefined || contents.isDestroyed()) return
    contents.openDevTools({ mode: 'detach' })
  }

  /**
   * Load /login, or the desktop entry when the platform cookie is still valid.
   * Returns once the first document is requested, not when the user finishes login.
   */
  async open(): Promise<void> {
    const window = this.window
    const view = this.view
    if (window === undefined || view === undefined) throw new Error('desktop model login: window is not attached')
    const alive = await this.sessionAlive()
    const target = alive ? `${this.origin}/desktop-entry` : `${this.origin}/login`
    // A still-valid cookie used to leave this view hidden until the first navigation.
    // The Harness page is already underneath, so the caption never learned that
    // login had not finished and the workspace switch stayed hidden.
    if (!this.authenticated) this.show('business')
    window.show()
    await view.webContents.loadURL(target)
  }

  /** Cover the workspace with the platform login page. */
  presentLogin(): void {
    const view = this.view
    const window = this.window
    if (view === undefined || window === undefined || window.isDestroyed()) return
    this.authenticated = false
    this.show('business')
    window.show()
    void view.webContents.loadURL(`${this.origin}/login`)
  }

  /**
   * Open or close the workspace dropdown above both pages.
   * @returns when the dropdown closes.
   */
  private toggleMenu(x: number, y: number, dark: boolean, zh: boolean): Promise<void> {
    if (this.menuView !== undefined) {
      this.closeMenu()
      return Promise.resolve()
    }
    const window = this.window
    if (window === undefined || window.isDestroyed() || !this.authenticated) return Promise.resolve()
    const zoom = window.webContents.getZoomFactor()
    const [width = 0, height = 0] = window.getContentSize()
    const menuWidth = 248
    const menuHeight = 146
    const left = Math.min(Math.max(0, Math.round(x * zoom)), Math.max(0, width - menuWidth))
    const top = Math.min(Math.max(0, Math.round(y * zoom)), Math.max(0, height - menuHeight))
    const view = new WebContentsView({
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    this.menuView = view
    view.setBackgroundColor(dark ? '#1f1f1f' : '#ffffff')
    view.setBounds({ x: left, y: top, width: menuWidth, height: menuHeight })
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    view.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') this.closeMenu()
    })
    view.webContents.on('blur', () => { if (this.menuArmed && this.menuView === view) this.closeMenu() })
    window.contentView.addChildView(view)
    const done = new Promise<void>((resolve) => { this.menuDone = resolve })
    void view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(workspaceMenuDocument(this.active, zh, dark))}`).then(() => {
      if (this.menuView !== view || view.webContents.isDestroyed()) return
      view.webContents.focus()
      setTimeout(() => { if (this.menuView === view) this.menuArmed = true }, 200)
    }).catch(() => { if (this.menuView === view) this.closeMenu() })
    return done
  }

  private closeMenu(): void {
    const view = this.menuView
    const done = this.menuDone
    this.menuView = undefined
    this.menuDone = undefined
    this.menuArmed = false
    if (view !== undefined) {
      const window = this.window
      if (window !== undefined && !window.isDestroyed()) window.contentView.removeChildView(view)
      if (!view.webContents.isDestroyed()) view.webContents.close()
    }
    done?.()
  }

  private state(): ModelSpaceState {
    return { active: this.authenticated ? this.active : 'business', authenticated: this.authenticated }
  }

  /** The platform view stays up until login finishes, and again whenever business is selected. */
  private coverWanted(): boolean {
    return !this.authenticated || this.active === 'business'
  }

  private show(space: ModelSpace): void {
    this.active = space
    this.fit()
    this.publish()
    // The caption document can still be loading, or about to reload into the workspace.
    // Repeat the same state so a listener that attaches late still unhides the switch.
    const generation = ++this.publishGeneration
    for (const delay of [300, 1200]) {
      setTimeout(() => { if (this.publishGeneration === generation) this.publish() }, delay)
    }
  }

  private publish(): void {
    const state = this.state()
    const window = this.window
    const view = this.view
    if (window !== undefined && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(MODEL_SPACE_IPC.changed, state)
    }
    if (view !== undefined && !view.webContents.isDestroyed()) view.webContents.send(MODEL_SPACE_IPC.changed, state)
  }

  /** Take the platform view off the window so minimize can reach the taskbar. */
  private parkCover(): void {
    const window = this.window
    const view = this.view
    if (window === undefined || window.isDestroyed() || view === undefined || view.webContents.isDestroyed()) return
    view.setVisible(false)
    if (window.contentView.children.includes(view)) window.contentView.removeChildView(view)
  }

  private fit(): void {
    const window = this.window
    const view = this.view
    if (window === undefined || window.isDestroyed() || view === undefined || view.webContents.isDestroyed()) return
    // A minimized window reports an empty client size. Resizing the cover then would
    // either reveal the conversation page or pull the window back onto the desktop.
    if (window.isMinimized()) return
    const [width = 0, height = 0] = window.getContentSize()
    const top = process.platform === 'win32' ? WINDOWS_TITLEBAR_HEIGHT : 0
    if (width < 2 || height <= top) return
    if (!window.contentView.children.includes(view)) window.contentView.addChildView(view)
    view.setBounds({ x: 0, y: top, width, height: height - top })
    view.setVisible(this.coverWanted())
  }

  private onAddress(url: string): void {
    const window = this.window
    const view = this.view
    if (window === undefined || window.isDestroyed() || view === undefined || view.webContents.isDestroyed()) return
    let parsed: URL
    try { parsed = new URL(url) } catch { return }
    if (parsed.origin !== this.origin) return
    const path = parsed.pathname
    if (path === '/login' || path === '/register') {
      this.authenticated = false
      this.account = null
      this.publishAccount()
      this.show('business')
      if (!window.isDestroyed() && window.isVisible()) window.show()
      return
    }
    // Identity completion and the cold-start entry stay on this page. Login's own
    // success route is /smartChat, same as the website; reaching it opens Harness.
    if (isLoginGatePath(path)) {
      if (!this.authenticated) this.show('business')
      return
    }
    if (this.authenticated) return
    this.authenticated = true
    this.show('conversation')
    void this.loadAccount()
    void this.onAuthenticated()
  }

  /** Ask the platform who is logged in, then tell the conversation page. */
  private async loadAccount(): Promise<void> {
    const account = await this.fetchAccount()
    if (account === undefined) return
    this.account = account
    this.publishAccount()
  }

  private publishAccount(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    window.webContents.send(MODEL_SPACE_IPC.accountChanged, this.account)
  }

  /** @returns the signed-in platform user, or undefined when the cookie is absent or expired. */
  private async fetchAccount(): Promise<PlatformAccount | undefined> {
    const partition = session.fromPartition(PARTITION)
    const cookies = await partition.cookies.get({ url: this.origin })
    if (cookies.length === 0) return undefined
    try {
      const response = await net.fetch(new URL('/DistributedAISystem/UserLoginDisplayInfo', this.origin).href, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
        },
      })
      if (!response.ok) return undefined
      const body: unknown = await response.json()
      return readPlatformAccount(body)
    } catch {
      return undefined
    }
  }

  private async sessionAlive(): Promise<boolean> {
    const account = await this.fetchAccount()
    return account !== undefined && account.userName !== ''
  }

  private assertSender(event: IpcMainInvokeEvent): void {
    const sender = event.sender
    const allowed = sender === this.window?.webContents || sender === this.view?.webContents || sender === this.menuView?.webContents
    if (!allowed || event.senderFrame !== sender.mainFrame) throw new Error('desktop model login: unowned renderer')
  }
}

/**
 * Model-platform login gate. The official welcome window stays unused:
 * this view loads the platform's own /login page, then keeps that same
 * document for the whole model site so the sessionStorage mark survives.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, net, session, shell, WebContentsView, type IpcMainInvokeEvent } from 'electron'
import { MODEL_SPACE_IPC, type ModelSpace, type ModelSpaceState } from './model-space.ts'
import { WINDOWS_TITLEBAR_HEIGHT } from '../windows-layout.ts'
import { workspaceMenuDocument } from './workspace-menu.ts'

const PARTITION = 'persist:zhishu-model'
const DEVELOPMENT_MODEL_ORIGIN = 'http://127.0.0.1:8888'
const PRODUCTION_MODEL_ORIGIN = 'https://172.18.127.67'

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
 * Local development loads the model dev server. A packaged app loads the origin
 * written at build time, which defaults to the production site.
 * @param env - process environment. A shell `DSH_MODEL_ORIGIN` applies only while unpackaged.
 * @param packaged - whether this process is an installed build.
 * @returns origin of the model site, without a path.
 */
export function modelPlatformOrigin(env: NodeJS.ProcessEnv = process.env, packaged = app.isPackaged): string {
  if (!packaged) return parseModelOrigin(env.DSH_MODEL_ORIGIN?.trim() || DEVELOPMENT_MODEL_ORIGIN)
  return parseModelOrigin(packagedModelOrigin() || PRODUCTION_MODEL_ORIGIN)
}

/** Pages that stay on the login flow and do not open the Harness workspace yet. */
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
    view.setVisible(false)
    const fit = (): void => { this.closeMenu(); this.fit() }
    window.on('resize', fit)
    window.on('enter-full-screen', fit)
    window.on('leave-full-screen', fit)
    this.fit()
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
    if (!alive) this.show('business')
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

  private show(space: ModelSpace): void {
    this.active = space
    const view = this.view
    if (view === undefined || view.webContents.isDestroyed()) return
    this.fit()
    view.setVisible(space === 'business' || !this.authenticated)
    this.publish()
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

  private fit(): void {
    const window = this.window
    const view = this.view
    if (window === undefined || window.isDestroyed() || view === undefined || view.webContents.isDestroyed()) return
    const [width = 0, height = 0] = window.getContentSize()
    const top = process.platform === 'win32' ? WINDOWS_TITLEBAR_HEIGHT : 0
    view.setBounds({ x: 0, y: top, width: Math.max(0, width), height: Math.max(0, height - top) })
  }

  private onAddress(url: string): void {
    let parsed: URL
    try { parsed = new URL(url) } catch { return }
    if (parsed.origin !== this.origin) return
    const path = parsed.pathname
    if (path === '/login' || path === '/register') {
      this.authenticated = false
      this.show('business')
      this.window?.show()
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
    void this.onAuthenticated()
  }

  private async sessionAlive(): Promise<boolean> {
    const partition = session.fromPartition(PARTITION)
    const cookies = await partition.cookies.get({ url: this.origin })
    if (cookies.length === 0) return false
    try {
      const response = await net.fetch(new URL('/DistributedAISystem/UserLoginDisplayInfo', this.origin).href, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
        },
      })
      if (!response.ok) return false
      const body: unknown = await response.json()
      if (typeof body !== 'object' || body === null) return false
      const record = body as { code?: unknown; content?: { userName?: unknown } }
      if (record.code === 2001 || record.code === '2001' || record.code === 2009 || record.code === '2009') return false
      return typeof record.content?.userName === 'string' && record.content.userName !== ''
    } catch {
      return false
    }
  }

  private assertSender(event: IpcMainInvokeEvent): void {
    const sender = event.sender
    const allowed = sender === this.window?.webContents || sender === this.view?.webContents || sender === this.menuView?.webContents
    if (!allowed || event.senderFrame !== sender.mainFrame) throw new Error('desktop model login: unowned renderer')
  }
}

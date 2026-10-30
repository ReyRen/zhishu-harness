import type { FileSaveResult } from '@deepseek-ai/dsh-client-ui-file-actions/types'
/** Origin-scoped boot, native directory selection, host paths of picked files, and update presentation with native confirmation actions. */

import type { DesktopShortcutInput, ShortcutConfigSnapshot, ShortcutSaveResult } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { DESKTOP_IPC, SCHEME, type DshDesktopProductApi, type DesktopUpdatePresentation } from './ipc.ts'
import { MODEL_SPACE_IPC, readModelSpaceState, type ModelSpace, type ModelSpaceState, type PlatformAccount } from './model-space/model-space.ts'
import { PLATFORM_IPC } from './platform-ipc.ts'
import { markDocumentPlatform, syncWindowFullscreen } from './preload-platform.ts'
import { syncNativeTheme } from './preload-theme.ts'
import { syncWindowsAppearance } from './preload-windows.ts'
import { installMandatoryUpdateOverlay } from './preload-mandatory-overlay.ts'
import { createDesktopBrowserBridge } from './preload-browser.ts'
import type { FileDragHandle } from '@deepseek-ai/dsh-util-file-drag'

function createProductApi(): DshDesktopProductApi {
  return {
    protocolVersion: 1,
    fileActions: {
      save: request => ipcRenderer.invoke(DESKTOP_IPC.fileSave, request) as Promise<FileSaveResult>,
      readClipboardImage: url => ipcRenderer.invoke(DESKTOP_IPC.clipboardImageRead, url) as
        Promise<{ bytes: Uint8Array; mediaType: string }>,
    },
    browser: createDesktopBrowserBridge(),
    fileDrag: {
      prepare: (source, requestId) => ipcRenderer.invoke(DESKTOP_IPC.fileDragPrepare, source, requestId) as
        Promise<FileDragHandle | undefined>,
      cancel: (requestId) => { void ipcRenderer.invoke(DESKTOP_IPC.fileDragCancel, requestId).catch((_error: unknown) => {
        // Main-process shutdown cancels any remaining preparations.
      }) },
      start: handle => ipcRenderer.invoke(DESKTOP_IPC.fileDragStart, handle) as Promise<boolean>,
      release: (handle) => { void ipcRenderer.invoke(DESKTOP_IPC.fileDragRelease, handle).catch((_error: unknown) => {
        // Main-process shutdown also releases every prepared file.
      }) },
    },
    deviceInfo: () => ipcRenderer.invoke(DESKTOP_IPC.deviceInfo) as Promise<string>,
    keyboard: {
      closeWindow: revision => ipcRenderer.invoke(DESKTOP_IPC.shortcutsCloseWindow, revision) as Promise<void>,
      subscribe: (listener) => {
        const handle = (_event: Electron.IpcRendererEvent, input: DesktopShortcutInput): void => {
          if (input.kind === 'iframe') {
            const element = document.activeElement
            if (!(element instanceof HTMLIFrameElement) || !element.isConnected
              || !element.matches('iframe[data-sidebar-browser-frame], iframe[data-html-preview]')) return
            if (input.frameName === '' || element.name !== input.frameName) return
          }
          if (input.kind === 'webview') {
            const element = document.activeElement
            if (element?.matches('webview[data-sidebar-browser-frame]') !== true || !element.isConnected
              || input.frameName === '' || element.getAttribute('name') !== input.frameName) return
          }
          listener(input)
        }
        ipcRenderer.on(DESKTOP_IPC.shortcutsInput, handle)
        return () => { ipcRenderer.off(DESKTOP_IPC.shortcutsInput, handle) }
      },
    },
    shortcuts: {
      get: definitions => ipcRenderer.invoke(DESKTOP_IPC.shortcutsGet, definitions) as Promise<ShortcutConfigSnapshot>,
      edit: (edit, revision) => ipcRenderer.invoke(DESKTOP_IPC.shortcutsEdit, edit, revision) as Promise<ShortcutSaveResult>,
      recording: active => ipcRenderer.invoke(DESKTOP_IPC.shortcutsRecording, active) as Promise<void>,
      subscribe(listener) {
        const handle = (_event: Electron.IpcRendererEvent, snapshot: ShortcutConfigSnapshot): void => { listener(snapshot) }
        ipcRenderer.on(DESKTOP_IPC.shortcutsChanged, handle)
        return () => { ipcRenderer.off(DESKTOP_IPC.shortcutsChanged, handle) }
      },
    },
    updates: {
      status: () => ipcRenderer.invoke(DESKTOP_IPC.updatesStatus) as Promise<DesktopUpdatePresentation>,
      open: () => ipcRenderer.invoke(DESKTOP_IPC.updatesOpen) as Promise<void>,
      subscribe(listener) {
        const handle = (_event: Electron.IpcRendererEvent, state: DesktopUpdatePresentation): void => { listener(state) }
        ipcRenderer.on(DESKTOP_IPC.updatesPresentation, handle)
        return () => { ipcRenderer.off(DESKTOP_IPC.updatesPresentation, handle) }
      },
    },
  }
}

if (location.protocol === `${SCHEME}:` && location.hostname === 'app') {
  contextBridge.exposeInMainWorld('dshOnboarding', {
    hasApiKey: () => ipcRenderer.invoke(DESKTOP_IPC.onboardingApiKey) as Promise<boolean>,
    setActive: (active: boolean) => { ipcRenderer.send(DESKTOP_IPC.onboardingActive, active) },
  })
  ipcRenderer.on(DESKTOP_IPC.enterWorkspace, () => {
    const body = document.body
    const previous = body.getAttribute('tabindex')
    body.tabIndex = -1
    body.focus({ preventScroll: true })
    if (previous === null) body.removeAttribute('tabindex')
    else body.setAttribute('tabindex', previous)
  })
  syncWindowsAppearance()
  if (process.platform === 'win32') installMandatoryUpdateOverlay()
  contextBridge.exposeInMainWorld('__DSH_DIRECTORY_PICKER__', {
    pick: () => ipcRenderer.invoke(DESKTOP_IPC.directoryPick) as Promise<string | null>,
  })
  // The composer cites dropped, picked, and pasted files and folders that
  // have a real path as `@path` references instead of uploading them; a
  // File without one (pasted bytes) answers '' and uploads as before.
  contextBridge.exposeInMainWorld('__DSH_HOST_PATHS__', {
    pathFor: (file: File) => webUtils.getPathForFile(file),
  })
  contextBridge.exposeInMainWorld('dshDesktopBoot', {
    ready: () => ipcRenderer.invoke(DESKTOP_IPC.boot) as Promise<unknown>,
    failed: (message: string) => ipcRenderer.invoke(DESKTOP_IPC.bootFailed, message) as Promise<void>,
  })
  contextBridge.exposeInMainWorld('dshPlatform', {
    open: (page: 'usage' | 'top-up', bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke(PLATFORM_IPC.open, page, bounds),
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke(PLATFORM_IPC.bounds, bounds),
    close: () => ipcRenderer.invoke(PLATFORM_IPC.close),
  })
}

markDocumentPlatform()
syncWindowFullscreen()
syncNativeTheme()
// Main-process IPC also verifies the owning window and top frame.
contextBridge.exposeInMainWorld('dshDesktop', location.protocol === `${SCHEME}:` && location.hostname === 'app' && process.isMainFrame ? createProductApi() : { protocolVersion: 1 })

if (location.protocol === `${SCHEME}:` && location.hostname === 'app') {
  contextBridge.exposeInMainWorld('zhishuPlatform', {
    account: () => ipcRenderer.invoke(MODEL_SPACE_IPC.accountGet) as Promise<PlatformAccount | null>,
    onAccount(listener: (account: PlatformAccount | null) => void) {
      const handler = (_event: Electron.IpcRendererEvent, account: PlatformAccount | null): void => { listener(account) }
      ipcRenderer.on(MODEL_SPACE_IPC.accountChanged, handler)
      return () => { ipcRenderer.off(MODEL_SPACE_IPC.accountChanged, handler) }
    },
    logout: () => ipcRenderer.invoke(MODEL_SPACE_IPC.logout) as Promise<void>,
  })
  contextBridge.exposeInMainWorld('dshModelSpace', {
    state: () => ipcRenderer.invoke(MODEL_SPACE_IPC.state) as Promise<ModelSpaceState>,
    switchTo: (space: ModelSpace) => ipcRenderer.invoke(MODEL_SPACE_IPC.switch, space) as Promise<ModelSpaceState>,
    onStateChanged(listener: (state: ModelSpaceState) => void) {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
        const state = readModelSpaceState(value)
        if (state !== undefined) listener(state)
      }
      ipcRenderer.on(MODEL_SPACE_IPC.changed, handler)
      return () => { ipcRenderer.off(MODEL_SPACE_IPC.changed, handler) }
    },
  })
  contextBridge.exposeInMainWorld('__DSH_LOCALE__', {
    read: () => ipcRenderer.invoke(DESKTOP_IPC.localeBootstrap),
    onChange: (locale: string) => { ipcRenderer.send(DESKTOP_IPC.localeChanged, locale) },
  })
  // The caption collapse button stays on this page. In the business space it
  // must fold the platform sidebar instead of the conversation sidebar under it.
  // The collapsed new-session control is also pinned in this strip, so hide it
  // and pull the caption menu back while the platform page is showing.
  // The root is absent until the HTML parser creates it.
  let activeSpace: ModelSpace = 'conversation'
  const installBusinessCaption = (): void => {
    const root = document.documentElement as HTMLElement | null
    if (root === null || root.querySelector('style[data-zhishu-business-caption]') !== null) return
    const businessCaption = document.createElement('style')
    businessCaption.dataset.zhishuBusinessCaption = ''
    businessCaption.textContent = `html[data-zhishu-business] button[class*="_newSession"]{display:none!important}
html[data-windows-titlebar][data-zhishu-business]{--dsh-windows-menu-start:48px!important}`
    root.append(businessCaption)
    root.toggleAttribute('data-zhishu-business', activeSpace === 'business')
  }
  if ((document.documentElement as HTMLElement | null) === null) window.addEventListener('DOMContentLoaded', installBusinessCaption, { once: true })
  else installBusinessCaption()
  const applySpace = (space: ModelSpace): void => {
    activeSpace = space
    const root = document.documentElement as HTMLElement | null
    if (root !== null) root.toggleAttribute('data-zhishu-business', space === 'business')
  }
  ipcRenderer.on(MODEL_SPACE_IPC.changed, (_event, value: unknown) => {
    const state = readModelSpaceState(value)
    if (state !== undefined) applySpace(state.active)
  })
  window.addEventListener('click', (event) => {
    if (activeSpace !== 'business' || !isCaptionSidebarToggle(event.target)) return
    event.preventDefault()
    event.stopPropagation()
    void ipcRenderer.invoke(MODEL_SPACE_IPC.businessSidebarToggle)
  }, true)
}

/** The Windows caption collapse control is the fixed button at the left of the title strip. */
function isCaptionSidebarToggle(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const button = target.closest('button')
  if (button === null || getComputedStyle(button).position !== 'fixed') return false
  const rect = button.getBoundingClientRect()
  const titlebar = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-windows-titlebar-height'))
  const band = Number.isFinite(titlebar) ? titlebar : 40
  return rect.left >= 0 && rect.left < 40 && rect.bottom <= band + 8
}

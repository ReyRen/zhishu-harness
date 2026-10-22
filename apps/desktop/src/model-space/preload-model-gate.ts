/** Model-page bridge: switch between the Harness conversation and the model site. */

import { contextBridge, ipcRenderer } from 'electron'
import { MODEL_SPACE_IPC, type ModelSpace, type ModelSpaceState } from './model-space.ts'

contextBridge.exposeInMainWorld('zhishuDesktop', {
  embedded: true,
  publishAccount(account?: { userAccount?: string; userName?: string } | null) {
    ipcRenderer.send(MODEL_SPACE_IPC.account, {
      userAccount: typeof account?.userAccount === 'string' ? account.userAccount : '',
      userName: typeof account?.userName === 'string' ? account.userName : '',
    })
  },
})

ipcRenderer.on(MODEL_SPACE_IPC.logout, () => {
  document.dispatchEvent(new Event('zhishu-desktop-logout'))
})

ipcRenderer.on(MODEL_SPACE_IPC.businessSidebarToggle, () => {
  document.dispatchEvent(new Event('zhishu-desktop-sidebar-toggle'))
})

contextBridge.exposeInMainWorld('dshModelSpace', {
  state: () => ipcRenderer.invoke(MODEL_SPACE_IPC.state) as Promise<ModelSpaceState>,
  switchTo: (space: ModelSpace) => ipcRenderer.invoke(MODEL_SPACE_IPC.switch, space) as Promise<ModelSpaceState>,
  onStateChanged(listener: (state: ModelSpaceState) => void) {
    const handler = (_event: Electron.IpcRendererEvent, state: ModelSpaceState): void => { listener(state) }
    ipcRenderer.on(MODEL_SPACE_IPC.changed, handler)
    return () => { ipcRenderer.off(MODEL_SPACE_IPC.changed, handler) }
  },
})

if (location.protocol === 'http:' || location.protocol === 'https:') {
  const notifyBoot = (): boolean => {
    const app = document.getElementById('app')
    if (app === null || app.querySelector('.zhishu-boot') !== null || app.childElementCount === 0) return false
    ipcRenderer.send(MODEL_SPACE_IPC.bootReady)
    return true
  }
  const watchBoot = (): void => {
    if (notifyBoot()) return
    const app = document.getElementById('app')
    if (app === null) return
    const observer = new MutationObserver(() => {
      if (notifyBoot()) observer.disconnect()
    })
    observer.observe(app, { childList: true, subtree: true })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchBoot, { once: true })
  else watchBoot()
}

if (location.protocol === 'data:') {
  window.addEventListener('DOMContentLoaded', () => {
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-space]')) {
      button.addEventListener('click', () => {
        const space = button.dataset.space
        if (space === 'conversation' || space === 'business') void ipcRenderer.invoke(MODEL_SPACE_IPC.switch, space)
      })
    }
  })
}

/** Model-page bridge: switch between the Harness conversation and the model site. */

import { contextBridge, ipcRenderer } from 'electron'
import { MODEL_SPACE_IPC, type ModelSpace, type ModelSpaceState } from './model-space.ts'

contextBridge.exposeInMainWorld('dshModelSpace', {
  state: () => ipcRenderer.invoke(MODEL_SPACE_IPC.state) as Promise<ModelSpaceState>,
  switchTo: (space: ModelSpace) => ipcRenderer.invoke(MODEL_SPACE_IPC.switch, space) as Promise<ModelSpaceState>,
  onStateChanged(listener: (state: ModelSpaceState) => void) {
    const handler = (_event: Electron.IpcRendererEvent, state: ModelSpaceState): void => { listener(state) }
    ipcRenderer.on(MODEL_SPACE_IPC.changed, handler)
    return () => { ipcRenderer.off(MODEL_SPACE_IPC.changed, handler) }
  },
})

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

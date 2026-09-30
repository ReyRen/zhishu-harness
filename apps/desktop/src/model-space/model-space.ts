/** IPC between the desktop shell and the Harness page or the model page. */

export const MODEL_SPACE_IPC = {
  state: 'zhishu-model:state',
  switch: 'zhishu-model:switch',
  changed: 'zhishu-model:state-changed',
  menu: 'zhishu-model:menu',
} as const

/** Which surface covers the main window. `business` is the whole model site. */
export type ModelSpace = 'conversation' | 'business'

export interface ModelSpaceState {
  readonly active: ModelSpace
  readonly authenticated: boolean
}

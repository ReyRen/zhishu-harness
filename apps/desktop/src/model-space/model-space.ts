/** IPC between the desktop shell and the Harness page or the model page. */

export const MODEL_SPACE_IPC = {
  state: 'zhishu-model:state',
  switch: 'zhishu-model:switch',
  changed: 'zhishu-model:state-changed',
  menu: 'zhishu-model:menu',
  account: 'zhishu-model:account',
  accountGet: 'zhishu-model:account-get',
  accountChanged: 'zhishu-model:account-changed',
  logout: 'zhishu-model:logout',
  businessSidebarToggle: 'zhishu-model:business-sidebar-toggle',
} as const

/** Which surface covers the main window. `business` is the whole model site. */
export type ModelSpace = 'conversation' | 'business'

export interface ModelSpaceState {
  readonly active: ModelSpace
  readonly authenticated: boolean
}

/** Platform user shown on the conversation account menu. Both strings may be empty. */
export interface PlatformAccount {
  readonly userAccount: string
  readonly userName: string
}

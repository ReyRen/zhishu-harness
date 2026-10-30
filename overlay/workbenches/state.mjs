import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const MAX_BYTES = 1024 * 1024

export function emptyWorkbenchState() {
  return {
    version: 1,
    added: [],
    pinned: [],
    favorites: [],
    active: null,
    sessionBindings: {},
    recentSessions: {},
    known: {},
    notes: {},
    hiddenWorkspaces: {},
  }
}

export function normalizeWorkbenchState(value) {
  const state = emptyWorkbenchState()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return state
  if (Array.isArray(value.added)) state.added = value.added.filter(id => typeof id === 'string')
  if (Array.isArray(value.pinned)) state.pinned = value.pinned.filter(id => typeof id === 'string' && state.added.includes(id))
  for (const id of state.added) if (!state.pinned.includes(id)) state.pinned.push(id)
  if (Array.isArray(value.favorites)) {
    const seen = new Set()
    state.favorites = value.favorites.filter(id => typeof id === 'string' && !seen.has(id) && seen.add(id))
  }
  if (typeof value.active === 'string' || value.active === null) state.active = value.active
  if (value.sessionBindings && typeof value.sessionBindings === 'object' && !Array.isArray(value.sessionBindings)) {
    for (const [sessionId, owner] of Object.entries(value.sessionBindings)) {
      if (typeof sessionId === 'string' && typeof owner === 'string') state.sessionBindings[sessionId] = owner
    }
  }
  if (value.recentSessions && typeof value.recentSessions === 'object' && !Array.isArray(value.recentSessions)) {
    for (const [owner, sessionId] of Object.entries(value.recentSessions)) {
      if (typeof owner === 'string' && typeof sessionId === 'string') state.recentSessions[owner] = sessionId
    }
  }
  if (value.notes && typeof value.notes === 'object' && !Array.isArray(value.notes)) {
    for (const [id, note] of Object.entries(value.notes)) {
      if (typeof id === 'string' && typeof note === 'string') state.notes[id] = note
    }
  }
  if (value.hiddenWorkspaces && typeof value.hiddenWorkspaces === 'object' && !Array.isArray(value.hiddenWorkspaces)) {
    for (const [id, hidden] of Object.entries(value.hiddenWorkspaces)) {
      if (typeof id !== 'string' || !Array.isArray(hidden)) continue
      state.hiddenWorkspaces[id] = hidden.filter(workspaceId => typeof workspaceId === 'string')
    }
  }
  if (value.known && typeof value.known === 'object' && !Array.isArray(value.known)) {
    for (const [id, meta] of Object.entries(value.known)) {
      if (typeof id !== 'string' || !meta || typeof meta !== 'object' || Array.isArray(meta)) continue
      if (typeof meta.packageName !== 'string' || typeof meta.title !== 'string') continue
      state.known[id] = { packageName: meta.packageName, title: meta.title }
    }
  }
  return state
}

export function createWorkbenchStateStore(file) {
  let queue = Promise.resolve()

  async function read() {
    try {
      const text = await readFile(file, 'utf8')
      const parsed = JSON.parse(text)
      const revision = Number.isSafeInteger(parsed?.revision) && parsed.revision >= 0 ? parsed.revision : 0
      return { revision, state: normalizeWorkbenchState(parsed?.state) }
    } catch (error) {
      if (error?.code === 'ENOENT') return { revision: 0, state: emptyWorkbenchState() }
      throw error
    }
  }

  function write(payload) {
    const task = queue.then(async () => {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        const error = new Error('工作台状态格式不正确。')
        error.status = 400
        throw error
      }
      const current = await read()
      if (payload.revision !== current.revision) {
        const error = new Error('工作台已在其他窗口更新，请重新加载后再操作。')
        error.status = 409
        throw error
      }
      const next = { revision: current.revision + 1, state: normalizeWorkbenchState(payload.state) }
      const body = JSON.stringify(next)
      if (Buffer.byteLength(body) > MAX_BYTES) {
        const error = new Error('工作台状态过大。')
        error.status = 413
        throw error
      }
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, body)
      return next
    })
    queue = task.then(() => {}, () => {})
    return task
  }

  return { read, write }
}

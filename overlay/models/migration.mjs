/** Read operator-produced model-reference aliases; this file never contains credentials. */
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

export async function loadLegacySelections(platformUserID, path = join(dshHomePath('storages'), 'zhishu-models', 'legacy-model-map.json')) {
  let raw
  try {
    if ((await stat(path)).size > 1024 * 1024) throw new Error('Legacy model map exceeds its size limit')
    raw = await readFile(path, 'utf8')
  } catch (error) { if (error.code === 'ENOENT') return []; throw error }
  let document
  try { document = JSON.parse(raw) } catch { throw new Error('Legacy model map is not valid JSON') }
  if (document?.version !== 1 || !platformUserID || document.platformUserID !== platformUserID || !Array.isArray(document.models)) {
    throw new Error('Legacy model map does not belong to this platform user')
  }
  const keys = new Set()
  for (const item of document.models) {
    if (!item || typeof item.provider !== 'string' || !item.provider || typeof item.model !== 'string' || !item.model
      || !/^[1-9]\d*$/u.test(String(item.tenantID)) || typeof item.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(item.id)) {
      throw new Error('Legacy model map contains an invalid selection')
    }
    const key = JSON.stringify([item.provider, item.model])
    if (keys.has(key)) throw new Error('Legacy model map contains duplicate selections')
    keys.add(key)
  }
  return document.models
}

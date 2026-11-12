/** A platform model owner independent of a user's optional knowledge-tool bundle. */
import { createKnowledgeRuntime } from '../weknora/runtime.mjs'
import { installUnifiedModels } from '../weknora/models.mjs'
import { loadLegacySelections } from './migration.mjs'
import { installModelManagement } from './management.mjs'

export const inject = ['connection', 'llm']

export async function apply(ctx, config) {
  const platformUserID = process.env.DSH_PLATFORM_USER_ID || undefined
  if (platformUserID && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(platformUserID)) {
    throw new Error('DSH_PLATFORM_USER_ID must be the Worker-assigned user identifier')
  }
  if (process.env.DSH_PUBLIC_AUTHORITY?.startsWith('dsh-u-') && !platformUserID) {
    throw new Error('Worker must provide DSH_PLATFORM_USER_ID for platform model authentication')
  }
  const runtime = createKnowledgeRuntime({ baseUrl: config.baseUrl, platformUserID })
  ctx.effect(() => () => runtime.close(), 'unified-models: close authenticated runtime')
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/zhishu-models/auth', methods: ['GET', 'POST'], requestBody: 'buffered',
    fetch: request => runtime.handle(request),
  }), 'unified-models: owner-only SSO handoff')
  const legacySelections = await loadLegacySelections(platformUserID)
  installUnifiedModels(ctx, runtime, legacySelections)
  installModelManagement(ctx, runtime)
}

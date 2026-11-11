/** A platform model owner independent of a user's optional knowledge-tool bundle. */
import { createKnowledgeRuntime } from '../weknora/runtime.mjs'
import { installUnifiedModels } from '../weknora/models.mjs'

export const inject = ['connection', 'llm']

export function apply(ctx, config) {
  const platformUserID = process.env.DSH_PLATFORM_USER_ID || undefined
  if (platformUserID && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(platformUserID)) {
    throw new Error('DSH_PLATFORM_USER_ID must be the Worker-assigned user identifier')
  }
  if (process.env.DSH_PUBLIC_AUTHORITY?.startsWith('dsh-u-') && !platformUserID) {
    throw new Error('Worker must provide DSH_PLATFORM_USER_ID for platform model authentication')
  }
  const runtime = createKnowledgeRuntime({ baseUrl: config.baseUrl, platformUserID })
  const publicBase = new URL(config.webUrl || config.baseUrl.replace(/\/api\/v1\/?$/u, ''))
  if (!['http:', 'https:'].includes(publicBase.protocol) || publicBase.username || publicBase.password || publicBase.search || publicBase.hash) {
    throw new Error('Model settings webUrl must be an HTTP(S) base URL without credentials, query or fragment')
  }
  publicBase.pathname = publicBase.pathname.replace(/\/$/u, '') + '/sso/platform'
  publicBase.searchParams.set('target', 'models')
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/zhishu-models/config', methods: ['GET'], requestBody: 'buffered',
    fetch: () => Response.json({ settingsURL: publicBase.href }, { headers: { 'cache-control': 'no-store' } }),
  }), 'unified-models: public settings location')
  ctx.effect(() => () => runtime.close(), 'unified-models: close authenticated runtime')
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/zhishu-models/auth', methods: ['GET', 'POST'], requestBody: 'buffered',
    fetch: request => runtime.handle(request),
  }), 'unified-models: owner-only SSO handoff')
  installUnifiedModels(ctx, runtime)
}

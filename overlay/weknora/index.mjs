/** Adapt the installed WeKnora tools to the platform user's verified SSO session. */
import { apply as applyApiKey, createTools, resolveConfig, WeknoraClient } from '@wxg-prc-cpg/dsh-weknora'
import { createKnowledgeRuntime } from './runtime.mjs'

export const inject = ['tools', 'connection']

/** Register an owner-authenticated handoff and keep the upstream tool implementations. */
export async function apply(ctx, config) {
  const resolved = resolveConfig(config)
  if (config.platformUserID !== undefined && config.platformUserID !== '' && (typeof config.platformUserID !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(config.platformUserID))) {
    throw new Error('platformUserID must be the Worker-assigned user identifier')
  }
  const platformUserID = config.platformUserID || undefined
  const route = '/api/zhishu-knowledge/auth'
  if (resolved.apiKey) {
    if (platformUserID) throw new Error('Per-user platform runtimes require SSO, not shared WeKnora API keys')
    applyApiKey(ctx, config)
    ctx.effect(() => ctx.connection.fetch.register({ path: route, methods: ['GET'], requestBody: 'buffered',
      async fetch() { return Response.json({ mode: 'api-key', authenticated: true }) },
    }))
    return
  }
  if (process.env.DSH_PUBLIC_AUTHORITY?.startsWith('dsh-u-') && !platformUserID) {
    throw new Error('Worker must provide DSH_PLATFORM_USER_ID for platform knowledge authentication')
  }
  const runtime = createKnowledgeRuntime({ ...resolved, platformUserID })
  ctx.effect(() => () => runtime.close(), 'weknora: close SSO transport')
  const transport = await runtime.listen()
  ctx.effect(() => ctx.connection.fetch.register({ path: route, methods: ['GET', 'POST'], requestBody: 'buffered',
    fetch: request => runtime.handle(request),
  }), 'weknora: owner-only SSO handoff')
  const proxied = { ...resolved, ...transport, tenantId: undefined }
  for (const definition of createTools(new WeknoraClient(proxied), proxied)) {
    ctx.tools.register({ ...definition, execute(args, context) {
      // Resolve visible KBs per call so newly created bases and revoked grants take effect.
      const current = createTools(new WeknoraClient(proxied), proxied).find(tool => tool.name === definition.name)
      return current.execute(args, context)
    } })
  }
}

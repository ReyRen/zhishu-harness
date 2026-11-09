/** Adapt the installed WeKnora tools to the platform user's verified SSO session. */
import { createTools, resolveConfig, WeknoraClient } from '@wxg-prc-cpg/dsh-weknora'
import { createKnowledgeRuntime } from './runtime.mjs'
import { installSelection, knowledgeRequestID, SelectedKnowledgeClient, selectedArguments } from './selection.mjs'

export const inject = ['tools', 'connection', 'commands', 'sessionProjections']

/** Register an owner-authenticated handoff and keep the upstream tool implementations. */
export async function apply(ctx, config) {
  const resolved = resolveConfig(config)
  // User profiles may configure tools, but cannot replace the Worker-assigned identity.
  const platformUserID = process.env.DSH_PLATFORM_USER_ID || undefined
  if (platformUserID && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(platformUserID)) {
    throw new Error('DSH_PLATFORM_USER_ID must be the Worker-assigned user identifier')
  }
  if (process.env.DSH_PUBLIC_AUTHORITY?.startsWith('dsh-u-') && !platformUserID) {
    throw new Error('Worker must provide DSH_PLATFORM_USER_ID for platform knowledge authentication')
  }
  const route = '/api/zhishu-knowledge/auth'
  let transport
  if (resolved.apiKey) {
    if (platformUserID) throw new Error('Per-user platform runtimes require SSO, not shared WeKnora API keys')
    ctx.effect(() => ctx.connection.fetch.register({ path: route, methods: ['GET'], requestBody: 'buffered',
      async fetch() { return Response.json({ mode: 'api-key', authenticated: true }) },
    }))
    transport = resolved
  } else {
    const runtime = createKnowledgeRuntime({ ...resolved, platformUserID })
    ctx.effect(() => () => runtime.close(), 'weknora: close SSO transport')
    transport = await runtime.listen()
    ctx.effect(() => ctx.connection.fetch.register({ path: route, methods: ['GET', 'POST'], requestBody: 'buffered',
      fetch: request => runtime.handle(request),
    }), 'weknora: owner-only SSO handoff')
  }
  const proxied = { ...resolved, ...transport, tenantId: resolved.apiKey ? resolved.tenantId : undefined }
  const selection = await installSelection(ctx, new WeknoraClient(proxied), resolved.knowledgeBaseIds)
  const descriptions = {
    list_knowledge_bases: 'Show the knowledge bases explicitly selected by the user for this conversation.',
    search: 'Search only the user-selected knowledge bases and return passages with document references. Do not widen the scope. Empty results mean no evidence was found.',
    read_document: 'Read a document belonging to the user-selected knowledge bases, using its knowledge_id from retrieval.',
    ask: 'Ask WeKnora to compose a cited answer using only the user-selected knowledge bases. Uses a fresh scoped RAG session; custom agents, prior session IDs and web search are not allowed.',
  }
  for (const definition of createTools(new WeknoraClient(proxied), proxied)) {
    ctx.tools.register({ ...definition,
      description: descriptions[definition.name.slice(resolved.toolPrefix.length + 1)],
      execute(args, context) {
        return selection.run(context, async (ids, signal) => {
          const config = { ...proxied, knowledgeBaseIds: ids, agentId: undefined }
          const requestID = knowledgeRequestID(platformUserID, context.agent.id, context.callId)
          const client = new SelectedKnowledgeClient(config, ids, requestID)
          const current = createTools(client, config).find(tool => tool.name === definition.name)
          return current.execute(selectedArguments(args, ids), { ...context, signal })
        })
      },
    }, { when: ({ agent }) => selection.selectionOf(agent).length > 0 })
  }
}

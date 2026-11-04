# Built-in WeKnora

English | [中文](README.zh.md)

Every platform Web and Desktop profile loads `@wxg-prc-cpg/dsh-weknora@0.1.0` from its private installation. Users do not install a market plugin or change their profiles. A profile that already owns this bundle supplies its own copy, avoiding duplicate registrations. Headless and SDK profiles do not load platform Web overlays.

The upstream plugin provides `weknora_list_knowledge_bases`, `weknora_search`, `weknora_read_document`, and `weknora_ask` to conversation agents, including Code Mode. Search returns passages, reading returns document chunks, and ask delegates to WeKnora's model. See the [upstream reference](https://github.com/Tencent/WeKnora/tree/main/packages/dsh-weknora) for tool behavior and limits.

Configure the Host environment before launching Web or Desktop. The container example forwards these variables; production Workers must supply them when creating each user's container. Changes require restarting that user's runtime.

| Variable | Meaning | Default |
|---|---|---|
| `WEKNORA_BASE_URL` | Backend URL; `/api/v1` is appended when absent | `http://localhost:8080/api/v1` |
| `WEKNORA_API_KEY` | WeKnora credential sent as `X-API-Key` | Unset |
| `WEKNORA_TENANT_ID` | Workspace selector sent as `X-Tenant-ID`, required for platform keys | Unset |
| `WEKNORA_KNOWLEDGE_BASE_IDS` | Comma-separated default knowledge base IDs | All bases visible to the credential |
| `WEKNORA_AGENT_ID` | Custom WeKnora agent for `weknora_ask` | RAG pipeline |
| `WEKNORA_RESOURCE_URLS` | `public` for loadable citations or `handle` for internal references | `handle` |

The credential needs `retrieve`; ask also needs `chat`. It is distinct from a model API key and the SSO Client Secret. The plugin does not inherit iframe login tokens. Each runtime uses its configured credential: sharing a credential shares its authorization. Current-user SSO requires a separate plugin adaptation. No production credential is included; live-backend verification remains pending until authentication is configured.

Without a reachable, authorized backend, tools remain registered and calls report errors. The default URL is the upstream development endpoint; a container's `localhost` refers to itself. `docker/.env.example` shows the existing 230 backend address for deployment configuration.

The image build runs [a keyless Web smoke](../../docker/smoke-weknora.mjs) against a local mock backend and deterministic model. It checks real agent calls, independent runtime credentials, denied scope, profile ownership and removal on unload. It does not verify production SSO, knowledge permissions or model quality.

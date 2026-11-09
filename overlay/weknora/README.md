# Built-in WeKnora

English | [中文](README.zh.md)

Every platform Web and Desktop profile loads `@wxg-prc-cpg/dsh-weknora@0.1.0` from its private installation. Users do not install a market plugin or change their profiles. A profile that already owns this bundle supplies its own copy, avoiding duplicate registrations. Headless and SDK profiles do not load platform Web overlays.

The upstream plugin provides `weknora_list_knowledge_bases`, `weknora_search`, `weknora_read_document`, and `weknora_ask` to conversation agents, including Code Mode. Search returns passages, reading returns document chunks, and ask delegates to WeKnora's model. See the [upstream reference](https://github.com/Tencent/WeKnora/tree/main/packages/dsh-weknora) for tool behavior and limits.

The platform client automatically obtains a `gcs-webnora` SSO ticket and hands it to its authenticated Harness Host, even when the knowledge workbench is closed. The Host exchanges it through `/auth/platform-sso/exchange`; tools use the resulting user Bearer credential. Credentials remain in memory and are never returned to the model, browser storage or JFS. Configure the backend before starting the runtime; the Worker supplies the user identity and endpoint when creating each container.

| Variable | Meaning | Default |
|---|---|---|
| `WEKNORA_BASE_URL` | Backend URL; `/api/v1` is appended when absent | `http://localhost:8080/api/v1` |
| `DSH_PLATFORM_USER_ID` | Worker-assigned platform user; the backend must verify this identity during SSO | Unset for standalone Desktop |
| `WEKNORA_API_KEY` | Explicit standalone machine credential; rejected in Worker-assigned user runtimes | Unset |
| `WEKNORA_TENANT_ID` | Optional workspace selector; the backend checks membership | The SSO user's active workspace |
| `WEKNORA_KNOWLEDGE_BASE_IDS` | Comma-separated default knowledge base IDs | All bases visible to the credential |
| `WEKNORA_AGENT_ID` | Custom WeKnora agent for `weknora_ask` | RAG pipeline |
| `WEKNORA_RESOURCE_URLS` | `public` for loadable citations or `handle` for internal references | `handle` |

Only native Host owner requests reach `/api/zhishu-knowledge/auth`. The Worker identity overrides the browser's identity assertion; gcs-webnora verifies the platform ticket and applies its existing user/workspace permissions. Local credentials refresh through `/auth/refresh`; a rejected login or refresh clears authorization. A 403 never falls back to another credential, and failed chat requests are not automatically repeated. Platform signout clears the Host credentials; upstream revocation remains enforced by gcs-webnora.

`knowledge_login_required` means reopen the signed-in platform session and retry; `knowledge_backend_unavailable` means check the configured backend and network. The default URL is the upstream development endpoint; a container's `localhost` refers to itself. `docker/.env.example` shows the 230 endpoint. Standalone API keys require `retrieve` and, for ask, `chat`; they are distinct from model keys and SSO Client Secrets.

The image build runs [a keyless Web smoke](../../docker/smoke-weknora.mjs) against a local mock backend and deterministic model. It checks real agent calls, API-key and SSO transports, owner-only handoff, independent credentials, denied scope, profile ownership and removal on unload. [Authentication tests](../../docker/tests/weknora-auth.test.mjs) cover user binding, refresh, revocation and logout races. Real platform tickets, knowledge permissions and model answers require deployment verification.

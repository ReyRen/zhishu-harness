# Built-in WeKnora

English | [中文](README.zh.md)

Every platform Web and Desktop profile loads `@wxg-prc-cpg/dsh-weknora@0.1.0` from its private installation. Users do not install a market plugin or change their profiles. A profile that already owns this bundle supplies its own copy, avoiding duplicate registrations. Headless and SDK profiles do not load platform Web overlays.

Type `/` and choose “知识库” (“Knowledge bases” in English) to search and multi-select in the native dropdown above the composer, without a separate dialog. It lists only knowledge bases available to the signed-in user and the deployment allowlist. Each check or uncheck applies immediately and keeps the list open after acknowledgment; failures retain the previous selection and show an error. Click outside or press Escape or Tab to close; acknowledged changes remain. The composer shows each selected name, with individual removal and clear-all actions. Resumed and forked conversations retain logged selections; new conversations default to no knowledge. Clearing every choice stops retrieval without removing evidence already present in conversation history. The internal command remains `knowledge`; its English alias is hidden in the menu.

Without a selection, the platform wrapper excludes all four WeKnora tools from model declarations and execution, including Code Mode. The four tools operate only within the selected union. The Host rechecks every selected base before each call, validates document membership before reading chunks, and cancels in-flight retrieval when any choice changes. Failed selections retain the previous set; revoked access fails the whole call rather than silently searching fewer bases. Search returns passages; ask uses a fresh scoped RAG session. Custom WeKnora agents, reused backend sessions, web search, and the upstream unscoped title-search fallback are disabled because they can widen the selected scope. A profile-owned upstream bundle remains independent of this platform wrapper.

The platform client automatically obtains a `gcs-webnora` SSO ticket and hands it to its authenticated Harness Host, even when the knowledge workbench is closed. The Host exchanges it through `/auth/platform-sso/exchange`; tools use the resulting user Bearer credential. Credentials remain in memory and are never returned to the model, browser storage or JFS. Configure the backend before starting the runtime; the Worker supplies the user identity and endpoint when creating each container.

| Variable | Meaning | Default |
|---|---|---|
| `WEKNORA_BASE_URL` | Backend URL; `/api/v1` is appended when absent | `http://localhost:8080/api/v1` |
| `DSH_PLATFORM_USER_ID` | Worker-assigned platform user; the backend must verify this identity during SSO | Unset for standalone Desktop |
| `WEKNORA_API_KEY` | Explicit standalone machine credential; rejected in Worker-assigned user runtimes | Unset |
| `WEKNORA_TENANT_ID` | Optional workspace selector; the backend checks membership | The SSO user's active workspace |
| `WEKNORA_KNOWLEDGE_BASE_IDS` | Comma-separated allowlist for the human picker; never automatically enables retrieval | All bases visible to the credential |
| `WEKNORA_AGENT_ID` | Upstream profile setting; the platform selection wrapper always uses scoped RAG | RAG pipeline |
| `WEKNORA_RESOURCE_URLS` | `public` for loadable citations or `handle` for internal references | `handle` |

Only native Host owner requests reach `/api/zhishu-knowledge/auth`. The Worker identity overrides the browser's identity assertion; gcs-webnora verifies the platform ticket and applies its existing user/workspace permissions. Local credentials refresh through `/auth/refresh`; a rejected login or refresh clears authorization. A 403 never falls back to another credential, and failed chat requests are not automatically repeated. Platform signout clears the Host credentials; upstream revocation remains enforced by gcs-webnora.

`knowledge_login_required` means reopen the signed-in platform session and retry; `knowledge_backend_unavailable` means check the configured backend and network. The default URL is the upstream development endpoint; a container's `localhost` refers to itself. `docker/.env.example` shows the 230 endpoint. Standalone API keys require `retrieve` and, for ask, `chat`; they are distinct from model keys and SSO Client Secrets.

Selections are reconstructed by a Session projection over successful native `knowledge` command records; no token or second Session-state file is persisted. Actual backend calls keep gcs-webnora's existing request/search logging. `X-Request-ID` carries the Worker user and hashes of the Harness Session/tool call with a random suffix, so operators can correlate KB IDs, results, status and latency without putting credentials in the identifier. The current `/knowledge-search` handler does not create a durable audit-log entry or a separate call-history page; adding one requires a backend change rather than a fabricated Harness record.

The image build runs [a keyless Web smoke](../../docker/smoke-weknora.mjs) against a local mock backend and deterministic model. It checks real agent calls, API-key and SSO transports, owner-only handoff, independent credentials, denied scope, profile ownership and removal on unload. [Authentication tests](../../docker/tests/weknora-auth.test.mjs) cover user binding, refresh, revocation and logout races. [Selection tests](../../docker/tests/weknora-selection.test.mjs) cover replay, scope restrictions, revocation and cancellation; [picker tests](../../docker/tests/weknora-picker.test.mjs) cover command acknowledgment and per-conversation choices. Real platform tickets, knowledge permissions and model answers require deployment verification.

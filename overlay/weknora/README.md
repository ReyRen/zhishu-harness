# Built-in WeKnora

English | [中文](README.zh.md)

The picker and tool catalog combine the current workspace's bases with bases shared to it, deduplicated by knowledge-base ID. Both lists use the same credentials, tenant scope and deployment allowlist. Shared-list failures stop catalog validation; revoked sharing stops the next selected tool call. Retrieval keeps the receiver's identity so gcs-webnora checks the source workspace and sharing permissions.

Every platform Web and Desktop profile loads `@wxg-prc-cpg/dsh-weknora@0.1.0` from its private installation. Users do not install a market plugin or change their profiles. A profile that already owns this bundle supplies its own copy, avoiding duplicate registrations. Headless and SDK profiles do not load platform Web overlays.

Type `/` and choose “知识库” (“Knowledge bases” in English) to search and multi-select in the native dropdown above the composer. It lists only bases available to the signed-in user and the deployment allowlist. Checks apply immediately after acknowledgment; failures retain the previous selection. The composer keeps one entry: no selection shows its title, one shows the name, and several show a count. Click it to reopen without changing drafts or attachments. The dropdown shows full names, All and Selected filters, search, and clear-all. Tab reaches these controls; an outside click, Escape, or focus leaving closes it. Resumed and forked conversations retain logged selections; new conversations default to no knowledge. Clearing choices stops retrieval without removing historical evidence. The internal command remains `knowledge`; its English alias is hidden in the menu.

Without a selection, the platform wrapper excludes every WeKnora tool from model declarations and execution, including Code Mode. The tools operate only within the selected union. The Host rechecks every selected base before each call, validates document membership before reading chunks, and cancels in-flight retrieval when any choice changes. Failed selections retain the previous set; revoked access fails the whole call rather than silently searching fewer bases. Search returns passages; ask uses a fresh scoped RAG session. Custom WeKnora agents, reused backend sessions, web search, and the upstream unscoped title-search fallback are disabled because they can widen the selected scope. A profile-owned upstream bundle remains independent of this platform wrapper.

For each accepted human text question with a selection, the Host retrieves passages and a document overview before the first model request. Native runtime context records this evidence in the Session log. `maxResults` bounds passages, Wiki matches and overview documents. `maxChunkChars` bounds each excerpt, summary and retrieval query. The overview includes document counts, parse status and pagination. Summaries can inspect `weknora_overview` and `weknora_read_document`. Search results retain rerank diagnostics and report partial coverage. Authentication, access and backend failures replace pending evidence with a failure report. Clearing the selection stops new retrieval without erasing historical evidence.

For selected Wiki-enabled bases, automatic retrieval and `weknora_search` also return Wiki page titles, slugs, summaries and matching excerpts through gcs-webnora's Wiki search. Wiki-only bases can return authored pages even when they have zero source documents. Mixed selections use each base's enabled indexes. Use `weknora_wiki_read_page` to read a matched page and its recorded source references. The tool rechecks access and forwards a read request to the selected Wiki.

The knowledge UI opens as a global sidebar panel, independent of workbench installation. Existing knowledge-workbench chats move to the main conversation list without deleting Session logs, files or notes. The AI assistant starts a native conversation only after leaving workbench mode successfully.

The platform client automatically obtains a `gcs-webnora` SSO ticket and hands it to its authenticated Harness Host, even when the knowledge panel is closed. The Host exchanges it through `/auth/platform-sso/exchange`; tools use the resulting user Bearer credential. Credentials remain in memory and are never returned to the model, browser storage or JFS. Signout rejects pending tickets before handoff and clears Host credentials even if that handoff fails. Configure the backend before starting the runtime; the Worker supplies the user identity and endpoint when creating each container.

| Variable | Meaning | Default |
|---|---|---|
| `WEKNORA_BASE_URL` | API URL reachable from the Harness Host. The tools append `/api/v1` when absent. Desktop fills `http://172.18.36.230:5175/weknora/api/v1` when unset | Overlay fallback `http://localhost:8080/api/v1` |
| `DSH_PLATFORM_USER_ID` | Worker-assigned platform user; the backend must verify this identity during SSO | Unset for standalone Desktop |
| `WEKNORA_API_KEY` | Explicit standalone machine credential; rejected in Worker-assigned user runtimes | Unset |
| `WEKNORA_TENANT_ID` | Optional workspace selector; the backend checks membership | The SSO user's active workspace |
| `WEKNORA_KNOWLEDGE_BASE_IDS` | Comma-separated allowlist for the human picker; never automatically enables retrieval | All bases visible to the credential |
| `WEKNORA_AGENT_ID` | Upstream profile setting; the platform selection wrapper always uses scoped RAG | RAG pipeline |
| `WEKNORA_RESOURCE_URLS` | `public` for loadable citations or `handle` for internal references | `handle` |

Set the API address in [`docker/.env`](../../docker/.env.example) as `WEKNORA_BASE_URL`, or in the Worker deployment's `worker.json` as `weknoraBaseURL`. Use an absolute HTTP(S) URL without credentials, query or fragment. After changing the address, recreate the Compose container or deploy the Worker configuration and roll out existing users.

### Web gateway

Harness Web opens `/weknora/sso/platform` on its current origin. On x86 and ARM, the front-web server block that serves Harness proxies the entire `/weknora/` prefix to the gcs-webnora HTTP service, including its assets and APIs. The gateway can reach gcs-webnora by service name on a shared network or by internal address on a separate server. Keep the path prefix on the upstream request.

```nginx
location ^~ /weknora/ {
    proxy_pass http://webnora.internal:5175;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_read_timeout 1800s;
}
```

Use the actual gcs-webnora upstream in `proxy_pass`. Include the public Harness origin, with its port, in gcs-webnora's `PLATFORM_SSO_PARENT_ORIGINS`. Retain the allowed ancestors for the outer platform page and its registered `gcs-webnora` SSO client.

The native Desktop renderer uses the configured API service's knowledge page. The packaged business workspace serves Harness over its local HTTP gateway, which proxies the same `/weknora/` prefix.

### Authentication and retrieval

Only native Host owner requests reach `/api/zhishu-knowledge/auth`. The Worker identity overrides the browser's identity assertion; gcs-webnora verifies the platform ticket and applies its existing user/workspace permissions. Local credentials refresh through `/auth/refresh`; a rejected login or refresh clears authorization. A 403 never falls back to another credential, and failed chat requests are not automatically repeated. Platform signout clears the Host credentials; upstream revocation remains enforced by gcs-webnora.

`knowledge_login_required` means reopen the signed-in platform session and retry; `knowledge_backend_unavailable` means check the configured backend and network. The default URL is the upstream development endpoint; a container's `localhost` refers to itself. `docker/.env.example` shows the 230 endpoint. Standalone API keys require `retrieve` and, for ask, `chat`; they are distinct from model keys and SSO Client Secrets.

With a knowledge base selected, attaching an image searches the selected bases that have image vectors enabled. The embedding model must accept images. The first attached image is the query. A text question also searches the document and Wiki indexes. Authorized document and Wiki images can appear in the answer with captions. When an image is loaded, the Host sends the signed-in user's credential to the knowledge base's file endpoint and gcs-webnora checks access again.

Successful `/knowledge-search` and `/wiki-search` calls appear in the searched knowledge base's Activity log with the actor, time and retrieval mode. The activity details contain neither the question nor the image bytes. Existing operational logs retain the `X-Request-ID` that associates backend requests with the Worker user and hashed Harness Session and tool call. The SSO transport uses private resource handles. Standalone API-key profiles can request public resource URLs and use private handles when WebNora refuses public URLs for a scoped key.

The image build runs [a keyless Web smoke](../../docker/smoke-weknora.mjs) against a local mock backend and deterministic model. It checks real agent calls, API-key and SSO transports, owner-only handoff, independent credentials, denied scope, profile ownership and removal on unload. [Authentication tests](../../docker/tests/weknora-auth.test.mjs) cover user binding, refresh, revocation and logout races. [Selection tests](../../docker/tests/weknora-selection.test.mjs) cover replay, scope restrictions, revocation and cancellation; [picker tests](../../docker/tests/weknora-picker.test.mjs) cover command acknowledgment and per-conversation choices. Real platform tickets, knowledge permissions and model answers require deployment verification.

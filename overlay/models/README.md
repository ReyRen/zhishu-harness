# Unified model settings

English | [中文](README.zh.md)

Platform Web profiles manage models in **Settings → Models**, using gcs-webnora's existing type tabs, cards, search, editor and connection tests. Other Harness settings pages retain their native layout. The authenticated `/harness/models` page offers chat, embedding, rerank, vision and speech models; ordinary workspace roles still govern who can edit them. Users choose among configured models in chat or in each knowledge base. Existing document indexes retain their embedding-model binding.

## Configuration and execution

`WEKNORA_BASE_URL` selects the existing authenticated gcs-webnora API, including `/api/v1`. `WEKNORA_WEB_URL` optionally selects its browser-facing base URL, including any proxy subpath; without it, the browser base is the API base with `/api/v1` removed. Worker supplies `DSH_PLATFORM_USER_ID`; authentication uses the current user's platform SSO and retains tokens only in Host memory. No shared model key or user-controlled identity replaces that authorization.

The registry and credentials remain in gcs-webnora's database. Harness uses the registered `zhishu-models` adapter and the workspace-authorized streaming endpoint; gcs-webnora resolves credentials and contacts the configured inference provider. This additional backend hop keeps stored keys out of browser responses and user containers, and lets knowledge-base background jobs continue when a Harness container stops. The service must be reachable on the site's network. Bundled dependencies do not supply model inference when that service or the model endpoint is unavailable.

Model selections use `<workspaceID>:<modelID>`, so equal names cannot merge models across workspaces. A prepared call carries the stored model revision; a concurrent edit produces a visible configuration-change error. The adapter preserves tool JSON, model-bound reasoning state and streamed usage. It rejects incomplete streams and explicit stop sequences, which the current backend API does not support. Images use the existing retained-attachment projection and the request body is limited to 32 MiB.

## Existing profiles

The platform overlay disables the old built-in provider configuration page and routes. The operator's gcs-webnora import command migrates existing model definitions and credentials into each verified owner's private workspace without changing existing knowledge-base bindings; it reuses fully equal configurations and preserves distinct connections. The resulting credential-free `DSH_HOME/storages/zhishu-models/legacy-model-map.json` records `version: 1`, `platformUserID` and `models` entries (`provider`, `model`, `tenantID`, `id`). The Host validates its owner and uses these exact aliases before name matching, including when another workspace is active. Old files are retained. Models configured only in a stopped user's profile require this import before rollout.

Idle conversations with retired routes move through the native logged model-selection API using that import map, a unique matching name, a single workspace default or its sole model. Ambiguous matches and deleted mapped models require an explicit selection. Active third-party adapter selections and existing unified selections remain unchanged. The model owner loads independently of the optional knowledge-tool bundle.

## Verification

The build runs [adapter tests](../../docker/tests/unified-models.test.mjs) and [a real Web composition smoke](../../docker/smoke-models.mjs). The smoke authenticates an isolated user against a mock backend, migrates a retired selection, executes a knowledge tool and completes the next model round without external networking or real user storage. It validates composition and protocol behavior; a site-specific real-model check is separate.

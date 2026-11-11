# Unified model settings

English | [中文](README.zh.md)

Platform Web profiles manage models in **Settings → Models**, using gcs-webnora's existing type tabs, cards, search, editor and connection tests. Other Harness settings pages retain their native layout. The authenticated `/harness/models` page offers chat, embedding, rerank, vision and speech models; ordinary workspace roles still govern who can edit them. Users choose among configured models in chat or in each knowledge base. Existing document indexes retain their embedding-model binding.

## Configuration and execution

`WEKNORA_BASE_URL` selects the existing authenticated gcs-webnora API, including `/api/v1`. `WEKNORA_WEB_URL` optionally selects its browser-facing base URL, including any proxy subpath; without it, the browser base is the API base with `/api/v1` removed. Worker supplies `DSH_PLATFORM_USER_ID`; authentication uses the current user's platform SSO and retains tokens only in Host memory. No shared model key or user-controlled identity replaces that authorization.

The registry and credentials remain in gcs-webnora's database. Harness uses the registered `zhishu-models` adapter and the workspace-authorized streaming endpoint; gcs-webnora resolves credentials and contacts the configured inference provider. This additional backend hop keeps stored keys out of browser responses and user containers, and lets knowledge-base background jobs continue when a Harness container stops. The service must be reachable on the site's network. Bundled dependencies do not supply model inference when that service or the model endpoint is unavailable.

Model selections use `<workspaceID>:<modelID>`, so equal names cannot merge models across workspaces. A prepared call carries the stored model revision; a concurrent edit produces a visible configuration-change error. The adapter preserves tool JSON, model-bound reasoning state and streamed usage. It rejects incomplete streams and explicit stop sequences, which the current backend API does not support. Images use the existing retained-attachment projection and the request body is limited to 32 MiB.

## Existing profiles

The platform overlay disables the old built-in provider configuration page and routes. Existing credentials are not imported or deleted. Models are configured in the shared registry; idle conversations with retired routes move through the native logged model-selection API when the model name has one match, or when a single workspace default or sole model is available. Ambiguous matches require an explicit selection. Active third-party adapter selections and existing unified selections remain unchanged. The model owner loads independently of the optional knowledge-tool bundle.

## Verification

The build runs [adapter tests](../../docker/tests/unified-models.test.mjs) and [a real Web composition smoke](../../docker/smoke-models.mjs). The smoke authenticates an isolated user against a mock backend, migrates a retired selection, executes a knowledge tool and completes the next model round without external networking or real user storage. It validates composition and protocol behavior; a site-specific real-model check is separate.

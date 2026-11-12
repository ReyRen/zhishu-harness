# Unified model settings

English | [中文](README.zh.md)

Platform Web profiles manage models in **Settings → Model settings**, using native Harness components for type filters, cards, search, editing and connection tests. The design follows gcs-webnora's model settings; the page mounts directly in the existing settings shell. Chat, embedding, rerank, vision and speech recognition models use the shared registry and its workspace roles. Users choose among configured models in chat or in each knowledge base. Existing document indexes retain their embedding-model binding.

The embedded knowledge workspace has no separate model-administration page. Its model selectors open Harness settings through the current iframe's origin-checked `weknora:open-model-settings` message; model changes invalidate its catalog through `weknora:models-updated`. Application-specific model choices remain unchanged. The knowledge picker shares one authentication handoff across callers, isolates caller cancellation, and requests a fresh SSO ticket once after a catalog 401.

## Configuration and execution

`WEKNORA_BASE_URL` selects the existing authenticated gcs-webnora API, including `/api/v1`. Worker supplies `DSH_PLATFORM_USER_ID`; authentication uses the current user's platform SSO and retains tokens only in Host memory. No shared model key or user-controlled identity replaces that authorization. The native page calls owner-authenticated `/api/zhishu-models/manage` operations and needs no separate model-page URL. The knowledge page has its own browser URL configuration.

The settings plugin retains loaded rows and unfinished drafts while switching sections. Signing out clears those rows and typed secrets. Saved credentials remain write-only: empty fields preserve them, explicit removal clears them, and connection tests refer to the saved model id. A failed credential update retains the committed definition id for retry. An unconfirmed save requires closing the editor and refreshing the list before another create. Existing embedding identities and dimensions stay fixed in the editor; changing them requires a new model and explicit reindexing.

The registry and credentials remain in gcs-webnora's database. Harness uses the registered `zhishu-models` adapter and the workspace-authorized streaming endpoint; gcs-webnora resolves credentials and contacts the configured inference provider. This additional backend hop keeps stored keys out of browser responses and user containers, and lets knowledge-base background jobs continue when a Harness container stops. The service must be reachable on the site's network. Bundled dependencies do not supply model inference when that service or the model endpoint is unavailable.

Model selections use `<workspaceID>:<modelID>`, so equal names cannot merge models across workspaces. A prepared call carries the stored model revision; a concurrent edit produces a visible configuration-change error. The adapter preserves tool JSON, model-bound reasoning state and streamed usage. It rejects incomplete streams and explicit stop sequences, which the current backend API does not support. Images use the existing retained-attachment projection and the request body is limited to 32 MiB.

## Existing profiles

The platform overlay disables the old built-in provider configuration page and routes. The operator's gcs-webnora import command migrates existing model definitions and credentials into each verified owner's private workspace without changing existing knowledge-base bindings; it reuses fully equal configurations and preserves distinct connections. The resulting credential-free `DSH_HOME/storages/zhishu-models/legacy-model-map.json` records `version: 1`, `platformUserID` and `models` entries (`provider`, `model`, `tenantID`, `id`). The Host validates its owner and uses these exact aliases before name matching, including when another workspace is active. Old files are retained. Models configured only in a stopped user's profile require this import before rollout.

Idle conversations with retired routes move through the native logged model-selection API using that import map, a unique matching name, a single workspace default or its sole model. Ambiguous matches and deleted mapped models require an explicit selection. Active third-party adapter selections and existing unified selections remain unchanged. The model owner loads independently of the optional knowledge-tool bundle.

## Verification

The build runs [adapter tests](../../docker/tests/unified-models.test.mjs), [native management tests](../../docker/tests/native-model-settings.test.mjs) and [a real Web composition smoke](../../docker/smoke-models.mjs). The smoke authenticates an isolated user against a mock backend, saves through native management, migrates a retired selection, executes a knowledge tool and completes the next model round without external networking or real user storage. It validates composition and protocol behavior; a site-specific real-model check is separate.

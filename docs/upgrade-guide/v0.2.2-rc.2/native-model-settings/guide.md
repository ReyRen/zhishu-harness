---
kind: upgrade-guide
description: Platform model settings use native Harness controls and owner-authenticated management operations instead of the model-page URL endpoint.
---

# Native platform model settings

English | [中文](guide.zh.md)

## Change

Platform compositions using `platformModelManagement: true` display **Settings → Model settings** through native Harness components. The shared gcs-webnora registry, saved model ids, migrated aliases, credentials and knowledge-base bindings remain unchanged. The `/api/zhishu-models/config` URL endpoint is replaced by owner-authenticated `/api/zhishu-models/manage` operations. Model settings no longer use `WEKNORA_WEB_URL`; the knowledge page keeps its separate browser URL configuration.

## Migration

1. Deploy the Harness Host and Client from the same image. Retain `WEKNORA_BASE_URL`, Worker-provided `DSH_PLATFORM_USER_ID` and current-user SSO; do not repeat the completed legacy-model import.
2. Remove model-page URL consumers. Native settings use GET management operations `context`, `models` and `providers`, and explicit POST operations for model definitions, credentials, copies, deletion and connection tests. Keep credentials on the Host and shared backend.
3. Open **Settings → Model settings**, switch to another settings section and return. Confirm cached rows and unfinished editor values remain, and that an existing chat and knowledge base use their original model configurations. Keep indexed embedding-model bindings intact.
4. Deploy the matching gcs-webnora knowledge-workspace frontend. Its separate model, Ollama and catalog administration entries are removed; application model selectors open Harness's native settings. Preserve existing model records and per-knowledge-base selections. Standalone gcs-webnora builds retain their own administration.

---
kind: upgrade-guide
description: Platform Web model configuration moves from profile providers to the authenticated shared model registry.
---

# Platform unified models

English | [中文](guide.zh.md)

## Change

Platform Web profiles use gcs-webnora's model registry in **Settings → Model settings**. The old platform profile provider routes are disabled; an operator imports existing definitions and credentials into their owners' private workspaces before rollout. Original files remain. Stock compositions without platform overlays keep their existing settings. Harness shows the current user’s complete available catalog without a workspace selector. Applications retain their own selections. Existing model IDs, knowledge-base bindings and indexes are unchanged.

## Migration

1. Stop every old gcs-webnora API and background writer and take a consistent database backup. Apply PostgreSQL migration 139 or SQLite migration 55. Startup audits legacy model references before activating the user-catalog policy; existing cross-owner references require migration review. Activated policy migrations reject automatic downgrade. Deploy the gcs-webnora version that provides `/harness/models`, `GET /api/v1/models/available` and `POST /api/v1/models/:id/harness-chat` before rolling out the Harness image.
2. Configure `WEKNORA_BASE_URL` and, when its public proxy differs, `WEKNORA_WEB_URL`. Keep Worker-provided `DSH_PLATFORM_USER_ID` and current-user SSO. Do not export stored model keys into user containers.
3. Back up the backend database and legacy profile/credential files. Use gcs-webnora's `cmd/migrate-harness-models` in plan mode, review the verified private-workspace targets, then apply. Install each owner's credential-free alias map at `DSH_HOME/storages/zhishu-models/legacy-model-map.json`. Confirm that old model endpoints and explicit capabilities are retained without overwriting existing configurations. In **Settings → Model settings**, verify chat and embedding configurations with the editor and connection test.
4. Open an idle existing conversation. A unique matching name, a single workspace default or its sole available model selects the unified model through native session events. Ambiguous catalogs require selection from the composer. Active third-party adapters and already explicit unified selections remain intact.
5. Verify the same available catalog in Harness and knowledge-base selectors, a real chat and a knowledge-base request. New references may select a model owned outside the business workspace; older backends cannot execute those references. Before a backend rollback, preserve the current database and review these bindings instead of overwriting current data with an old backup. Keep existing embedding bindings for indexed documents; replacing them still requires explicit reindexing. See [configuration and limitations](../../../../overlay/models/README.md).

---
kind: upgrade-guide
description: Selected platform knowledge bases are retrieved before human questions reach the model, and search results retain retrieval diagnostics.
---

# Selected knowledge retrieval

English | [中文](guide.zh.md)

## Change

Platform Web and Desktop compositions retrieve evidence and a bounded document overview before sending each accepted human text question to the model when knowledge bases are selected. The previous composition only exposed optional tools. Native Session logs retain the evidence. Search outputs add `retrieval` diagnostics, and the new `weknora_overview` tool provides scoped document discovery. Platform ask declarations omit the already-rejected `agent_id`, `session_id` and `web_search` arguments. Independently installed upstream bundles keep their own behavior.

## Migration

1. Deploy the matching Harness Host and Client. Retain the existing SSO identity, `WEKNORA_BASE_URL`, model registry and indexed documents. No Session-format or database migration is required.
2. Ensure the backend provides the authenticated `GET /api/v1/knowledge-bases/:id/knowledge` route with `data` and `total`, alongside existing selected retrieval routes. gcs-webnora enforces access to owned and shared bases. Standalone API keys need retrieval permission.
3. Open a conversation, select a knowledge base and ask a specific document question. Confirm the first model request contains logged selected-knowledge context. Ask for a summary and confirm the answer uses actual documents and identifies partial coverage.
4. Clear the selection and send another question. Confirm no new knowledge retrieval occurs. Consumers decoding search results must accept the additive `retrieval` field and keep no-match, rerank filtering and request failures distinct from an empty document catalog.

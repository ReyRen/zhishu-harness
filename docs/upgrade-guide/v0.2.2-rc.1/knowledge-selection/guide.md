---
kind: upgrade-guide
description: "Platform WeKnora tools require an explicit conversation knowledge selection and no longer search all visible knowledge bases by default."
---

# Select knowledge before retrieval

English | [中文](guide.zh.md)

## Change

The platform WeKnora wrapper keeps its tools unavailable until a user selects a knowledge base. `WEKNORA_KNOWLEDGE_BASE_IDS` limits available choices; it no longer enables default retrieval. The wrapper uses fresh scoped RAG sessions and rejects custom agents, reused backend sessions and web search. Profile-owned upstream bundles remain independent.

## Migration

1. Keep the current SSO and backend configuration; no token migration is required.
2. In the conversation composer, type `/`, choose “Knowledge bases”, check one or more available bases and save. New conversations start without a selection; resumed and forked conversations retain logged selections. Existing single selections remain selected.
3. Confirm the composer displays all selected names. Retrieval and document reading stay within their union; each selected base is rechecked for access before retrieval. Cancel discards the dialog draft; changing the selection cancels active retrieval.
4. Click clear or run `/knowledge off` to disable the tools. Previously retrieved content remains in conversation history. See the [platform plugin reference](../../../../overlay/weknora/README.md).

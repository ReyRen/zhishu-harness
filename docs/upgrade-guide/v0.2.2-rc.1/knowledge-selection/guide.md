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
2. In the conversation composer, type `/`, choose “Knowledge bases”, and check one or more available bases in the native dropdown. Each change applies immediately, without a save dialog. New conversations start without a selection; resumed and forked conversations retain logged selections. Existing single selections remain selected.
3. The composer keeps one control: no selection shows “Knowledge bases”, one shows its name, and several show the selected count. Click it to reopen the same dropdown without changing drafts or attachments; search or switch to Selected to review full names. Tab reaches the filter and clear controls; an outside click, Escape, or focus leaving closes the dropdown. Retrieval and document reading stay within the selected union; each base is rechecked for access, and selection changes cancel active retrieval.
4. Clear every selection or run `/knowledge off` to disable the tools. Previously retrieved content remains in conversation history. See the [platform plugin reference](../../../../overlay/weknora/README.md).

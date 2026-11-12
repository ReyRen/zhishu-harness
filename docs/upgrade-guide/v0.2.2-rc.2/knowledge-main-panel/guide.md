---
kind: upgrade-guide
description: Platform knowledge navigation moves from an installed workbench to a global panel.
---

# Knowledge panel

English | [中文](guide.zh.md)

## Change

Platform Web and Desktop profiles open knowledge from the global sidebar instead of an installed workbench. Existing knowledge-workbench conversations become main conversations; unrelated workbench ownership, Session logs, files and notes remain intact. The knowledge panel's AI assistant starts a native main conversation.

## Migration

1. Back up the existing workbench state before rollout using the platform release procedure.
2. Open the updated client. It removes only the legacy knowledge launcher and its conversation-owner references. A load or save failure remains visible and stops dependent actions.
3. Verify that historical knowledge conversations remain accessible in the main list, other workbenches retain their conversations, and the knowledge panel opens without a market installation.

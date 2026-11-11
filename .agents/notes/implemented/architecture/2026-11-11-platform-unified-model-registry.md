# Agent Note: Platform unified model registry

Status: implemented

English | [中文](2026-11-11-platform-unified-model-registry.zh.md)

## Problem

Independent Harness and knowledge-base model editors require duplicate setup, while copying credentials into per-user containers expands access and leaves background indexing dependent on a user runtime's availability.

## Decision

The platform Models section embeds the existing authenticated gcs-webnora editor. Its database owns model definitions and credentials; an independent Harness adapter requests authorized inference there using the current user's SSO. Stable model IDs include the ordinary workspace, and captured configuration revisions prevent mixed metadata and credential versions. Sharing a knowledge base does not authorize its source workspace's model settings.

## Alternatives considered

Copying model configuration between two stores preserves competing owners and needs credential replication. Fetching keys into Harness containers avoids an inference hop but exposes credentials beyond their existing owner. Moving knowledge-base execution into user containers prevents offline background work when those containers are stopped. A second React editor duplicates gcs-webnora's validation, protocol catalogs and deletion guards.

## Consequences

The platform requires the model-registry backend for inference and adds an internal streaming hop. Authentication stays per user, stored keys remain server-side and knowledge-base indexing stays independent. Stock compositions retain their own provider editors. Existing platform profile-only models need configuration in the shared registry; ambiguous old selections remain explicit user decisions. Adapter tests and the shipped Web composition smoke cover authorization, logout cancellation, revisions, model selection, tool rounds and truncated streams.

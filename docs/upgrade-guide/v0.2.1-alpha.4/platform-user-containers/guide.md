---
kind: upgrade-guide
description: "Platform user containers require scoped bubblewrap policies and Worker-managed Docker instead of user Swarm Services."
---

# Run platform users through the restricted Worker

English | [中文](guide.zh.md)

## Change

The platform Docker deployment now bundles the primary runtime and seven Office skills and requires a scoped bubblewrap policy. User workloads run as ordinary Docker containers managed by GCS Worker, not Swarm Services. Existing Master configurations with Docker/Overlay placement fields are rejected; the public launch and terminate interfaces remain unchanged. JFS user directories are not migrated or deleted.

## Migration

1. Update Master and Worker from their merged main branches. Install `docker/security/install.sh` on each qualified Worker. Do not enable privileged mode or change daemon-wide security defaults; review the security tradeoffs in the [Docker README](../../../../docker/README.md).
2. Configure Master `workers` with real per-node URLs, not routing mesh. Configure the trusted Worker with its Docker socket, JFS root, private `dataDir`, named AppArmor profile and seccomp file. Restrict the Worker control port to Master/local administration.
3. Build the DSH image from merged main and distribute the exact Image ID to all configured Workers. Update both Master configurations only after smoke tests pass.
4. Follow the [release procedure](../../../cookbook/updating-platform-fork.md) for a maintenance-window migration: stop each old user Service before creating its replacement against `/storage-root-jfs/user-<userID>`. Never run both generations against the same directory.
5. Confirm every intended user container is healthy and uses the expected image and specification. Test launch, native Web/settings, command confinement, Office rendering and terminate/relaunch with preserved history. Retain old stopped workloads/images until stability is verified.

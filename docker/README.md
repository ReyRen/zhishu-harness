# DSH container build

English | [中文](README.zh.md)

This directory builds `zhishu-harness` into the complete native Web image. Master authenticates and selects a Worker; Worker creates each user's ordinary Docker container through the local Engine API. The image keeps the native Web UI, uses no Nginx, and enables the managed default Workspace and user-directory restrictions on `main`.

## Related projects

| Project | Responsibility |
| --- | --- |
| [zhishu-harness](https://github.com/ReyRen/zhishu-harness) | This repository; tracks DSH upstream and builds the native Web image |
| [gcs-harness-master](https://github.com/ReyRen/gcs-harness-master) | Authenticates, selects Workers, and routes each user's iframe |
| [gcs-harness-worker](https://github.com/ReyRen/gcs-harness-worker) | Manages restricted user containers and proxies their private bridge addresses |

## Update from upstream

`master` only tracks official `upstream/master`; it contains no platform changes and is never used to build images. `main` is the platform-development and image-build branch. Follow the [upstream update and release guide](../docs/cookbook/updating-platform-fork.md) for conflict review, validation, a pull request into this fork's `main`, image construction, and rollout.

## Build an image

Build only from a clean checkout of the merged `main` on a labeled Worker. The [release guide](../docs/cookbook/updating-platform-fork.md) gives the commands and the image-ID rollout procedure. Docker reuses unchanged dependency layers; `DSH_CLIENT_COMMIT_HASH` records the exact source revision in the frontend and the image's `org.opencontainers.image.revision` label.

## User Workspaces

The container creates and automatically opens `/storage-root-jfs/user/workspace`, so a user can chat immediately. On the Worker this maps to `/storage-root-jfs/user-<userID>/workspace`. The native Web UI cannot remove this required default Workspace, but users can create and switch to other Workspaces.

The directory picker is rooted at `/storage-root-jfs/user`. It shows only the current user's mounted directory and descendants and refuses paths or symbolic links that leave the root. `DSH_WORKSPACE_ROOT`, `DSH_DEFAULT_WORKSPACE`, and `DSH_DEFAULT_WORKSPACE_TITLE` configure this policy; the production image supplies fixed defaults and Compose states them explicitly.

## Office authoring

The build prepares the official [primary runtime](../packages/skill/tool-workspace-dependencies/README.md) and Office resources from the upstream download lock. [cache-primary-runtime.mjs](cache-primary-runtime.mjs) uses curl to cache those exact official archives, checks SHA256, and leaves assembly and validation to the upstream builder; it uses no mirror or intermediary server. `DSH_RESOURCE_DOWNLOAD_TIMEOUT_MS` is a build argument with a 600000 ms per-download default for large release assets. `DSH_PRIMARY_RUNTIME=/opt/dsh-runtime/primary-runtime` selects the bundled Python, Node.js and pnpm; Python includes numpy, pandas and the Word, Excel and PowerPoint authoring libraries. The bundled Python is also first on `PATH`.

The container loads [office.cordis.patch.yml](office.cordis.patch.yml), exposing `load_workspace_dependencies` and seven skills: `office`, `office-docx`, `office-pptx`, `office-xlsx`, `office-render`, `office-recalculate`, and `office-export-pdf`. Skills use the bundled LibreOffice Kit CLI, not system LibreOffice. Resources stay in the image; generated files belong in the user's Workspace. The [Office reference](../packages/skill/skill-office/README.md) describes their limits.

The image build runs [smoke-office.mjs](smoke-office.mjs) without network access. It checks built Web skill registration, document authoring, PDF conversion, image rendering and formula recalculation in a private temporary directory. To repeat it without mounting user data:

```bash
docker run --rm --init --network none --entrypoint node "$IMAGE" /opt/dsh/docker/smoke-office.mjs
```

<a id="default-memory"></a>

## Default memory

Every Web profile loads the pinned [meow-memory 0.32.1](https://github.com/Phant0Meow/dsh-meow-memory) package from the installation. Existing user profiles receive it when their container restarts; startup does not install or compile packages. If a profile already owns the bundle, its installed copy takes precedence and only one instance loads.

The image's Node 24 provides `node:sqlite`; BM25 search needs no vector service, downloaded model or external database. The default global state is under `DSH_HOME/storages/meow-memory`; each Workspace's database is `.dsh-meow/memory.db`. The managed default Workspace therefore stores memories at `/storage-root-jfs/user-<userID>/workspace/.dsh-meow/memory.db` on the Worker. These paths survive container replacement. Reflection and dream consolidation use the configured DSH model, which must be available inside the offline site's network.

The build runs [smoke-memory.mjs](smoke-memory.mjs) without networking. It exercises real registered memory tools, SQLite integrity, retrieval after Web restarts, independent users and a profile that already owns the bundle:

```bash
docker run --rm --init --network none --entrypoint node "$IMAGE" /opt/dsh/docker/smoke-memory.mjs
```

## Offline plugin market

The image includes the same [private catalog and community tarballs](../market-registry/README.md) as Desktop, plus Verdaccio and its locked Linux dependencies. Startup imports every bundled tarball, then starts the registry at `127.0.0.1:4873` and the catalog at `127.0.0.1:4874` before Web. Both listeners remain inside each container; no host ports or extra proxy routes are needed. Publishing is disabled and missing packages do not fall back to public npm. A failed service stops the container rather than leaving Web connected to a broken market.

The Host receives `DSHM_REGISTRY_URL`, `DSHM_NPM_MIRROR` and disabled automatic peer installation. The workbench catalog uses `http://127.0.0.1:4874/workbenches.json` when unset, so building the image does not require `ZHISHU_WORKBENCH_CATALOG_URL`. See the [private-registry README](../market-registry/README.md#environment-variables) for the variable table. Users install plugins and workbenches through the native market. Their profile, installed packages and settings remain under `DSH_HOME` on the existing JFS mount; temporary registry storage is recreated from the image. Rebuild the image to deliver a new catalog or package version, including all of its non-host runtime dependencies.

The build runs [smoke-market.mjs](smoke-market.mjs) with networking disabled: it installs every catalog plugin and workbench into a fresh profile and empty package cache, authenticates native Web and fetches its plugin clients, checks workbench ownership conflicts, restart persistence and user isolation, then rejects missing packages and publishing requests. Repeat without user data:

```bash
docker run --rm --init --network none --entrypoint node "$IMAGE" /opt/dsh/docker/smoke-market.mjs
```

Offline coverage applies to shipped Office/runtime resources and bundled market packages, not arbitrary npm/GitHub plugins, model inference or web search. Those require their configured services. Desktop-only operating-system integrations and browser-restricted capabilities are not supplied by installing server dependencies.

## Validate one user

`docker/compose.yml` validates one ordinary container; Worker manages production containers. First install the scoped policy on this Worker with `bash docker/security/install.sh`. The Worker must have created the `gcs-dsh-users` bridge with inter-container communication disabled.

```bash
cd /path/to/zhishu-harness
cp docker/.env.example docker/.env

# Set DSH_CLIENT_COMMIT_HASH to the complete output of git rev-parse HEAD.
# Set DSH_USER_ROOT_PATH to an existing validation user's private directory.
set -a
. docker/.env
set +a

test -n "$DSH_USER_ROOT_PATH"
install -d -m 0700 "$DSH_USER_ROOT_PATH/dsh-home" "$DSH_USER_ROOT_PATH/workspace"
docker compose --env-file docker/.env -f docker/compose.yml config
docker compose --env-file docker/.env -f docker/compose.yml up -d
```

Stop validation with:

```bash
docker compose --env-file docker/.env -f docker/compose.yml down
```

Master obtains `userID` from the identity service; Worker mounts `/storage-root-jfs/user-<userID>` at `/storage-root-jfs/user`. DSH listens on private port `3081` and publishes no host port. Worker uses host networking to proxy inspected container IPs; user containers cannot communicate with each other through their bridge.

## Command sandbox

[bwrap](bwrap) enters a child user namespace before the official bubblewrap sandbox. The scoped [seccomp policy](security/seccomp-bwrap.json) derives from Moby v24.0.6 (see [license](security/LICENSE.Moby)); its only added allowances are the tested namespace-clone flags and mount setup calls. The [named AppArmor policy](security/apparmor-bwrap) permits that setup while denying sensitive proc/sys paths. Worker preflights each image without user mounts before creating a user container.

User containers drop all outer capabilities, retain no-new-privileges, and receive no Docker socket, host PID namespace or privileged mode. Nested procfs requires disabling Docker's mount-based system-path masks for these containers; AppArmor supplies explicit path denials instead. This is not equivalent to Docker's default protection: user namespaces expose additional shared-kernel code. The policy is qualified on this x86-64 Docker 24 / Linux 5.4 deployment; validate other environments separately. Installing it does not change daemon-wide defaults.

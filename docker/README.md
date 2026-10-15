# DSH container build

English | [中文](README.zh.md)

This directory builds the current `zhishu-harness` source into the complete native Web image used by `gcs-harness-master` for per-user Swarm Services. The image keeps the native Web UI, uses no Nginx, and enables the managed default Workspace and directory-root policies implemented on `main`.

## Related projects

| Project | Responsibility |
| --- | --- |
| [zhishu-harness](https://github.com/ReyRen/zhishu-harness) | This repository; tracks DSH upstream and builds the native Web image |
| [gcs-harness-master](https://github.com/ReyRen/gcs-harness-master) | Creates, updates, removes, and routes per-user Swarm Services after platform authentication |
| [gcs-harness-worker](https://github.com/ReyRen/gcs-harness-worker) | Proxies Master traffic to user DSH Services on the Overlay network |

## Update from upstream

`master` only tracks official `upstream/master`; it contains no platform changes and is never used to build images. `main` is the platform-development and image-build branch. Follow the [upstream update and release guide](../docs/cookbook/updating-platform-fork.md) for conflict review, validation, a pull request into this fork's `main`, image construction, and rollout.

## Build an image

Build only from a clean checkout of the merged `main` on a labeled Worker. The [release guide](../docs/cookbook/updating-platform-fork.md) gives the commands and the image-ID rollout procedure. Docker reuses unchanged dependency layers; `DSH_CLIENT_COMMIT_HASH` records the exact source revision in the frontend.

## User Workspaces

The container creates and automatically opens `/storage-root-jfs/user/workspace`, so a user can chat immediately. On the Worker this maps to `/storage-root-jfs/user-<userID>/workspace`. The native Web UI cannot remove this required default Workspace, but users can create and switch to other Workspaces.

The directory picker is rooted at `/storage-root-jfs/user`. It shows only the current user's mounted directory and descendants and refuses paths or symbolic links that leave the root. `DSH_WORKSPACE_ROOT`, `DSH_DEFAULT_WORKSPACE`, and `DSH_DEFAULT_WORKSPACE_TITLE` configure this policy; the production image supplies fixed defaults and Compose states them explicitly.

## Office authoring

The build prepares the official [primary runtime](../packages/skill/tool-workspace-dependencies/README.md) and Office resources from the upstream download lock. [cache-primary-runtime.mjs](cache-primary-runtime.mjs) uses curl to cache those exact official archives, checks SHA256, and leaves assembly and validation to the upstream builder; it uses no mirror or intermediary server. `DSH_RESOURCE_DOWNLOAD_TIMEOUT_MS` is a build argument with a 600000 ms per-download default for large release assets. `DSH_PRIMARY_RUNTIME=/opt/dsh-runtime/primary-runtime` selects the bundled Python, Node.js and pnpm; Python includes numpy, pandas and the Word, Excel and PowerPoint authoring libraries. The bundled Python is also first on `PATH`.

The container loads [office.cordis.patch.yml](office.cordis.patch.yml) with the native Web profile to expose `load_workspace_dependencies` and the official Office skills: `office`, `office-docx`, `office-pptx`, `office-xlsx`, `office-render`, `office-recalculate` and `office-export-pdf`. The operation skills use the installed LibreOffice Kit CLI, not system LibreOffice. Latin and Chinese fonts are installed for rendering. Resources are queried directly in the image layer without startup downloads or copies into JFS; generated files belong in the user's Workspace. The official [Office skill reference](../packages/skill/skill-office/README.md) documents authoring, validation and rendering limits.

The image build runs [smoke-office.mjs](smoke-office.mjs) without network access. It checks built Web skill registration, document read/write and structural checks, PDF conversion, image rendering and formula recalculation in a private temporary directory. To repeat it against a built image without mounting user data:

```bash
docker run --rm --init --network none --entrypoint node "$IMAGE" /opt/dsh/docker/smoke-office.mjs
```

## Validate one user

`docker/compose.yml` validates the image only; Master creates production user Services.

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

Master obtains `userID` from the configured identity service and mounts Worker path `/storage-root-jfs/user-<userID>` at `/storage-root-jfs/user`. DSH exposes only Overlay port `3081` and publishes no per-user host port. Production Services and Compose use a one-second health interval so routing begins soon after HTTP readiness.

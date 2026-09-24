# DSH container build

English | [中文](README.zh.md)

This directory builds the current `zhishu-harness` source into the complete native Web image used by `gcs-harness-master` for per-user Swarm Services. The image keeps the native Web UI, uses no Nginx or runtime patch, and enables the managed default Workspace and directory-root policies implemented on `main`.

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

## Validate one user

`docker/compose.yml` validates the image only; Master creates production user Services.

```bash
cd /path/to/zhishu-harness
cp docker/.env.example docker/.env

# Set DSH_CLIENT_COMMIT_HASH to the complete output of git rev-parse HEAD.
set -a
. docker/.env
set +a

install -d -m 0700 "$DSH_USER_ROOT_PATH/dsh-home" "$DSH_USER_ROOT_PATH/workspace"
docker compose --env-file docker/.env -f docker/compose.yml config
docker compose --env-file docker/.env -f docker/compose.yml up -d
```

Stop validation with:

```bash
docker compose --env-file docker/.env -f docker/compose.yml down
```

Master obtains `userID` from the configured identity service and mounts Worker path `/storage-root-jfs/user-<userID>` at `/storage-root-jfs/user`. DSH exposes only Overlay port `3081` and publishes no per-user host port. Production Services and Compose use a one-second health interval so routing begins soon after HTTP readiness.

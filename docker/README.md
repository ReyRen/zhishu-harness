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

`master` only tracks official `upstream/master`; it contains no platform changes and is never used to build images. `main` is the platform-development and image-build branch.

```bash
git status --short
git fetch upstream --prune
git switch master
git merge --ff-only upstream/master
git push origin master

git switch main
git merge --no-edit master
git push origin main
```

Resolve and test merge conflicts instead of replacing the repository with a ZIP archive.

## Build an image

Run at the repository root on `main` with a clean worktree:

```bash
cd /path/to/zhishu-harness
test "$(git branch --show-current)" = "main"
test -z "$(git status --porcelain)"
COMMIT="$(git rev-parse HEAD)"
IMAGE="zhishu-harness:main-${COMMIT:0:7}"

docker build --network host \
  --build-arg "DSH_CLIENT_COMMIT_HASH=$COMMIT" \
  --file docker/Dockerfile \
  --tag "$IMAGE" \
  .

docker image inspect --format '{{.Id}}' "$IMAGE"
```

The root `.dockerignore` excludes Git metadata, dependencies, and build outputs. `DSH_CLIENT_COMMIT_HASH` records the source revision in the DSH frontend. Docker reuses unchanged dependency layers.

The build uses the official Debian repositories by default. On a slow network, add `--build-arg DEBIAN_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian` and `--build-arg DEBIAN_SECURITY_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian-security` to the build command; Debian signatures still verify the packages. The Dockerfile caches APT indexes and packages so later builds do not redownload unchanged dependencies.

Production scheduling uses only Worker-local images. Put the same image ID on every Worker labeled `dsh=true,jfs=true`, update `dsh.localImageID` in `/etc/gcs-harness-master/master.json`, and restart Master. The field accepts only an exact `sha256:<64 lowercase hexadecimal characters>` image ID, so Swarm does not try a registry pull. Each user's next `launch` switches its Service to the configured image without changing `/storage-root-jfs/user-<userID>`.

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

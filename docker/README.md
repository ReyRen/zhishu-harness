# DSH 容器构建

本目录将当前 `zhishu-harness` 源码构建为完整原生 Web 镜像，供 `gcs-harness-master` 按用户创建 Swarm Service。镜像不修改或裁剪 DSH，不使用 Nginx 和平台 patch。

## 相关项目

| 项目 | 职责 |
| --- | --- |
| [zhishu-harness](https://github.com/ReyRen/zhishu-harness) | 本项目；跟踪 DSH 上游并构建完整原生 Web 镜像 |
| [gcs-harness-master](https://github.com/ReyRen/gcs-harness-master) | 根据平台用户身份创建、更新和删除用户 Swarm Service |
| [gcs-harness-worker](https://github.com/ReyRen/gcs-harness-worker) | 在 Overlay 网络中代理 Master 与用户 DSH Service 的流量 |

## 分支约定与更新上游

- `master` 只用于跟踪 DSH 官方 `upstream/master`，不放平台改造，也不用于构建镜像。
- `main` 是平台开发和唯一的镜像构建分支，包含 `docker/` 等部署文件。

先在 `master` 同步官方上游，再将其合入 `main`：

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

如果合并发生冲突，先解决并完成测试，不要用 ZIP 覆盖仓库。

## 构建镜像

必须在仓库根目录执行：

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

IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
printf '%s\n' "$IMAGE_ID"
```

仓库根 `.dockerignore` 会排除 `.git`、依赖和构建产物；提交号通过 DSH 官方的 `DSH_CLIENT_COMMIT_HASH` 写入前端版本信息。首次构建或源码更新需要重新编译，未变化的依赖层会复用缓存。

生产调度只使用 Worker 本地镜像，不访问外部镜像仓库。构建新版本后，必须先让所有带 `dsh=true`、`jfs=true` 标签的 Worker 都具有同一个 `IMAGE_ID`，然后将 `/etc/gcs-harness-master/master.json` 中的 `dsh.localImageID` 更新为该值并重启 Master。配置只接受 `sha256:<64位十六进制>` Image ID，不接受 tag；这样 Swarm 不会先尝试远程拉取。用户下次调用 `launch` 时会切换到新镜像，已有 `/storage-root-jfs/user-<userID>` 不变。

Master 创建的生产 Service 和本 compose 验证环境都使用 2 秒健康检查间隔，以便 DSH HTTP 就绪后尽快加入路由。

## 单用户验证

`docker/compose.yml` 只用于验证镜像；生产用户容器由 Master 创建。

```bash
cd /path/to/zhishu-harness
cp docker/.env.example docker/.env

# 编辑 docker/.env，并把 DSH_CLIENT_COMMIT_HASH 改为 git rev-parse HEAD 的完整输出。
set -a
. docker/.env
set +a

install -d -m 0700 "$DSH_USER_ROOT_PATH/dsh-home" "$DSH_USER_ROOT_PATH/workspace"
docker compose --env-file docker/.env -f docker/compose.yml config
docker compose --env-file docker/.env -f docker/compose.yml up -d
```

验证结束：

```bash
docker compose --env-file docker/.env -f docker/compose.yml down
```

容器内部固定使用 `/storage-root-jfs/user`；Master 接收原始 `userID`，并把宿主机 `/storage-root-jfs/user-<userID>` 挂载到该路径。DSH 对外只提供 Overlay 内部端口 `3081`，不发布每用户宿主机端口。

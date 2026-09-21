# DSH 容器构建

本目录将当前 `zhishu-harness` 源码构建为完整原生 Web 镜像，供 `gcs-harness-master` 按用户创建 Swarm Service。镜像不修改或裁剪 DSH，不使用 Nginx 和平台 patch。

## 更新上游

本仓库使用 `main`，官方仓库由 `upstream/master` 跟踪：

```bash
git status --short
git fetch upstream --prune
git switch main
git merge --no-edit upstream/master
git push origin main
```

如果合并发生冲突，先解决并完成测试，不要用 ZIP 覆盖仓库。

## 构建镜像

必须在仓库根目录执行：

```bash
cd /path/to/zhishu-harness

COMMIT="$(git rev-parse HEAD)"
IMAGE="zhishu-harness:main-${COMMIT:0:7}"

docker build --network host \
  --build-arg "DSH_CLIENT_COMMIT_HASH=$COMMIT" \
  --file docker/Dockerfile \
  --tag "$IMAGE" \
  .
```

仓库根 `.dockerignore` 会排除 `.git`、依赖和构建产物；提交号通过 DSH 官方的 `DSH_CLIENT_COMMIT_HASH` 写入前端版本信息。首次构建或源码更新需要重新编译，未变化的依赖层会复用缓存。

构建新版本后，将 `/etc/gcs-harness-master/master.json` 中的 `dsh.image` 更新为新 tag，并重启 Master。用户下次调用 `launch` 时会切换到新镜像，已有 `/storage-root-jfs/user-<userID>` 不变。

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

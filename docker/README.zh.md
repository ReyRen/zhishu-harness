# DSH 容器构建

[English](README.md) | 中文

本目录将当前 `zhishu-harness` 源码构建为完整原生 Web 镜像，供 `gcs-harness-master` 按用户创建 Swarm Service。镜像保留原生 Web，不使用 Nginx 或运行时 patch，并启用 `main` 上实现的托管默认工作区与目录根策略。

## 相关项目

| 项目 | 职责 |
| --- | --- |
| [zhishu-harness](https://github.com/ReyRen/zhishu-harness) | 本仓库；跟踪 DSH 上游并构建原生 Web 镜像 |
| [gcs-harness-master](https://github.com/ReyRen/gcs-harness-master) | 平台认证后创建、更新、删除和路由每用户 Swarm Service |
| [gcs-harness-worker](https://github.com/ReyRen/gcs-harness-worker) | 在 Overlay 网络中代理 Master 到用户 DSH Service 的流量 |

## 更新上游

`master` 只跟踪官方 `upstream/master`；它不包含平台改造，也绝不用于构建镜像。`main` 是平台开发和镜像构建分支。

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

遇到合并冲突时应解决并测试冲突，不要用 ZIP 覆盖仓库。

## 构建镜像

在 `main` 的干净工作树中，从仓库根目录执行：

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

根目录 `.dockerignore` 会排除 Git 元数据、依赖和构建产物。`DSH_CLIENT_COMMIT_HASH` 将源码版本写入 DSH 前端。Docker 会复用未变化的依赖层。

默认使用 Debian 官方软件源。网络较慢时可在构建命令中增加 `--build-arg DEBIAN_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian` 和 `--build-arg DEBIAN_SECURITY_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian-security`；软件包仍由 Debian 签名校验。Dockerfile 会缓存 APT 索引和软件包，后续构建不会重复下载未变化的依赖。

生产调度只使用 Worker 本地镜像。请将相同 Image ID 放到所有带 `dsh=true,jfs=true` 标签的 Worker，更新 `/etc/gcs-harness-master/master.json` 中的 `dsh.localImageID`，然后重启 Master。该字段只接受精确的 `sha256:<64 位小写十六进制字符>` Image ID，因此 Swarm 不会尝试从仓库拉取。每个用户下次调用 `launch` 时，其 Service 会切换到所配置镜像，而 `/storage-root-jfs/user-<userID>` 保持不变。

## 用户工作区

容器会创建并自动打开 `/storage-root-jfs/user/workspace`，因此用户可以立即问答。它在 Worker 上对应 `/storage-root-jfs/user-<userID>/workspace`。原生 Web 不能删除这个必需默认工作区，但用户仍可创建和切换其他工作区。

目录选择器以 `/storage-root-jfs/user` 为根。它只显示当前用户的挂载目录及其后代，并拒绝跳出根的路径或符号链接。`DSH_WORKSPACE_ROOT`、`DSH_DEFAULT_WORKSPACE` 和 `DSH_DEFAULT_WORKSPACE_TITLE` 配置该策略；生产镜像提供固定默认值，Compose 也显式列出这些值。

## 验证单个用户

`docker/compose.yml` 只验证镜像；生产用户 Service 由 Master 创建。

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

停止验证：

```bash
docker compose --env-file docker/.env -f docker/compose.yml down
```

Master 从配置的身份服务取得 `userID`，并把 Worker 路径 `/storage-root-jfs/user-<userID>` 挂载到 `/storage-root-jfs/user`。DSH 只开放 Overlay 端口 `3081`，不发布每用户宿主机端口。生产 Service 与 Compose 使用一秒健康检查间隔，使 HTTP 就绪后尽快开始路由。

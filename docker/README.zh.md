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

`master` 只跟踪官方 `upstream/master`；它不包含平台改造，也绝不用于构建镜像。`main` 是平台开发和镜像构建分支。冲突审查、验证、向本仓库 `main` 提 PR、构建镜像和滚动更新的步骤见[上游更新与发布指南](../docs/cookbook/updating-platform-fork.zh.md)。

## 构建镜像

只在带标签的 Worker 上，从已合并的干净 `main` 工作树构建。[发布指南](../docs/cookbook/updating-platform-fork.zh.md)列出了命令和 Image ID 切换步骤。Docker 会复用未变化的依赖层；`DSH_CLIENT_COMMIT_HASH` 把准确源码版本写入前端。

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

# DSH 容器构建

[English](README.md) | 中文

本目录将 `zhishu-harness` 构建为完整原生 Web 镜像。Master 验证用户并选择 Worker；Worker 通过本机 Engine API 为用户创建普通 Docker 容器。镜像保留原生 Web，不使用 Nginx，并启用 `main` 中的受管默认工作区和用户目录限制。

## 相关项目

| 项目 | 职责 |
| --- | --- |
| [zhishu-harness](https://github.com/ReyRen/zhishu-harness) | 本仓库；跟踪 DSH 上游并构建原生 Web 镜像 |
| [gcs-harness-master](https://github.com/ReyRen/gcs-harness-master) | 验证用户、选择 Worker，并路由每位用户的 iframe |
| [gcs-harness-worker](https://github.com/ReyRen/gcs-harness-worker) | 管理受限用户容器，并代理其私有 bridge 地址 |

## 更新上游

`master` 只跟踪官方 `upstream/master`；它不包含平台改造，也绝不用于构建镜像。`main` 是平台开发和镜像构建分支。冲突审查、验证、向本仓库 `main` 提 PR、构建镜像和滚动更新的步骤见[上游更新与发布指南](../docs/cookbook/updating-platform-fork.zh.md)。

## 构建镜像

只在带标签的 Worker 上，从已合并的干净 `main` 工作树构建。[发布指南](../docs/cookbook/updating-platform-fork.zh.md)列出了命令和 Image ID 切换步骤。Docker 会复用未变化的依赖层；`DSH_CLIENT_COMMIT_HASH` 把准确源码版本写入前端及镜像的 `org.opencontainers.image.revision` 标签。

## 用户工作区

容器会创建并自动打开 `/storage-root-jfs/user/workspace`，因此用户可以立即问答。它在 Worker 上对应 `/storage-root-jfs/user-<userID>/workspace`。原生 Web 不能删除这个必需默认工作区，但用户仍可创建和切换其他工作区。

目录选择器以 `/storage-root-jfs/user` 为根。它只显示当前用户的挂载目录及其后代，并拒绝跳出根的路径或符号链接。`DSH_WORKSPACE_ROOT`、`DSH_DEFAULT_WORKSPACE` 和 `DSH_DEFAULT_WORKSPACE_TITLE` 配置该策略；生产镜像提供固定默认值，Compose 也显式列出这些值。

## Office 文档创作

构建过程根据上游下载锁准备官方 [primary runtime](../packages/skill/tool-workspace-dependencies/README.zh.md) 和 Office 资源。[cache-primary-runtime.mjs](cache-primary-runtime.mjs) 用 curl 缓存完全相同的官方归档，检查 SHA256，并由上游构建器完成组装和验证；它不使用镜像源或中间服务器。构建参数 `DSH_RESOURCE_DOWNLOAD_TIMEOUT_MS` 的单次下载默认期限为 600000 毫秒，供大体积发布资源使用。`DSH_PRIMARY_RUNTIME=/opt/dsh-runtime/primary-runtime` 指向随包的 Python、Node.js 和 pnpm；Python 包含 numpy、pandas 以及 Word、Excel、PowerPoint 创作库。随包 Python 也位于 `PATH` 最前。

容器加载 [office.cordis.patch.yml](office.cordis.patch.yml)，提供 `load_workspace_dependencies` 和七项 skills：`office`、`office-docx`、`office-pptx`、`office-xlsx`、`office-render`、`office-recalculate`、`office-export-pdf`。skills 使用随包 LibreOffice Kit CLI，不使用系统 LibreOffice。资源留在镜像中；生成文件存入用户工作区。[Office 参考](../packages/skill/skill-office/README.zh.md)说明其限制。

镜像构建在无网络环境执行 [smoke-office.mjs](smoke-office.mjs)，在私有临时目录检查实际 Web 技能注册、文档创作、PDF 转换、图像渲染和公式重算。不挂载用户数据时，可重复检查：

```bash
docker run --rm --init --network none --entrypoint node "$IMAGE" /opt/dsh/docker/smoke-office.mjs
```

<a id="default-memory"></a>

## 默认记忆

所有 Web profile 从安装目录加载固定版本的 [meow-memory 0.32.1](https://github.com/Phant0Meow/dsh-meow-memory)。已有用户在容器重启后即可加载；启动时不安装或编译包。如果 profile 已持有此组合包，则使用用户安装的副本，只加载一个实例。

镜像内的 Node 24 提供 `node:sqlite`；BM25 检索不需要向量服务、下载模型或外部数据库。默认全局状态位于 `DSH_HOME/storages/meow-memory`，各工作区的数据库位于 `.dsh-meow/memory.db`。因此，托管默认工作区的记忆在 Worker 上存为 `/storage-root-jfs/user-<userID>/workspace/.dsh-meow/memory.db`。替换容器不会丢失这些路径中的数据。反思和梦境整理使用已配置的 DSH 模型，离线现场须在内网提供可访问的模型服务。

构建时断网执行 [smoke-memory.mjs](smoke-memory.mjs)，验证实际注册的记忆工具、SQLite 完整性、Web 重启后检索、独立用户，以及已持有该组合包的 profile：

```bash
docker run --rm --init --network none --entrypoint node "$IMAGE" /opt/dsh/docker/smoke-memory.mjs
```

## 离线插件市场

镜像包含与桌面端相同的[私有目录和社区安装包](../market-registry/README.zh.md)，以及 Verdaccio 和锁定的 Linux 依赖。启动时导入全部随包 tarball，先在 `127.0.0.1:4873` 启动包仓库、在 `127.0.0.1:4874` 启动目录，再启动 Web。两个地址都留在各自容器内部，不需要宿主机端口或额外代理规则。禁止发布包；缺包不会回退到公网 npm。任一服务失败会停止容器，不让 Web 继续连接失效的市场。

Host 自动获得 `DSHM_REGISTRY_URL`、`DSHM_NPM_MIRROR`，并关闭 peer 自动安装。工作台列表未单独设置时使用默认的 `http://127.0.0.1:4874/workbenches.json`，构建镜像不必设置 `ZHISHU_WORKBENCH_CATALOG_URL`。变量对照见 [私有源 README](../market-registry/README.zh.md#environment-variables)。用户仍通过原生市场安装插件与工作台。profile、已安装包和设置保存在现有 JFS 挂载中的 `DSH_HOME`；临时仓库数据从镜像重建。新增目录或包版本需要重建镜像，并带上该包全部非宿主运行时依赖。

构建在断网环境执行 [smoke-market.mjs](smoke-market.mjs)：使用全新 profile 和空包缓存安装全部目录插件与工作台，认证原生 Web 并获取插件客户端，检查工作台归属的写入冲突、重启持久化和用户隔离，再检查缺包及发布请求被拒绝。不挂载用户数据时可重复检查：

```bash
docker run --rm --init --network none --entrypoint node "$IMAGE" /opt/dsh/docker/smoke-market.mjs
```

离线范围是随镜像交付的 Office、运行时资源和市场安装包，不包括任意 npm/GitHub 插件、模型推理或联网搜索；它们仍需要配置相应服务。桌面端专属的操作系统集成和受浏览器限制的能力，也不会因为安装服务端依赖而自动具备。

## 验证单个用户

`docker/compose.yml` 用于验证一个普通容器；生产容器由 Worker 管理。先在该 Worker 执行 `bash docker/security/install.sh` 安装独立策略。Worker 必须已创建禁用容器互访的 `gcs-dsh-users` bridge 网络。

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

停止验证：

```bash
docker compose --env-file docker/.env -f docker/compose.yml down
```

Master 从身份服务取得 `userID`；Worker 将 `/storage-root-jfs/user-<userID>` 挂载到 `/storage-root-jfs/user`。DSH 监听私有端口 `3081`，不发布宿主机端口。Worker 使用 host 网络代理经过检查的容器 IP；用户容器不能通过该 bridge 互访。

## 命令沙箱

[bwrap](bwrap) 在官方 bubblewrap 沙箱前进入子 user namespace。[独立 seccomp 策略](security/seccomp-bwrap.json) 来自 Moby v24.0.6（见[许可](security/LICENSE.Moby)），仅增加经测试的 namespace clone 标志和挂载准备调用。[独立 AppArmor 策略](security/apparmor-bwrap) 允许这些准备操作，同时禁止敏感 proc/sys 路径。Worker 在创建用户容器前，会在不挂载用户目录的环境中预检镜像。

用户容器移除全部外层 capabilities，保留 no-new-privileges，不挂载 Docker socket、不共享宿主机 PID namespace，也不开启 privileged。嵌套 procfs 要求为这些容器关闭 Docker 的挂载式系统路径遮蔽，改由 AppArmor 显式拒绝敏感路径。这不等同于 Docker 默认保护：user namespaces 会暴露更多共享内核代码。策略已在当前 x86-64、Docker 24、Linux 5.4 环境验证；其他环境须另行验证。安装策略不会修改整个 Docker daemon 的默认配置。

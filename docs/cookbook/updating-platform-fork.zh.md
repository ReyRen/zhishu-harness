# 更新上游并发布平台镜像

[English](updating-platform-fork.md) | 中文

本流程用于 `ReyRen/zhishu-harness` 与 GCS 部署。未特别注明时，命令在仓库根目录执行。`172.18.36.225` 的独立 Web 环境不在此流程内。

## 分支与合并规则

- 官方 `deepseek-ai/deepseek-harness:master` 只读，绝不向官方推送或提 PR。
- Fork 的 `master` 仅快进官方提交；`main` 是二开分支，也是唯一的生产镜像来源。
- 在 Mutagen 同步目录外建临时分支，逐处分析文本和语义冲突。官方行为替代不兼容二开；保留兼容的每用户工作区、JFS 边界、原生 Web、桌面端和市场能力。
- 已认证的非 loopback 浏览器必须能够向自身 Host 持久化设置。官方远程访问机制现在已支持此能力，不再伪造 loopback 身份。若以后真正冲突，暂停并请用户决策。
- 不强推、不硬重置、不整文件接受 ours/theirs、不用 ZIP 覆盖。未知改动、测试失败、主机不可用时停止发布。

## 1. 拉取并快进 Fork master

确认工作树干净、远程目标正确。额外禁用官方远程的推送 URL。

```bash
git status --short --branch
git remote -v
git remote set-url --push upstream DISABLED
git fetch origin main master
git fetch upstream master
git merge-base --is-ancestor origin/master upstream/master
git switch master
git merge --ff-only origin/master
git merge --ff-only upstream/master
test "$(git rev-parse HEAD)" = "$(git rev-parse upstream/master)"
git push origin master
```

官方没有新提交时，不修改状态，也不发送例行通知。有更新时记录官方及 Fork main 的提交 ID。

## 2. 在 Mutagen 之外整合验证

同步目录保持 main。在独立 worktree 中从最新 origin/main 建分支，先合并但不提交。

```bash
git switch -c sync-upstream-YYYY-MM-DD origin/main
git merge --no-ff --no-commit origin/master
git diff --name-only --diff-filter=U
git diff origin/master -- docker packages/api/workspace-controller packages/host/directory-picker-auto packages/host/directory-picker-browse
```

自动合并也要审查：默认工作区、用户目录边界、已认证设置、完整 Web 和插件代理路径、运行时及 Office skills、锁文件、桌面打包。官方已替代的适配应删除。官方实验性市场仍默认关闭，不因两个包并存就删除已安装的第三方市场。

遵循仓库提交前检查及文档技能，按实际变更选择测试，不能关闭失败检查。双语文档改动后重新记录配对元数据。

```bash
pnpm install --frozen-lockfile
pnpm exec vitest run packages/api/workspace-controller/tests/workspace-controller.host.spec.ts packages/host/directory-picker-auto/tests/loader-composition.spec.ts packages/host/directory-picker-browse/tests/service.spec.ts
node --test docker/tests/cache-primary-runtime.test.mjs docker/tests/sandbox-policy.test.mjs
pnpm run verify-package-dependencies
pnpm run build
pnpm run test:docs
pnpm run doc-sync
git add -A
git diff --cached --check
git commit -m "Merge official DSH into platform main"
git push -u origin sync-upstream-YYYY-MM-DD
```

使用生产镜像进行 Linux 验证时设置 `NODE_ENV=test`，清除继承的 DSH home/workspace/runtime 环境变量。复用含已移除包产物的 worktree 时执行 `pnpm run clean`。

合并前构建独立标签的验证镜像，实际测试 bubblewrap 命令、Web 登录/设置/插件及 Office 渲染；验证镜像不算生产 main 镜像。**仅向 ReyRen/zhishu-harness:main 提 PR**。无未解决冲突且关键检查通过后才合并。若 fork 检查需要官方专用 runner 或凭据，核实具体原因并提供等效 Linux 证据，不能将真实代码失败当作通过。

## 3. 更新正式构建检出

Worker 源码：`172.18.36.230:/storage-md0/renyuan/zhishu-harness-platform/zhishu-harness`。Windows 源码：`E:\Projects\zhishu-harness-platform\zhishu-harness`。Mutagen 排除 Git 元数据、依赖、生成产物和已知跨系统符号链接差异；两端 Git 必须分别快进。

暂停同步并确认两端干净。先更新 Worker，再更新 Windows，不重置无法解释的改动。

```bash
mutagen sync pause zhishu-harness-platform
```

依次在 Worker、Windows 执行：

```bash
git fetch origin main master
git switch master
git merge --ff-only origin/master
git switch main
git merge --ff-only origin/main
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
```

恢复同步并等待核对。两端 HEAD 都须等于合并后的 main，工作树干净，Mutagen 无冲突或传输失败。

```bash
mutagen sync resume zhishu-harness-platform
mutagen sync flush zhishu-harness-platform
mutagen sync list zhishu-harness-platform --long
```

## 4. 在 Worker 构建并烟测

生产镜像只能从 `172.18.36.230` 上干净、已合并的 main 构建。

```bash
COMMIT="$(git rev-parse HEAD)"
IMAGE="zhishu-harness:main-${COMMIT:0:7}"
docker build --network host --build-arg "DSH_CLIENT_COMMIT_HASH=$COMMIT" --file docker/Dockerfile --tag "$IMAGE" .
IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
printf '%s %s\n' "$IMAGE" "$IMAGE_ID"
```

镜像包含原生 Web、打包的 primary runtime 和七项 Office skills。网络异常可用 Debian 镜像源构建参数，临时构建中转不能成为长期依赖。

使用镜像前在每个 Worker 安装 `docker/security/install.sh`，它安装独立命名 AppArmor 策略和限定 seccomp 文件，不改 Docker 全局配置。不同内容不能直接覆盖现有策略：策略变更须审查并使用新 profile 名称，再逐用户更新。

用户是 Worker 管理的普通 Docker 容器，不是 Swarm Service。移除外层全部 capabilities、保留 no-new-privileges，采用限定的 bubblewrap 策略，不开 privileged、不加宿主机 SYS_ADMIN。嵌套 procfs 要求关闭这些容器的 Docker mount-based system-path masks，改由 AppArmor 拒绝敏感路径；这与 Docker 默认防护并非完全等价，仍共享宿主机内核。当前验证目标为 x86-64 Docker 24 / Linux 5.4，其他环境须单独验证。

先在无真实用户数据环境烟测，验证沙箱实际约束、非 loopback 已认证设置、Office 导入/渲染/重算、默认工作区和插件资源。所有配置 Worker 必须具备同一 Image ID，Worker 不拉取用户镜像。

## 5. 通过 Master 和 Worker 发布

相关代码：[Master](https://github.com/ReyRen/gcs-harness-master)、[Worker](https://github.com/ReyRen/gcs-harness-worker)。Master 使用 systemd。Swarm 仅部署受信任 Worker Global Service；Worker 使用 host 网络，在隔离的本地 bridge 上管理用户。必须用节点真实 URL，不能用 routing mesh。Worker 控制端口 `18081` 限 Master/本机管理访问，并要求私有内部 Token。

在 `172.18.29.80` 检查 systemd unit，备份两份配置，保留属主和权限，把两份 `dsh.localImageID` 均更新为已验证镜像。当前路径：

- `/root/go/src/gcs-harness-master/dist/linux-amd64/master.json`：运行配置。
- `/etc/gcs-harness-master/master.json`：维护副本。

```bash
systemctl cat gcs-harness-master
systemctl restart gcs-harness-master
systemctl is-active gcs-harness-master
curl --fail --silent http://127.0.0.1:18088/healthz
```

两份配置一致后才能重启。workers 列表显式填写节点地址。Master 只支持单实例；任一配置 Worker 不可达就拒绝调度，防止第二个 JFS 写入者。删除节点配置前必须排空用户。

私下从共享 Token 文件读取 `X-GCS-Worker-Token`，查询各 Worker 的 `GET /internal/v1/state`。逐个用户 POST `/internal/v1/containers/{userID}/rollout`，请求体为 `{"imageID":"sha256:..."}`。Worker 停止并保留旧容器，启动新容器，等待 healthy 并验证内部登录凭据；新版本失败先停新容器，再重启旧容器。首个失败就停止发布。不要记录凭据或将 Worker/DSH Token 返回前端。

从旧用户 Swarm Service 进行一次性迁移时，短暂停止 Master 防止新 launch。每个旧用户 Service 先缩容为零，确认任务已停止，**然后**才能在同一 JFS 路径启动普通容器。保留停止的旧规格和镜像以便回滚。不删除运行中的用户 Service，不允许两代进程同时写同一目录。

## 6. 验证、恢复及清理

逐个确认目标用户容器 running、healthy、精确镜像及 Worker 规格正确，JFS bind 指向 `/storage-root-jfs/user-<userID>`。测试完整 launch/iframe/terminate 链路。Master 的浏览器会话存于内存，重启后须重新 launch，历史数据仍在 JFS。

单用户 rollout 失败会尝试自动回滚。清理或恢复失败则停下检查，不能手工再启动一个写入者。回退发布时恢复两份 Master 配置，再通过 Worker 逐个切回保留的旧镜像并验证健康。一次性迁移回退时，先停普通容器，再把旧 Service 扩回一份。

新版本稳定后，才按明确 ID 清理停止的回滚容器、旧任务容器和无引用旧镜像。保留运行中的用户容器及 `/storage-root-jfs/user-<userID>`。不执行广泛 Docker prune、数据卷删除或 compose down -v。

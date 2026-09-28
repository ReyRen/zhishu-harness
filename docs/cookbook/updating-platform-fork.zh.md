# 更新上游并发布 DSH 平台镜像

[English](updating-platform-fork.md) | 中文

本文档说明如何更新 `ReyRen/zhishu-harness`、构建每用户 DSH 镜像，并在 GCS Harness Swarm 部署中滚动切换镜像。Git 命令在 `zhishu-harness` 仓库根目录执行，Shell 示例使用 Bash。`172.18.36.225` 上独立的完整 Web 验收环境不在本流程内。

## 分支与冲突规则

- `upstream/master` 是官方 `deepseek-ai/deepseek-harness` 分支。只读取官方仓库，绝不向官方仓库提交平台 PR。
- `origin/master` 与官方分支完全一致。它只能快进，不加入平台提交，也不用于构建生产镜像。
- `origin/main` 承载平台二开。从 `main` 创建临时分支并合入 `master`，然后**只向 `ReyRen/zhishu-harness` 的 `main` 提 PR**。不要把临时分支直接推入 `main`。
- 即使 Git 没有报告文本冲突，也要检查语义交叉修改。如果官方更新替代或冲突于平台改造，以官方行为为准，并清理过时的平台源码、配置、测试和文档。独立且仍与官方代码兼容的平台能力才保留。
- 不使用 `git push --force`、整文件“ours/theirs”解决、`git reset --hard` 或 ZIP 覆盖来完成上游更新。提交关系或工作树状态不清楚时先停下核对。

## 1. 检查仓库并同步 `master`

先确保工作树干净，并确认 `origin` 指向自己的 Fork、`upstream` 指向官方仓库。Fork 的 `master` 必须是官方 `master` 的祖先；若发生分叉，应调查原因，不能强推。

```bash
git status --short --branch
git remote -v
git fetch origin main master
git fetch upstream master
git merge-base --is-ancestor origin/master upstream/master
git switch master
git merge --ff-only origin/master
git merge --ff-only upstream/master
test "$(git rev-parse HEAD)" = "$(git rev-parse upstream/master)"
git push origin master
```

这里的推送目标**只有 `ReyRen/zhishu-harness:master`**。继续之前记录两个提交 ID。不要从该分支向 `deepseek-ai/deepseek-harness` 提 PR。

## 2. 将官方代码合入平台工作分支

从 Fork 的最新 `main` 建分支。为避免未合并的代码通过 Mutagen 进入 Worker，本节和下一节应在**同步目录之外的独立 Git worktree** 中执行；保持 `E:\Projects\zhishu-harness-platform\zhishu-harness` 的主检出停在 `main`。合并先停在提交之前，以便检查双方都改过的文件。冲突时，暂存区第 2 阶段是平台版本、第 3 阶段是官方版本；应逐处比较，不能整文件接受任意一侧。

```bash
git switch -c sync-upstream-YYYY-MM-DD origin/main
git merge --no-ff --no-commit master
git status --short
git diff --name-only --diff-filter=U
git diff master -- docker packages/api/workspace-controller packages/host/directory-picker-auto packages/host/directory-picker-browse
```

逐个解决冲突，并检查自动合并的文件。尤其要确认完整原生 Web 配置、自动默认工作区、用户目录根限制、Docker 构建与锁文件仍适配新版官方代码。如果官方行为已取代其中某项二开，应删除那项二开，而不是保留不兼容补丁。把已解决文件加入暂存区，运行 `git diff --cached --check`，然后提交合并；不能提交尚未解决的暂存区。

## 3. 验证并通过 PR 合入 `main`

测试应覆盖实际变更；下列命令覆盖平台集成和镜像构建。若合并影响官方新功能，还需加跑对应的定向测试。Windows 本地的符号链接权限可能阻止文档检查，应改在 Linux 或 CI 验证并调查失败，不能把失败当作通过。

```bash
pnpm install --frozen-lockfile
pnpm exec vitest run packages/api/workspace-controller/tests/workspace-controller.host.spec.ts packages/host/directory-picker-auto/tests/loader-composition.spec.ts packages/host/directory-picker-browse/tests/service.spec.ts
pnpm run verify-package-dependencies
pnpm run build
pnpm run test:docs
pnpm run doc-sync
git add -A
git diff --cached --check
git commit -m "Merge official DSH into platform main"
git push -u origin sync-upstream-YYYY-MM-DD
```

推送时用实际分支名。在 GitHub 的 `ReyRen/zhishu-harness` 创建 PR，确认**目标为 `main`、来源为 `sync-upstream-YYYY-MM-DD`**，审查平台文件变更和检查结果后在本仓库合并。仅显示“无冲突”并不够。不要向官方仓库创建这个 PR。

GitHub 显示 PR 已合并后，按第 4 节的顺序更新 Worker 和本地主检出；不要先在仍运行的 Mutagen 会话内切换主检出的分支。

## 4. 确认 Worker 构建来源

目前的 DSH Worker 为 `172.18.36.230`，源码目录是 `/storage-md0/renyuan/zhishu-harness-platform/zhishu-harness`。Mutagen 双向同步源码，但**不传播 `.git`**、`node_modules`、`.dsh-build` 和 Windows/Linux 表示方式不同的少量 Git 符号链接；两端的 Git 元数据必须分别更新，不能再依赖 Mutagen 传递 Git 引用或索引。只有 Worker 的 `main` 等于 Fork 中已合并的 `main`、工作树干净后才能构建。

先在 Windows 上暂停 `zhishu-harness-platform` 同步会话，并确认两端原有工作树干净。若暂停失败、Worker 无法访问 Fork，或发现无法解释的本地改动，应停止发布，不要重置或覆盖文件。暂停成功后，**先在 Worker** 快进 Git：

```bash
mutagen sync pause zhishu-harness-platform
```

```bash
cd /storage-md0/renyuan/zhishu-harness-platform/zhishu-harness
git fetch origin main master
git switch master
git merge --ff-only origin/master
git switch main
git merge --ff-only origin/main
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
```

然后在 Windows 主检出快进 `main`，最后恢复同步并等待一次完整核对；`mutagen sync list --long` 不得出现冲突或转移错误，两端 `HEAD` 与工作树必须一致且干净。未完成这些检查前，不要删除旧镜像或开始构建。

```bash
cd /e/Projects/zhishu-harness-platform/zhishu-harness
git fetch origin main master
git switch master
git merge --ff-only origin/master
git switch main
git merge --ff-only origin/main
git status --short --branch
mutagen sync resume zhishu-harness-platform
mutagen sync flush zhishu-harness-platform
mutagen sync list zhishu-harness-platform --long
```

## 5. 在 Worker 上构建镜像

镜像包含原生 Web，但不发布每用户宿主机端口。容器内使用 `/storage-root-jfs/user`；Swarm 将现有的 `/storage-root-jfs/user-<userID>` 挂载到该路径。发布过程中绝不删除或重新创建这些用户目录。

```bash
COMMIT="$(git rev-parse HEAD)"
IMAGE="zhishu-harness:main-${COMMIT:0:7}"
docker build --network host \
  --build-arg "DSH_CLIENT_COMMIT_HASH=$COMMIT" \
  --file docker/Dockerfile \
  --tag "$IMAGE" \
  .
IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
printf '%s %s\n' "$IMAGE" "$IMAGE_ID"
```

软件源较慢时，Dockerfile 可接收 `DEBIAN_MIRROR` 与 `DEBIAN_SECURITY_MIRROR` 构建参数。修改 Master 前，先用 `DSH_PUBLIC_AUTHORITY=localhost:3081` 启动一次性测试容器，并确认 `3081` 端口响应；未认证访问 `/` 返回 HTTP 401。随后停止测试容器。所有标记为 `dsh=true,jfs=true` 的 Swarm 节点必须在本地拥有完全相同的 Image ID；若有多个合格 Worker，需分发已构建镜像。

## 6. 切换 Master 和现有用户 Service

在 Swarm Manager `172.18.29.80` 上，先用 `systemctl cat gcs-harness-master` 确认运行配置路径。目前服务读取 `/root/go/src/gcs-harness-master/dist/linux-amd64/master.json`，`/etc/gcs-harness-master/master.json` 是维护中的副本。先备份两份文件，再把两份文件的 `dsh.localImageID` 都改为新的 `sha256:...` Image ID，保留属主和权限，确认文件一致后重启 Master。Master API Token 和 DSH 启动 Token 均不能写入本指南或 Git 提交。

```bash
systemctl cat gcs-harness-master
jq -r '.dsh.localImageID' /root/go/src/gcs-harness-master/dist/linux-amd64/master.json
systemctl restart gcs-harness-master
systemctl is-active gcs-harness-master
curl --fail --silent http://127.0.0.1:18088/healthz
```

只有两份配置都填入新 Image ID 后才能运行重启命令。此后新用户 `launch` 会使用新镜像。若要迁移已运行用户，先列出 `dsh-u-` Service，再**逐个**执行 `docker service update --image "$IMAGE_ID" --no-resolve-image --detach=false <service-name>`。每个服务更新完成、Worker 容器健康后再更新下一位用户。操作会短暂重启该用户的 DSH 进程，但挂载的历史会话和工作区数据不变。

## 7. 验证、回滚与清理

确认 Master 健康、目标 Service 均为 `1/1`、配置的 Image ID 正确且 Worker 容器健康。如果发布失败，恢复备份的 Master 配置并重启 Master；只要所有合格 Worker 仍保留旧镜像，即可将受影响 Service 更新回旧 Image ID。新镜像完成滚动更新并经过观察后，再核对旧镜像引用的已停止容器具体 ID，删除这些容器和旧镜像。镜像更新过程中不执行 `docker service rm`、`docker compose down -v` 或数据卷清理。JFS 用户目录不是可丢弃的构建产物。

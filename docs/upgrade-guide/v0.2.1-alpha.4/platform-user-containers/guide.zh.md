---
kind: upgrade-guide
description: "平台用户容器改用限定的 bubblewrap 策略和 Worker 本机 Docker 管理，不再创建用户 Swarm Service。"
---

# 通过受限 Worker 运行平台用户容器

[English](guide.md) | 中文

## 变更

平台 Docker 镜像打包 primary runtime 和七项 Office skills，并要求限定的 bubblewrap 策略。用户使用 GCS Worker 管理的普通 Docker 容器，不再使用 Swarm Service。Master 不接受旧 Docker/Overlay placement 配置；公共 launch、terminate 接口不变。JFS 用户目录不迁移、不删除。

## 迁移

1. 从合并后的 main 更新 Master 和 Worker，在每个已验证环境的 Worker 安装 `docker/security/install.sh`。不开 privileged，不改 Docker 全局安全默认值；安全取舍见 [Docker README](../../../../docker/README.zh.md#命令沙箱)。
2. Master 的 `workers` 填写节点真实 URL，不能用 routing mesh。受信任 Worker 配置 Docker socket、JFS 根目录、私有 `dataDir`、命名 AppArmor 策略及 seccomp 文件。控制端口仅允许 Master/本机管理访问。
3. 从合并后的 main 构建 DSH 镜像，把同一 Image ID 分发到所有配置 Worker。烟测通过后才能更新两份 Master 配置。
4. 按[发布流程](../../../cookbook/updating-platform-fork.zh.md#5-通过-master-和-worker-发布)安排维护窗口：先停止旧用户 Service，再对 `/storage-root-jfs/user-<userID>` 启动替代容器。不允许两代进程同时写同一目录。
5. 确认目标用户容器 healthy，镜像与规格正确；测试 launch、原生 Web/设置、命令约束、Office 渲染及 terminate/重新 launch 后历史保留。新版本稳定前保留停止的旧实例和镜像。

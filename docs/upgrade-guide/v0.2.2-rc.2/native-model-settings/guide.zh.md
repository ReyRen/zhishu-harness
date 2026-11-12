---
kind: upgrade-guide
description: 平台模型设置使用 Harness 原生控件和经过所有者认证的管理操作，替代模型页面地址接口。
---

# 平台原生模型设置

[English](guide.md) | 中文

## 变更

使用 `platformModelManagement: true` 的平台组合通过 Harness 原生组件显示**设置 → 模型设置**。统一的 gcs-webnora 模型目录、已存模型 ID、迁移别名、凭据和知识库绑定保持不变。`/api/zhishu-models/config` 地址接口由经过所有者认证的 `/api/zhishu-models/manage` 操作替代。模型设置不再使用 `WEKNORA_WEB_URL`，知识库页面保留独立的浏览器地址配置。

## 迁移

1. 使用同一镜像部署 Harness Host 与 Client。保留 `WEKNORA_BASE_URL`、Worker 提供的 `DSH_PLATFORM_USER_ID` 和当前用户 SSO，不要重复执行已完成的旧模型导入。
2. 移除模型页面地址调用方。原生设置使用 GET 管理操作 `context`、`models`、`providers`，以及用于模型定义、凭据、复制、删除和连接测试的明确 POST 操作。凭据保留在 Host 和统一后端。
3. 打开**设置 → 模型设置**，切换到其他设置分区后返回，确认列表缓存及未完成的编辑值保留，并确认已有对话与知识库仍使用原模型配置。保留已建立索引的嵌入模型绑定。
4. 部署配套的 gcs-webnora 知识库工作台前端。独立的模型、Ollama 与模型目录管理入口被移除，各应用模型选择器打开 Harness 原生设置。保留已有模型记录及各知识库的模型选择。独立部署的 gcs-webnora 构建仍保留自己的管理页。

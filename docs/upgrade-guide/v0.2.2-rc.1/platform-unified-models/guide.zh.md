---
kind: upgrade-guide
description: 平台 Web 模型配置从 profile 提供方迁入经过认证的统一模型目录。
---

# 平台统一模型

[English](guide.md) | 中文

## 变更

平台 Web profile 在**设置 → 模型设置**中使用 gcs-webnora 模型目录。旧平台 profile 提供方路由被禁用，运维人员须在滚动更新前将已有定义和凭据导入所属用户的私有空间，原始文件保留。不加载平台 overlay 的原始组合保持现有设置。Harness 展示当前用户的完整可用目录，不提供空间选择器，各应用保留自己的模型选择。已有模型 ID、知识库绑定和索引保持不变。

## 迁移

1. 先停止全部旧 gcs-webnora API 和后台写入者，进行数据库一致备份，再应用 PostgreSQL 139 或 SQLite 55 迁移。启动时须完成历史模型引用审查，既有跨归属引用需要迁移核对；策略启用后拒绝自动执行数据库降级。部署提供 `/harness/models`、`GET /api/v1/models/available` 和 `POST /api/v1/models/:id/harness-chat` 的 gcs-webnora 版本，再滚动更新 Harness 镜像。
2. 配置 `WEKNORA_BASE_URL`；公共代理不同的情况下另行配置 `WEKNORA_WEB_URL`。保留 Worker 提供的 `DSH_PLATFORM_USER_ID` 和当前用户 SSO。不要把已存模型密钥导出到用户容器。
3. 备份后端数据库与旧 profile、凭据文件。使用 gcs-webnora 的 `cmd/migrate-harness-models` 先生成计划，核对已验证的私有空间目标，再应用。将各用户不含凭据的别名映射安装到 `DSH_HOME/storages/zhishu-models/legacy-model-map.json`。确认旧模型地址和显式能力均保留，不覆盖已有配置。在**设置 → 模型设置**中通过编辑器和连接测试确认对话及向量模型配置。
4. 打开空闲的已有会话。名称唯一匹配、唯一空间默认模型或唯一可用模型会通过原生会话事件被选为统一模型。目录存在歧义时需从输入框选择。活跃的第三方适配器和已明确选择的统一模型保持不变。
5. 验证 Harness 与知识库选择器使用同一份可用目录，以及真实对话和知识库调用。新引用可以选择业务空间之外归属的模型，旧后端无法执行这些引用；后端回滚前须保留当前数据库并核查绑定，不能用旧备份覆盖现有数据。已建索引的文档保留原 Embedding 绑定，替换时仍需显式重建索引。见[配置和限制](../../../../overlay/models/README.zh.md)。

---
kind: upgrade-guide
description: 平台 Web 模型配置从 profile 提供方迁入经过认证的统一模型目录。
---

# 平台统一模型

[English](guide.md) | 中文

## 变更

平台 Web profile 在**设置 → 模型**中使用 gcs-webnora 模型目录。旧平台 profile 提供方路由被禁用，profile 凭据不会被复制或删除。不加载平台 overlay 的原始组合保持现有设置。知识库模型绑定和索引保持不变。

## 迁移

1. 先部署提供 `/harness/models` 和 `POST /api/v1/models/:id/harness-chat` 的 gcs-webnora 版本，再滚动更新 Harness 镜像。
2. 配置 `WEKNORA_BASE_URL`；公共代理不同的情况下另行配置 `WEKNORA_WEB_URL`。保留 Worker 提供的 `DSH_PLATFORM_USER_ID` 和当前用户 SSO。不要把已存模型密钥导出到用户容器。
3. 在**设置 → 模型**中使用现有编辑器及连接测试确认空间的对话和向量模型配置。缺少的模型在此补充，旧 profile 独有的模型不会自动导入。
4. 打开空闲的已有会话。名称唯一匹配、唯一空间默认模型或唯一可用模型会通过原生会话事件被选为统一模型。目录存在歧义时需从输入框选择。活跃的第三方适配器和已明确选择的统一模型保持不变。
5. 验证真实对话和知识库调用。已建索引的文档保留原 Embedding 绑定，替换时仍需显式重建索引。见[配置和限制](../../../../overlay/models/README.zh.md)。

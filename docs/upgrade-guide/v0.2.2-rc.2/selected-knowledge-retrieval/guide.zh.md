---
kind: upgrade-guide
description: 平台已选知识库在用户问题进入模型前检索，搜索结果保留检索诊断。
---

# 已选知识库检索

[English](guide.md) | 中文

## 变更

平台 Web 和桌面组合在已选知识库时，会在每次接纳用户文字提问后、发送模型前，检索证据并提供有数量限制的文档概览。之前的组合仅开放可选工具。原生 Session 日志保留这些证据。搜索输出新增 `retrieval` 诊断，新增的 `weknora_overview` 工具支持限定范围的文档发现。平台 ask 声明移除原本就被拒绝的 `agent_id`、`session_id` 和 `web_search` 参数。独立安装的上游组合包保持自身行为。

## 迁移

1. 部署配套的 Harness Host 和 Client。保留现有 SSO 身份、`WEKNORA_BASE_URL`、模型目录和已索引文档。不需要 Session 格式或数据库迁移。
2. 确认后端在现有检索接口之外，提供经过认证的 `GET /api/v1/knowledge-bases/:id/knowledge` 接口，返回 `data` 和 `total`。gcs-webnora 校验自有与共享知识库的访问权限。独立 API Key 需要检索权限。
3. 打开会话，选择知识库并提问具体文档问题。确认第一轮模型请求包含已记录的知识库上下文。要求总结，确认回答使用真实文档并说明未覆盖的部分。
4. 清空选择，再发送问题，确认不再产生新的知识库检索。解析搜索结果的调用方须接受新增的 `retrieval` 字段，并区分未命中、重排序过滤、请求失败与空文档目录。

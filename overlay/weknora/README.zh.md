# 内置 WeKnora

[English](README.md) | 中文

平台所有 Web 和 Desktop profile 都从私有安装目录加载 `@wxg-prc-cpg/dsh-weknora@0.1.0`。用户无需安装市场插件或修改 profile。如果 profile 已持有此组合包，则使用它自己的副本，避免重复注册。Headless 和 SDK profile 不加载平台 Web overlay。

原插件向对话 Agent 提供 `weknora_list_knowledge_bases`、`weknora_search`、`weknora_read_document` 和 `weknora_ask`，包括 Code Mode。检索返回原文片段，读取返回文档分块，问答委托 WeKnora 自身的模型。工具行为和限制见[上游参考](https://github.com/Tencent/WeKnora/tree/main/packages/dsh-weknora)。

启动 Web 或 Desktop 前配置 Host 环境。容器示例透传这些变量；生产 Worker 需要在创建各用户容器时提供。修改后需要重启对应用户的运行时。

| 变量 | 含义 | 默认值 |
|---|---|---|
| `WEKNORA_BASE_URL` | 后端地址；缺少 `/api/v1` 时自动补上 | `http://localhost:8080/api/v1` |
| `WEKNORA_API_KEY` | 通过 `X-API-Key` 发送的 WeKnora 凭证 | 未设置 |
| `WEKNORA_TENANT_ID` | 通过 `X-Tenant-ID` 发送的空间选择，平台级 Key 需要它 | 未设置 |
| `WEKNORA_KNOWLEDGE_BASE_IDS` | 逗号分隔的默认知识库 ID | 当前凭证可见的全部知识库 |
| `WEKNORA_AGENT_ID` | `weknora_ask` 使用的 WeKnora 自定义 Agent | RAG 流程 |
| `WEKNORA_RESOURCE_URLS` | `public` 返回可加载的引用地址，`handle` 返回内部引用 | `handle` |

凭证需要 `retrieve` 权限，问答还需要 `chat`。它不同于模型 API Key 和 SSO Client Secret。插件不会继承 iframe 登录 Token。每个运行时使用配置的凭证：共用凭证也就共用其授权。按当前用户进行 SSO 认证需要单独改造插件。仓库不含生产凭证；真实后端验证需要在配置认证后进行。

后端不可达或未获授权时，工具仍然注册，调用会报告错误。默认地址沿用原插件的开发入口；容器内的 `localhost` 指向自身。`docker/.env.example` 给出了现有 230 后端地址，供部署时配置。

镜像构建通过本地模拟后端和确定性模型运行[无密钥 Web 冒烟验证](../../docker/smoke-weknora.mjs)，检查真实 Agent 调用、各运行时独立凭证、越权拒绝、profile 归属和卸载后移除工具。这不验证生产 SSO、知识库权限或模型质量。

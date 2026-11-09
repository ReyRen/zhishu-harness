# 内置 WeKnora

[English](README.md) | 中文

平台所有 Web 和 Desktop profile 都从私有安装目录加载 `@wxg-prc-cpg/dsh-weknora@0.1.0`。用户无需安装市场插件或修改 profile。如果 profile 已持有此组合包，则使用它自己的副本，避免重复注册。Headless 和 SDK profile 不加载平台 Web overlay。

原插件向对话 Agent 提供 `weknora_list_knowledge_bases`、`weknora_search`、`weknora_read_document` 和 `weknora_ask`，包括 Code Mode。检索返回原文片段，读取返回文档分块，问答委托 WeKnora 自身的模型。工具行为和限制见[上游参考](https://github.com/Tencent/WeKnora/tree/main/packages/dsh-weknora)。

平台客户端自动取得 `gcs-webnora` SSO 票据，并交给已认证的 Harness Host，无需先打开知识库工作台。Host 通过 `/auth/platform-sso/exchange` 换证，对话工具使用得到的用户 Bearer 凭据。凭据只保存在内存中，不返回给模型，也不写入浏览器存储或 JFS。运行前配置后端地址；Worker 创建各用户容器时传入用户身份与地址。

| 变量 | 含义 | 默认值 |
|---|---|---|
| `WEKNORA_BASE_URL` | 后端地址；缺少 `/api/v1` 时自动补上 | `http://localhost:8080/api/v1` |
| `DSH_PLATFORM_USER_ID` | Worker 指定的平台用户；后端换证时必须验证该身份 | 独立 Desktop 不设置 |
| `WEKNORA_API_KEY` | 独立部署显式配置的机器凭据；Worker 用户运行时拒绝它 | 未设置 |
| `WEKNORA_TENANT_ID` | 可选的空间选择；后端校验成员权限 | SSO 用户的当前空间 |
| `WEKNORA_KNOWLEDGE_BASE_IDS` | 逗号分隔的默认知识库 ID | 当前凭证可见的全部知识库 |
| `WEKNORA_AGENT_ID` | `weknora_ask` 使用的 WeKnora 自定义 Agent | RAG 流程 |
| `WEKNORA_RESOURCE_URLS` | `public` 返回可加载的引用地址，`handle` 返回内部引用 | `handle` |

只有原生 Host 所有者请求可访问 `/api/zhishu-knowledge/auth`。Worker 身份优先于浏览器的身份声明；gcs-webnora 验证平台票据并按现有用户和空间权限授权。本地凭据通过 `/auth/refresh` 刷新；登录或刷新被拒绝时清除授权。403 不会改用其他凭据，失败的问答请求也不会自动重复。平台退出时清除 Host 凭据，上游撤销仍由 gcs-webnora 强制执行。

`knowledge_login_required` 表示需要重新打开已登录的平台会话后重试；`knowledge_backend_unavailable` 表示需要检查后端配置及网络。默认地址沿用原插件的开发入口；容器内的 `localhost` 指向自身。`docker/.env.example` 给出了 230 地址。独立 API Key 需要 `retrieve` 权限，问答还需要 `chat`；它不同于模型密钥和 SSO Client Secret。

镜像构建通过本地模拟后端和确定性模型运行[无密钥 Web 冒烟验证](../../docker/smoke-weknora.mjs)，检查真实 Agent 调用、API Key 与 SSO 传输、所有者专用换证入口、独立凭据、越权拒绝、profile 归属和卸载后移除工具。[认证测试](../../docker/tests/weknora-auth.test.mjs) 覆盖用户绑定、刷新、撤销及退出竞态。真实平台票据、知识库权限和模型回答需要在部署时验证。

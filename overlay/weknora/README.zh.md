# 内置 WeKnora

[English](README.md) | 中文

选择器和工具列表合并当前工作空间内的知识库与共享给该空间的知识库，并按知识库 ID 去重。两个列表使用相同凭据、空间范围和部署允许列表。共享列表读取失败会停止目录校验；撤销共享会阻止下一次已选工具调用。检索保留接收方身份，由 gcs-webnora 校验来源空间和共享权限。

平台所有 Web 和 Desktop profile 都从私有安装目录加载 `@wxg-prc-cpg/dsh-weknora@0.1.0`。用户无需安装市场插件或修改 profile。如果 profile 已持有此组合包，则使用它自己的副本，避免重复注册。Headless 和 SDK profile 不加载平台 Web overlay。

输入 `/` 后选择“知识库”，在输入框上方的原生下拉列表中搜索和多选。列表仅包含当前登录用户有权访问且位于部署允许列表中的知识库。勾选或取消在确认成功后立即生效，失败保留原选择。输入框始终只有一个入口：未选择显示“知识库”，单选显示名称，多选显示数量。点击可重新打开列表，不改变草稿和附件。下拉中显示完整名称，提供全部与已选筛选、搜索和清空。Tab 可访问这些控件，点列表外、Esc 或焦点离开时收起。恢复和分支会话保留日志中的选择，新会话默认不使用知识库。取消全部选择可停止检索，但不会移除历史资料。内部命令仍为 `knowledge`，菜单不显示英文别名。

未选择时，平台适配层从模型声明和执行入口中排除全部 WeKnora 工具，Code Mode 同样受限。工具仅使用已选知识库的并集。Host 在每次调用前逐一检查可见权限，读取分块前校验文档归属，并在任一选择更改时中止正在进行的检索。选择失败保留原集合；某个库失去权限时整次调用失败，不会静默缩小检索范围。搜索返回片段；ask 使用全新的限定范围 RAG 会话。自定义 WeKnora Agent、复用后端会话、联网搜索，以及上游跨库标题搜索回退被禁用，避免扩大选定范围。profile 自己安装的上游组合包独立于平台适配层。

已选知识库时，Host 在每次接纳用户文字提问后、首次请求模型前，检索片段并读取文档概览。原生运行时上下文将这些证据写入 Session 日志。`maxResults` 限制片段、Wiki 匹配页和概览文档数量，`maxChunkChars` 限制每份摘录、摘要和检索问题的长度。概览包含文档数量、解析状态和分页信息。总结可使用 `weknora_overview` 与 `weknora_read_document` 查看资料。搜索保留重排序诊断和覆盖范围。认证、权限和后端失败会将待提供的证据替换为失败说明。取消全部选择会停止新检索，历史证据保留。

所选知识库开启 Wiki 时，自动检索和 `weknora_search` 也会通过 gcs-webnora 的 Wiki 搜索取得页面标题、slug、摘要和匹配摘录。仅开启 Wiki 的库即使没有源文档，也能检索到手工创建的页面。混选时各库使用已启用的索引。`weknora_wiki_read_page` 可以读取命中页和已记录的来源，调用前会重新校验权限，并向所选 Wiki 发送读取请求。

知识库界面通过全局侧栏面板打开，不依赖工作台安装。已有知识库工作台会话进入主会话列表，不删除 Session 日志、文件或笔记。AI 助手仅在成功退出工作台模式后创建原生会话。

平台客户端自动取得 `gcs-webnora` SSO 票据，并交给已认证的 Harness Host，无需先打开知识库面板。Host 通过 `/auth/platform-sso/exchange` 换证，对话工具使用得到的用户 Bearer 凭据。凭据只保存在内存中，不返回给模型，也不写入浏览器存储或 JFS。退出登录会在交接前拒绝尚未完成的旧票据，即使交接失败也会清除 Host 凭据。运行前配置后端地址；Worker 创建各用户容器时传入用户身份与地址。

| 变量 | 含义 | 默认值 |
|---|---|---|
| `WEKNORA_BASE_URL` | Harness Host 可访问的 API 地址。工具在缺少 `/api/v1` 时自动补上。桌面未设置时使用 `http://172.18.36.230:5175/weknora/api/v1` | overlay 内回退为 `http://localhost:8080/api/v1` |
| `DSH_PLATFORM_USER_ID` | Worker 指定的平台用户；后端换证时必须验证该身份 | 独立 Desktop 不设置 |
| `WEKNORA_API_KEY` | 独立部署显式配置的机器凭据；Worker 用户运行时拒绝它 | 未设置 |
| `WEKNORA_TENANT_ID` | 可选的空间选择；后端校验成员权限 | SSO 用户的当前空间 |
| `WEKNORA_KNOWLEDGE_BASE_IDS` | 人工选择器的知识库 ID 允许列表，以逗号分隔；不会自动启用检索 | 当前凭证可见的全部知识库 |
| `WEKNORA_AGENT_ID` | 上游 profile 设置；平台选择适配层始终使用限定范围的 RAG | RAG 流程 |
| `WEKNORA_RESOURCE_URLS` | `public` 返回可加载的引用地址，`handle` 返回内部引用 | `handle` |

API 地址在 [`docker/.env`](../../docker/.env.example) 中配置为 `WEKNORA_BASE_URL`，或在 Worker 部署目录的 `worker.json` 中配置为 `weknoraBaseURL`。使用绝对 HTTP(S) URL，地址不包含凭据、查询参数或片段。修改地址后，重建 Compose 容器，或重新部署 Worker 配置并逐用户 rollout。

### Web 网关

Harness Web 在当前源打开 `/weknora/sso/platform`。x86 和 ARM 都在提供 Harness 入口的 front-web 服务中，将整个 `/weknora/` 前缀转发给 gcs-webnora 的 HTTP 服务，包括静态资源和 API。两者处于共享网络时可使用服务名，分开部署时使用网关可达的内网地址。上游请求保留该路径前缀。

```nginx
location ^~ /weknora/ {
    proxy_pass http://webnora.internal:5175;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_read_timeout 1800s;
}
```

将 `proxy_pass` 指向实际的 gcs-webnora 上游。将带端口的 Harness 访问源加入 gcs-webnora 的 `PLATFORM_SSO_PARENT_ORIGINS`，并保留外层平台页面的嵌入授权和平台已注册的 `gcs-webnora` SSO 客户端。

桌面原生界面使用已配置 API 服务的知识库页面。打包后的业务工作区通过本地 HTTP 网关打开 Harness，该网关也代理同一个 `/weknora/` 前缀。

### 认证与检索

只有原生 Host 所有者请求可访问 `/api/zhishu-knowledge/auth`。Worker 身份优先于浏览器的身份声明；gcs-webnora 验证平台票据并按现有用户和空间权限授权。本地凭据通过 `/auth/refresh` 刷新；登录或刷新被拒绝时清除授权。403 不会改用其他凭据，失败的问答请求也不会自动重复。平台退出时清除 Host 凭据，上游撤销仍由 gcs-webnora 强制执行。

`knowledge_login_required` 表示需要重新打开已登录的平台会话后重试；`knowledge_backend_unavailable` 表示需要检查后端配置及网络。默认地址沿用原插件的开发入口；容器内的 `localhost` 指向自身。`docker/.env.example` 给出了 230 地址。独立 API Key 需要 `retrieve` 权限，问答还需要 `chat`；它不同于模型密钥和 SSO Client Secret。

选择知识库后，附图会检索所选库中已启用图片向量且嵌入模型支持图片的索引。每次使用第一张附图，文字问题仍会检索文档和 Wiki。文档与 Wiki 中有权读取的图片可以带图注显示在回答中。每次加载图片时，Host 使用当前登录用户的凭据访问知识库文件接口，由 gcs-webnora 再次校验权限。

成功执行的 `/knowledge-search` 和 `/wiki-search` 记录在对应知识库的「活动记录」中，显示操作者、时间和检索方式。活动详情不含问题内容或图片字节。运维日志仍使用 `X-Request-ID` 关联 Worker 用户以及 Harness 会话和工具调用的哈希值。SSO 使用私有资源引用。独立 API Key 配置可请求公开资源链接，WebNora 拒绝为限定知识库的密钥提供公开链接时，使用私有资源引用。

镜像构建通过本地模拟后端和确定性模型运行[无密钥 Web 冒烟验证](../../docker/smoke-weknora.mjs)，检查真实 Agent 调用、API Key 与 SSO 传输、所有者专用换证入口、独立凭据、越权拒绝、profile 归属和卸载后移除工具。[认证测试](../../docker/tests/weknora-auth.test.mjs) 覆盖用户绑定、刷新、撤销及退出竞态。[选择测试](../../docker/tests/weknora-selection.test.mjs) 覆盖重放、范围限制、权限撤销和取消；[选择器测试](../../docker/tests/weknora-picker.test.mjs) 覆盖命令确认和会话独立选择。真实平台票据、知识库权限和模型回答需要在部署时验证。

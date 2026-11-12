# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

文档：[https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## 本分支的平台部署

本分支保留完整的上游 DSH Web 应用，并增加托管工作区配置以及 [docker/](docker/README.zh.md) 下的独立容器构建。多用户部署由以下项目组成：

- [gcs-harness-master](https://github.com/ReyRen/gcs-harness-master) 负责平台身份认证、生命周期、调度与 iframe 网关。
- [gcs-harness-worker](https://github.com/ReyRen/gcs-harness-worker) 负责节点本地用户容器生命周期与内部数据面代理。
- 本仓库负责每用户 DSH 镜像。

`master` 分支只镜像 DSH 官方 `upstream/master`。平台开发和容器构建始终使用 `main`；更新与发布流程见[容器构建指南](docker/README.zh.md)。

<a id="platform-update-policy"></a>

## 更新触发与上游合并原则

本原则同时适用于 `zhishu-harness` 与 `gcs-webnora`。仅在用户明确要求时更新，不启用定时更新任务。持续合入各自上游，同时保留平台需要的业务能力。

| 上游与二开功能的关系 | 合并取舍 |
|---|---|
| 二开具有上游没有的能力 | 保留该能力，并适配新的上游接口。 |
| 上游已完整覆盖某项二开能力 | 采用上游实现，删除重复的二开实现。 |
| 上游仅覆盖某项二开能力的一部分 | 共性部分采用上游，仅通过受支持的扩展或配置保留未覆盖的业务差异。 |
| 保留必要能力、数据兼容或权限要求与上游真正冲突 | 暂停受影响的发布，说明具体冲突，请用户决定。 |

按实际行为、配置、权限与兼容性判断是否重合，不能只看功能名或文件名。按上述规则自行处理常规合并冲突，不反复请求确认。两个项目分别维护自己的历史和 PR；“保持最新”指包含上游更新并保留必要业务能力，不要求二开源码与上游逐文件相同。

1. 实时核对官方与 Fork 引用、本地和服务器检出、未提交工作、待合并 PR、镜像及运行服务。分别判断待合并、业务代码待构建、待部署和上次未完成步骤；上游未变化不代表发布完成。
2. 在 Mutagen 之外的分支审查整合。保留未知改动，确认归属后才能发布；不强推、不重置未知修改，不向任何官方上游推送或提 PR。审查后合入对应 Fork 的 `main`；暂停 Mutagen，先快进服务器，再快进本地，确认两端干净一致后恢复并 flush。
3. 按影响范围验证行为、类型、静态检查、文档、依赖和构建。运行时改动还须完成相关沙箱、Office、原生 Web、离线市场和集成验证。真实失败必须修复；基础设施限制须说明原因并提供等效验证，失败检查仍如实记录为失败。
4. 运行时发布从干净且已合并的 `main` 构建，先用无真实用户数据的环境验证，再部署并核对实际运行版本。Harness 镜像更新包括 Master 默认镜像和现有用户逐个 rollout，确保当前及下次 Web launch 均使用新版；首个失败即停。当前发布目标为 x86，ARM 须另行授权。
5. 保持用户 JFS 路径、数据归属、SSO、共享与撤权、沙箱防护。持久化格式变化须停写并一致备份；进程回滚不等于格式回滚。仅文档更新完成文档检查和同步即可，运行时输入未变化时不重建镜像或重启服务。

例如，可以手动要求：

> 更新 zhishu-harness 和 gcs-webnora：按本原则合入各自最新上游和经审查的二开，更新两个 main 及本地、服务器检出，验证并发布 x86 运行时改动；ARM 保持现状。

分别报告上游合入、main 提交、检出同步、产物构建和实际部署结果，列出待办与阻碍；不能将构建成功或上游镜像分支同步成功等同于发布完成。

官方来源为 `deepseek-ai/deepseek-harness:master`；Fork `master` 仅快进镜像官方，`ReyRen/zhishu-harness:main` 是平台源码。保留每用户工作区与 JFS 隔离、原生 Web/桌面端、插件与工作台、离线依赖、primary runtime 和 Office skills。Harness 原生“模型设置”保持为用户级唯一模型配置入口，各应用保留自己的模型选择逻辑。Fork 的可选 CI workflow 保持仅手动触发。具体步骤见[发布流程](docs/cookbook/updating-platform-fork.zh.md)；另一个项目的集成要求见其 [README](https://github.com/ReyRen/gcs-webnora#platform-update-policy)。

## 开发者预览

DeepSeek Harness 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

<a id="run"></a>

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

<a id="run-from-source"></a>

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

## 社区与支持

- 通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群！扫描下方二维码填写入群问卷，小助手会定期发送入群邀请。

<table>
  <thead>
    <tr>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

`pnpm run dev:web` 会在一个终端里完成构建、启动，并在源码修改时重建 client bundle；`make help` 列出 Web 与 Desktop 对应的 Make target。完整表格见开发指南的「应用命令」一节。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 引用

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

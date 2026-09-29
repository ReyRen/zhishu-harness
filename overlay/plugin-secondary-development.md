# zhishu-harness 插件二次开发说明

本文说明官方界面里两类插件入口各自管什么，以及在无外网局域网、Web 端一用户一容器的部署里，提供方的插件应该放在哪里。

部署前提：每个用户一个 Harness 容器。容器拉起时挂上该用户自己的目录，profile 在其中，换镜像不会重建。开关是否打开，记在这份目录里，不记在镜像里。

## 官方界面怎么区分插件

对话界面里和插件有关的入口有两个，名单不是同一份。

### 设置里的「内置插件」

只读。它列出当前这个进程里已经启动的插件，分成两组：

- **会话插件**：由 Agent 预设按会话组成。
- **全局插件**：系统和所有会话共用。

搜索比对的是模块名、条目 id，以及包自己的标题和描述。它不搜索侧栏配置卡片上的中文标题。所以侧栏上叫「终端」的卡片，在这里搜「终端」找不到；执行器包的描述是英文的 Shell、bash。

这里不能安装、不能开关。

### 左侧栏的「插件」

这一页管理组合包，分三块。

**添加插件**安装第三方组合包，写入当前用户的 profile，不影响其他用户。输入可以是 npm 包名、Git 仓库地址，或本机绝对路径。包必须声明 `dsh.bundle`。无外网时，包名和 Git 地址都会失败，只能用容器内能看到的绝对路径，或页面上的自定义内网 npm 源。

**官方**把两种卡片放在一起。它们不是两个插槽。

1. 带开关的，是随安装提供的可选组合包，名单在 `packages/boot/app-boot/src/profile.ts` 的 `OPTIONAL_BUNDLES`。这是完整功能包，代码在仓库里，打进镜像，默认关闭，用户打开后才进入进程，不能卸载。智能体团队就是这一类：包名 `@deepseek-ai/dsh-experimental-agent-team-profile`，目录 `packages/experimental/agent-team-profile`。它的 `cordis.patch.yml` 插入三行，本体、工具和网页界面分别在 `packages/experimental/agent-team`、`tool-agent-team`、`client-ui-agent-team`。
2. 没有开关的，是配置卡片，注册在插件页声明的 `plugins.item` 插槽上。伴生包只改一个已经在跑的插件的参数，不增加功能。终端、Agent 循环、子智能体、网页搜索都是这种卡片。

**已安装**列出这个 profile 自己持有的组合包。

插件页另外两个配置插槽不出现在「官方」列表开头：`plugins.bundle.config` 画在某个组合包的详情页上，`plugins.row.config` 画在该包某一行自己的配置页上。

### 终端这张卡片改的是谁

卡片由 `packages/client/ui-settings-shell` 注册，标题是「终端」。保存时按 loader 行 id 写入设置。非 Windows 的行是 `bash-sandbox`，包 `@deepseek-ai/dsh-bash-sandbox`（`packages/shell/bash-sandbox`）。它继承 `packages/shell/bash-local` 的配置。页面只改两个易变字段：`timeoutMs`（命令多久后被杀掉）、`maxOutputBytes`（标准输出在内存里留多少，超出转临时文件）。保存后进这个插件实例，下一次模型调用 bash 工具、走到 `ctx.shell.resolve()` 时读走。

`@deepseek-ai/dsh-shell`（`packages/shell/shell`）只是 `ctx.shell` 的接口，卡片不写它。右侧栏里人自己敲命令的终端标签是 `dsh-client-ui-sidebar-terminal`，也不读这两个数。Windows 上同一张卡片改的是行 `pwsh-sandbox`，包 `@deepseek-ai/dsh-pwsh-sandbox`。Host 没有提供对应命名空间时，卡片不出现。

## 我们的场景怎么放

| 提供方要的效果 | 放哪里 | 不要用 |
| --- | --- | --- |
| 某个用户按自己的需要安装 | 插件页「添加插件」，容器内绝对路径 | npm 包名、GitHub 地址 |
| 所有用户必须加载，可以盖掉已有功能 | 仓库根目录 `overlay/<名称>/` | `OPTIONAL_BUNDLES`，改官方 `cordis.patch.yml` |
| 系统级功能，用户自己打开；稳定前保留开关 | `OPTIONAL_BUNDLES`，源码在本仓库并作为 `apps/cli` 的运行时依赖 | `overlay/`（没有开关，人人都会加载） |

### 全员必须加载：`overlay/`

`apps/cli/src/profile-boot.ts` 的 `zhishuOverlayPatches()` 在每次启动时扫描 `overlay/<名称>/cordis.patch.yml`，按目录名排序。这些补丁叠在官方组合包之后、用户自己的补丁之前，所以可以按行 id 关掉官方那一行再插入自己的实现，不必改 `packages/` 里的官方补丁。

它不是 profile 里的组合包。插件页没有开关，也不能卸载。代码在镜像里，不访问外网。换镜像之后，已经在用的用户下一次启动就会加载。品牌替换 `overlay/brand/` 就是这样：关掉 `ui-brand-official`，插入侧栏标识。新增能力时复制这个目录，不要把补丁写进官方 `cordis.patch.yml`。

`overlay/` 只在没有 `VITEST` 环境变量时加载，官方测试仍走原组合。

### 用户可选的系统插件：官方组合包清单

适合「镜像里自带、默认关闭、每个人在自己的插件页打开」。包要同时满足：

- 源码在本仓库。
- 是 `apps/cli` 的运行时依赖，这样无外网也能从安装目录解析，打开时不下载。
- `package.json` 声明 `dsh.bundle.patch`，并带图标和 `locale` 文案。
- 名字写进 `OPTIONAL_BUNDLES`。
- 不要写进 `web` 这个 profile 模板。`scripts/verify-default-product-isolation.ts` 会拒绝「既在可选名单里，又被随附模板选中」。

开关没有单独的默认值。打开表示该用户 `profiles/<name>/package.json` 的 `dsh.profile.bundles` 含有这个包名。这份文件在容器挂载的用户目录里。`initProfile` 看到 `package.json` 已经存在就不再写入。因此：

- 更新镜像不会把已有用户的开关改成开。
- 完全新用户也不会自动开着。可选组合包在第一次创建 profile 时本来就不写入这个名单。

功能稳定、要变成全员加载时，把补丁挪进 `overlay/`，并从 `OPTIONAL_BUNDLES` 去掉。不要试图给官方开关加一个「默认开」：官方没有这一档；写进 `web` 模板会被门禁拒绝，而且也改不到已经存在的 profile。

同一份镜像里，每个用户看到的可选卡片都一样。Harness 不认识平台用户，不能按人隐藏某一张卡片。平台上的 `runtime-features.json` 只控制整页 Harness 谁能进入。

### 和改官方源码的界限

界面上官方留了 slot 的，用 `overlay/` 占用 slot。品牌用的是 `sidebar.brand.mark` 和 `sidebar.brand.name`。没有 slot 时，优先在 `overlay/` 写独立插件，按行 id 关掉官方那一行再插入自己的实现。直接改 `packages/` 和上游冲突更大，只在行为被封在插件运行之前、没有可关闭的行可以替换时才改。

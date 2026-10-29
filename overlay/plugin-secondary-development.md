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

`apps/cli/src/profile-boot.ts` 的 `zhishuOverlayPatches()` 在每次启动时扫描 `overlay/<名称>/cordis.patch.yml`，按目录名排序。这些补丁叠在官方组合包之后、用户自己的补丁之前，所以可以按行 id 关掉官方那一行再插入自己的实现，不必改 `packages/` 里的官方补丁。其中 `hide-official-account` 对所有 Web profile 加载，容器化网页也会关掉官方账号菜单并回到设置齿轮。`platform-account` 只在 profile `desktop` 上加载。

它不是 profile 里的组合包。插件页没有开关，也不能卸载。代码在镜像里，不访问外网。换镜像之后，已经在用的用户下一次启动就会加载。品牌替换 `overlay/brand/` 就是这样：关掉 `ui-brand-official`，插入侧栏标识。新增能力时复制这个目录，不要把补丁写进官方 `cordis.patch.yml`。

插件市场同样预装，源码不放进仓库。平台私有装配锁定版本 `dshmarket@1.66.22`，依赖归属和运行时共享规则见[预装说明](README.zh.md)。构建安装包或镜像时从公网 npm 装进安装目录。`overlay/dsh-market/cordis.patch.yml` 只插入这一行，并设置 `allowRestart: false`。因此版本跟着安装包或镜像走，不进用户 profile，插件页「已安装」里不会出现。用户若再从插件页安装同名包，`profileOwnsOverlayBundle()` 会跳过这条插入，避免同一个 id 出现两次。这份包不发布到私有源。

`meow-memory` 也是平台私有装配的锁定版本依赖。`overlay/meow-memory/cordis.patch.yml` 插入并指定 `homeDir: dsh-storage`。它不进私有源。profile 里已有同名包时，用的是上面同一条跳过判断。

市场里列出的其他插件默认仍是公网目录。私有源在 `market-registry/`，说明见 [README.zh.md](../market-registry/README.zh.md)。`pnpm market:registry` 启动没有公网代理的 Verdaccio 和本地目录；`pnpm dsh:private` 把市场指到这两处。目前目录里是从社区拷入的 `open-sea-skin`。桌面安装包会带上同一份源，并在本机自己启动；开发时的 `pnpm run dev:desktop` 仍要先执行 `pnpm market:registry`。

`overlay/` 只在没有 `VITEST` 环境变量时加载，官方测试仍走原组合。

### 预装第三方包的两种拿法

上面两个预装包现在都是锁定 npm 版本。全员预装、不进用户 profile、不进私有源，这两点两种拿法相同。差别是构建时字节从哪来，以及以后能不能在本仓库改这份代码。

| | 锁定 npm 版本 | 源码拷进仓库 |
| --- | --- | --- |
| 适用 | 原样使用社区已发布的包，构建机可以访问公网 npm | 要改这个插件自己的代码，改动随安装包和镜像发布 |
| 依赖 | 私有平台装配锁定版本，如 `dshmarket@1.66.22`、`meow-memory@0.32.1` | `workspace:*`。源码放进仓库，并写进 `pnpm-workspace.yaml` |
| 构建 | 构建机按锁文件从公网 npm 拉一次。完整性哈希钉住字节。pnpm store 里已有时不再下载 | 字节在 git 里。构建不必再向 npm 要这个包 |
| 用户运行 | 安装目录里已有这份包，启动不下载 | 同样在安装目录里，启动不下载 |
| 改代码 | 本仓库不改它。要改行为就改回右列，或等上游发新版本后再改锁定的版本号 | 直接改仓库里的副本，自己负责合入上游后续版本 |
| 当前 | `dshmarket`、`meow-memory` | 插件市场曾经放在 `third-party/dshmarket`。没有功能分叉，已改成锁定版本 |

预装仍由 `overlay/<名称>/cordis.patch.yml` 插入。旁边的 `package.json` 只给 `profileOwnsOverlayBundle()` 读包名，用来跳过 profile 里已有的同名包，它本身不是安装包。

### 私有源里的社区插件

私有源不是预装。`market-registry/tarballs/` 里的压缩包是用户从市场装进自己 profile 的。现在的做法是社区包原样拷进来：不改代码，只让局域网安装不访问公网 npm。意图和锁定版本一样，用的是上游字节；字节放在仓库的 tarball 里，因为私有源没有公网回退，用户安装时不能再去 npm 拉。

要对这份插件做二次开发，开发副本按上一节的「源码拷进仓库」来放，改完再打包。新 tarball 放回 `market-registry/tarballs/`，`plugins.json` 的版本调高。成品仍给用户安装，不改成 `apps/cli` 的锁定版本。只有目的变成全员预装时，才改成锁定版本或源码依赖，并从私有源目录去掉，避免市场里再出现一份。只改压缩包、不留源码，下次对不上上游，也没法继续改。

升级和回滚见下一节。

### 私有源插件的升级和回滚

侧栏「添加插件」和插件市场装进同一份用户 profile（`package.json`、`pnpm-lock.yaml`、`node_modules`、`cordis.patch.yml`）。容器在挂载的 `DSH_HOME`，桌面安装包在用户目录的 `.dsh`。私有源只提供安装包。

预装的插件市场随程序走，不在这份目录里。同名包在 profile 里只有一份，后装的会盖住预装副本。换镜像或安装包会换掉程序、预装市场和私有源里的包，不会删掉、也不会自动升级用户已经装上的插件。

升级某个私有源插件：把新 tarball 放进 `market-registry/tarballs/`，把 `plugins.json` 的 `version` 调高，再重新构建镜像或桌面安装包。旧 tarball 可以从仓库拿掉，这不会卸掉已经装上的旧版本。没装过的人直接看到新版本。从市场按包名装过的人会看到更新提示，要点一下才换成新版本。镜像更新之后、用户还没点更新之前，profile 里继续跑旧版本。

新版本有问题：把旧 tarball 放回去，`plugins.json` 改回旧版本，重新构建。还没点更新的人不用处理。已经升上去的人不会自动降回来，市场只提示更高版本；私有源退回之后，卸掉再装一次才会装回当前版本。市场自带的回滚只覆盖刚更新完、新版本起不来，并且私有源里还要能下到旧包。确认新版本没问题再删旧包。

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

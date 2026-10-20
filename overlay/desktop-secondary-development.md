# 桌面端二次开发与打包说明

本文记录智枢桌面端怎样建在官方 DeepSeek Harness 上，以及 Windows 未签名安装包怎么打。对话界面的插件增量仍放在 `overlay/`，规则见 [plugin-secondary-development.md](./plugin-secondary-development.md)。

这里打出来的是官方 DeepSeek Harness 桌面端，不是 `dsh-desktop` 那个智树壳。两边的安装包不能互相代替。

## 整体实现方案

智枢桌面端是官方壳上的二次开发，不是另写一个应用。会话和业务仍是两个空间：会话继续用官方对话和官方运行时；业务不再在 Harness 里重做平台页面，而是在同一个窗口里直接铺上 model 站点，平台页面只在 model 仓库维护一份。登录也不再用官方 DeepSeek 账号，改走平台自己的登录页。

### 为什么留在官方壳上

会话要的是官方智能体能力：对话、文件、Office，以及安装包里的 Python 运行时。这些封在官方桌面 Host 和 `dsh-app://app` 的对话页里。`dsh-desktop` 没有这份运行时，所以智枢不从那边长出来。官方壳负责窗口、更新、运行时和对话页。账号、补录和业务功能仍由 model 仓库维护，桌面端只加载那个站点。

### 一个窗口里的两层

主窗口自己的网页是 Harness 对话，地址是 `dsh-app://app/`。model 站点是盖在上面的另一个 `WebContentsView`，分区 `persist:zhishu-model`，和对话页的 cookie、存储互不相通。从登录到进入站点始终是这同一个 view。平台把登录标记写在 `sessionStorage` 里，换一个 view 就会丢。

未登录时平台页盖住对话。对话页在盖上去之前就已经加载，所以登录门是这一层遮罩，不是另一扇窗口。点最小化把整个窗口收到任务栏，不会露出底下的会话页。从任务栏还原后，未登录仍是登录页。登录完成并离开登录流程后，平台页藏起来，底下的对话页成为会话空间。再切到业务时，把已经打开的整站显示出来。模型训练只是平台里的一个功能，不是业务空间的落地页。平台自己的顶栏、侧栏、标签保持显示，桌面端不改这些。

### 登录怎么接上平台

启动不再打开官方欢迎页。`openInitialWindow` 创建主窗口后直接交给 `ModelPlatformGate.open()`。官方账号菜单由 `overlay/hide-official-account` 关掉。不改欢迎页源码，也不停账号控制器。

冷启动先读这个分区里的 cookie，再 `POST /DistributedAISystem/UserLoginDisplayInfo`。会话还在就打开 `/desktop-entry`，由平台自己决定去补录还是进入和网页登录成功后相同的去向。cookie 无效，或还没有 cookie，就打开 `/login`。用户在登录页输入账号时不经过 `/desktop-entry`。

这些路径仍算登录流程，不打开对话：`/login`、`/register`、`/desktop-entry`、`/complete-identity`。平台网页登录成功后的去向是 `/smartChat`。桌面端看到地址已经离开上述路径、并且仍是平台源站，就视为已登录：藏起平台页，调用 `enterWorkspace()`，主窗口导航到 `dsh-app://app/`。验证码和 RSA 仍由平台登录页自己完成，桌面端不重做。

退出确认被取消，或官方侧还没进入会话就需要把窗口露出来时，用 `presentLogin()` 再盖上 `/login`。

会话页左下角是平台账号，不是 DeepSeek 账号。官方那一行 `ui-settings-account` 保持关闭。`overlay/platform-account` 占住原来的 `settings.launcher`：头像和账号名来自平台登录，弹出层里是「设置」和「退出登录」。设置仍打开 Harness 自己的设置。退出登录通知壳，由业务页执行原来的退出并回到 `/login`。

业务页只在桌面壳里改。model 预加载注入 `window.zhishuDesktop.embedded`。有这个标记时藏起蓝顶栏和侧栏自己的收起按钮，侧栏左下角放平台账号菜单（用户信息、修改密码、值班电话、用户手册、其他平台、全屏、退出登录），标签栏保留。窗口左上角的折叠按钮按当前空间切换：会话时收会话侧栏，业务时通知业务页收它自己的侧栏。会话侧栏收起后钉在标题栏上的「新会话」按钮，切到业务时藏起，菜单回到折叠按钮旁边。`Header.vue` 仍负责拉取用户信息和相关登录副作用，对话框挂到 `body`。浏览器直接打开 model 没有这个标记，顶栏、侧栏和收起按钮保持原样。

### 工作空间切换

只有 Windows 标题栏有切换。按钮在「编辑」右侧，由 `preload-menu.ts` 画在对话页上，未登录时隐藏。下拉层是另一个 `WebContentsView`（`workspace-menu.ts`），这样平台页盖住窗口时菜单仍在最上面。macOS 没有这套网页标题栏，也就没有这个按钮。

切到业务：显示平台 view。Windows 上它让出标题栏高度，避免盖住「应用 / 编辑」。切回会话：藏起平台 view。对话页一直在底下，不用重新加载。

标题栏和平台页不在同一个文档里。登录状态用 `zhishu-model:state`、`zhishu-model:switch`、`zhishu-model:state-changed`、`zhishu-model:menu` 传递。对话页经常比登录门更早打开，所以状态会补发，标题栏在按钮还藏着时也会自己再问。这两处的细节见后面的打包说明。

### 改动落在哪

| 想改的东西 | 放哪 | 不要 |
|---|---|---|
| 对话界面的标识、关掉官方账号菜单 | `overlay/` 独立插件 | 改 `packages/` 里的界面源码，或把插件接进官方 `tsc` / `tsdown` |
| 窗口、登录门、两个空间谁盖住谁、安装包里的平台地址 | `apps/desktop` | 在平台里再做一套桌面壳 |
| 登录页、补录、`/desktop-entry`、业务功能 | model 仓库 | 在 Harness 里复制这些页面 |

官方测试设置了 `VITEST` 时不加载 overlay。没有 Web 界面的 profile 也不加载。桌面端带 Web 运行时，会加载。`hide-official-account` 对所有 Web profile 生效，关掉官方账号菜单，左下角回到只有设置的齿轮。`platform-account` 只在 profile 名为 `desktop` 时加载，用平台账号换成这颗齿轮。容器化网页用 profile `web`，不加载平台账号。

相关代码在 `apps/desktop/src/model-space/`：

| 文件 | 作用 |
|---|---|
| `model-gate.ts` | 承载 model 页面的 `WebContentsView`，分区 `persist:zhishu-model` |
| `model-space.ts` | 会话 / 业务的类型和 IPC |
| `workspace-menu.ts` | 标题栏下拉菜单 |
| `preload-model-gate.ts` | model 页面的预加载脚本，打包后仍是 `lib/preload-model-gate.cjs` |

## 桌面壳现在做什么

表现如下。分层和原因见上面的整体实现方案。

- 启动看到的是平台登录页。cookie 仍有效时不重复出登录表单，先走 `/desktop-entry`。
- 需要补录时先补录，然后进入 Harness 会话。
- 业务空间是整个 model 站点。
- Windows 标题栏「编辑」右侧切换「会话 / 业务」。macOS 没有这个按钮。
- 官方账号菜单不出现。

model 仓库的 `/desktop-entry` 不能要求登录标记。冷启动时 cookie 还在、`sessionStorage` 已经空了，这个路由负责接上和网页登录成功后相同的去向。

## 模型平台地址

本地开发加载 `http://127.0.0.1:8888`。安装包加载本机网关 `http://127.0.0.1:17321`。页面在安装包里，后台地址在安装目录的 `resources/model-gateway.json`。安装后的程序不读本机环境变量。

| 场景 | 地址从哪来 |
|---|---|
| `pnpm run dev:desktop` | 默认本地 8888。启动前在 shell 设置 `DSH_MODEL_ORIGIN` 可临时改掉，只影响这一次 |
| 打包 | 页面固定为 `http://127.0.0.1:17321`，写入 `dshModelOrigin`。后台 IP 不在这里改 |

实现：`apps/desktop/scripts/model-origin.mjs` 写入页面地址；`model-gate.ts` 的 `modelPlatformOrigin` 在运行时读取。打包会丢掉 shell 里的 `DSH_MODEL_ORIGIN`。

## 平台页面打进安装包

打包命令会先构建 model，再把产物放进安装包。默认 `DSH_MODEL_DELIVERY=full`：在 `gcs-infer-center/web` 执行 `pnpm run build:micro`，在 `gcs-loop/frontend/apps/cozeloop` 执行 `pnpm exec rushx build`，然后在 model 执行 `npm run build:delivery:full`。`DSH_MODEL_DELIVERY=lite` 只构建 model 的 `build:delivery:lite`，不带 flow 和 prompt。产物已经打好时，设 `DSH_DESKTOP_SKIP_MODEL_BUILD=1`，脚本只拷贝现成的 dist。

拷贝结果在安装包的 `resources/model-site/`：主应用是 `app/`，flow 是 `flow/`，prompt 是 `prompt/`。app 启动后在 `127.0.0.1:17321` 提供这些页面，并按 `resources/model-gateway.json` 把接口直连到局域网后台。Harness 会话页仍打开本机 `:3002`，再转到配置里的 `harness.target`。这份配置随安装包带一份默认值。升级时若安装目录里已经有它，安装程序保留原文件。改 IP 后重启 app 即可。

部署网络是局域网，后台也都在局域网里。使用 app 的电脑要能直接访问这些 IP 和端口。还有人用浏览器打开网页时，67 上的 nginx 继续留给网页；只交付桌面端时，这台 nginx 可以不再当入口。

登录到整站仍是同一个 `WebContentsView`，分区仍是 `persist:zhishu-model`。页面继续请求相对路径。找不到的前端路径回到 `index.html`。不要用 `file://` 打开构建结果。

本地开发仍走 model 的 8888，不启动这份网关。

页面发给 `127.0.0.1:17321` 的请求，由主进程里的网关改头后再连各条 `target`。配置字段是 `publicOrigin`，默认文件里写的是 `https://172.18.127.67`。安装目录里的 `model-gateway.json` 没写这个字段，或写成空字符串时，代码用同一地址（`model-gateway.ts` 的 `DEFAULT_PUBLIC_ORIGIN`）。改这个字段后重启 app 生效。

所有走网关的请求都用它，包括 `/DistributedAISystem/`、其余后台，以及 `127.0.0.1:3002` 转到 `harness.target` 的请求。浏览器原来带了 `Origin`，就换成 `publicOrigin`。`Referer` 换成这个来源，路径和查询保留。`/flow`、`/prompt` 和主应用的静态文件从磁盘读，不改这些头。

`Host` 默认用 `publicOrigin` 的主机名。某一条路由自己写了 `host` 时用那个值：`/api`、`/console/api`、`/files` 用 `172.18.127.66`，`/api/v1/` 用 `172.18.29.80`。这几条的 `Origin` 和 `Referer` 仍然是 `publicOrigin`。连接仍打到该条的 `target`，不会打到 `publicOrigin` 这个地址本身。

后台返回的 `Location` 若指向该后台自己的源站，会改回本机正在听的地址（`127.0.0.1:17321` 或 `:3002`）。`Set-Cookie` 里的 `Domain` 会去掉，cookie 留在 `127.0.0.1`。

### 和继续打开 67 相比

后续希望会话里的智能体用自然语言完成平台业务，例如打开成绩页，并总结全班成绩分布。成绩在后台，总结应调接口，不必让智能体认识页面布局。Computer use 是只给屏幕截图、再模拟点击的做法，用在没有接口的软件上。平台页面本身就在调后台，这条路不适合当成绩统计的实现。

加载 67 远程页面也不会逼得只能做 computer use。壳进程可以带着 `persist:zhishu-model` 的 cookie 调 67 上的接口。更麻烦的是源站和登录态都绑在 67：会话页和业务页仍是两个分区，智能体现在既点不到业务页，也带不上 `JSESSIONID`。这个隔断在下面两种本机方案里都还在，落地后要单独做工具，让智能体使用这份登录态，并按转发配置调接口。打开成绩页给用户看，是壳切到业务并打开对应路由。

| | 现在：打开 67 | 本机页面，接口仍走 67 | 本机页面，直连各后台（采用） |
|---|---|---|---|
| 页面从哪来 | 67 的 nginx | 安装包 | 安装包 |
| 接口怎么走 | 浏览器直接到 67，再由 nginx 转发 | 先到本机，再转到 67 的 nginx | 先到本机，再按配置直连各后台 |
| 还要部署 nginx 吗 | 要，页面和接口都靠它 | 要，只当接口网关 | 桌面端不再靠它。浏览器用户还在用网页时才留 |
| 改后台 IP | 改 nginx，不用重装 app | 改 nginx，不用重装 app | 改安装目录里的配置，重启 app |
| 智能体调接口 | 可以，但要针对 67 这个源站带 cookie | 可以，请求本机相对路径，路径清单仍在服务器 | 可以，和页面共用本机源站和同一份转发配置 |
| 打开页面的速度 | 页面文件走局域网到 67 | 页面文件在本机；接口仍多一跳 nginx | 页面文件在本机；接口少一跳 nginx |

打开某个业务页，快的是页面自身的脚本和样式：从本机磁盘读，不跟 67 要文件。站点已经打开之后，再进成绩这类菜单，时间主要花在接口。直连少一次 nginx 转发，局域网里通常差得不大。列表数据不会因为页面打进安装包就明显变快。

## 环境变量

下面这些变量在 PowerShell 里用 `$env:名字 = '值'` 设置。它只活在当前这个终端里，关掉窗口就没了。新开一个终端要重新设置。打包或 `pnpm run dev:desktop` 必须在设过变量的那个终端里执行。装好的程序不读这些变量。后台 IP 和 `publicOrigin` 改 `resources/model-gateway.json`，不靠环境变量。

`apps/desktop/.env.windows` 只放应用 ID、更新源这类发布项，从 `.env.windows.example` 复制，Git 忽略。已经复制出来的文件里若还有 `DSH_MODEL_ORIGIN`，留着也不改变安装包里的页面地址。页面地址固定是 `http://127.0.0.1:17321`。

| 变量 | 在哪设 | 作用 |
|---|---|---|
| `DSH_MODEL_ORIGIN` | 启动 `pnpm run dev:desktop` 的终端 | 未打包时改平台页地址。不设则用 `http://127.0.0.1:8888` |
| `DSH_DESKTOP_OPEN_DEVTOOLS` | 同上。不设时开发脚本当作 `1` | 设为 `0` 时，本地开发不自动打开会话页和业务页的开发工具。安装包不看这个变量 |
| `DSH_MODEL_DELIVERY` | 执行打包命令的终端 | `full`（默认）构建 model、flow、prompt。`lite` 只构建 model 的 `build:delivery:lite` |
| `DSH_DESKTOP_SKIP_MODEL_BUILD` | 同上 | 设为 `1` 时不重新构建，只拷贝已经打好的 dist |
| `DSH_MODEL_ROOT` | 同上 | model 仓库路径。不设则用与 `zhishu-harness` 同级的 `model` |
| `ELECTRON_MIRROR` | 同上 | Electron 本体的下载镜像。用法见后面的「重复下载」 |
| `ELECTRON_BUILDER_BINARIES_MIRROR` | 同上 | electron-builder 所用二进制的下载镜像。内置 Python 仍从 GitHub 下载 |

## 合并官方代码之后

把 `main` 合进当前分支后，本地可能还留着已经搬走或删掉的包。`pnpm run dev:desktop` 和 `git push` 都会先编译工作区。构建按 `packages/*/*` 扫描，目录里只要还有 `lib`，即使没有 `package.json` 也会被当成包打包。旧产物还在引用已经不存在的导出时，编译失败。推送前的 typecheck 走同一套编译，所以 `git push` 会一起失败。

这次合入后，`packages/session/session-title-all-prompts-llm` 只剩旧的 `lib`，仍在导入 `registerSessionTitleLlmProvider`。当前的 `session-title-llm` 已经不再导出它，于是出现 `MISSING_EXPORT`。

`pnpm run dev:desktop` 会按当前源码重编还在仓库里的包，但不会删掉这些旧目录。包被移动或删除时，先在仓库根目录执行：

```powershell
pnpm run clean
```

它清掉各包的 `lib`，并删掉没有 `package.json`、只剩 `lib`、`node_modules` 这类产物的旧目录。包没有被移动或删除的小改动，直接 `pnpm run dev:desktop` 即可。

`clean` 不改仓库根上的 `node_modules`。桌面开发启动时会遍历 `node_modules\.pnpm\node_modules` 里的链接。旧目录删掉之后，链接还指着原来的路径，就会报 `ENOENT`。这次是 `dsh-experimental-schedule-bundle` 等链接指向已经不存在的目录。锁文件已经是最新时，单独再执行 `pnpm install` 会显示 Already up to date，这些链接不会重写。

出现这种断链时，在仓库根目录按顺序做：

1. 先退出正在运行的桌面应用。
2. 若还要跑桌面，按下一节先备份 `downloads`。`clean` 会删掉它。
3. `pnpm run clean`
4. 删除根目录的 `node_modules`。不要删本机的 pnpm 缓存。
5. `pnpm install`
6. 按下一节把备份放回去。
7. `pnpm run dev:desktop`

依赖还在本机缓存里，一般不用重新从网络下载。只有合并后包被移动或删除时才需要删掉 `node_modules`。平时只改壳源码、没有切分支，直接 `pnpm run dev:desktop`。

## 切分支或合并之后完全重建

`lib/` 不进 git。切分支、合并 `main` 之后，磁盘上会留下上一份源码打出来的 `lib/index.js`、`lib/client.js`，以及根目录 `node_modules` 里指向已经搬走的包的链接。只执行 `pnpm run build:lib:host` 或只执行 `pnpm run build:lib:client`，另一边仍是旧产物。网页就会出现一片 `waiting for services`，或 `client bundle not found`。`pnpm dsh:private` 不会自己重编这些文件。

在仓库根目录按顺序做。先停掉正在跑的 `pnpm dsh:private`、`pnpm market:registry` 和桌面窗口，并关掉已经打开的网页标签。旧标签连的是上一轮没编完的页面。

`clean` 会删掉整个 `apps/desktop/.desktop-build`。还要跑桌面时，先把其中的 `downloads` 拷到仓库外面。那个目录里是已经下好的 Node 和 Python。目录不存在就跳过，后面 `pnpm run dev:desktop` 会重新向 GitHub 要约 21MB 的 Python，直连常常在 5 分钟内下不完。

```powershell
$backup = 'C:\Users\Admin\Documents\code\zhishu-desktop-downloads'
if (Test-Path .\apps\desktop\.desktop-build\downloads) {
  if (Test-Path $backup) { Remove-Item -Recurse -Force $backup }
  Copy-Item -Recurse -Force .\apps\desktop\.desktop-build\downloads $backup
}
```

然后再清编译产物并重编：

```powershell
pnpm run clean
Remove-Item -Recurse -Force node_modules
pnpm install
pnpm run build:artifacts
```

编完后把备份放回去。`clean` 已经删掉 `.desktop-build`，要先建这个目录。没有备份就跳过。

```powershell
$backup = 'C:\Users\Admin\Documents\code\zhishu-desktop-downloads'
if (Test-Path $backup) {
  New-Item -ItemType Directory -Force .\apps\desktop\.desktop-build | Out-Null
  Copy-Item -Recurse -Force $backup .\apps\desktop\.desktop-build\downloads
}
```

`clean` 删掉各包的 `lib`、增量编译记录，以及没有 `package.json`、只剩产物的旧目录。

`build:artifacts` 按当前分支同时重编 Host 和网页客户端，包括 `lib/index.js` 与 `lib/client.js`。完成后再执行 `pnpm dsh:private` 或 `pnpm run dev:desktop`。不要把编译命令和启动命令写在同一行里一起跑，启动会抢在编译结束之前打开页面。

## 看安装包里的网络请求

安装包启动时不会自己打开开发工具。`pnpm run dev:desktop` 和 `pnpm run start:desktop` 会给会话页和业务页各开一个独立窗口。登录和平台接口在业务页那个窗口里，会话页的网络面板看不到这些请求。

要看刚打出来的程序，先完全退出已经安装的「DeepSeek Harness」，包括托盘。这个应用有单实例锁，安装版还在跑时，下面的命令只会把安装版窗口唤到前面，调试端口不会生效。

在一个终端里启动解压目录。这条命令占住该终端，直到窗口关掉，不是后台任务。图形界面程序用 Ctrl+C 不一定能停掉，关掉窗口即可。

```powershell
& "C:\Users\Admin\Documents\code\zhishu-harness\apps\desktop\.desktop-build\targets\win-x64\unsigned-artifacts\win-unpacked\Zhishu.exe" --remote-debugging-port=9222
```

然后用 Chrome 打开 `chrome://inspect`，勾选 Discover network targets，在 Configure 里加上 `localhost:9222`，再对目标点 inspect。

壳里是两块页面，列表行数可以比两块多：

- 会话是 `dsh-app://app/`。标题相同、地址也相同的两条是同一个会话页，点其中一条即可。
- 业务是 `http://127.0.0.1:17321` 上的那个 view，同一时间只有一个当前地址。列表里若同时有 `/login` 和 `/harnessAgent`，是这个 view 先后打开过的地址还留在列表里，对着眼前那一屏的路径点 inspect。
- `/harnessAgent` 里嵌上 `http://127.0.0.1:3002/` 之后，列表会再多出那一条。

业务页 Network 里的 `Host`、`Origin`、`Referer` 是页面发给 `127.0.0.1:17321` 的值，例如 `Origin: http://127.0.0.1:17321`。网关改成 `publicOrigin` 发生在主进程转发之后，这个面板里看不到。返回状态是后台经网关送回来的，这个能看到。

## 对话界面的 overlay

`apps/cli/src/profile-boot.ts` 加载 `overlay/*/cordis.patch.yml`。本地开发沿用 CLI 产物旁的仓库目录。打包时 `electron-builder` 把仓库 `overlay/` 放到安装包的 `resources/overlay`（在 asar 外面，图片才能被读到）。桌面壳启动 Host 前把这个目录写入 `DSH_ZHISHU_OVERLAY`。安装后的对话界面包含 `brand`。`hide-official-account` 跟着所有 Web profile 生效，容器里的 profile `web` 也会关掉官方账号菜单。`hide-product-onboarding` 同样跟着所有 Web profile：预览版说明被同名槽位跳过，API Key 弹窗由 `credentialOnboarding: false` 关掉，官方 DeepSeek 的密钥路由和账号路由也不加载。自定义模型提供商仍可添加。`platform-account` 只跟着 profile `desktop`。改完 overlay 后需要重新打包才会进安装包；容器镜像要重新构建才会带上这次 profile 判断。

## 插件市场私有源

安装包带上 `market-registry/` 里的目录和其中的皮肤包。打包前 `prepare:market-registry` 把 Verdaccio 装进 `resources/market-registry`（真实文件，没有指向仓库的链接）。装好的程序启动 Host 之前，在本机 `127.0.0.1:4873` 启动这份源，并在 `127.0.0.1:4874` 提供 `plugins.json`。Host 进程被设成使用这两个地址，同时关掉 pnpm 的 peer 自动安装，避免它到私有源里找 `react` 和 `cordis`。

已发布的包写在应用用户目录，不写进安装目录。安装包更新后，新的 tarball 会在下次启动时补进这个目录。`127.0.0.1` 上如果已经有同一份源在听，安装包会沿用它，不会再起一个。

`pnpm run dev:desktop` 不启动 Verdaccio。开发时先在另一个终端执行 `pnpm market:registry`。不要在跑 `pnpm` 的终端里设置 `npm_config_auto_install_peers=false`，那两个变量只属于 Host 进程。改了 `plugins.json` 或 `tarballs/` 之后要重新打包才会进安装包。

## Windows 图标

资源管理器里的程序图标使用 dsh-desktop 的 `build/icon.ico`，副本在：

- `apps/desktop/resources/icon-windows.ico`：安装包和安装后的 exe
- `apps/desktop/resources/app-icon.png`：Windows 安装包内的 `icon.png`

`apps/desktop/scripts/electron-builder-config.mjs` 的 `win.icon` 指向 ico，安装后的 exe 和安装包向导用这份。同一份 ico 也作为 `extraResources` 打成 `resources/tray.ico`，托盘读的是它，不是 `resources/tray-windows.ico`。`apps/desktop/electron-builder.config.d.mts` 里的 `win` 类型必须声明 `icon`，否则 `tsc` 在打包编译阶段失败。

安装包显示名是同一文件里的 `productName`，现为 `Zhishu`。它决定安装后的 `Zhishu.exe`、开始菜单和安装目录名。安装包文件名是 `artifactName`，现为 `zhishu-<版本>-win-x64-unsigned.exe`。窗口标题、托盘提示、关于和菜单文案是 `Zhishu Harness`，Harness 仍保留。壳内文案在 `apps/desktop/src/locale.ts`，会话页标题来自构建时的 `DSH_CLIENT_TITLE`。

## 打未签名安装包

在仓库根目录执行：

```powershell
pnpm run package:desktop:win:x64:unsigned
```

先准备 `apps/desktop/.env.windows`（Git 忽略）。从 `.env.windows.example` 复制。未签名打包仍要能通过配置检查，至少包括应用 ID，以及当前更新环境对应的强制更新源。`DSH_MODEL_ORIGIN` 可以不写。

这台打包机还需要：

- Visual Studio 的「使用 C++ 的桌面开发」（MSVC 和 Windows SDK）。安装脚本要编译 `window-frame.dll`，找不到 `vswhere.exe` 会在生成安装包之前退出。下载页：https://visualstudio.microsoft.com/visual-cpp-build-tools/
- Python，供编译原生模块。不在 `PATH` 里时，把 `PYTHON` 指到 `python.exe`。

成功后的文件在 `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/`：

| 文件 | 作用 |
|---|---|
| `zhishu-<版本>-win-x64-unsigned.exe` | NSIS 安装包。双击进入安装向导，装到当前用户 |
| `win-unpacked/Zhishu.exe` | 已解压的程序，双击直接启动，不经过安装 |

文件名里的 `-unsigned` 表示不能当作正式发布包上传。Windows 会提示未签名。

装出来的对话界面已经换成 overlay，只说明 `resources/overlay` 打进去了。标题栏的「会话 / 业务」在壳的预加载脚本里（`apps/desktop/src/preload-menu.ts`），一开始是隐藏的，要等 model 登录状态送到这个页面。Harness 页经常比登录门更早打开，进入会话时那次通知会落在即将换掉的文档上，按钮就一直不出现。`model-gate.ts` 会在页面加载完、以及进入会话后再补发状态；标题栏在按钮还藏着时会自己再问。这两处都在壳源码里，改完要重新打包才会进安装包。

## 准备运行时在 pnpm 结束后失败

日志停在 `prepare-dsh.ts`，看起来像安装包快打完了。这一步还在准备内置 dsh 运行时，electron-builder 还没开始，所以不会有新的 exe。

pnpm 自己会先打出 `Done in … using pnpm v11.7.0`。接着出现 `PostQueuedCompletionStatus: (6)`，后面的乱码是 Windows 错误 6「句柄无效」。退出码是 `2147483651`（`0x80000003`）。`prepare-dsh.ts` 只认退出码 0，于是清掉当次准备的运行时并中止。

原因是打包用 `electron.exe` 的 Node 模式跑 pnpm，并且继承了 Cursor 终端的控制台。pnpm 已经结束，进程退出时 libuv 在这个控制台上崩溃。以前有的构建能过，是因为这次崩溃不稳定；连续失败时，原样再执行同一条命令也不会好。

处理写在 `apps/desktop/scripts/prepare-dsh.ts`：不再把控制台直接交给这个进程，输出改由管道转发。失败记录在 `apps/desktop/.desktop-build/packaging-runs/<一次构建>/events.jsonl`，对应阶段是 `runtime:lockfile`。前面的编译、依赖打包和 Electron 缓存还在，修好后重新执行打包命令会从准备运行时继续。

## 三种 Harness 的差别

智枢桌面端、`dsh-desktop`、model 里嵌的网页 Harness，对话可以来自同一套产品，执行环境不同。智枢桌面端用的是官方壳，运行时打在安装包里。

### dsh-desktop

`dsh-desktop` 的 `package:dev:win` 只编译智树壳，再交给 electron-builder。它自带 Node 和 pnpm，不编译 `window-frame.dll`，所以没有 Visual C++ 也能打出安装包。它的 `*-setup.exe` 同样是安装包；直接启动的是解压目录里的程序。

官方这条路径还会打进独立的 Python 运行时（numpy、pandas、Office 文档库、LibreOffice），放在 `resources/runtime/primary-runtime`。对话里创建和检查 Word、PPT、Excel，以及用这套库做数据处理，依赖这份运行时。`dsh-desktop` 没有它，本机另装 Python 也不会自动接上这些技能。两边的安装包不能互相代替。

### model 里的网页 Harness

`/harnessAgent` 是浏览器里的一层页面。iframe 打开当前主机的 `:3002`。开发时由本机转发，生产由 nginx 整站转到网关 `172.18.29.80:18089`。真正跑智能体的是容器里的 `dsh --profile web`（`docker/container-entrypoint.sh`）。

当前镜像 `docker/Dockerfile` 的运行层有 bash、git、ripgrep 和 Debian 的 `python3`。没有放入 `primary-runtime`，也没有设置 `DSH_PRIMARY_RUNTIME`。所以没有 numpy、pandas，也没有 LibreOffice 和 Office skills。容器可以另加：把 `primary-runtime/` 和 `office-skills/` 放进镜像，并设置 `DSH_PRIMARY_RUNTIME`。现在的网页镜像没有做这一步。

| | 官方桌面端（智枢采用） | dsh-desktop | model 里的网页 Harness |
|---|---|---|---|
| 页面在哪 | 本机窗口里的 `dsh-app://app/` | 智树壳自己的窗口 | 浏览器 iframe，经 `:3002` 进容器 |
| 文件在哪 | 用户这台电脑 | 用户这台电脑 | 容器里的 `/storage-root-jfs/user` |
| Python | 安装包内的创作环境 | 没有。本机另装 Python 接不上技能 | 系统 `python3`，没有 numpy、pandas |
| Office | 有 LibreOffice 和 Office 文档库 | 没有 | 没有 |

容器补上 Linux 版的 `primary-runtime/`、`office-skills/` 并设置 `DSH_PRIMARY_RUNTIME` 之后，用 Python 做数据处理，以及创建和检查 Word、PPT、Excel，可以和桌面端对齐。这和安装包用的是同一套构建结果，目标系统不同：桌面是 Windows，容器是 Linux。

补上之后，两边的能力范围仍然不同。网页方案跑在服务器上，不会变成装在用户电脑里的桌面端。

| | 官方桌面端 | 加上运行时之后的网页容器 |
|---|---|---|
| 文件在哪 | 用户这台电脑上的目录 | 容器里的 `/storage-root-jfs/user` |
| 网络从哪出去 | 用户这台电脑 | 容器所在服务器 |
| 窗口和本机程序 | 能开本机目录、调用本机上的程序 | 只有浏览器里的页面，碰不到用户电脑上的文件和已安装软件 |
| 和 model 的关系 | 同一个窗口里盖着平台页，登录态在 `persist:zhishu-model` | 平台页面里的一层 iframe，会话在容器里 |

## 本机数据放在哪

本地 `pnpm dsh web`、`pnpm dsh:private`、解压目录里的 `Zhishu.exe`，以及 `pnpm dev:desktop`，会话并不各写一份。前三种在没设置 `DSH_HOME` 时共用用户主目录下的 `.dsh`。开发桌面单独用仓库里的一套目录，看不到正式数据。

`dsh:private` 只是给 `dsh web` 加上本机插件源地址，数据目录不变。

| 启动方式 | 数据根 `DSH_HOME` | profile | 会话和工作区列表 |
|---|---|---|---|
| `pnpm dsh web`、`pnpm dsh:private` | `%USERPROFILE%\.dsh` | `profiles\web` | 这份 home 里的 `sessions`、`storages` |
| 解压版或安装后的 `Zhishu.exe` | 同样是 `%USERPROFILE%\.dsh` | `profiles\desktop` | 同一套 `sessions` 和 `storages` |
| `pnpm dev:desktop` | `apps/desktop/.desktop-build/development/home`（启动前已设置 `DSH_HOME` 时用那个值） | 这个开发 home 里的 `profiles\desktop` | 这个开发 home 里的 `sessions` |

因此网页版和正式桌面能看到同一批会话。开发桌面看不到它们。插件和模型配置按 profile 分开：网页在 `profiles\web\cordis.patch.yml`，桌面在 `profiles\desktop\cordis.patch.yml`。

### 会话和工作区

会话日志在 `$DSH_HOME\sessions`。先按当时的工作目录分一层，目录名把盘符和斜杠换成 `-`，两端再加 `--`。例如工作区 `C:\Users\Admin\Documents\code` 对应 `--C-Users-Admin-Documents-code--`。每个会话再占下面一个子目录，里面是 JSONL 日志。没有工作目录的会话进 `_no-cwd`。

左侧工作区列表不是这些文件夹。列表、顺序、归档和置顶写在 `$DSH_HOME\storages\workspace.json`。会话列表上的标题和摘要缓存在 `storages\session_projcache`。从界面去掉一个工作区只删这条登记，不删磁盘上的项目文件夹，也不删 `sessions` 里的日志。

### `.dsh` 里各目录

未设置 `DSH_HOME` 时，Windows 上就是 `%USERPROFILE%\.dsh`。

```text
.dsh\
  sessions\                 全部会话 JSONL。网页和正式桌面共用
  storages\                 结构化状态
    workspace.json          工作区列表
    session_projcache\      会话列表缓存
    cost-meter\             费用统计
    mcp_connector.json      MCP 连接授权
  profiles\
    web\                    网页版：已装插件、cordis.patch.yml、pnpm-lock.yaml
    desktop\                桌面版：同上。模型提供方和默认模型也在这份 cordis.patch.yml
    node_modules\           安装插件时的依赖
  attachments\v1\           消息里的图片和文件。有附件之后才会出现
  cache\                    附件等缓存
  dsh-runtimes\             首次用到时展开的内置 Python、Node、pnpm
  dsh-market\               插件市场自己的状态，例如快照和屏蔽列表
  logs\                     启动日志
  .credentials.yaml         模型页写入的密钥
  .anonymous-user-id        这一份 home 的匿名标识
```

每个 profile 目录里常见的是 `package.json`（装了哪些插件）、`cordis.patch.yml`（模型、主题、开关）、`pnpm-lock.yaml` 和 `node_modules`。清安装残留时删锁文件和 `node_modules`，留下 `cordis.patch.yml`，模型配置还在。

另外两处不在 `.dsh` 里：

- `~\.agents`：用户全局 `AGENTS.md` 和 `skills`。网页和桌面只要用同一个 home，都会读它。
- 桌面壳自己的数据在 `%APPDATA%\@deepseek-ai\dsh-desktop`，跟程序显示名「智枢」不是同一个文件夹。这里有 Chromium 缓存、快捷键、`desktop\settings.json`，以及打包后本地插件源的可写数据 `market-registry`。模型网关地址在安装目录的 `resources\model-gateway.json`。`pnpm dev:desktop` 的壳数据在 `apps/desktop/.desktop-build/development/electron-user-data`，不写上面的 Roaming 目录。

容器里的网页 Harness 不使用用户电脑上的 `.dsh`。它的文件在容器内，见上一节。

## 重复下载

第一次打包会把 Electron、内置 Node 和 Python 下载到 `apps/desktop/.desktop-build/downloads`。之后同一份文件校验通过就用缓存，只在本地重新解压。electron-builder 使用准备好的本地 Electron 目录，不会再下载一次。`pnpm run clean` 会删掉这个目录，备份和放回的命令在「切分支或合并之后完全重建」。

开发依赖里已有的 `apps/desktop/node_modules/electron/dist` 不会被这次准备步骤复用。第一次从 GitHub 拉 Electron 时终端会停在 `prepare-runtime.ts`，中间没有进度。要换国内镜像，先停掉当前打包，再执行：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
$env:DSH_DESKTOP_SKIP_MODEL_BUILD = '1'
pnpm run package:desktop:win:x64:unsigned
```

内置 Python 仍从 GitHub 下载，不受这两个变量影响。

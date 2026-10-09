# 桌面端二次开发与打包说明

本文记录智枢桌面端怎样建在官方 DeepSeek Harness 上，以及 Windows 未签名安装包怎么打。对话界面的插件增量仍放在 `overlay/`，规则见 [plugin-secondary-development.md](./plugin-secondary-development.md)。

这里打出来的是官方 DeepSeek Harness 桌面端，不是 `dsh-desktop` 那个智树壳。两边的安装包不能互相代替。

## 整体实现方案

智枢桌面端是官方壳上的二次开发，不是另写一个应用。会话和业务仍是两个空间：会话继续用官方对话和官方运行时；业务不再在 Harness 里重做平台页面，而是在同一个窗口里直接铺上 model 站点，平台页面只在 model 仓库维护一份。登录也不再用官方 DeepSeek 账号，改走平台自己的登录页。

### 为什么留在官方壳上

会话要的是官方智能体能力：对话、文件、Office，以及安装包里的 Python 运行时。这些封在官方桌面 Host 和 `dsh-app://app` 的对话页里。`dsh-desktop` 没有这份运行时，所以智枢不从那边长出来。官方壳负责窗口、更新、运行时和对话页。账号、补录和业务功能仍由 model 仓库维护，桌面端只加载那个站点。

### 一个窗口里的两层

主窗口自己的网页是 Harness 对话，地址是 `dsh-app://app/`。model 站点是盖在上面的另一个 `WebContentsView`，分区 `persist:zhishu-model`，和对话页的 cookie、存储互不相通。从登录到进入站点始终是这同一个 view。平台把登录标记写在 `sessionStorage` 里，换一个 view 就会丢。

未登录时平台页盖住对话。登录完成并离开登录流程后，平台页藏起来，底下的对话页成为会话空间。再切到业务时，把已经打开的整站显示出来。模型训练只是平台里的一个功能，不是业务空间的落地页。平台自己的顶栏、侧栏、标签保持显示，桌面端不改这些。

### 登录怎么接上平台

启动不再打开官方欢迎页。`openInitialWindow` 创建主窗口后直接交给 `ModelPlatformGate.open()`。官方账号菜单由 `overlay/hide-official-account` 关掉。不改欢迎页源码，也不停账号控制器。

冷启动先读这个分区里的 cookie，再 `POST /DistributedAISystem/UserLoginDisplayInfo`。会话还在就打开 `/desktop-entry`，由平台自己决定去补录还是进入和网页登录成功后相同的去向。cookie 无效，或还没有 cookie，就打开 `/login`。用户在登录页输入账号时不经过 `/desktop-entry`。

这些路径仍算登录流程，不打开对话：`/login`、`/register`、`/desktop-entry`、`/complete-identity`。平台网页登录成功后的去向是 `/smartChat`。桌面端看到地址已经离开上述路径、并且仍是平台源站，就视为已登录：藏起平台页，调用 `enterWorkspace()`，主窗口导航到 `dsh-app://app/`。验证码和 RSA 仍由平台登录页自己完成，桌面端不重做。

退出确认被取消，或官方侧还没进入会话就需要把窗口露出来时，用 `presentLogin()` 再盖上 `/login`。

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

官方测试设置了 `VITEST` 时不加载 overlay。没有 Web 界面的 profile 也不加载。桌面端带 Web 运行时，会加载。

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

本地开发加载 `http://127.0.0.1:8888`。安装包加载构建时写进去的地址，默认 `https://172.18.127.67`（443，不带端口）。安装后的程序不读本机环境变量。

| 场景 | 地址从哪来 |
|---|---|
| `pnpm run dev:desktop` | 默认本地 8888。启动前在 shell 设置 `DSH_MODEL_ORIGIN` 可临时改掉，只影响这一次 |
| 打包 | 读 `apps/desktop/.env.windows` 或 `.env.macos` 里的 `DSH_MODEL_ORIGIN`。不写则用 `https://172.18.127.67`，写入安装包的 `dshModelOrigin` |

实现：`apps/desktop/scripts/model-origin.mjs` 负责打包时写入；`model-gate.ts` 的 `modelPlatformOrigin` 负责运行时读取。打包会丢掉 shell 里的同名变量，只认 dotenv 文件。

## 对话界面的 overlay

`apps/cli/src/profile-boot.ts` 加载 `overlay/*/cordis.patch.yml`。本地开发沿用 CLI 产物旁的仓库目录。打包时 `electron-builder` 把仓库 `overlay/` 放到安装包的 `resources/overlay`（在 asar 外面，图片才能被读到）。桌面壳启动 Host 前把这个目录写入 `DSH_ZHISHU_OVERLAY`。因此安装后的对话界面包含 `brand` 和 `hide-official-account`。改完 overlay 后需要重新打包才会进安装包。

## Windows 图标

资源管理器里的程序图标使用 dsh-desktop 的 `build/icon.ico`，副本在：

- `apps/desktop/resources/icon-windows.ico`：安装包和安装后的 exe
- `apps/desktop/resources/app-icon.png`：Windows 安装包内的 `icon.png`

`apps/desktop/scripts/electron-builder-config.mjs` 的 `win.icon` 指向 ico。`apps/desktop/electron-builder.config.d.mts` 里的 `win` 类型必须声明 `icon`，否则 `tsc` 在打包编译阶段失败。托盘图标仍是原来的鲸鱼图。

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
| `deepseek-harness-<版本>-win-x64-unsigned.exe` | NSIS 安装包。双击进入安装向导，装到当前用户 |
| `win-unpacked/DeepSeek Harness.exe` | 已解压的程序，双击直接启动，不经过安装 |

文件名里的 `-unsigned` 表示不能当作正式发布包上传。Windows 会提示未签名。

装出来的对话界面已经换成 overlay，只说明 `resources/overlay` 打进去了。标题栏的「会话 / 业务」在壳的预加载脚本里（`apps/desktop/src/preload-menu.ts`），一开始是隐藏的，要等 model 登录状态送到这个页面。Harness 页经常比登录门更早打开，进入会话时那次通知会落在即将换掉的文档上，按钮就一直不出现。`model-gate.ts` 会在页面加载完、以及进入会话后再补发状态；标题栏在按钮还藏着时会自己再问。这两处都在壳源码里，改完要重新打包才会进安装包。

## 准备运行时在 pnpm 结束后失败

日志停在 `prepare-dsh.ts`，看起来像安装包快打完了。这一步还在准备内置 dsh 运行时，electron-builder 还没开始，所以不会有新的 exe。

pnpm 自己会先打出 `Done in … using pnpm v11.7.0`。接着出现 `PostQueuedCompletionStatus: (6)`，后面的乱码是 Windows 错误 6「句柄无效」。退出码是 `2147483651`（`0x80000003`）。`prepare-dsh.ts` 只认退出码 0，于是清掉当次准备的运行时并中止。

原因是打包用 `electron.exe` 的 Node 模式跑 pnpm，并且继承了 Cursor 终端的控制台。pnpm 已经结束，进程退出时 libuv 在这个控制台上崩溃。以前有的构建能过，是因为这次崩溃不稳定；连续失败时，原样再执行同一条命令也不会好。

处理写在 `apps/desktop/scripts/prepare-dsh.ts`：不再把控制台直接交给这个进程，输出改由管道转发。失败记录在 `apps/desktop/.desktop-build/packaging-runs/<一次构建>/events.jsonl`，对应阶段是 `runtime:lockfile`。前面的编译、依赖打包和 Electron 缓存还在，修好后重新执行打包命令会从准备运行时继续。

## 和 dsh-desktop 打包的差别

`dsh-desktop` 的 `package:dev:win` 只编译智树壳，再交给 electron-builder。它自带 Node 和 pnpm，不编译 `window-frame.dll`，所以没有 Visual C++ 也能打出安装包。它的 `*-setup.exe` 同样是安装包；直接启动的是解压目录里的程序。

官方这条路径还会打进独立的 Python 运行时（numpy、pandas、Office 文档库、LibreOffice）。对话里创建和检查 Word、PPT、Excel，以及用这套库做数据处理，依赖这份运行时。dsh-desktop 没有它，本机另装 Python 也不会自动接上这些技能。

## 重复下载

第一次打包会把 Electron、内置 Node 和 Python 下载到 `apps/desktop/.desktop-build/downloads`。之后同一份文件校验通过就用缓存，只在本地重新解压。electron-builder 使用准备好的本地 Electron 目录，不会再下载一次。

开发依赖里已有的 `apps/desktop/node_modules/electron/dist` 不会被这次准备步骤复用。第一次从 GitHub 拉 Electron 时终端会停在 `prepare-runtime.ts`，中间没有进度。要换国内镜像，先停掉当前打包，再执行：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
pnpm run package:desktop:win:x64:unsigned
```

内置 Python 仍从 GitHub 下载，不受这两个变量影响。

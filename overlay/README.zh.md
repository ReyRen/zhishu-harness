# overlay

[English](README.md) | 中文

本目录存放二次开发增量。每个子目录是独立插件。启动 Web profile（包括桌面的 Web 运行时）时，`apps/cli` 会在官方组合包之后加载其中的 `cordis.patch.yml`。无 Web 的 headless 和 SDK profile 不加载这些插件。`hide-official-account` 对所有 Web profile 生效，关掉官方账号菜单，左下角回到设置齿轮。`platform-account` 只在 profile `desktop` 上加载。除非官方界面没有对应 slot，否则不要改 `packages/` 中的源码。

```text
overlay/
├── brand/                 Sidebar brand and new-conversation mark
│   ├── cordis.patch.yml   Disable the official brand row and insert this plugin
│   ├── package.json       Declare dsh.client
│   ├── index.js           Host: serve images
│   ├── client.js          Browser: occupy the sidebar and hero brand slots
│   └── assets/            logo.png, logo-mark.png, zhishu-hero.webp, zhishu-hero-loop.webp, zhishu.gif
├── hide-official-account/ Every Web profile: disable the official DeepSeek account menu so the settings gear returns
│   └── cordis.patch.yml   Disable ui-settings-account only
├── hide-product-onboarding/ Every Web profile: skip the preview notice and the API-key dialog
│   ├── cordis.patch.yml   credentialOnboarding: false, and insert this plugin
│   ├── package.json       Declare dsh.client
│   ├── index.js           Host row so the client bundle loads
│   └── client.js          Browser: occupy welcome-notice and complete it immediately
├── platform-account/      Desktop only: platform user on the conversation sidebar. Settings and sign-out live in that menu
├── running-status/        Running mark, “Thinking”, conversation scrollbar
│   ├── cordis.patch.yml   Insert this plugin
│   ├── package.json       Declare dsh.client
│   ├── index.js           Host row so the client bundle loads
│   └── client.js          Browser: replace the running status and hide the extra bar
└── dsh-market/            Preinstalled plugin market (insert only)
    └── cordis.patch.yml   Insert `dshmarket` with restart disabled
```

`dsh-market` 里没有市场实现。实现在 `third-party/dshmarket`（社区 dshmarket 1.66.22，编译结果在 `host/`），并由 `apps/cli` 依赖带进安装目录，所以本地 `pnpm dsh web` 直接用这份源码。它不写入用户 profile，左侧「已安装」里看不到。如果用户之后又在插件页安装了同名包，启动时会跳过这条插入，避免 Cordis id `dsh-market` 注册两次。

新增能力时可沿用此目录结构，不要把补丁写进官方的 `cordis.patch.yml`。官方界面如何区分插件，以及无外网部署时应把插件放在哪里，见 [plugin-secondary-development.md](./plugin-secondary-development.md)。桌面壳登录、工作空间、Windows 打包，以及网页和桌面的会话落在哪，见 [desktop-secondary-development.md](./desktop-secondary-development.md)。

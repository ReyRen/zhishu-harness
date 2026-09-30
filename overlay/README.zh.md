# overlay

[English](README.md) | 中文

本目录存放二次开发增量。每个子目录是独立插件。启动 Web profile（包括桌面的 Web 运行时）时，`apps/cli` 会在官方组合包之后加载其中的 `cordis.patch.yml`。无 Web 的 headless 和 SDK profile 不加载这些插件。除非官方界面没有对应 slot，否则不要改 `packages/` 中的源码。

```text
overlay/
├── brand/                 Sidebar brand and new-conversation mark
│   ├── cordis.patch.yml   Disable the official brand row and insert this plugin
│   ├── package.json       Declare dsh.client
│   ├── index.js           Host: serve images
│   ├── client.js          Browser: occupy the sidebar and hero brand slots
│   └── assets/            logo.png, logo-mark.png, zhishu-hero.webp, zhishu-hero-loop.webp, zhishu.gif
└── hide-official-account/ Disable the official DeepSeek account menu. Desktop login uses the model site
    └── cordis.patch.yml   Disable ui-settings-account only
```

新增能力时可沿用此目录结构，不要把补丁写进官方的 `cordis.patch.yml`。官方界面如何区分插件，以及无外网部署时应把插件放在哪里，见 [plugin-secondary-development.md](./plugin-secondary-development.md)。桌面壳登录、工作空间和 Windows 打包见 [desktop-secondary-development.md](./desktop-secondary-development.md)。

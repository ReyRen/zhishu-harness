# overlay

English | [中文](README.zh.md)

Put secondary-development additions in this directory. Each subdirectory is an independent plugin. When a Web profile starts, including Desktop's Web runtime, `apps/cli` loads its `cordis.patch.yml` after the shipped bundles. Headless and SDK profiles do not load these Web plugins. `hide-official-account` loads for every Web profile and disables the official account menu, so the settings gear returns. `platform-account` loads only for profile `desktop`. Do not edit the official UI source under `packages/` unless it provides no matching slot.

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

`dsh-market` does not contain the market implementation. That package is `third-party/dshmarket` (community dshmarket 1.66.22, compiled output in `host/`) and an `apps/cli` dependency, so `pnpm dsh web` resolves it from this checkout. It is not written into the user profile. If a profile later installs `dshmarket` itself, startup skips this insert so the Cordis id `dsh-market` is registered once.

Copy this directory structure for another capability. Keep its patch outside the official `cordis.patch.yml`. For how the official UI distinguishes plugins and where to put them in offline deployments, see [plugin-secondary-development.md](./plugin-secondary-development.md) (Chinese). Desktop login, workspaces, and Windows packaging are in [desktop-secondary-development.md](./desktop-secondary-development.md) (Chinese).

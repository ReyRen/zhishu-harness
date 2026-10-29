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
├── dsh-market/            Preinstalled plugin market (insert only)
│   └── cordis.patch.yml   Insert `dshmarket` with restart disabled
└── meow-memory/           Preinstalled memory with persistent DSH-home state
    └── cordis.patch.yml   Insert `meow-memory` with homeDir: dsh-storage
```

`dsh-market` does not contain the market implementation. `apps/cli` depends on the pinned npm package `dshmarket@1.66.22`, so `pnpm dsh web`, the container image, and the desktop package resolve that published package. It is not written into the user profile. If a profile later installs `dshmarket` itself, startup skips this insert so the Cordis id `dsh-market` is registered once.

`meow-memory` loads the pinned `apps/cli` dependency for every Web profile. Its global state uses DSH-home storage and its project databases stay in each Workspace. The overlay's standard `package.json` bundle declaration lets a profile's own installed bundle replace the default insert without registering it twice. The market overlay uses the same declaration. It is not added to the private catalog. See [container memory](../docker/README.md#default-memory) for persistence and offline verification.

Copy this directory structure for another capability. Keep its patch outside the official `cordis.patch.yml`. For how the official UI distinguishes plugins and where to put them in offline deployments, see [plugin-secondary-development.md](./plugin-secondary-development.md) (Chinese). Desktop login, workspaces, and Windows packaging are in [desktop-secondary-development.md](./desktop-secondary-development.md) (Chinese). The workbench concept and its boundaries are in [workbench-concept.md](./workbench-concept.md) (Chinese).

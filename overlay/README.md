# overlay

English | [中文](README.zh.md)

Put secondary-development additions in this directory. Each subdirectory is an independent plugin. When a Web profile starts, including Desktop's Web runtime, `apps/cli` loads its `cordis.patch.yml` after the shipped bundles. Headless and SDK profiles do not load these Web plugins. Do not edit the official UI source under `packages/` unless it provides no matching slot.

```text
overlay/
└── brand/                 Sidebar brand and new-conversation mark
    ├── cordis.patch.yml   Disable the official brand row and insert this plugin
    ├── package.json       Declare dsh.client
    ├── index.js           Host: serve images
    ├── client.js          Browser: occupy the sidebar and hero brand slots
    └── assets/            logo.png, logo-mark.png, zhishu-hero.webp, zhishu-hero-loop.webp, zhishu.gif
```

Copy this directory structure for another capability. Keep its patch outside the official `cordis.patch.yml`. For how the official UI distinguishes plugins and where to put them in offline deployments, see [plugin-secondary-development.md](./plugin-secondary-development.md) (Chinese).

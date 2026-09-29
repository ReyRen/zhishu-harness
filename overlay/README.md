# overlay

二次开发增量放在这里，每个子目录是一个独立插件。启动 Web 或桌面时，`apps/cli` 会按目录名自动加载其中的 `cordis.patch.yml`。不要改 `packages/` 里的官方界面源码，除非官方没有对应 slot。

```text
overlay/
└── brand/                 侧栏顶部标识，以及新会话标题前的标识
    ├── cordis.patch.yml   关掉官方品牌行，插入本插件
    ├── package.json       声明 dsh.client
    ├── index.js           Host：提供图片
    ├── client.js          浏览器：占用侧栏品牌槽和新会话 hero 标识槽
    └── assets/            logo.png、logo-mark.png、zhishu-hero.webp、zhishu-hero-loop.webp、zhishu.gif
```

新增一块能力时复制这个目录结构，不要把补丁写进官方 `cordis.patch.yml`。官方界面里插件怎么区分、无外网部署里该放哪一类，见 [plugin-secondary-development.md](./plugin-secondary-development.md)。

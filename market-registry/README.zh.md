# 插件市场私有源

本地或内网的插件目录和安装包。插件市场本身不在这里，它随 `zhishu-harness` 安装包启动。这里只放用户可以从市场安装的社区插件。

没有公网代理。Verdaccio 里没有的包，安装会失败，不会退回 `registry.npmjs.org`。

## 现在有什么

| 包 | 版本 | 来源 |
| --- | --- | --- |
| `dsh-dream-skin` | 10.15.0 | 社区 npm，tarball 在 `tarballs/` |
| `open-sea-skin` | 1.2.5 | 社区 npm，tarball 在 `tarballs/` |

`plugins.json` 是市场列表。`tarballs/` 是对应的安装包。启动时如果 `storage/` 里还没有这个版本，会把 tarball 发布进 Verdaccio。

## 启动

在仓库根目录：

```text
pnpm market:registry
```

第一次使用前，在本目录执行 `pnpm install --ignore-workspace`。

然后另开一个终端：

```text
pnpm dsh:private
```

这会把市场进程指到：

- 目录：`http://127.0.0.1:4874/plugins.json`
- 安装包：`http://127.0.0.1:4873`

普通 `pnpm dsh web` 仍使用公网目录。`DSHM_REGISTRY_URL` 和 `DSHM_NPM_MIRROR` 以 `DSH_` 开头，不能写进项目 `.env`，只能放在启动进程的环境里。

`dsh-dream-skin` 声明了宿主才有的 peer（`react`、`cordis`、若干 `@deepseek-ai/dsh-client-*`）。`pnpm dsh:private` 会关掉 pnpm 的 peer 自动安装，避免它去私有源里找这些包。

## 再拷一个社区插件

1. 从社区目录记下包名、版本，以及 `https://github.com/owner/repo`。`url` 必须保持这个形式，市场用它识别来源，不能改成内网地址。
2. 在能访问公网 npm 的机器上打包，把 tarball 放进 `tarballs/`：

```text
npm pack <包名>@<版本> --registry https://registry.npmjs.org/ --pack-destination market-registry/tarballs
```

3. 在 `start.mjs` 的 `mirrored` 列表里加上 `{ name, version }`。
4. 在 `plugins.json` 里加一条。`npm` 填包名，`url` 填上面的 GitHub 地址，`count` 改成条目数。
5. 重启 `pnpm market:registry`，再重启 `pnpm dsh:private`。市场每次打开都会重新读取目录。

装进用户 profile 的是 `npm` 字段指向的包。这个包如果还有自己的运行时依赖，那些依赖的 tarball 也要按同样步骤放进来。peer 不需要拷，宿主已经提供。

## 放到另一台机器

把本目录（含 `tarballs/`，不含 `node_modules/` 和 `storage/`）拷过去，安装依赖后执行 `pnpm market:registry`。

给别的机器用时，把 `verdaccio.yaml` 的 `listen` 和 `start.mjs` 里目录服务的监听地址从 `127.0.0.1` 改成 `0.0.0.0`。Web 进程的环境变量写成那台机器的内网地址：

```text
DSHM_REGISTRY_URL=http://<内网地址>:4874/plugins.json
DSHM_NPM_MIRROR=http://<内网地址>:4873
```

同时带上 `npm_config_auto_install_peers=false` 和 `pnpm_config_auto_install_peers=false`。只对运行 Web 的机器开放 `4873` 和 `4874`。当前配置允许匿名发布，不要暴露到公网。

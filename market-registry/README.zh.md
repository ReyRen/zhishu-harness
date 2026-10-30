# 插件市场私有源

[English](README.md) | 中文

本地或内网的插件目录和安装包。插件市场本身不在这里，它随 `zhishu-harness` 安装包启动。这里只放用户可以从市场安装的社区插件。

没有公网代理。Verdaccio 里没有的包，安装会失败，不会退回 `registry.npmjs.org`。

## 现在有什么

| 包 | 版本 | 来源 |
| --- | --- | --- |
| `open-sea-skin` | 1.2.6 | 社区 npm，tarball 在 `tarballs/` |
| `deepseek-harness-daily` | 0.4.10 | 工作台「产品更新追踪」，GitHub Release |
| `dsh-mind-workbench` | 1.0.15 | 工作台「DSH 思维导图工作台」，GitHub Release |
| `dsh-xiaohongshu-note-workbench` | 0.1.1 | 工作台「小红书笔记创作」，按公网目录指定的 GitHub commit 打包 |
| `dsh-bianqu-workbench` | 0.1.1 | 工作台「编曲工作台」，按公网目录指定的 GitHub commit 打包 |
| `@deepseek-ai/schemastery` | 3.18.2 | 多个工作台的运行时依赖 |
| `@deepseek-ai/cosmokit` | 1.8.3 | `schemastery` 的依赖 |
| `@standard-schema/spec` | 1.1.0 | `schemastery` 的依赖 |

`plugins.json` 是插件市场列表。`workbenches.json` 是工作台市场列表。`tarballs/` 里还有未单独上架的依赖包。启动时如果私有源里还没有这个版本，会把 tarball 发布进 Verdaccio。

工作台目录条目仍要给出 `npm` 和 `version`，`url` 保持 `https://github.com/owner/repo`。不要把宿主指到 `https://market.dshdesktop.com/index.json`：那份目录的安装包在 GitHub Release，不会从这份私有源下载。

`deepseek-harness-daily` 声明的宿主版本是 `0.2.0-rc.2` 或 `0.2.1-rc.2`。当前仓库是 `0.2.2-alpha.2`，安装会被宿主拒绝，直到上游放宽版本或单独授权。`dsh-mind-workbench` 的版本范围可以装到当前宿主。安装前要关掉 peer 自动安装，否则私有源里没有的 `cordis` 等 peer 会导致安装失败。`pnpm dsh:private` 已经带上这个设置。`pnpm dev:desktop` 要在同一个终端里先设置 `npm_config_auto_install_peers=false` 和 `pnpm_config_auto_install_peers=false`。

<a id="environment-variables"></a>

## 环境变量

私有源对外提供三类地址：插件列表、工作台列表、npm 安装源。对应关系如下。

| 变量 | 用途 | 本机 / 随包默认 | 何时必须显式设置 |
| --- | --- | --- | --- |
| `DSHM_REGISTRY_URL` | 插件市场列表（`plugins.json`） | 无内置私有默认；`pnpm dsh:private`、桌面安装包、容器启动脚本会写成 `http://127.0.0.1:4874/plugins.json` | Web/容器改连**独立私有源服务器**时 |
| `ZHISHU_WORKBENCH_CATALOG_URL` | 工作台市场列表（`workbenches.json`） | 未设置时宿主默认为 `http://127.0.0.1:4874/workbenches.json` | 工作台列表不在上述默认地址时（例如迁到内网其它主机） |
| `DSHM_NPM_MIRROR` | 插件与工作台共用的 npm 安装源 | 未设置时工作台安装默认为 `http://127.0.0.1:4873`；`dsh:private` / 桌面 / 容器会显式写入同一地址 | Web/容器改连**独立私有源服务器**时 |

说明：

- `DSHM_REGISTRY_URL` 和 `DSHM_NPM_MIRROR` 以 `DSH_` 开头，不能写进项目 `.env`，只能放在启动进程的环境里。`ZHISHU_WORKBENCH_CATALOG_URL` 同理，放在启动 Host / Web 的环境里。
- **桌面安装包与当前容器镜像**在进程内起 loopback 私有源（`4873` / `4874`），并已带上或依赖上述默认；**构建安装包或镜像时不必额外设置** `ZHISHU_WORKBENCH_CATALOG_URL`。桌面安装包不读构建机终端里的 `DSHM_*`。
- 私有源迁到单独服务器、由 Web 或其它 Host 去连时，三个地址都要改成那台机器的内网 URL，并继续关闭 peer 自动安装（见下一节示例）。
- 若只要让已随包启动的本机源工作，保持默认即可，无需再设工作台变量。

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

- 插件目录：`http://127.0.0.1:4874/plugins.json`
- 工作台目录：`http://127.0.0.1:4874/workbenches.json`
- 安装包：`http://127.0.0.1:4873`

普通 `pnpm dsh web` 仍使用公网目录。`pnpm dsh:private` 已写入上一节的本机 `DSHM_*` 地址，并关掉 pnpm 的 peer 自动安装。社区插件如果声明了宿主才有的 peer（`react`、`cordis`、若干 `@deepseek-ai/dsh-client-*`），这样就不会去私有源里找这些包。工作台列表在未设置时走宿主默认的本机 `workbenches.json`。

## 再拷一个社区插件

1. 从社区目录记下包名、版本，以及 `https://github.com/owner/repo`。`url` 必须保持这个形式，市场用它识别来源，不能改成内网地址。
2. 在能访问公网 npm 的机器上打包，把 tarball 放进 `tarballs/`：

```text
npm pack <包名>@<版本> --registry https://registry.npmjs.org/ --pack-destination market-registry/tarballs
```

3. 在 `plugins.json` 里加一条。`npm` 填包名，`url` 填上面的 GitHub 地址，`count` 改成条目数。开发时的 `pnpm market:registry` 和桌面安装包里的私有源都读这份列表。
4. 重启 `pnpm market:registry`，再重启 `pnpm dsh:private`。市场每次打开都会重新读取目录。打过的安装包要重新打包才会带上新插件。

装进用户 profile 的是 `npm` 字段指向的包。这个包如果还有自己的运行时依赖，那些依赖的 tarball 也要按同样步骤放进来。peer 不需要拷，宿主已经提供。

## 放到另一台机器

把本目录（含 `tarballs/`，不含 `node_modules/` 和 `storage/`）拷过去，安装依赖后执行 `pnpm market:registry`。

给别的机器用时，把 `verdaccio.yaml` 的 `listen` 和 `start.mjs` 里目录服务的监听地址从 `127.0.0.1` 改成 `0.0.0.0`。Web / Host 进程的环境变量写成那台私有源机器的内网地址（三个都要设）：

```text
DSHM_REGISTRY_URL=http://<内网地址>:4874/plugins.json
ZHISHU_WORKBENCH_CATALOG_URL=http://<内网地址>:4874/workbenches.json
DSHM_NPM_MIRROR=http://<内网地址>:4873
npm_config_auto_install_peers=false
pnpm_config_auto_install_peers=false
```

只对运行 Web 的机器开放 `4873` 和 `4874`。当前配置允许匿名发布，不要暴露到公网。

## 桌面安装包

`pnpm run package:desktop:win:x64:unsigned` 会把 `plugins.json`、`workbenches.json`、`tarballs/` 和 Verdaccio 放进安装包的 `resources/market-registry`。装好的程序在本机 `127.0.0.1:4873` 和 `4874` 自己启动这份源，进程内写入 `DSHM_REGISTRY_URL` / `DSHM_NPM_MIRROR`；工作台列表走宿主默认的本机 `workbenches.json`。构建与运行都**不必**再设 `ZHISHU_WORKBENCH_CATALOG_URL`。它不读构建机终端里的 `DSHM_*`。若将来要让安装包直连远程私有源，需要改桌面启动逻辑，而不是只在打包时 export 变量。

本机源的数据写在应用用户目录的 `market-registry` 里，不写进安装目录。安装包里新加的版本会在下次启动时补进去。开发时仍要另开 `pnpm market:registry`，`pnpm run dev:desktop` 不会自己启动 Verdaccio。

## 容器 Web 镜像

[容器构建](../docker/README.zh.md)根据独立冻结锁文件安装 Verdaccio，并准备相同的目录和 tarball，包括未在市场列为插件的额外依赖 tarball。在原生 Web 之前启动两个 loopback 服务，禁止发布包、关闭 peer 自动安装，并断网测试空缓存安装。启动脚本写入本机 `DSHM_REGISTRY_URL` / `DSHM_NPM_MIRROR`；工作台列表未单独设置时使用默认的 `http://127.0.0.1:4874/workbenches.json`，**构建镜像时不必**加 `ZHISHU_WORKBENCH_CATALOG_URL`。每个容器拥有各自的监听地址，不要通过平台代理暴露这些地址。已安装插件保存在用户 `DSH_HOME` 的 profile 中，临时仓库数据则从镜像重建。增加插件或修改版本需要重新构建镜像。若容器改为连接集群外的独立私有源，再按「放到另一台机器」一节设置全部三个变量。

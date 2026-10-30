# Private plugin registry

English | [中文](README.zh.md)

A local or intranet plugin catalog and package store. The market application starts with the `zhishu-harness` installation; this directory contains community plugins users can install from it.

There is no public-registry proxy. A package absent from Verdaccio fails to install instead of falling back to `registry.npmjs.org`.

## Available packages

| Package | Version | Source |
| --- | --- | --- |
| `open-sea-skin` | 1.2.6 | Community npm; tarball in `tarballs/` |
| `deepseek-harness-daily` | 0.4.10 | Workbench “产品更新追踪”, GitHub Release |
| `dsh-mind-workbench` | 1.0.15 | Workbench “DSH 思维导图工作台”, GitHub Release |
| `dsh-xiaohongshu-note-workbench` | 0.1.1 | Workbench “小红书笔记创作”, packed from GitHub source commit |
| `dsh-bianqu-workbench` | 0.1.1 | Workbench “编曲工作台”, packed from GitHub source commit |
| `@deepseek-ai/schemastery` | 3.18.2 | Runtime dependency of several workbenches |
| `@deepseek-ai/cosmokit` | 1.8.3 | Dependency of `schemastery` |
| `@standard-schema/spec` | 1.1.0 | Dependency of `schemastery` |

`plugins.json` is the plugin catalog. `workbenches.json` is the workbench catalog. `tarballs/` also holds dependencies that are not listed on their own. Startup publishes a tarball to Verdaccio if that version is not already in the private registry.

Workbench catalog entries still need `npm` and `version`, and `url` stays `https://github.com/owner/repo`. Do not point the host at `https://market.dshdesktop.com/index.json`: those packages are GitHub Releases and are not downloaded from this registry.

`deepseek-harness-daily` requires host `0.2.0-rc.2` or `0.2.1-rc.2`. This repository is `0.2.2-alpha.2`, so installation is refused until upstream widens that range or an exact-version exemption is granted. `dsh-mind-workbench` accepts the current host. Disable automatic peer installation before installing, or peers such as `cordis` that are absent from the private registry fail the install. `pnpm dsh:private` already sets this. For `pnpm dev:desktop`, set `npm_config_auto_install_peers=false` and `pnpm_config_auto_install_peers=false` in the same terminal first.

<a id="environment-variables"></a>

## Environment variables

The private source exposes three URLs: the plugin catalog, the workbench catalog, and the npm install registry.

| Variable | Purpose | Loopback / bundled default | When you must set it explicitly |
| --- | --- | --- | --- |
| `DSHM_REGISTRY_URL` | Plugin market catalog (`plugins.json`) | No built-in private default; `pnpm dsh:private`, the Desktop package, and the container startup script set `http://127.0.0.1:4874/plugins.json` | Web/container points at a **separate private-registry host** |
| `ZHISHU_WORKBENCH_CATALOG_URL` | Workbench market catalog (`workbenches.json`) | Host defaults to `http://127.0.0.1:4874/workbenches.json` when unset | Workbench catalog is not at that default URL (for example after moving it to another intranet host) |
| `DSHM_NPM_MIRROR` | Shared npm install registry for plugins and workbenches | Workbench installs default to `http://127.0.0.1:4873` when unset; `dsh:private` / Desktop / container set the same address explicitly | Web/container points at a **separate private-registry host** |

Notes:

- `DSHM_REGISTRY_URL` and `DSHM_NPM_MIRROR` begin with `DSH_` and cannot live in the project's `.env`; set them on the process that starts Host / Web. Set `ZHISHU_WORKBENCH_CATALOG_URL` the same way.
- **Desktop packages and the current container image** start a loopback private source (`4873` / `4874`) and already write or rely on the defaults above; **building the installer or image does not require** `ZHISHU_WORKBENCH_CATALOG_URL`. The Desktop package does not read terminal `DSHM_*` from the build machine.
- When the private source moves to its own server and Web or another Host connects to it, set all three URLs to that machine's intranet addresses and keep automatic peer installation disabled (see the example below).
- If only the bundled loopback source is in use, leave the workbench variable unset.

## Start

From the repository root:

```text
pnpm market:registry
```

Before the first run, execute `pnpm install --ignore-workspace` in this directory.

Then open another terminal:

```text
pnpm dsh:private
```

This points the market process at:

- Plugin catalog: `http://127.0.0.1:4874/plugins.json`
- Workbench catalog: `http://127.0.0.1:4874/workbenches.json`
- Packages: `http://127.0.0.1:4873`

Ordinary `pnpm dsh web` still uses the public catalog. `pnpm dsh:private` writes the loopback `DSHM_*` values from the previous section and disables automatic peer installation. If a community plugin declares host-supplied peers (`react`, `cordis`, or `@deepseek-ai/dsh-client-*` packages), pnpm does not search the private registry for them. The workbench catalog uses the host's loopback `workbenches.json` default when unset.

## Mirror another community plugin

1. Record its package name, version and `https://github.com/owner/repo` URL from the community catalog. Preserve that URL format: the market identifies its source from it, so do not replace it with an intranet URL.
2. On a machine with public npm access, pack it into `tarballs/`:

```text
npm pack <包名>@<版本> --registry https://registry.npmjs.org/ --pack-destination market-registry/tarballs
```

3. Add an entry to `plugins.json`. Set `npm` to the package name, `url` to its GitHub URL, and `count` to the entry count. Both development's `pnpm market:registry` and the Desktop installation's private registry read this list.
4. Restart `pnpm market:registry`, then `pnpm dsh:private`. The market reloads the catalog whenever it opens. Rebuild existing installation packages to include the new plugin.

The user's profile installs the package named by `npm`. Mirror its runtime dependencies as tarballs too; host-supplied peers do not need mirroring.

## Move to another machine

Copy this directory, including `tarballs/` but excluding `node_modules/` and `storage/`, install dependencies and run `pnpm market:registry`.

To serve other machines, change the listeners in `verdaccio.yaml` and `start.mjs` from `127.0.0.1` to `0.0.0.0`. Set the Web / Host process environment to that private-registry machine's intranet address (all three URLs):

```text
DSHM_REGISTRY_URL=http://<内网地址>:4874/plugins.json
ZHISHU_WORKBENCH_CATALOG_URL=http://<内网地址>:4874/workbenches.json
DSHM_NPM_MIRROR=http://<内网地址>:4873
npm_config_auto_install_peers=false
pnpm_config_auto_install_peers=false
```

Allow ports `4873` and `4874` only from Web hosts. The current configuration permits anonymous publishing; do not expose it publicly.

## Desktop installation package

`pnpm run package:desktop:win:x64:unsigned` includes `plugins.json`, `workbenches.json`, `tarballs/` and Verdaccio under `resources/market-registry`. The installed application starts the registry on local `127.0.0.1:4873` and `4874`, writes `DSHM_REGISTRY_URL` / `DSHM_NPM_MIRROR` in-process, and lets the workbench host use its loopback `workbenches.json` default. Building and running do **not** require `ZHISHU_WORKBENCH_CATALOG_URL`. The package does not read build-machine terminal `DSHM_*` values. Pointing a Desktop build at a remote private source needs Desktop startup changes, not only exporting variables at pack time.

Registry data lives under `market-registry` in the application's user directory, not the installation directory. A later startup imports new bundled versions. During development, start `pnpm market:registry` separately; `pnpm run dev:desktop` does not start Verdaccio.

## Container Web image

The [container build](../docker/README.md) installs the independent frozen Verdaccio lockfile and prepares the same catalog and tarballs, including additional dependency tarballs not listed as installable plugins. It starts both loopback services before native Web, disables publishing and peer auto-installation, and tests cold-cache installation without networking. The startup script sets loopback `DSHM_REGISTRY_URL` / `DSHM_NPM_MIRROR`; the workbench catalog uses `http://127.0.0.1:4874/workbenches.json` when unset, so **building the image does not require** `ZHISHU_WORKBENCH_CATALOG_URL`. Each container has its own listeners; do not expose them through the platform proxy. Installed plugins persist in the user's `DSH_HOME` profile, while temporary registry storage is regenerated from the image. Adding plugins or changing versions requires rebuilding the image. If the container instead connects to a private source outside the image, set all three variables as in “Move to another machine”.

# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Platform deployment in this fork

This fork keeps the complete upstream DSH Web application and adds managed-workspace configuration plus a self-contained container build under [docker/](docker/README.md). The multi-user deployment is composed of:

- [gcs-harness-master](https://github.com/ReyRen/gcs-harness-master) for platform identity, lifecycle, scheduling, and the iframe gateway.
- [gcs-harness-worker](https://github.com/ReyRen/gcs-harness-worker) for node-local user-container lifecycle and the internal data-plane proxy.
- This repository for the per-user DSH image.

The `master` branch only mirrors the official DSH `upstream/master`. Platform development and container builds always use `main`; see the [container build guide](docker/README.md) for the update and release workflow.

<a id="platform-update-policy"></a>

## Updates and upstream merges

This policy applies to both `zhishu-harness` and `gcs-webnora`. Updates run only on an explicit user request; no scheduled update task is enabled. Preserve platform capabilities while keeping each project current with its own upstream.

| Upstream and platform functionality | Merge decision |
|---|---|
| The platform has a unique capability | Keep it and adapt it to the new upstream APIs. |
| Upstream fully covers a platform capability | Use the upstream implementation and remove the redundant platform implementation. |
| Upstream covers only part of a platform capability | Use upstream for the shared part and retain only the uncovered business behavior through supported extensions or configuration. |
| Preserving a required capability, data compatibility or permissions conflicts with upstream | Pause the affected release, explain the specific conflict and ask the user to decide. |

Compare actual behavior, configuration, permissions and compatibility; matching names or files do not establish equivalent functionality. Resolve routine merge conflicts under these rules without repeated approval. Repositories keep their own histories and PRs; “up to date” means incorporating upstream while preserving required business behavior, rather than identical source trees.

1. Read live upstream and fork refs, local/server checkouts, uncommitted work, pending PRs, images and running services. Independently check pending merges, business-code builds, deployment and interrupted work; unchanged upstream refs do not mean the release is complete.
2. Review on a branch outside Mutagen. Preserve unknown work and establish ownership before publishing it; never force-push, reset unknown edits or push/open PRs in either official upstream. Land reviewed changes in the appropriate fork’s `main` and synchronize clean local/server checkouts with Mutagen paused, server first, then local, before resuming and flushing.
3. Validate the affected behavior, types, static checks, documentation, dependencies and build. Runtime changes also require the relevant sandbox, Office, native Web, offline-market and integration checks. Fix real failures; report infrastructure limitations with equivalent validation and keep failed checks recorded as failures.
4. For a runtime release, build from clean, merged `main`, validate without real user data, deploy and verify actual running versions. A Harness image update includes the Master default and sequential existing-user rollouts, so both current and future Web launches use the new image. Stop on the first failure. x86 is the current release target; ARM requires separate authorization.
5. Keep user JFS paths, data ownership, SSO, sharing/revocation and sandbox protections intact. Persisted-format changes require stopped writers and a consistent backup; process rollback does not roll back data formats. Documentation-only updates require documentation checks and synchronization, without rebuilding images or restarting services when runtime inputs are unchanged.

For example, request:

> Update zhishu-harness and gcs-webnora: merge each latest upstream and the reviewed custom changes under this policy, update both main branches and local/server checkouts, and validate and deploy x86 runtime changes. Keep ARM unchanged.

Report upstream integration, main commits, checkout synchronization, built artifacts and deployed versions separately, including remaining work and blockers. Never report a build or a mirror-branch update as a completed deployment.

The official source is `deepseek-ai/deepseek-harness:master`; fork `master` only fast-forwards it, and `ReyRen/zhishu-harness:main` is the platform source. Preserve per-user workspaces and JFS isolation, native Web/Desktop, plugins and workbenches, offline dependencies, primary runtime and Office skills. Harness’s native “Model settings” remains the single user-wide model configuration entry; applications keep their own model-selection logic. Keep the fork’s optional CI workflow manual-only. Follow the [release procedure](docs/cookbook/updating-platform-fork.md); the sibling project records its integration requirements in its [README](https://github.com/ReyRen/gcs-webnora#platform-update-policy).

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/4MrtZUhpxg">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## Citation

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

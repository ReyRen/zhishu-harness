# Update upstream and publish the platform image

English | [中文](updating-platform-fork.zh.md)

Use this procedure for `ReyRen/zhishu-harness` and the GCS deployment. Commands run in the repository root unless a host is specified. The independent Web environment on `172.18.36.225` is outside this procedure.

## Branch and merge rules

- Official `deepseek-ai/deepseek-harness:master` is read-only. Never push or open a PR there.
- Fork `master` only fast-forwards official commits. Fork `main` contains platform development and is the only production image source.
- Merge on a temporary branch outside Mutagen's synchronized directory. Review textual and semantic conflicts individually. Official behavior replaces incompatible platform designs; retain compatible per-user workspaces, JFS boundaries, native Web, Desktop and market features.
- Authenticated non-loopback browsers must be able to persist settings to their own Host. Official remote-access support now implements this; do not fake loopback identity. If future upstream behavior truly conflicts, stop for a user decision.
- No force pushes, hard resets, whole-file ours/theirs resolutions or ZIP overlays. Unknown changes, failed tests or unavailable hosts block release.
- If Issues are disabled in `ReyRen/zhishu-harness`, a platform PR records its upstream/main baselines, scope and validation without an Issue reference. Do not enable Issues or open one in the official repository to satisfy a contribution-template requirement.

## 0. Reconcile pending work before fetching

Every run reads live official/Fork refs, the canonical checkouts, pending worktrees/PRs, images and running containers. Evaluate these conditions independently:

| Condition | Required work |
|---|---|
| Official master is ahead of Fork master | Fast-forward Fork master |
| Fork main does not contain the official target | Resume or create the reviewed upstream merge |
| Main changed, or a target lacks a validated image for main | Build and smoke-test that target |
| A configured Worker runs an older image or stale specification | Roll out the validated image |
| A previous run stopped before completion | Recheck its evidence and resume the pending step |

Only report no change when none of these conditions holds. Equal official/Fork master refs do not establish that main, images or deployment are current. Main-only development updates trigger builds independently. Unknown uncommitted work is reported and preserved, not published automatically.

Keep recovery checkpoints in `$CODEX_HOME/automations/dsh/release-state.json`: target refs, owned review worktree, completed checks, built images and each Worker's deployed result. Save each successful phase with a temporary file and rename; record failures and pending work. Never store credentials. The file is a recovery aid, not authority: verify its claims against live state, and reconstruct it when absent.

The enabled automatic release target is x86 on `172.18.36.230`, controlled by Master `172.18.29.80`. Also report ARM source/image drift on `172.18.127.43` and `172.18.127.44`; publish ARM only when explicitly enabled. Record architecture, commit, image name and local Image ID separately. Do not compare IDs across architectures or Docker image backends, or claim that an x86 release updated ARM.

## 1. Fetch and fast-forward fork master

Confirm a clean worktree and exact remote targets. Disable the official push URL as an additional guard.

```bash
git status --short --branch
git remote -v
git remote set-url --push upstream DISABLED
git fetch origin main master
git fetch upstream master
git merge-base --is-ancestor origin/master upstream/master
git switch master
git merge --ff-only origin/master
git merge --ff-only upstream/master
test "$(git rev-parse HEAD)" = "$(git rev-parse upstream/master)"
git push origin master
```

If official master is unchanged, skip only its fast-forward. Continue the independent checks in step 0, including an unfinished merge or main-only update. Stay silent only when there is no pending work or new result requiring attention.

## 2. Integrate and validate outside Mutagen

Keep the synchronized checkout on main. Reuse a known owned pending worktree instead of discarding its resolutions. Before integrating a newer origin/main, preserve a resolved merge checkpoint with the normal commit hooks, then merge the new main and recheck affected behavior. For a new integration, create a branch from current origin/main and merge master without committing first.

```bash
git switch -c sync-upstream-YYYY-MM-DD origin/main
git merge --no-ff --no-commit origin/master
git diff --name-only --diff-filter=U
git diff origin/master -- docker packages/api/workspace-controller packages/host/directory-picker-auto packages/host/directory-picker-browse
```

Review automatic merges too: default workspace creation, user-root boundaries, authenticated settings, full Web and plugin proxy paths, runtime/Office skills, lockfiles and Desktop packaging. Remove obsolete adaptations when official code replaces them. The optional official experimental market remains disabled by default; do not remove the installed third-party market merely because both packages exist.

Follow the repository's pre-push and documentation skills. Select tests for the actual diff; do not disable failing platform release checks. Re-record paired-document metadata after editing both languages.

```bash
pnpm install --frozen-lockfile
pnpm exec vitest run packages/api/workspace-controller/tests/workspace-controller.host.spec.ts packages/host/directory-picker-auto/tests/loader-composition.spec.ts packages/host/directory-picker-browse/tests/service.spec.ts
node --test docker/tests/cache-primary-runtime.test.mjs docker/tests/sandbox-policy.test.mjs
pnpm run verify-package-dependencies
pnpm run verify-npm-install-layout
pnpm run build
pnpm run test:docs
pnpm run doc-sync
git add -A
git diff --cached --check
git commit -m "Merge official DSH into platform main"
git push -u origin sync-upstream-YYYY-MM-DD
```

When using a production image as a Linux test environment, set `NODE_ENV=test` and unset inherited DSH home/workspace/runtime variables. Use `pnpm run clean` when reusing a worktree that contains outputs from removed packages.

Build a separately tagged verification image and test actual bubblewrap command execution, Web login/settings/plugin loading and Office rendering before merging. Such an image is not a production main image. Open a PR **only to ReyRen/zhishu-harness:main**. Merge only after conflicts are resolved and critical checks pass. If fork checks require official-only runners or credentials, verify that exact cause and provide equivalent Linux evidence; do not excuse real code failures.

Fork main keeps [upstream CI](../../.github/workflows/ci.yml) on `workflow_dispatch` only, including its job conditions. Do not run or retry it automatically, wait for it, or require a GitHub browser login for platform releases. Preserve this setting when merging upstream; Fork master still mirrors official source. Historical failures in this optional workflow remain recorded as failures, without changing thresholds or calling them passes. They do not block platform releases; the build, type, documentation, dependency, storage/isolation, sandbox, Office, native Web and offline-market checks above still must pass. Other workflow triggers remain unchanged.

## 3. Update the canonical build checkout

Worker source: `172.18.36.230:/storage-md0/renyuan/zhishu-harness-platform/zhishu-harness`. Windows source: `E:\Projects\zhishu-harness-platform\zhishu-harness`. Mutagen excludes Git metadata, dependencies, generated outputs and known cross-OS symlink differences; each Git checkout must be advanced separately.

Pause synchronization and confirm both checkouts are clean. Fast-forward the Worker first, then Windows; never reset unexplained changes.

```bash
mutagen sync pause zhishu-harness-platform
```

On the Worker, then on Windows:

```bash
git fetch origin main master
git switch master
git merge --ff-only origin/master
git switch main
git merge --ff-only origin/main
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
```

Resume and wait for reconciliation. Both HEADs must match merged main, with clean worktrees and no Mutagen conflicts or transfer failures.

```bash
mutagen sync resume zhishu-harness-platform
mutagen sync flush zhishu-harness-platform
mutagen sync list zhishu-harness-platform --long
```

## 4. Build and smoke-test on the Worker

Production builds use only clean merged main on `172.18.36.230`.

```bash
COMMIT="$(git rev-parse HEAD)"
IMAGE="zhishu-harness:main-${COMMIT:0:7}"
docker build --network host --build-arg "DSH_CLIENT_COMMIT_HASH=$COMMIT" --file docker/Dockerfile --tag "$IMAGE" .
IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
printf '%s %s\n' "$IMAGE" "$IMAGE_ID"
```

The image includes native Web, bundled primary runtime and seven Office skills. Debian mirror build arguments are available for network issues; temporary build-host workarounds must not become permanent dependencies.

Install `docker/security/install.sh` on each target Worker before using the image. It installs a named AppArmor policy and scoped seccomp file, not a global Docker configuration change. It refuses to overwrite different policy contents: policy changes require review and a new profile name before rolling containers.

Users run as ordinary Docker containers managed by Worker, not Swarm Services. They drop all outer capabilities, retain no-new-privileges, and use scoped bubblewrap policies without privileged or host SYS_ADMIN. Removing Docker's mount-based system-path masks is required for nested procfs; AppArmor denies sensitive paths instead. This is not identical to Docker's default protection and still shares the host kernel. The qualified target is x86-64 Docker 24 / Linux 5.4; other targets need independent validation.

Smoke-test without real user data first. Verify actual sandbox enforcement, non-loopback authenticated settings, bundled Office imports/rendering/recalculation, default workspace and plugin assets. Put the identical image ID on every configured Worker; Worker never pulls user images.

## 5. Roll out through Master and Worker

Related code: [Master](https://github.com/ReyRen/gcs-harness-master), [Worker](https://github.com/ReyRen/gcs-harness-worker). Master runs under systemd. Swarm only deploys trusted Worker Global Services; Worker uses host networking and manages users on an isolated local bridge. Use real node URLs, not routing mesh. Worker control port `18082` is restricted to Master/local administration and requires its private Token.

On `172.18.29.80`, inspect the systemd unit. Back up both configuration copies, preserve ownership and modes, and update `dsh.localImageID` in both to the verified image. Current paths are:

- `/root/go/src/gcs-harness-master/dist/linux-amd64/master.json` (running configuration).
- `/etc/gcs-harness-master/master.json` (maintained copy).

```bash
systemctl cat gcs-harness-master
systemctl restart gcs-harness-master
systemctl is-active gcs-harness-master
curl --fail --silent http://127.0.0.1:18088/healthz
```

Do not restart until both copies agree. The configured workers list contains explicit node addresses. The Master must remain a single instance; any unreachable configured Worker blocks scheduling to avoid a second JFS writer. Drain users before removing a Worker from configuration.

Query each Worker's `GET /internal/v1/state` with `X-GCS-Worker-Token` loaded privately from the shared token file. For each existing user, sequentially POST `/internal/v1/containers/{userID}/rollout` with `{"imageID":"sha256:..."}`. The Worker stops and retains the old container, starts the replacement, waits for healthy and verifies its internal login credential; a failed replacement is stopped before the old container restarts. Stop release on the first failure. Never log credentials or send Worker/DSH tokens to the frontend.

Every image update includes both the Master's default-image configuration and the existing-user rollouts. Building or retagging alone does not complete a release. Before reporting success, confirm the configured default and every current user's actual image ID match the new image, so the next Web launch uses it; keep each user's existing JFS directory.

For the one-time migration from old user Swarm Services, stop Master briefly to prevent new launches. Scale each old user Service to zero and verify its tasks have stopped **before** starting the ordinary container on the same JFS path. Keep stopped old specifications/images for rollback. Never delete a running user Service or start both generations against the same storage.

## 6. Verify, recover and clean up

Verify every intended user container is running, healthy, using the exact image and matching Worker specification; confirm the JFS bind points to `/storage-root-jfs/user-<userID>`. Test the full launch/iframe/terminate path. Master stores browser sessions in memory, so restarting it requires a new launch; historical data remains on JFS.

A failed per-user rollout attempts process rollback automatically; it does not reverse persisted-format migrations. Before a release that changes persistence, stop writers and back up DSH state consistently. An old runtime can reject newer data; stop for a format-aware recovery decision instead of overwriting history. If cleanup or rollback fails, stop and inspect; do not manually start another writer. To revert a release, restore both Master configs, roll users back sequentially through Worker to the retained old image, and verify health again. During the one-time migration, stop the ordinary container before scaling its old Service back up.

Only after the new version is stable, remove explicitly identified stopped rollback containers, old stopped task containers and unreferenced old images. Preserve live user containers and `/storage-root-jfs/user-<userID>`. Do not run broad Docker prune, volume deletion or compose down -v.

# Update upstream and release the DSH platform image

English | [中文](updating-platform-fork.zh.md)

This procedure updates `ReyRen/zhishu-harness`, builds its per-user DSH image, and rolls that image through the GCS Harness Swarm deployment. Run Git commands from the `zhishu-harness` repository root and shell examples in Bash. The standalone Web acceptance deployment on `172.18.36.225` is separate and is not updated by this procedure.

## Branch and conflict rules

- `upstream/master` is the official `deepseek-ai/deepseek-harness` branch. Treat it as read-only; never open a platform pull request against the official repository.
- `origin/master` mirrors the official branch exactly. Fast-forward it only; never add platform commits or build production images from it.
- `origin/main` contains the platform development. Merge `master` into a temporary branch based on `main`, then open a pull request **in `ReyRen/zhishu-harness` with base `main`**. Do not push the temporary branch directly to `main`.
- Review semantic overlap even if Git reports no textual conflict. If an official change replaces or conflicts with a platform modification, use the official behavior and remove the obsolete platform source, configuration, tests, and documentation. Preserve independent platform behavior only when it still works with the official code.
- Never use `git push --force`, a blanket “ours/theirs” resolution, `git reset --hard`, or a ZIP overlay to complete an upstream update. Stop if ancestry or the working tree is unclear.

## 1. Check the repository and synchronize `master`

Start with a clean working tree and verify that `origin` is the fork and `upstream` is the official repository. The fork's `master` must be an ancestor of the official `master`; divergence needs investigation instead of a force push.

```bash
git status --short --branch
git remote -v
git fetch origin main master
git fetch upstream master
git merge-base --is-ancestor origin/master upstream/master
git switch master
git merge --ff-only origin/master
git merge --ff-only upstream/master
test "$(git rev-parse HEAD)" = "$(git rev-parse upstream/master)"
git push origin master
```

The push target is **only `ReyRen/zhishu-harness:master`**. Record both commit IDs before continuing. Do not publish a PR from this branch to `deepseek-ai/deepseek-harness`.

## 2. Merge official code into a platform branch

Create the branch from the current fork `main`. The merge is paused before its commit so overlapping files can be inspected. In a conflict, stage 2 is the platform side and stage 3 is the official side; inspect both instead of accepting either side for the whole file.

```bash
git switch main
git merge --ff-only origin/main
git switch -c sync-upstream-YYYY-MM-DD
git merge --no-ff --no-commit master
git status --short
git diff --name-only --diff-filter=U
git diff master -- docker packages/api/workspace-controller packages/host/directory-picker-auto packages/host/directory-picker-browse
```

Resolve each conflict and inspect auto-merged files. In particular, verify the complete native Web profile, automatic default Workspace, user directory root, Docker build, and lockfile still agree with the new official code. If official behavior supersedes one of these additions, remove that addition rather than preserving an incompatible patch. Stage the resolved files, run `git diff --cached --check`, and commit the merge. Never commit an unresolved index.

## 3. Validate and merge a pull request into `main`

Use checks that cover the changed behavior; the following commands cover the platform integration and image build. Add focused official-feature tests when the merge touches their behavior. Documentation checks may need Linux or CI when local Windows symlink permissions prevent them; investigate failures rather than treating them as passes.

```bash
pnpm install --frozen-lockfile
pnpm exec vitest run packages/api/workspace-controller/tests/workspace-controller.host.spec.ts packages/host/directory-picker-auto/tests/loader-composition.spec.ts packages/host/directory-picker-browse/tests/service.spec.ts
pnpm run verify-package-dependencies
pnpm run build
pnpm run test:docs
pnpm run doc-sync
git add -A
git diff --cached --check
git commit -m "Merge official DSH into platform main"
git push -u origin sync-upstream-YYYY-MM-DD
```

Use the actual branch name in the push command. Create a GitHub PR at `ReyRen/zhishu-harness`, confirm **base `main` and head `sync-upstream-YYYY-MM-DD`**, review the changed platform files and checks, then merge it there. A green conflict indicator alone is not sufficient. Do not create this PR in the official repository.

After GitHub reports the PR merged, refresh the local build source:

```bash
git switch main
git fetch origin main
git merge --ff-only origin/main
git status --short --branch
```

## 4. Confirm the Worker build source

The current DSH Worker is `172.18.36.230`, with source at `/storage-md0/renyuan/zhishu-harness-platform/zhishu-harness`. Build only after its `main` equals the merged fork `main` and its working tree is clean. If Mutagen has synchronized Git references before its index, a dirty status may be transient; compare the files and index to `origin/main` before repairing anything. Do not reset or overwrite unrecognized changes.

```bash
cd /storage-md0/renyuan/zhishu-harness-platform/zhishu-harness
git fetch origin main
git switch main
git merge --ff-only origin/main
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
```

## 5. Build the image on the Worker

The image contains the native Web UI and publishes no per-user host port. It uses `/storage-root-jfs/user` inside the container; Swarm mounts each user's existing `/storage-root-jfs/user-<userID>` directory there. Never remove or recreate those user directories during a release.

```bash
COMMIT="$(git rev-parse HEAD)"
IMAGE="zhishu-harness:main-${COMMIT:0:7}"
docker build --network host \
  --build-arg "DSH_CLIENT_COMMIT_HASH=$COMMIT" \
  --file docker/Dockerfile \
  --tag "$IMAGE" \
  .
IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
printf '%s %s\n' "$IMAGE" "$IMAGE_ID"
```

On a slow package mirror, the Dockerfile accepts `DEBIAN_MIRROR` and `DEBIAN_SECURITY_MIRROR` build arguments. Before changing Master, start one disposable container with `DSH_PUBLIC_AUTHORITY=localhost:3081` and check that port `3081` responds; an unauthenticated request to `/` returns HTTP 401. Stop the disposable container afterward. All Swarm nodes labeled `dsh=true,jfs=true` must have this exact Image ID locally; distribute the built image if more than one Worker is eligible.

## 6. Switch Master and existing user Services

On Swarm Manager `172.18.29.80`, inspect `systemctl cat gcs-harness-master` to confirm the runtime config path. The current service reads `/root/go/src/gcs-harness-master/dist/linux-amd64/master.json`; `/etc/gcs-harness-master/master.json` is a maintained copy. Back up both, set `dsh.localImageID` in both to the new `sha256:...` Image ID, keep ownership and permissions, and verify the files match before restarting Master. Do not place the Master API token or any DSH launch token in this guide or a Git commit.

```bash
systemctl cat gcs-harness-master
jq -r '.dsh.localImageID' /root/go/src/gcs-harness-master/dist/linux-amd64/master.json
systemctl restart gcs-harness-master
systemctl is-active gcs-harness-master
curl --fail --silent http://127.0.0.1:18088/healthz
```

Run the restart commands only **after** both config files contain the new Image ID. New user launches then use the new image. To migrate already-running users, list the `dsh-u-` Services and update them **one at a time** with `docker service update --image "$IMAGE_ID" --no-resolve-image --detach=false <service-name>`. Verify each update has completed and its Worker container is healthy before proceeding to the next user. This restarts that user's DSH process briefly but retains its bind-mounted history and Workspace data.

## 7. Verify, rollback, and clean up

Confirm Master health, every intended Service at `1/1`, the configured Image ID, and healthy Worker containers. If a release fails, restore the backed-up Master config, restart Master, and roll affected Services back to the previous Image ID while the old image remains on every eligible Worker. Keep the old image until the new rollout and observation period pass; then inspect its exact stopped container IDs before removing those containers and the old image. Do not use `docker service rm`, `docker compose down -v`, or volume cleanup as part of an image update. The JFS user directories are not disposable build artifacts.

#!/usr/bin/env bash
set -euo pipefail

: "${DSH_PUBLIC_AUTHORITY:?DSH_PUBLIC_AUTHORITY is required}"
workspace_root="${DSH_WORKSPACE_ROOT:-/storage-root-jfs/user}"
default_workspace="${DSH_DEFAULT_WORKSPACE:-${workspace_root}/workspace}"
primary_runtime="${DSH_PRIMARY_RUNTIME:?DSH_PRIMARY_RUNTIME is required}"
export MEOW_MEMORY_HOME="${MEOW_MEMORY_HOME:-${DSH_HOME}/storages/meow-memory}"

test -f "${primary_runtime}/runtime.json"
test -x "${primary_runtime}/dependencies/python/bin/python3"
test -x "${primary_runtime}/dependencies/node/bin/node"
test -f "${primary_runtime}/../office-skills/office/SKILL.md"

install -d -m 0700 "${DSH_HOME}" "${default_workspace}"
cd "${default_workspace}"

exec node /opt/dsh/docker/container-web.mjs

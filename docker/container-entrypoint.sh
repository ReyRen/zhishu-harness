#!/usr/bin/env bash
set -euo pipefail

web_port="${DSH_WEB_PORT:-3080}"
internal_port="${DSH_INTERNAL_PORT:-3081}"
public_authority="${DSH_PUBLIC_AUTHORITY:?DSH_PUBLIC_AUTHORITY is required}"

socat "TCP-LISTEN:${internal_port},fork,reuseaddr,bind=0.0.0.0" "TCP:127.0.0.1:${web_port}" &

exec node /opt/dsh/apps/cli/lib/bin.js \
  --profile web \
  --host 127.0.0.1 \
  --port "${web_port}" \
  --trusted-host "${public_authority}" \
  --no-open

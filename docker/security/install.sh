#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0 || { echo 'Run as root on each DSH Worker' >&2; exit 1; }
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
destination=/etc/gcs-harness/security
apparmor_target=/etc/apparmor.d/gcs-harness-bwrap
command -v apparmor_parser >/dev/null
test "$(uname -m)" = x86_64 || { echo 'This policy is qualified only on x86_64 Linux; validate other architectures first' >&2; exit 1; }
install -d -m 0755 "$destination"
for pair in "seccomp-bwrap.json:$destination/seccomp-bwrap.json" "apparmor-bwrap:$apparmor_target"; do
  source_file="${pair%%:*}"
  target_file="${pair#*:}"
  if [ -e "$target_file" ] && ! cmp --silent "$source_dir/$source_file" "$target_file"; then
    echo "Refusing to replace an existing different policy: $target_file; use a new policy name and roll containers" >&2
    exit 1
  fi
done
install -m 0644 "$source_dir/seccomp-bwrap.json" "$destination/seccomp-bwrap.json"
install -m 0644 "$source_dir/apparmor-bwrap" "$apparmor_target"
apparmor_parser -r "$apparmor_target"
grep -Fx 'gcs-harness-bwrap (enforce)' /sys/kernel/security/apparmor/profiles >/dev/null
printf 'Installed scoped gcs-harness-bwrap policy; Docker daemon defaults are unchanged.\n'

#!/usr/bin/env bash
set -euo pipefail

root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT

bash "$(dirname "$0")/install-matrix-diagnostics.sh" "$root"

test -x "$root/home/admin/.local/bin/matrix-diagnostics"
test -x "$root/home/admin/.local/lib/matrix-diagnostics/matrix-diagnostics.cjs"
test -f "$root/etc/systemd/system/matrix-diagnostics.service"
test -f "$root/etc/systemd/system/matrix-diagnostics.timer"
grep -q '^User=admin$' "$root/etc/systemd/system/matrix-diagnostics.service"
grep -q '^Type=oneshot$' "$root/etc/systemd/system/matrix-diagnostics.service"
grep -q '^OnUnitActiveSec=5min$' "$root/etc/systemd/system/matrix-diagnostics.timer"
grep -q '^Persistent=true$' "$root/etc/systemd/system/matrix-diagnostics.timer"
! grep -Eqi 'token|password|secret|cookie|smtp' "$root/etc/systemd/system/matrix-diagnostics.service"
test "$(stat -c '%a %U:%G' "$root/var/lib/matrix-diagnostics")" = "700 admin:admin"
test "$(stat -c '%a %U:%G' "$root/home/admin/work/packaging-system/.runtime/vm_debug_ci/workspace/store/matrix-diagnostics")" = "700 admin:admin"
test "$(stat -c '%U:%G' "$root/home/admin/.local/bin/matrix-diagnostics")" = "admin:admin"
node --check "$root/home/admin/.local/lib/matrix-diagnostics/matrix-diagnostics.cjs"

echo "matrix diagnostics install tests passed"

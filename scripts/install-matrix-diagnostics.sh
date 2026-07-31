#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest_root="${1:-/}"

install_file() {
  local mode="$1" source="$2" target="$3"
  install -D -m "$mode" "$source" "${dest_root%/}$target"
}

install_file 0644 "$project_root/scripts/matrix-diagnostics-core.cjs" "/home/admin/.local/lib/matrix-diagnostics/matrix-diagnostics-core.cjs"
install_file 0755 "$project_root/scripts/matrix-diagnostics.cjs" "/home/admin/.local/lib/matrix-diagnostics/matrix-diagnostics.cjs"

install_file 0755 "$project_root/deploy/bin/matrix-diagnostics" "/home/admin/.local/bin/matrix-diagnostics"

install_file 0644 "$project_root/deploy/systemd/matrix-diagnostics.service" "/etc/systemd/system/matrix-diagnostics.service"
install_file 0644 "$project_root/deploy/systemd/matrix-diagnostics.timer" "/etc/systemd/system/matrix-diagnostics.timer"

install -d -m 0700 "${dest_root%/}/var/lib/matrix-diagnostics"
install -d -m 0700 "${dest_root%/}/home/admin/work/packaging-system/.runtime/vm_debug_ci/workspace/store/matrix-diagnostics"

if [[ "$dest_root" == "/" ]]; then
  systemctl daemon-reload
  systemctl enable --now matrix-diagnostics.timer
  systemctl start matrix-diagnostics.service
fi

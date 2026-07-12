#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
APP_USER="${APP_USER:-$(id -un)}"
BACKUP_DIR="${BACKUP_DIR:-/var/lib/packaging-system-backups}"
SERVICE_NAME="packaging-system.service"
INSTALL_BACKUP_TIMER="${INSTALL_BACKUP_TIMER:-0}"

[[ "$(id -u)" -ne 0 ]] || { echo "请使用普通应用用户运行，不要直接使用 root。"; exit 1; }
[[ -f "$APP_DIR/package-lock.json" && -f "$APP_DIR/frontend-next/package-lock.json" ]] || { echo "缺少依赖锁文件。"; exit 1; }

echo "[1/9] 安装系统依赖"
sudo apt-get update -y
sudo apt-get install -y curl git nginx build-essential

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(`.`)[0]')" != "22" ]]; then
  echo "[2/9] 安装 Node.js 22"
  [[ -d "$HOME/.nvm" ]] || curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  # shellcheck disable=SC1090
  source "$HOME/.nvm/nvm.sh"
  nvm install 22
  nvm use 22
else
  echo "[2/9] Node.js 22 已就绪"
fi
NODE_BIN="$(command -v node)"

echo "[3/9] 安装锁定依赖"
cd "$APP_DIR"
npm ci
(cd frontend-next && npm ci && npm run build)

echo "[4/9] 检查数据恢复状态"
mkdir -p "$APP_DIR/data" "$APP_DIR/public/uploads/orders"
if [[ ! -f "$APP_DIR/data/app.db" ]]; then
  echo "未发现 data/app.db。应用服务不会启动。请先按 docs/DEPLOYMENT_FULL_REPRO.md 校验并恢复私密数据包。"
  exit 2
fi

echo "[5/9] 安装应用服务"
tmp_service="$(mktemp)"
sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__APP_USER__|$APP_USER|g" -e "s|__NODE_BIN__|$NODE_BIN|g" deploy/systemd/packaging-system.service > "$tmp_service"
sudo install -m 0644 "$tmp_service" "/etc/systemd/system/$SERVICE_NAME"
rm -f "$tmp_service"

echo "[6/9] 安装 Nginx"
sudo install -m 0644 deploy/nginx/packaging-system.conf /etc/nginx/sites-available/packaging-system
sudo ln -sfn /etc/nginx/sites-available/packaging-system /etc/nginx/sites-enabled/packaging-system
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t

echo "[7/9] 可选安装定时备份"
if [[ "$INSTALL_BACKUP_TIMER" == "1" ]]; then
  sudo install -d -m 0700 -o "$APP_USER" -g "$APP_USER" "$BACKUP_DIR"
  for unit in runtime-backup.service runtime-backup.timer; do
    tmp_unit="$(mktemp)"
    sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__APP_USER__|$APP_USER|g" -e "s|__NODE_BIN__|$NODE_BIN|g" -e "s|__BACKUP_DIR__|$BACKUP_DIR|g" "deploy/systemd/$unit" > "$tmp_unit"
    sudo install -m 0644 "$tmp_unit" "/etc/systemd/system/$unit"
    rm -f "$tmp_unit"
  done
fi

echo "[8/9] 启动并检查"
sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE_NAME"
[[ "$INSTALL_BACKUP_TIMER" == "1" ]] && sudo systemctl enable --now runtime-backup.timer
sudo systemctl reload nginx
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1/health

echo "[9/9] 重建完成"
sudo systemctl status "$SERVICE_NAME" --no-pager -l | sed -n '1,30p'

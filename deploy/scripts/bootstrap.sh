#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
APP_USER="${APP_USER:-$(id -un)}"
SERVICE_NAME="packaging-system.service"
SYSTEMD_SRC="$APP_DIR/deploy/systemd/packaging-system.service"
NGINX_SRC="$APP_DIR/deploy/nginx/packaging-system.conf"

echo "[1/8] Install base packages..."
sudo apt-get update -y
sudo apt-get install -y curl git nginx

if ! command -v node >/dev/null 2>&1; then
  echo "[2/8] Node.js not found. Installing nvm + Node 22..."
  if [ ! -d "$HOME/.nvm" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  fi
  # shellcheck disable=SC1090
  source "$HOME/.nvm/nvm.sh"
  nvm install 22
  nvm use 22
else
  echo "[2/8] Node.js found: $(node -v)"
fi

cd "$APP_DIR"

if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  NODE_BIN="$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" | sort -V | tail -n1)/bin/node"
fi

echo "[3/8] Install npm deps..."
npm install

echo "[4/8] Ensure data dir exists..."
mkdir -p "$APP_DIR/data"
mkdir -p "$APP_DIR/public/uploads/orders"

echo "[5/8] Install systemd service..."
tmp_service="$(mktemp)"
sed \
  -e "s|__APP_DIR__|$APP_DIR|g" \
  -e "s|__APP_USER__|$APP_USER|g" \
  -e "s|__NODE_BIN__|$NODE_BIN|g" \
  "$SYSTEMD_SRC" > "$tmp_service"
sudo cp "$tmp_service" "/etc/systemd/system/$SERVICE_NAME"
rm -f "$tmp_service"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo "[6/8] Install nginx site config..."
sudo cp "$NGINX_SRC" /etc/nginx/sites-available/packaging-system
sudo ln -sf /etc/nginx/sites-available/packaging-system /etc/nginx/sites-enabled/packaging-system
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo "[7/8] Health checks..."
curl -fsS http://127.0.0.1:8080/health || (echo "Node health check failed" && exit 1)
curl -fsS http://127.0.0.1/health || (echo "Nginx health check failed" && exit 1)

echo "[8/8] Done. Service status:"
sudo systemctl status "$SERVICE_NAME" --no-pager -l | sed -n '1,30p'

echo "bootstrap complete"

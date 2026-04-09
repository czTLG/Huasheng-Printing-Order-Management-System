#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="packaging-system"
SERVICE_NAME="packaging-system.service"
BACKUP_DIR="${ROOT}/archives/dr-lite"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

now_ts(){ date +"%Y%m%d_%H%M%S"; }
log(){ echo "[dr-lite] $*"; }

usage(){
  cat <<EOF
轻量容灾脚本

用法：
  bash scripts/dr-lite.sh backup      # 生成轻量备份（代码关键目录+数据库）
  bash scripts/dr-lite.sh list        # 查看备份列表
  bash scripts/dr-lite.sh restore <包路径> [--restart]
  bash scripts/dr-lite.sh check       # 检查服务/数据库/最近备份状态

说明：
- 备份默认保留 ${RETENTION_DAYS} 天
- restore 只覆盖 data/ 与 public/、src/、package*.json（轻量恢复）
EOF
}

do_backup(){
  local ts out tmp
  ts="$(now_ts)"
  out="${BACKUP_DIR}/${APP_NAME}_dr_${ts}.tar.gz"
  tmp="$(mktemp -d)"

  log "开始备份 -> ${out}"

  mkdir -p "$tmp/payload"
  # 1) 拷贝关键目录
  for d in src public scripts docs; do
    [[ -d "$ROOT/$d" ]] && cp -a "$ROOT/$d" "$tmp/payload/"
  done
  for f in package.json package-lock.json; do
    [[ -f "$ROOT/$f" ]] && cp -a "$ROOT/$f" "$tmp/payload/"
  done

  mkdir -p "$tmp/payload/data"
  [[ -d "$ROOT/data/uploads" ]] && cp -a "$ROOT/data/uploads" "$tmp/payload/data/"
  [[ -f "$ROOT/data/product_prefill_map.json" ]] && cp -a "$ROOT/data/product_prefill_map.json" "$tmp/payload/data/"
  [[ -f "$ROOT/data/customer_bag_map.json" ]] && cp -a "$ROOT/data/customer_bag_map.json" "$tmp/payload/data/"

  # 2) 尝试热备份数据库（若 sqlite3 CLI 不可用就直接复制）
  if command -v sqlite3 >/dev/null 2>&1 && [[ -f "${ROOT}/data/app.db" ]]; then
    sqlite3 "${ROOT}/data/app.db" ".backup '${tmp}/payload/app.db'" || cp -f "${ROOT}/data/app.db" "${tmp}/payload/app.db"
  elif [[ -f "${ROOT}/data/app.db" ]]; then
    cp -f "${ROOT}/data/app.db" "${tmp}/payload/app.db"
  fi

  # 3) 元信息
  {
    echo "app=${APP_NAME}"
    echo "time=$(date -Iseconds)"
    echo "host=$(hostname)"
    echo "service=${SERVICE_NAME}"
    echo "node=$(node -v 2>/dev/null || echo n/a)"
    echo "cwd=${ROOT}"
  } > "${tmp}/payload/manifest.txt"

  # 4) 一次性打包
  tar -czf "$out" -C "$tmp/payload" .
  rm -rf "$tmp"

  # 5) 清理过期备份
  find "$BACKUP_DIR" -type f -name "${APP_NAME}_dr_*.tar.gz" -mtime +"$RETENTION_DAYS" -delete || true

  log "备份完成: ${out}"
}

do_list(){
  ls -lh "$BACKUP_DIR"/*.tar.gz 2>/dev/null || echo "暂无备份"
}

do_restore(){
  local pkg="${1:-}"
  local restart="${2:-}"
  [[ -n "$pkg" ]] || { echo "缺少备份包路径"; usage; exit 1; }
  [[ -f "$pkg" ]] || { echo "备份包不存在: $pkg"; exit 1; }

  log "准备恢复: $pkg"
  local bak="${BACKUP_DIR}/pre_restore_$(now_ts).tar.gz"
  log "先做恢复前快照: $bak"
  tar -czf "$bak" -C "$ROOT" data src public package.json package-lock.json 2>/dev/null || true

  local tmp
  tmp="$(mktemp -d)"
  tar -xzf "$pkg" -C "$tmp"

  # 仅覆盖轻量关键目录
  [[ -d "$tmp/src" ]] && rsync -a --delete "$tmp/src/" "$ROOT/src/"
  [[ -d "$tmp/public" ]] && rsync -a --delete "$tmp/public/" "$ROOT/public/"
  [[ -f "$tmp/package.json" ]] && cp -f "$tmp/package.json" "$ROOT/package.json"
  [[ -f "$tmp/package-lock.json" ]] && cp -f "$tmp/package-lock.json" "$ROOT/package-lock.json"
  [[ -f "$tmp/app.db" ]] && cp -f "$tmp/app.db" "$ROOT/data/app.db"

  rm -rf "$tmp"

  if [[ "$restart" == "--restart" ]]; then
    log "重启服务 ${SERVICE_NAME}"
    sudo systemctl restart "$SERVICE_NAME"
  fi

  log "恢复完成"
}

do_check(){
  echo "=== 服务状态 ==="
  systemctl is-active "$SERVICE_NAME" 2>/dev/null || true
  echo "=== 健康检查 ==="
  curl -s -o /dev/null -w "127.0.0.1:8080 -> %{http_code}\n" http://127.0.0.1:8080/health || true
  curl -s -o /dev/null -w "cahs.top -> %{http_code}\n" http://cahs.top/health || true
  echo "=== 数据库 ==="
  [[ -f "$ROOT/data/app.db" ]] && ls -lh "$ROOT/data/app.db" || echo "app.db 不存在"
  echo "=== 最近备份 ==="
  ls -lt "$BACKUP_DIR"/*.tar.gz 2>/dev/null | head -n 3 || echo "暂无备份"
}

cmd="${1:-}"
case "$cmd" in
  backup) do_backup ;;
  list) do_list ;;
  restore) do_restore "${2:-}" "${3:-}" ;;
  check) do_check ;;
  *) usage ;;
esac

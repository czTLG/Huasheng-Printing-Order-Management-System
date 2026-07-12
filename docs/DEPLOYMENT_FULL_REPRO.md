# 服务器迁移与完整重建手册

> 目标：仅凭私有 Git 仓库和经过验证的私密数据包，在 Ubuntu 22.04/24.04 新服务器上恢复订单、开单、成本快照、用户权限、客户资料、附件及网络服务。

## 1. 安全原则

1. Git 只保存代码、模板和文档；数据库、附件、真实 `.env` 和私密数据包禁止进入 Git。
2. 运行中的 SQLite 只能通过在线 Backup API 生成一致性快照，不能直接复制主库文件。
3. 清理之前先备份；第一阶段只审计，不删除任何数据。
4. 恢复之前先校验；不能覆盖正在被 Node 进程使用的数据库。
5. 旧服务器保留到新服务器完成业务验收和回滚观察期。

## 2. 变量约定

旧服务器和新服务器分别设置适合自己的值：

```bash
export APP_USER=admin
export APP_DIR=/home/admin/work/packaging-system
export REPO_URL=git@github.com:czTLG/Huasheng-Printing-Order-Management-System.git
export RELEASE_REF=feature/runtime-rebuild
export BACKUP_DIR=/var/lib/packaging-system-backups
export DOMAIN=example.com
```

`RELEASE_REF` 正式迁移时应改为经过验收的提交号或发布标签。域名未知时先用服务器 IP 做本地验收。

## 3. 两类迁移资产

### 3.1 私有 Git 仓库

仓库必须包含 `src/`、`frontend-next/`、`public/` 中的代码资源、`deploy/`、`scripts/`、依赖锁文件和本文档。

提交前检查不能包含私密数据：

```bash
cd "$APP_DIR"
git status --short
git ls-files | rg '(^|/)(app\.db|\.env)$|runtime-data-|private|secret'
```

### 3.2 私密数据包

数据包包含：

- SQLite 一致性快照；
- 订单图片和业务附件；
- `product_prefill_map.json`、`customer_bag_map.json`、`material_options.json`、`system_package_config.json`；
- `manifest.json`、`checksums.sha256` 和 `verification.json`。

私密数据包必须通过 SSH/SFTP、加密对象存储或离线加密介质传输，不能通过公开链接或 Git 提交传输。

## 4. 旧服务器迁移前审计

### 4.1 记录当前版本和数据库状态

```bash
cd "$APP_DIR"
git rev-parse HEAD
node -v
stat -c '%s %y %n' data/app.db
sha256sum data/app.db
systemctl is-active packaging-system.service
```

### 4.2 执行只读审计

审计目录必须放在项目目录之外：

```bash
AUDIT_DIR="$BACKUP_DIR/audit-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$AUDIT_DIR"
chmod 700 "$BACKUP_DIR" "$AUDIT_DIR"
cd "$APP_DIR"
npm run runtime:audit -- --db "$APP_DIR/data/app.db" --root "$APP_DIR" --out "$AUDIT_DIR"
```

检查 `runtime-audit.md` 和 `runtime-audit.json`。重复文件、孤立候选和疑似重复记录只进入人工评审清单，本流程不执行删除。

再次执行 `stat` 和 `sha256sum`，数据库大小、修改时间和哈希应与审计前一致。

## 5. 旧服务器生成原始恢复包

```bash
sudo install -d -m 0700 -o "$APP_USER" -g "$APP_USER" "$BACKUP_DIR"
cd "$APP_DIR"
npm run runtime:backup -- --db "$APP_DIR/data/app.db" --root "$APP_DIR" --out "$BACKUP_DIR"
LATEST_BUNDLE="$(find "$BACKUP_DIR" -maxdepth 1 -type d -name 'runtime-data-*' | sort | tail -1)"
npm run runtime:verify -- --bundle "$LATEST_BUNDLE"
```

正式备份应先生成或确认私密黄金基线，并把它一并装入数据包：

```bash
BASELINE_DIR="$BACKUP_DIR/private-baseline"
npm run baseline:generate-private -- --db "$APP_DIR/data/app.db" --out "$BASELINE_DIR"
GOLDEN_BASELINE_PATH="$BASELINE_DIR/private-golden-baseline.json"
npm run baseline:verify
npm run runtime:backup -- --db "$APP_DIR/data/app.db" --root "$APP_DIR" --out "$BACKUP_DIR" --baseline "$GOLDEN_BASELINE_PATH"
```

确认 `verification.json` 的状态为 `healthy` 后才允许传输。建议在传输前用组织批准的加密工具加密；密码或私钥必须通过另一条通道保存。

## 6. 新服务器基础准备

推荐配置为 2 核、4 GB 内存、充足独立磁盘。安全组和防火墙仅开放 SSH、80、443，禁止公开 8080。

```bash
sudo timedatectl set-timezone Asia/Shanghai
sudo apt-get update
sudo apt-get install -y git curl nginx ufw build-essential
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

创建普通应用用户并配置只允许密钥登录。不要使用 root 直接运行应用。

## 7. 克隆仓库和安装依赖

```bash
sudo install -d -m 0755 -o "$APP_USER" -g "$APP_USER" "$(dirname "$APP_DIR")"
git clone "$REPO_URL" "$APP_DIR"
cd "$APP_DIR"
git checkout "$RELEASE_REF"
git status --short
```

先不要运行 `bootstrap.sh`。它检测不到 `data/app.db` 时会以状态码 2 停止，避免误启动空生产库。

## 8. 传输和校验私密数据包

将数据包传到新服务器项目目录之外，例如 `$BACKUP_DIR/incoming/`。解密后设置：

```bash
sudo chown -R "$APP_USER:$APP_USER" "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
find "$BACKUP_DIR" -type f -exec chmod 600 {} \;
cd "$APP_DIR"
npm ci
npm run runtime:verify -- --bundle "$BACKUP_DIR/incoming/runtime-data-时间戳"
```

校验失败时立即停止，重新传输健康数据包，禁止手工跳过校验。

## 9. 安全恢复数据

首次安装时服务尚未运行，可以从健康数据包恢复。以下命令中的 `BUNDLE` 必须指向刚通过验证的数据包：

```bash
export BUNDLE="$BACKUP_DIR/incoming/runtime-data-时间戳"
sudo systemctl stop packaging-system.service 2>/dev/null || true
install -d -m 0700 "$APP_DIR/data"
install -m 0600 "$BUNDLE/database/app.db" "$APP_DIR/data/app.db"
cp -a "$BUNDLE/config/data/." "$APP_DIR/data/"
if [[ -d "$BUNDLE/files/public/uploads" ]]; then
  install -d -m 0700 "$APP_DIR/public/uploads"
  cp -a "$BUNDLE/files/public/uploads/." "$APP_DIR/public/uploads/"
fi
if [[ -d "$BUNDLE/files/data/uploads" ]]; then
  install -d -m 0700 "$APP_DIR/data/uploads"
  cp -a "$BUNDLE/files/data/uploads/." "$APP_DIR/data/uploads/"
fi
chmod 600 "$APP_DIR/data/app.db"
```

这段流程只适用于首次安装或已确认服务停止的恢复窗口。已有生产服务恢复时，必须先创建恢复前快照，再恢复到临时路径、校验并原子切换；不能对运行中的 `app.db` 执行覆盖。

## 10. 恢复环境变量

从密码管理器创建项目外部的私密环境文件，或使用 systemd 凭据机制。变量名参考 `.env.example`。不得把真实密码写入 `.env.example` 或提交 Git。

至少核对：

- `DB_PATH`；
- 邮箱账号和应用专用密码；
- 消息同步令牌；
- 其他生产环境密钥。

## 11. 自动构建和启动

```bash
cd "$APP_DIR"
APP_DIR="$APP_DIR" APP_USER="$APP_USER" BACKUP_DIR="$BACKUP_DIR" GOLDEN_BASELINE_PATH="$BACKUP_DIR/private-baseline/private-golden-baseline.json" INSTALL_BACKUP_TIMER=1 bash deploy/scripts/bootstrap.sh
```

脚本将执行锁定依赖安装、前端构建、systemd 模板渲染、Nginx 配置检查、应用启动和本机健康检查。

检查：

```bash
systemctl status packaging-system.service --no-pager -l
systemctl status runtime-backup.timer --no-pager
journalctl -u packaging-system.service -n 100 --no-pager
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1/health
```

## 12. DNS 和 HTTPS

迁移前至少24小时把域名 TTL 调整为300秒。新服务器本地验收通过后更新 A/AAAA 记录，再申请证书：

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN"
sudo certbot renew --dry-run
curl -fsS "https://$DOMAIN/health"
```

没有使用 `www` 子域名时，从命令中移除对应参数。证书成功后再按项目要求启用 `FORCE_HTTPS=1`。

## 13. 业务验收清单

上线前使用只读或可回滚方式逐项检查：

- 管理员和普通角色登录；
- 角色菜单及成本页面权限没有扩大；
- 订单总量、最近订单、工序状态和历史记录；
- 开单总量、最近开单、预览和导出；
- 成本快照数量、材料价格和历史结果；
- 用户、客户、询盘和消息数量；
- 订单图片及 CRM 附件可访问；
- PDF、Excel 等导出功能；
- `npm run verify:smoke` 和 `npm run baseline:verify`。

不要为了验收在正式库中创建无法清理的测试数据。

## 14. 最终切换

第一次预迁移验证完成后安排短暂停写窗口：

1. 通知用户停止写入旧服务器。
2. 停止旧应用服务或通过网关进入维护模式。
3. 在旧服务器生成并验证最终数据包。
4. 传输到新服务器并再次验证。
5. 停止新服务器应用，按第9节恢复最终包。
6. 启动新应用并重复技术及业务验收。
7. 切换 DNS，持续观察错误日志和关键接口。
8. 旧服务器保持停止写入和可回滚状态，不立即销毁。

## 15. 回滚

若新服务器验收失败：

1. 停止新服务器应用，避免产生两套写入数据。
2. 把 DNS 指回旧服务器。
3. 启动旧服务器应用。
4. 检查旧服务器健康状态和最新数据。
5. 保存新服务器日志和失败数据包用于分析。

若新服务器已经产生新业务数据，不能直接回切，必须先制定数据合并方案。

## 16. 自动备份与恢复演练

定时器默认每小时生成一致性快照：

```bash
systemctl list-timers runtime-backup.timer
sudo systemctl start runtime-backup.service
journalctl -u runtime-backup.service -n 100 --no-pager
```

长期策略建议：小时备份保留48小时、每日30天、每周12周、每月12个月，并保留至少一份加密异地副本。当前工具不会自动删除旧包；在正式增加保留清理前，必须确保新包验证健康且不会删除最后一份健康备份。

每月至少选择一个备份，在临时目录执行校验和恢复演练。演练不能覆盖生产 `data/app.db`。

## 17. 常见故障

- `SQLITE_CANTOPEN`：检查数据库父目录、文件所有者、权限和 `DB_PATH`。
- 校验和不一致：数据包损坏或被修改，重新传输，禁止强行恢复。
- Nginx 502：检查应用服务、8080监听和 `journalctl`。
- 前端未更新：确认 `frontend-next` 构建成功且输出目录正确。
- 附件404：查看审计报告中的缺失引用，并核对数据包 `files/`。
- HTTPS失败：检查 DNS 是否已指向新服务器、80/443是否开放。

## 18. 一页式快速重建清单

```bash
# 1. 定义变量
export APP_USER=admin APP_DIR=/home/admin/work/packaging-system
export REPO_URL=私有仓库地址 RELEASE_REF=已验收提交号
export BACKUP_DIR=/var/lib/packaging-system-backups DOMAIN=实际域名

# 2. 克隆仓库
git clone "$REPO_URL" "$APP_DIR"
cd "$APP_DIR" && git checkout "$RELEASE_REF" && npm ci

# 3. 传入私密数据包后验证
npm run runtime:verify -- --bundle "$BACKUP_DIR/incoming/runtime-data-时间戳"

# 4. 确认服务停止后，按第9节恢复数据库、附件和配置

# 5. 构建并启动
APP_DIR="$APP_DIR" APP_USER="$APP_USER" BACKUP_DIR="$BACKUP_DIR" INSTALL_BACKUP_TIMER=1 bash deploy/scripts/bootstrap.sh

# 6. 验收
npm run verify:smoke
npm run baseline:verify
curl -fsS http://127.0.0.1:8080/health

# 7. 配置 DNS 和 HTTPS，完成第13、14节业务验收后再切流量
```

快速清单不能替代首次迁移时的完整流程，尤其不能跳过旧服务器原始备份、私密数据包校验、停写窗口和回滚准备。

# 包装袋印刷厂管理系统（packaging-system）完整部署与可复现手册

> 目标：把当前线上可运行版本完整沉淀成可迁移文档，方便你推到私人仓库后，在任意新机器一键复现（应用 + 数据库 + Nginx + systemd + 回归验证）。

---

## 1. 项目地址（当前环境）

- **服务器公网地址**：`http://198.11.183.14/`
- **绑定域名**：`http://cahs.top/`
- **项目代码目录（服务器本地）**：`/home/admin/work/packaging-system`
- **服务监听端口（Node）**：`127.0.0.1:8080`
- **反向代理（Nginx）**：`80 -> 8080`
- **systemd 服务名**：`packaging-system.service`

---

## 2. 技术栈与运行结构

- Node.js + Express
- SQLite（better-sqlite3）
- 前端：`public/index.html` 单页应用
- 导出：CSV / XLS / DOC / PDF（pdfkit）
- 进程管理：systemd
- 网关：Nginx

关键目录：

```bash
/home/admin/work/packaging-system
├── src/                 # 后端
├── public/              # 前端静态资源
├── data/                # SQLite 数据文件目录（重点备份）
├── baseline/            # 核算基准样例
├── scripts/             # 回归脚本 verify-baseline.js
├── deploy/              # 部署相关文件（可补充）
└── docs/                # 文档（本文件）
```

---

## 3. 新机器部署前提

## 系统要求

- Ubuntu 22.04 LTS（建议）
- 2C2G 起步
- 开放 80 端口（如需 HTTPS 还要 443）

## 安装运行环境

```bash
sudo apt-get update -y
sudo apt-get install -y curl git nginx

# 安装 nvm（若未安装）
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc

# 安装 Node（建议与线上一致）
nvm install 22
nvm use 22
node -v
npm -v
```

---

## 4. 项目初始化（从你的私人仓库拉取）

```bash
# 示例：替换成你的仓库地址
git clone <YOUR_PRIVATE_REPO_URL> /home/admin/work/packaging-system
cd /home/admin/work/packaging-system
bash deploy/scripts/bootstrap.sh
```

> `bootstrap.sh` 会自动安装依赖、创建 `data/` 目录、渲染 systemd 服务文件并启用 Nginx 反向代理。

---

## 5. 数据库（SQLite）迁移与恢复

## 数据目录建议

- 统一放在：`/home/admin/work/packaging-system/data/`
- 至少备份：`data/*.db`（或你实际库名）

## 旧机器导出（在线热备份推荐）

```bash
# 示例：假设主库为 data/app.db
cd /home/admin/work/packaging-system
sqlite3 data/app.db ".backup '/home/admin/work/packaging-system/data/app.backup-$(date +%F-%H%M%S).db'"
```

## 新机器恢复

```bash
mkdir -p /home/admin/work/packaging-system/data
# 将备份文件上传到 data/ 后：
cp app.backup-YYYY-MM-DD-HHMMSS.db /home/admin/work/packaging-system/data/app.db
```

## 权限

```bash
sudo chown -R admin:admin /home/admin/work/packaging-system
chmod -R u+rwX /home/admin/work/packaging-system/data
```

---

## 6. systemd 部署（后台常驻 + 开机自启）

创建服务文件：`/etc/systemd/system/packaging-system.service`

```ini
[Unit]
Description=Packaging System Node Service
After=network.target

[Service]
Type=simple
User=admin
WorkingDirectory=/home/admin/work/packaging-system
Environment=PORT=8080
Environment=FORCE_HTTPS=0
ExecStart=/home/admin/.nvm/versions/node/v22.22.0/bin/node /home/admin/work/packaging-system/src/server.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

生效与启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable packaging-system.service
sudo systemctl restart packaging-system.service
sudo systemctl status packaging-system.service --no-pager -l
```

日志查看：

```bash
journalctl -u packaging-system.service -f
```

---

## 7. Nginx 反向代理

站点配置示例：`/etc/nginx/sites-available/packaging-system`

```nginx
server {
    listen 80;
    server_name cahs.top www.cahs.top _;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用：

```bash
sudo ln -sf /etc/nginx/sites-available/packaging-system /etc/nginx/sites-enabled/packaging-system
sudo nginx -t
sudo systemctl reload nginx
```

---

## 8. 健康检查与验收

```bash
# 应用本地
curl -sS http://127.0.0.1:8080/health

# Nginx 转发层
curl -sS http://127.0.0.1/health

# 公网
curl -sS http://198.11.183.14/health
```

页面验收建议：
- 登录
- 订单管理（新增、排序、工序推进）
- 成本核算（至少跑 1 个标准样例）
- 报价导出（客户版 / 内部版）

---

## 9. 回归与上线门禁（非常重要）

核心计算改动后必须跑：

```bash
cd /home/admin/work/packaging-system
npm run baseline:verify
```

期望：`PASS 10/10`（或你的最新基准总数）

前端模板字符串/DOM 改动后，务必做语法检查：

```bash
# 从 public/index.html 提取 script 后 node -c 检查（建议写成脚本）
```

并再次检查：
- `/health` 正常
- 手机端核心页面可操作（成本核算 / 统计分析 / 开单）

---

## 10. 给 Codex 的优化工作方式（建议）

你要让 Codex 持续优化订单管理，建议采用这个流程：

1. 在仓库根目录准备上下文文件：
   - `IDENTITY.md`
   - `AGENTS.md`
   - 本文档 `docs/DEPLOYMENT_FULL_REPRO.md`
2. 每次给 Codex 明确任务边界（例：只改订单页三段式布局，不动报价模块）
3. 每个 PR 必须包含：
   - 变更说明
   - 风险点
   - 回滚方式
   - 验证结果（`baseline:verify` + `/health`）
4. 先在测试机部署验证，再上生产

可直接给 Codex 的任务模板：

```text
目标：优化订单管理页（移动端优先）。
限制：不改成本核算公式，不改导出接口。
必须通过：npm run baseline:verify、/health 检查。
输出：改动文件列表、回滚步骤、测试截图清单。
```

---

## 11. 一键迁移清单（最小必带）

推到私人仓库时至少包含：

- `src/`
- `public/`
- `scripts/`
- `baseline/`
- `package.json` + `package-lock.json`
- `docs/DEPLOYMENT_FULL_REPRO.md`
- （可选）`deploy/` 下的 systemd/nginx 模板

不要入库：

- `node_modules/`
- 真实生产数据库（除非你刻意做脱敏样本）
- 私钥、token、敏感配置

---

## 12. 常用运维命令速查

```bash
# 服务
sudo systemctl restart packaging-system.service
sudo systemctl status packaging-system.service --no-pager -l
journalctl -u packaging-system.service -n 200 --no-pager

# Nginx
sudo nginx -t
sudo systemctl reload nginx

# 端口
ss -ltnp | grep -E ':80|:8080'

# 健康
curl -sS http://127.0.0.1:8080/health
curl -sS http://127.0.0.1/health
```

---

## 13. 版本化建议（你推私人仓库时）

建议新增：

- `deploy/systemd/packaging-system.service`
- `deploy/nginx/packaging-system.conf`
- `deploy/scripts/bootstrap.sh`（安装依赖 + 启动服务）
- `docs/CHANGELOG_DEPLOY.md`

这样你换新机器时，文档 + 配置 + 脚本三件套就齐了。

---

## 14. 当前线上配置基线（便于对照）

- systemd WorkingDirectory: `/home/admin/work/packaging-system`
- ExecStart: `/home/admin/.nvm/versions/node/v22.22.0/bin/node /home/admin/work/packaging-system/src/server.js`
- Node PORT: `8080`
- Nginx: `80 -> 127.0.0.1:8080`

---

如果你愿意，我下一步可以直接给你生成：

1. `deploy/systemd/packaging-system.service` 标准模板
2. `deploy/nginx/packaging-system.conf` 标准模板
3. `deploy/scripts/bootstrap.sh` 一键部署脚本

你推到私人仓库后，换机器基本就是：`clone -> bootstrap -> restore db -> done`。

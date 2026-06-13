# 华胜印刷订单管理系统

包装袋印刷厂生产订单流转、开单管理与成本核算平台。用于软包装（食品袋、日化袋、自动包装膜）的生产全流程数字化管理。

## 系统架构

```
nginx (:80) → Express (:8080) → SQLite (data/app.db)
                                  ↓
                  React SPA (public/new/) + 旧版 jQuery (public/legacy-app.html)
```

| 层 | 技术 | 说明 |
|---|---|---|
| 前端（新版） | React 18 + TypeScript + Vite 5 + Tailwind CSS | `frontend-next/` 构建输出到 `public/new/` |
| 前端（旧版） | jQuery + 原生 HTML/CSS | `public/legacy-app.html` 完整业务逻辑 |
| 后端 | Express.js (CommonJS) | `src/server.js` 入口，路由模块在 `src/routes/` |
| 数据库 | SQLite (better-sqlite3) | 单文件 `data/app.db`，通过 `DB_PATH` 环境变量指定 |

## 核心功能模块

- **订单管理** — 多步工序流转（印刷→复膜→制袋→…→完成），支持加急/回退
- **开单管理** — 生产作业单创建，含印刷/覆膜四层结构/制袋/装箱参数，导出 PDF/Excel，邮件发送
- **成本核算** — 9 种袋型核算引擎（八边封/自立拉链/三边封/自动包/材料重量等），报价对比，案例管理
- **生产看板** — 工序跟踪、产能统计、老板仪表盘
- **权限系统** — super_admin / manager / ai_sales / worker 四级角色，模块级权限控制
- **审计日志** — 全操作留痕

## 快速部署到新服务器

### 前置要求
- Ubuntu 20.04+ / Debian 12+
- Node.js 22+
- Nginx（可选，推荐用于生产）

### 步骤

```bash
# 1. 克隆仓库
git clone git@github.com:czTLG/Huasheng-Printing-Order-Management-System.git
cd Huasheng-Printing-Order-Management-System

# 2. 安装依赖
npm install

# 3. 构建前端
cd frontend-next && npm install && npm run build && cd ..

# 4. 恢复数据库（从备份）
mkdir -p data
xz -d app.db.xz && mv app.db data/
cp customer_bag_map.json data/
cp material_options.json data/
cp product_prefill_map.json data/
cp system_package_config.json data/

# 5. 启动服务
PORT=8080 node src/server.js
```

服务默认监听 `http://0.0.0.0:8080`，可通过 `PORT` 环境变量修改端口。

数据库路径通过 `DB_PATH` 环境变量指定，默认为 `./data/app.db`。

## 数据备份与恢复

### 备份
```bash
tar czf backup-$(date +%Y%m%d).tar.gz data/
```

### 恢复
```bash
tar xzf backup-YYYYMMDD.tar.gz
PORT=8080 DB_PATH=./data/app.db node src/server.js
```

数据库为单文件 SQLite，备份即复制文件，无需 `pg_dump` 或 `mysqldump`。

## 本地开发

```bash
cd frontend-next && npm run dev      # 前端开发服务器
cd .. && PORT=8080 node src/server.js  # 后端 API
```

## Nginx 配置参考

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## GitHub 仓库

https://github.com/czTLG/Huasheng-Printing-Order-Management-System

## 数据规模参考（截至 2026-06-13）

| 数据表 | 记录数 |
|---|---|
| 订单 (orders) | 10,050 |
| 工单 (work_orders) | 608 |
| 客户 (customers) | 251 |
| 成本快照 (cost_snapshots) | 814 |
| 审计日志 (audit_logs) | 5,166 |
| 用户 (users) | 12 |

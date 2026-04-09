# 80端口 + HTTPS 部署步骤（推荐 Nginx 反代）

> 目标：Node 服务继续跑 8080，外部统一走 80/443。

## 1) 安装 Nginx（Ubuntu）

```bash
sudo apt update
sudo apt install -y nginx
```

## 2) 启用站点配置

```bash
sudo cp /home/admin/work/packaging-system/deploy/nginx-packaging.conf /etc/nginx/sites-available/packaging-system
sudo ln -sf /etc/nginx/sites-available/packaging-system /etc/nginx/sites-enabled/packaging-system
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

## 3) 启动 Node 服务（8080）

```bash
cd /home/admin/work/packaging-system
PORT=8080 FORCE_HTTPS=0 nohup node src/server.js >/tmp/packaging-system.log 2>&1 &
```

## 4) 验证 80 端口

```bash
curl -I http://127.0.0.1
```

应返回 200 或 301，并由 Nginx 转发到 Node。

---

## HTTPS（可选但建议）

### 5) 申请证书（有域名时）

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your.domain.com
```

### 6) 强制 HTTPS

启动 Node 时打开：

```bash
PORT=8080 FORCE_HTTPS=1 nohup node src/server.js >/tmp/packaging-system.log 2>&1 &
```

并确保 Nginx 443 server 生效。

---

## 说明

- 当前环境普通用户无法直接绑定 80 端口（Linux 低端口权限限制）。
- 所以建议采用 Nginx 反代方案，稳定、可扩展、便于后续加 HTTPS。

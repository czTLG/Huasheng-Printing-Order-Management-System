# 包装袋印刷厂智能生产管理系统（演示版后端）

这是根据《包装袋印刷厂智能生产管理系统 - 开发对接文档（MD版）》实现的**第一阶段可运行版本**，用于快速验证核心业务流。

## 已实现模块

1. **角色权限（RBAC）**
   - super_admin：全权限
   - ai_sales：可生成报价、看客户版报价
   - worker：仅可推进自己负责工序的订单

2. **订单管理与工序流转**
   - 固定流程：印刷 → 复膜 → 制袋 → 发货 → 完成
   - 支持加急排序
   - 工人只能操作本人负责工序

3. **AI报价引擎（演示公式版）**
   - 自动包核算（参考 hess_calculation_formulas.txt）
   - 八边封核算（参考 babian_calculation_formulas.txt）
   - 材料重量核算（参考 clhs_calculation_formulas.txt）
   - 生成内部版/客户版双版本报价

4. **增量知识更新记录（演示版）**
   - 记录 sourceType/sourceId/changeType，模拟增量更新任务触发

5. **全操作留痕（审计日志）**
   - 下单、流转、报价、增量更新、日报任务都有日志

6. **每晚20:00生产日报任务（演示版）**
   - 目前写入审计日志，后续可接企业微信/Telegram/邮件

---

## 快速部署到新机器

```bash
git clone https://github.com/czTLG/packaging-system.git /home/admin/work/packaging-system
cd /home/admin/work/packaging-system
bash deploy/scripts/bootstrap.sh
```

默认结果：

- Node 服务监听 `127.0.0.1:8080`
- Nginx 对外暴露 `80`
- systemd 服务名：`packaging-system.service`

如果你需要恢复旧机器的数据，再把备份库放回 `data/app.db` 后重启服务即可。

完整迁移文档见 `docs/DEPLOYMENT_FULL_REPRO.md`。

## 本地运行

```bash
cd /home/admin/work/packaging-system
npm install
npm start
```

服务默认运行在 `http://localhost:8080`

## 鉴权方式（演示版）

通过 Header 模拟登录身份：

- `x-user-role`: `super_admin` | `ai_sales` | `worker`
- `x-user-name`: 用户名（工人流转校验会用到）

---

## API 示例

### 1) 创建订单（管理员）

```bash
curl -X POST http://localhost:8080/api/orders \
  -H 'Content-Type: application/json' \
  -H 'x-user-role: super_admin' \
  -H 'x-user-name: admin01' \
  -d '{
    "customerName":"A客户",
    "bagType":"八边封",
    "useCase":"食品",
    "size":{"length":20,"width":12,"bottom":5},
    "urgency":1,
    "assignedPrintWorker":"zhangsan",
    "assignedLaminationWorker":"lisi",
    "assignedBaggingWorker":"wangwu"
  }'
```

### 2) 推进工序（工人）

```bash
curl -X PATCH http://localhost:8080/api/orders/1/next \
  -H 'x-user-role: worker' \
  -H 'x-user-name: zhangsan'
```

### 3) 生成报价（管理员/商务）

```bash
curl -X POST http://localhost:8080/api/quotes/generate \
  -H 'Content-Type: application/json' \
  -H 'x-user-role: ai_sales' \
  -H 'x-user-name: sales01' \
  -d '{
    "orderId":1,
    "quoteType":"eight_side_seal",
    "input":{
      "ba_chang":20,
      "ba_kuang":12,
      "ba_di":5,
      "thick":[3,4,5,0],
      "price":[9500,12000,13500,0],
      "proportion":[0.92,1.02,1.12,0],
      "jgf":18,
      "zxyf":200,
      "sh":0.05,
      "lr":0.12,
      "ba_zdf":50
    }
  }'
```

### 4) 增量更新记录（管理员）

```bash
curl -X POST http://localhost:8080/api/system/knowledge/incremental-update \
  -H 'Content-Type: application/json' \
  -H 'x-user-role: super_admin' \
  -H 'x-user-name: admin01' \
  -d '{
    "sourceType":"order",
    "sourceId":"1",
    "changeType":"updated",
    "detail":"客户调整尺寸"
  }'
```

### 5) 查询审计日志（管理员）

```bash
curl http://localhost:8080/api/system/audit-logs \
  -H 'x-user-role: super_admin' \
  -H 'x-user-name: admin01'
```

---

## 下一阶段建议

- 接入 MySQL(RDS) + Redis + JWT 正式鉴权
- 增加前端（PC/手机响应式）
- 补齐 Excel/Word/PDF 实际导出
- 接入真实消息通道（Telegram/企业微信/邮件）
- 增加 OpenClaw + GPT 实际调用链（并做机密字段脱敏）
- 上线前补齐 HTTPS、字段级加密、备份恢复与演示/生产环境隔离

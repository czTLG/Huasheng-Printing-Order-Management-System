# 包装工厂管理系统接口规范

生成日期：2026-04-21  
运行架构：Express 静态前端 + REST API，旧版 SQLite 业务数据原样保留。  
鉴权：除 `/health`、`/api/auth/login`、`/api/auth/register` 外，接口需 `Authorization: Bearer <token>`。超级管理员可用 `x-view-as-role` 预览部分角色权限。

## 通用返回

成功通常返回：

```json
{ "ok": true, "id": 1 }
```

列表通常返回：

```json
{ "rows": [], "meta": { "page": 1, "pageSize": 20, "total": 0, "totalPages": 1 } }
```

失败通常返回：

```json
{ "error": "错误说明" }
```

## 权限模块

`super_admin` 可访问全部管理接口；`manager` 可访问订单、开单、成本、统计、看板；`ai_sales` 可访问报价、开单、部分订单详情；工人角色只能访问本人负责工序和授权看板内容。前端菜单由 `/api/auth/me` 返回的 `permissions` 与角色共同控制。

## 接口清单

| 模块 | 方法 | 地址 | 入参字段 | 返回 JSON 结构 |
| --- | --- | --- | --- | --- |
| 健康检查 | GET | `/health` | 无 | `{ ok, service }` |
| 登录注册 | POST | `/api/auth/register` | body: `username,password,fullName` | `{ ok, id, status }` |
| 登录注册 | POST | `/api/auth/login` | body: `username,password` | `{ ok, token, user }` |
| 登录注册 | GET | `/api/auth/me` | header token | `{ user }` |
| 登录注册 | POST | `/api/auth/change-password` | body: `oldPassword,newPassword` | `{ ok }` |
| 权限管理 | GET | `/api/auth/users/pending` | 无 | `{ rows:[user] }` |
| 权限管理 | POST | `/api/auth/users/:id/approve` | path: `id`; body: `role,permissions` | `{ ok }` |
| 权限管理 | GET | `/api/auth/users` | 无 | `{ rows:[user] }` |
| 权限管理 | POST | `/api/auth/users/:id/permissions` | path: `id`; body: `role,status,permissions` | `{ ok }` |
| 权限管理 | DELETE | `/api/auth/users/:id` | path: `id` | `{ ok }` |
| 权限管理 | GET | `/api/auth/dashboard/today` | 无 | `{ users, orders, workOrders, logs }` |
| 权限管理 | GET | `/api/auth/users/activity` | query: `date,page,pageSize` | `{ rows, meta }` |
| 权限管理 | GET | `/api/auth/users/:username/activity` | path: `username`; query: `date` | `{ rows }` |
| 权限管理 | GET | `/api/auth/users/activity/export` | query: `date` | `{ rows }` 或下载内容 |
| 订单 | POST | `/api/orders` | body: `customerName,bagType,useCase,size,urgency,assignedPrintWorker,assignedLaminationWorker,assignedBaggingWorker,assignedShippingWorker,orderQty,orderSpec` | `{ ok, id }` |
| 订单 | GET | `/api/orders` | query: `status,q,updatedFrom,page,pageSize,sortBy,sortOrder` | `{ rows:[order], meta }` |
| 订单统计 | GET | `/api/orders/stats/capacity` | query: `range,start,end` | `{ rows, summary }` |
| 订单统计 | GET | `/api/orders/stats/boss-dashboard` | query: `range,start,end,salesperson` | `{ summary, stageStats, urgentRows, materialTop }` |
| 订单统计 | GET | `/api/orders/stats/production-report` | query: `range,start,end` | `{ rows, summary }` |
| 订单统计 | GET | `/api/orders/stats/film-usage` | query: `range,start,end,salesperson` | `{ rows, summary }` |
| 订单 | PATCH | `/api/orders/:id` | path: `id`; body: `customerName,bagType,useCase,urgency` | `{ ok }` |
| 订单 | PATCH | `/api/orders/:id/full` | path: `id`; body: `customer_name,bag_type,use_case,order_qty,order_spec,status,urgency,assigned_*` | `{ ok }` |
| 订单流程 | PATCH | `/api/orders/:id/processing` | path: `id` | `{ ok, status }` |
| 订单流程 | PATCH | `/api/orders/:id/next` | path: `id`; body: `source,qty,unit` | `{ ok, from, to, completionLogId }` |
| 订单流程 | POST | `/api/orders/:id/rollback-last-complete` | path: `id`; body: `reason` | `{ ok, orderId, stage, from, to, rollbackLogId, rolledBackLogId, original }` |
| 订单流程 | GET | `/api/orders/:id/stage-logs` | path: `id` | `{ rows:[stageLog] }` |
| 看板 | GET | `/api/orders/board/panel` | query: `stage,q,roller,timeRange` | `{ rows, summary, meta }` |
| 看板 | GET | `/api/orders/board/summary` | query: `range` | `{ rows, summary }` |
| 订单订阅 | GET | `/api/orders/subscriptions/mine` | 无 | `{ rows:[{order_id,created_at}] }` |
| 订单订阅 | POST | `/api/orders/:id/subscribe` | path: `id` | `{ ok }` |
| 订单订阅 | DELETE | `/api/orders/:id/subscribe` | path: `id` | `{ ok }` |
| 订单 | POST | `/api/orders/:id/priority` | path: `id`; body: `priority` | `{ ok, id, priority }` |
| 订单图片 | POST | `/api/orders/:id/image` | path: `id`; body: `imageUrl` 或 `imageDataUrl` | `{ ok, imageUrl, thumbUrl }` |
| 订单图片 | DELETE | `/api/orders/:id/image` | path: `id` | `{ ok, removed }` |
| 订单 | GET | `/api/orders/:id/detail` | path: `id` | `order + size_json + work_order_summary + operation_logs` |
| 订单 | PATCH | `/api/orders/:id/work-order-full` | path: `id`; body: 开单完整字段 | `{ ok, workOrderId }` |
| 订单 | DELETE | `/api/orders/:id` | path: `id` | `{ ok }` |
| AI 报价 | GET | `/api/quotes/mine` | 无 | `{ rows:[quote] }` |
| AI 报价 | POST | `/api/quotes/chat` | body: `message` | `{ reply, parsed }` |
| AI 报价 | POST | `/api/quotes/generate` | body: `orderId,quoteType,input` | `{ ok, quoteId, internal, customer }` |
| AI 报价 | POST | `/api/quotes/generate-multi` | body: `baseInput,quantities,materialFactors` | `{ ok, rows }` |
| AI 报价 | GET | `/api/quotes/:id/detail` | path: `id` | `{ quote, order }` |
| AI 报价 | GET | `/api/quotes/:id` | path: `id` | `quote` |
| 报价单 | POST | `/api/quote-sheets` | body: `orderId,customerName,productName,bagType,specs,input,calc,quantity,unitPrice,amount,cost,profitRate,notes` | `{ ok, id }` |
| 报价单 | GET | `/api/quote-sheets` | query: `type,date` | `{ rows }` |
| 报价单 | GET | `/api/quote-sheets/:id` | path: `id` | `quoteSheet` |
| 导出 | GET | `/api/export/quote-sheet/:id.csv` | path: `id` | 文件流 |
| 导出 | GET | `/api/export/quote-sheet/:id.xls` | path: `id` | 文件流 |
| 导出 | GET | `/api/export/quote-sheet/:id.doc` | path: `id` | 文件流 |
| 导出 | GET | `/api/export/quote-sheet/:id.pdf` | path: `id` | 文件流 |
| 开单 | GET | `/api/work-orders/meta` | 无 | `{ salespersons, customers, bagPrefillDict, materialOptions }` |
| 开单 | POST | `/api/work-orders/material-options` | body: `names` | `{ ok, names }` |
| 开单 | POST | `/api/work-orders/material-options/delete` | body: `name` | `{ ok, names }` |
| 开单 | GET | `/api/work-orders/product-options` | query: `salespersonId,customerId,q` | `{ rows }` |
| 开单 | GET | `/api/work-orders/last-print-qty` | query: `customerName,productName,spec` | `{ printQty, workNo }` |
| 开单 | GET | `/api/work-orders/product-search` | query: `q,mode` | `{ rows, keywords }` |
| 开单 | GET | `/api/work-orders` | query: `q,page,pageSize,salespersonId,customerId` | `{ rows, meta }` |
| 开单草稿 | GET | `/api/work-orders/preview-drafts` | query: `page,pageSize` | `{ rows, meta }` |
| 开单草稿 | GET | `/api/work-orders/preview-drafts/:id` | path: `id` | `draft` |
| 开单草稿 | DELETE | `/api/work-orders/preview-drafts/:id` | path: `id` | `{ ok }` |
| 客户档案 | POST | `/api/work-orders/customers` | body: `salespersonId,name,contact,phone,default*` | `{ ok, id }` |
| 客户档案 | PATCH | `/api/work-orders/customers/:id` | path: `id`; body: 客户字段 | `{ ok }` |
| 开单 | POST | `/api/work-orders` | body: `salespersonId,customerId,customerName,productName,bagType,spec,quantity,deliveryDate,roller,remark,processRequirements,syncToOrder,emailTo,emailCc` | `{ ok, id, workNo, orderId }` |
| 开单邮件 | POST | `/api/work-orders/:id/send-email` | path: `id`; body: `to,cc` | `{ ok, emailStatus }` |
| 开单导出 | GET | `/api/work-orders/:id/preview.xls` | path: `id` | 文件流 |
| 开单导出 | GET | `/api/work-orders/:id/export.wps.xls` | path: `id` | 文件流 |
| 开单导出 | GET | `/api/work-orders/:id/export.xls` | path: `id` | 文件流 |
| 开单导出 | POST | `/api/work-orders/preview.pdf` | body: 开单字段 | 文件流 |
| 开单导出 | GET | `/api/work-orders/:id/export.pdf` | path: `id` | 文件流 |
| 成本 | GET | `/api/cost/material-prices` | 无 | `{ rows:[{code,prop,price}] }` |
| 成本 | POST | `/api/cost/material-prices` | body: `code,prop,price` | `{ ok }` |
| 成本快照 | GET | `/api/cost/snapshots` | query: `kind` | `{ rows }` |
| 成本快照 | POST | `/api/cost/snapshots` | body: `kind,name,costType,input,result` | `{ ok, id }` |
| 成本快照 | PATCH | `/api/cost/snapshots/:id` | path: `id`; body: `name,input,result` | `{ ok }` |
| 成本快照 | DELETE | `/api/cost/snapshots/:id` | path: `id` | `{ ok }` |
| 成本导出 | POST | `/api/cost/export.xls` | body: 成本计算输入与结果 | 文件流 |
| 成本邮件 | GET | `/api/cost/email-logs` | query: `page,pageSize` | `{ rows, meta }` |
| 成本邮件 | POST | `/api/cost/email-logs/:id/retry` | path: `id` | `{ ok }` |
| 成本邮件 | POST | `/api/cost/send-email` | body: `to,cc,costType,payload` | `{ ok, logId }` |
| 成本导出 | POST | `/api/cost/export.pdf` | body: 成本计算输入与结果 | 文件流 |
| 成本计算 | POST | `/api/cost/calculate` | body: `costType,fields` | `{ ok, result, trace }` |
| 系统 | POST | `/api/system/knowledge/incremental-update` | body: `sourceType,sourceId,changeType,detail` | `{ ok, id }` |
| 系统 | GET | `/api/system/audit-logs` | query: `limit` | `{ rows }` |
| 系统 | GET | `/api/system/slow-apis` | 无 | `{ rows }` |
| 系统 | POST | `/api/system/slow-apis/reset` | 无 | `{ ok }` |
| 系统打包 | GET | `/api/system/package/config` | 无 | `{ config }` |
| 系统打包 | POST | `/api/system/package/config` | body: `enabled,cron,to,cc` | `{ ok, config }` |
| 系统打包 | POST | `/api/system/package/build` | body: `scope` | `{ ok, file, size }` |
| 系统打包 | POST | `/api/system/package/send` | body: `to,cc,file` | `{ ok }` |
| 菜单 | GET | `/api/menu/items` | 无 | `{ rows }` |
| 菜单 | POST | `/api/menu/items` | body: `name,type` | `{ ok, id }` |
| 菜单 | POST | `/api/menu/items/:id/disable` | path: `id` | `{ ok }` |
| 菜单 | POST | `/api/menu/items/:id/enable` | path: `id` | `{ ok }` |
| 菜单 | DELETE | `/api/menu/items/:id` | path: `id` | `{ ok }` |
| 股票 | GET | `/api/stocks/results` | query: `date` | `{ day, rows }` |
| 股票 | POST | `/api/stocks/run` | body: `date` | `{ ok, day, rows, sourceUsed, warning }` |
| 股票 | POST | `/api/stocks/send-mail` | body: `date` | `{ ok, sent }` |
| 股票自选 | GET | `/api/stocks/watchlist` | 无 | `{ rows }` |
| 股票自选 | POST | `/api/stocks/watchlist/add` | body: `code,name` | `{ ok }` |
| 股票自选 | POST | `/api/stocks/watchlist/remove` | body: `code` | `{ ok }` |
| 股票自选 | POST | `/api/stocks/watchlist/pin` | body: `code,pinned` | `{ ok }` |
| 股票自选 | POST | `/api/stocks/watchlist/import` | body: `rows` | `{ ok, count }` |
| 股票自选 | POST | `/api/stocks/watchlist/run` | body: `date` | `{ ok, rows }` |
| 股票自选 | GET | `/api/stocks/watchlist/analysis` | query: `date` | `{ day, rows }` |
| 股票源 | GET | `/api/stocks/sources/status` | 无 | `{ rows, updatedAt }` |
| 股票源 | GET | `/api/stocks/sources/eastmoney-health` | 无 | `{ ok, latencyMs, source }` |
| 股票源 | POST | `/api/stocks/sources/probe-eastmoney` | 无 | `{ ok, results }` |
| 期货 | GET | `/api/futures/framework` | 无 | `{ markdown }` |
| 期货 | GET | `/api/futures/positions/latest` | 无 | `{ positions, updatedAt }` |
| 期货 | GET | `/api/futures/ranking/latest` | 无 | `{ rows, updatedAt }` |
| 期货 | POST | `/api/futures/ranking/run` | body: `date` | `{ ok, rows, outputFile }` |
| 期货 | POST | `/api/futures/report/run` | body: `date` | `{ ok, report }` |

## 关键对象结构

`order`：

```json
{
  "id": 1001,
  "customer_name": "华北食品",
  "customer_name_display": "华北食品",
  "bag_type": "自立拉链袋",
  "use_case": "零食包装",
  "order_qty": "20000",
  "order_spec": "180*260+40mm",
  "status": "印刷",
  "urgency": 1,
  "priority": 100,
  "assigned_print_worker": "1号印刷机",
  "assigned_lamination_worker": "1号覆膜机",
  "assigned_bagging_worker": "wangwu",
  "assigned_shipping_worker": "zhaoliu",
  "processing_started_at": null,
  "processing_stage": null,
  "created_at": "2026-04-21 09:00:00",
  "updated_at": "2026-04-21 09:10:00",
  "buttonState": {
    "canStartProcessing": true,
    "canAdvance": true,
    "canRollback": false,
    "canUploadImage": true,
    "canDelete": true
  }
}
```

`stageLog`：

```json
{
  "id": 1,
  "stage": "印刷",
  "source": "1号印刷机",
  "qty": 5000,
  "unit": "米",
  "event_type": "COMPLETE",
  "rolled_back": 0,
  "rollback_of_log_id": 0,
  "rollback_reason": "",
  "operated_by": "worker01",
  "created_at": "2026-04-21 10:00:00"
}
```

Mock 数据包见 [`mocks/mock-data.json`](../mocks/mock-data.json)。

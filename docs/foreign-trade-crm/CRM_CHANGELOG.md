# Huasheng Foreign Trade CRM Changelog

## Entry Template

### YYYY-MM-DD HH:mm - Phase X - 标题

* Operator:
* Branch:
* Commit:
* Scope:
* Files changed:
* Database changes:
* Permission changes:
* API changes:
* Frontend changes:
* Build result:
* Test result:
* Smoke test result:
* Risks:
* Decisions:
* Next step:

---

## 2026-06-24 - Pre-CRM Baseline Cleaned

* Operator: Claude/Codex
* Branch: main
* Commit: df5ddfd
* Scope:
  * 清理 CRM 开发前 git 工作区
  * 提交 23 个已修改文件
  * 提交有效未跟踪代码和文档
  * 排除临时文件
* Gitignore added:
  * backup/
  * data/*.db.xz
  * .playwright-mcp/
  * page-screenshot.png
* Build result:
  * npm run build: PASS
* Smoke test result:
  * node scripts/smoke-test.js: SMOKE PASS
* Git status:
  * clean
* GitHub:
  * pushed
* Risks:
  * 后续 CRM 开发必须从 clean baseline 开始
  * 不允许直接在 main 上开发
* Decisions:
  * CRM 开发使用 feature/foreign-trade-crm 分支
  * Phase 0 只读审查，不修改代码
* Next step:
  * 将 Phase 0 审查结果写入 CRM_CONTEXT.md
  * 然后进入 Phase 1 权限与菜单基础

---

## 2026-06-24 - Phase 0 - Current System Review Completed

* Operator: Claude/Codex
* Branch: feature/foreign-trade-crm
* Commit: df5ddfd
* Scope:
  * 只读审查当前订单系统
  * 审查技术栈、数据库、权限系统、订单模块、成本核算模块、前后端结构、风险点、P0 建议
* Key findings:
  * React + Vite + Express + SQLite
  * 无 react-router，activeTab 切换
  * 权限有菜单/API，但无字段级权限
  * 已有 customers 表，需要兼容扩展
  * 成本模块缺少 inquiry/specification 关联
  * cost_snapshots 不是正式版本化成本单
  * audit() 可复用
* Decisions:
  * P0 从权限与菜单基础开始
  * 先做 foreign_trade_crm_admin
  * 不重写成本核算
  * 不做网站询盘/SEO/产品图/报价底线
* Next step:
  * 等确认后进入 Phase 1.1：权限模型扩展

---

## 2026-06-24 - Phase 1-3 Foundation - CRM permissions, customers, communications and inquiries

* Operator: Codex
* Branch: feature/foreign-trade-crm
* Commit: f476943
* Scope:
  * 实现 CRM Phase 1 权限与菜单基础
  * 实现 CRM Phase 2 客户与沟通记录基础
  * 实现 CRM Phase 3 询盘与规格版本基础
  * 接入基础 audit log
  * 增加 smoke test 覆盖 CRM 权限、CRUD、规格版本和材料层
* Files changed:
  * shared/permissions-model.json
  * src/db.js
  * src/middleware/auth.js
  * src/routes/auth.js
  * src/routes/crm.js
  * src/server.js
  * frontend-next/src/App.tsx
  * frontend-next/src/components/Admin.tsx
  * frontend-next/src/lib/mockService.ts
  * frontend-next/src/components/crm/CrmCustomers.tsx
  * frontend-next/src/components/crm/CrmCustomerDetail.tsx
  * frontend-next/src/components/crm/CrmInquiries.tsx
  * frontend-next/src/components/crm/CrmInquiryDetail.tsx
  * frontend-next/src/components/crm/CrmAuditLogs.tsx
  * scripts/smoke-test.js
  * docs/foreign-trade-crm/CRM_CONTEXT.md
  * docs/foreign-trade-crm/CRM_CHANGELOG.md
* Database changes:
  * customers table safely extended through PRAGMA table_info checks
  * Added communication_logs table
  * Added inquiries table
  * Added inquiry_specifications table
  * Added specification_layers table
  * Added CRM indexes for customer, communication, inquiry, specification, and layer lookups
* Permission changes:
  * Added crm module key
  * Added foreign_trade_crm_admin role
  * super_admin and foreign_trade_crm_admin can access full CRM API
  * manager, ai_sales, worker, worker_print, worker_film, worker_bag, worker_ship, and default have crm=false
  * CRM activeTab render path checks visibleModules.includes('crm')
  * Unauthorized CRM API access returns 403 through allowRoles()
* API changes:
  * GET /api/crm/customers
  * POST /api/crm/customers
  * GET /api/crm/customers/:id
  * PATCH /api/crm/customers/:id
  * GET /api/crm/customers/:id/communications
  * POST /api/crm/customers/:id/communications
  * GET /api/crm/inquiries
  * POST /api/crm/inquiries
  * GET /api/crm/inquiries/:id
  * PATCH /api/crm/inquiries/:id
  * GET /api/crm/inquiries/:id/specifications
  * POST /api/crm/inquiries/:id/specifications
  * GET /api/crm/specifications/:id
  * POST /api/crm/specifications/:id/layers
  * GET /api/crm/audit-logs
* Frontend changes:
  * Added CRM 客户, CRM 询盘, CRM 日志 menu entries
  * Added CRM customer list/detail pages
  * Added communication timeline and manual communication creation
  * Added inquiry list/detail pages
  * Added specification version creation and material layer creation
  * Added CRM audit log page
  * Added CRM API methods to mockService
* Build result:
  * Root npm run build: FAILED because root package.json has no build script
  * frontend-next npm run build: PASS
* Test result:
  * frontend-next npm run lint: PASS
* Smoke test result:
  * node scripts/smoke-test.js: SMOKE PASS
* Risks:
  * costing_user field-level filtering is deferred because costing_user API access is not implemented in Phase 1-3
  * Root build command mismatch should be kept visible in future verification notes
* Decisions:
  * Do not implement costing_requests in this round
  * Do not modify Cost.tsx or 9 bag-type costing formulas
  * Keep all CRM frontend navigation inside App.tsx activeTab mode
  * Reuse audit() and store field-level changes in detail JSON
* Next step:
  * Phase 4: costing request association, without rewriting cost calculation formulas

---

## 2026-06-24 - Phase 4 - Costing Request Integration

* Operator: Codex
* Branch: feature/foreign-trade-crm
* Commit: pending
* Scope:
  * 实现 CRM 询盘到成本核算请求的桥接
  * 新增 costing_requests 和 cost_sheet_lines
  * 扩展 cost_snapshots CRM 关联字段
  * 新增 costing_user 受限 API 访问
  * 新增成本核算请求列表、详情、状态流转、预填数据与复制摘要
  * 保持 Cost.tsx 和 9 种袋型核心公式不变
* Files changed:
  * shared/permissions-model.json
  * src/db.js
  * src/middleware/auth.js
  * src/routes/crm.js
  * src/routes/cost.js
  * frontend-next/src/App.tsx
  * frontend-next/src/components/Admin.tsx
  * frontend-next/src/lib/mockService.ts
  * frontend-next/src/components/crm/CrmInquiryDetail.tsx
  * frontend-next/src/components/crm/CrmCostingRequests.tsx
  * frontend-next/src/components/crm/CrmCostingRequestDetail.tsx
  * scripts/smoke-test.js
  * docs/foreign-trade-crm/CRM_CONTEXT.md
  * docs/foreign-trade-crm/CRM_CHANGELOG.md
* Database changes:
  * Added costing_requests table
  * Added cost_sheet_lines table
  * Extended cost_snapshots with customer_id, inquiry_id, specification_id, costing_request_id, version_no, is_current, crm_quote_status, crm_notes
  * Added indexes for costing request assignment, inquiry lookup, cost sheet lines, and CRM-linked cost snapshots
* Permission changes:
  * Added costing_user role
  * costing_user has crm=false and cost=true
  * costing_user can access only assigned /api/crm/costing-requests and costing-prefill data
  * costing_user responses hide email, WhatsApp, raw_content, and communication timeline
  * full CRM APIs remain limited to super_admin and foreign_trade_crm_admin
* API changes:
  * POST /api/crm/inquiries/:id/costing-requests
  * GET /api/crm/costing-requests
  * GET /api/crm/costing-requests/:id
  * PATCH /api/crm/costing-requests/:id
  * GET /api/crm/inquiries/:id/costing-prefill
  * POST /api/cost/snapshots accepts optional CRM association fields without changing old payload compatibility
* Frontend changes:
  * Added CRM 核价 menu entry for full CRM users
  * Added CrmCostingRequests page
  * Added CrmCostingRequestDetail page
  * Added cost request creation section to CrmInquiryDetail
  * Added copyable costing summary as the safe Cost.tsx handoff path
* Build result:
  * frontend-next npm run build: PASS
* Test result:
  * frontend-next npm run lint: PASS
* Smoke test result:
  * node scripts/smoke-test.js: SMOKE PASS
* Risks:
  * costing_user has assigned-request API access but no dedicated frontend menu because crm=false
  * Cost.tsx is not prefilled directly; copyable summary is the Phase 4 transition strategy
* Decisions:
  * Do not rewrite Cost.tsx
  * Do not modify the 9 bag-type calculation formulas
  * Keep cost_snapshots and add optional CRM link fields only
  * Defer formal cost_sheets abstraction
* Next step:
  * Phase 5: logistics, clearance, and miscellaneous charge records

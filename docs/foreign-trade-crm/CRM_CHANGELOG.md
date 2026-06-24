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


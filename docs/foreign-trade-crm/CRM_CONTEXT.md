# Huasheng Foreign Trade CRM Context

## 1. Current Branch and Architecture

* Branch: `feature/foreign-trade-crm`
* Stack:
  * Frontend: React 18 + TypeScript + Vite 5 + Tailwind CSS
  * Backend: Express.js CommonJS
  * Database: SQLite / better-sqlite3 / `data/app.db`
  * Auth: JWT + bcryptjs
  * Routing: no `react-router`; frontend uses `App.tsx` activeTab switching
  * Backend entry: `src/server.js`
  * DB init: `src/db.js initDb()`

CRM is a single workbench focused on external-trade customer management, email understanding, inquiry/specification tracking, costing/freight preparation, and pre-quotation readiness.

## 2. System Boundaries

CRM is not a quotation engine, not a website-inquiry system, and not an order rewrite layer.

Allowed CRM-owned domains:

* customers
* communications
* inquiries
* specifications
* costing requests
* freight quotes
* email sync and AI analysis
* import suggestions
* research notes
* CRM audit logs
* quote readiness scoring

Order/production systems remain separate:

* `orders`
* `work_orders`
* `order_stage_logs`
* `quote_sheets`
* `material_prices`
* production worker flows

Boundary principle:

* CRM may read order summaries only when explicitly needed.
* CRM must not become a write path into order or production tables.
* Any bridge into cost/order data must stay nullable, backward compatible, and read-first.

## 3. Roles and Permissions

Current important roles:

* `super_admin`
* `foreign_trade_crm_admin`
* `costing_user`
* `freight_user`
* `ai_sales`
* `worker`
* `worker_print`
* `worker_film`
* `worker_bag`
* `worker_ship`

CRM access:

* `super_admin` and `foreign_trade_crm_admin` can access the full CRM workbench.
* `costing_user` can access only assigned costing requests and related safe summaries.
* `freight_user` can access only assigned freight quotes and related safe summaries.
* `ai_sales` and worker roles do not get full CRM access.
* Sensitive fields like customer email, WhatsApp, and raw email content are hidden for restricted roles.

Frontend module control:

* Single top-level CRM entry: `外贸 CRM`
* CRM internal tabs are controlled inside `CrmModule`

## 4. Database Tables

Current CRM tables:

* `customers`
* `communication_logs`
* `inquiries`
* `inquiry_specifications`
* `specification_layers`
* `costing_requests`
* `cost_sheet_lines`
* `freight_quotes`
* `email_messages`
* `email_sync_runs`
* `email_ai_analysis_runs`
* `crm_import_suggestions`
* `customer_research_notes`

Important CRM read/derived fields:

* customer stage and follow-up fields
* quote readiness fields on `inquiries`
* email conversation fields such as `conversation_key`
* AI candidate hint fields on quote readiness responses

DB rules:

* `CREATE TABLE IF NOT EXISTS` only for new tables
* `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` only for field expansion
* no destructive migration
* no rename/drop of legacy tables or columns

## 5. Core APIs

CRM API surface:

* customers: list, create, detail, update
* communications: list/create under customer
* inquiries: list, create, detail, update
* inquiry specifications: list, create version, detail
* specification layers: create
* quote readiness: get/recalculate
* costing requests: list/detail/update/create from inquiry
* freight quotes: list/detail/update/create from inquiry
* email sync/status/messages/parse/thread APIs
* AI analysis runs and import suggestion APIs
* customer research notes APIs
* customer priority API
* CRM dashboard API

All CRM write APIs require CRM-safe permission checks and audit log recording.

## 6. Frontend CRM Modules

Current CRM modules:

* `CrmModule`
* `CrmDashboard`
* `CrmCustomers`
* `CrmCustomerDetail`
* `CrmCustomerPriority`
* `CrmInquiries`
* `CrmInquiryDetail`
* `CrmCostingRequests`
* `CrmFreightQuotes`
* `CrmEmailImport`
* `CrmAuditLogs`
* `CrmQuoteReadinessCard`

Navigation:

* Top-level menu remains a single `外贸 CRM`
* Internal tabs are used for workbench sections

## 7. Email + AI Pipeline

Email pipeline now includes:

* IMAP sync for `INBOX` and `Sent`/sent-folder variants
* `email_messages` storage
* `email_sync_runs` task history
* `conversation_key` threading
* noise / business relevance hints
* `email_ai_analysis_runs` for Codex CLI thread analysis
* prompt and output files under `data/email-ai-prompts/` and `data/email-ai-outputs/`
* `crm_import_suggestions` as pending review/import items
* controlled preview/apply flow

Important rule:

* Rules-based parsing is only a first-pass hint layer.
* AI/Codex thread analysis is the higher-value extraction layer.
* Nothing auto-overwrites `customers`, `inquiries`, or `specifications`.
* Suggestions stay pending until a human explicitly applies them.

## 8. Quote Readiness

The quote-readiness evaluator reads `inquiry + latest specification` and classifies records into:

* `ready`
* `partial`
* `blocked`
* `technical_check`
* `boss_check`
* `need_customer_info`

Persisted fields on `inquiries`:

* `quote_readiness_status`
* `quote_readiness_score`
* `quote_readiness_color`
* `quote_missing_fields_json`
* `quote_readiness_warnings_json`
* `quote_next_action`
* `quote_readiness_updated_at`

AI candidate hints:

* Pending specification suggestions can surface candidate fields.
* Candidate hints do not change formal readiness status.
* Candidate hints only guide human review.

High-barrier dry-food packaging rule:

* ALOX / high-barrier / barrier-film language by itself should not be treated as sterilization / retort / frozen technical risk.
* If the inquiry only suggests a high-barrier dry-food structure, the readiness result may stay yellow/partial with a next action to confirm final barrier structure, MOQ, and quotation scope.
* Only explicit hard-process keywords such as retort, sterilization, 121°C, boiling, microwave, frozen, high temperature, or pressure cooking should force a technical-check style warning.

## 9. Costing / Freight Boundary

Costing integration:

* `costing_requests` carries CRM inquiry/specification context into the cost process.
* `cost_sheet_lines` exists as a bridge table.
* `cost_snapshots` has CRM linkage fields added in an append-only way.
* CRM does not rewrite `Cost.tsx` or the 9 bag-type calculators.

Freight integration:

* `freight_quotes` stores multiple versions per inquiry.
* One selected quote may mark others `is_current = 0`.
* CRM stores fees as text fields to avoid currency-format breakage.

## 10. Order System Boundary

Order system boundary is documented in:

* `docs/foreign-trade-crm/CRM_ORDER_SYSTEM_BOUNDARY.md`

Core order tables that must remain isolated:

* `orders`
* `work_orders`
* `order_stage_logs`
* `quote_sheets`
* `material_prices`
* `users`
* `audit_logs`

Rules:

* CRM is append-only on schema changes.
* CRM must not create destructive migrations.
* CRM must not alter order status flow or production flow.
* CRM roles do not gain order delete rights through CRM code.

## 11. Safety Rules

Never:

* print or store mailbox passwords in docs
* submit `.env`
* auto-send email
* delete/move/mark-read remote mail
* auto-apply import suggestions
* auto-create formal quotations
* auto-overwrite customer master data
* modify order core logic or cost formulas

Always:

* record key CRM writes in audit logs
* keep unreadable fields hidden for scoped roles
* keep migrations append-only
* keep CRM failures from breaking orders

## 12. Current Known Real Customers

These are the two most important real-world CRM examples currently used for manual review:

* `ENGLISH BISCUIT MANUFACTURERS (PVT) LTD` / `Safeer` / Pakistan / roll film
* `BM Enterprise` / `Shawkat` / Bangladesh / oats pouch

Use these for sanity checks on inquiry, specification, quote-readiness, and pending AI suggestion review.

## 13. Current Next Priorities

Recommended near-term work:

1. Keep cleaning and applying only clearly correct pending suggestions.
2. Tighten quote-readiness review with AI candidate hints.
3. Improve follow-up task quality in the dashboard.
4. Keep CRM and order systems isolated.
5. Delay formal quotation Phase 6 until the current CRM data flow is stable.

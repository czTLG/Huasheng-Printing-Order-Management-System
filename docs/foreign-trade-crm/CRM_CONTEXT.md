# Huasheng Foreign Trade CRM Context

## 1. Project Purpose

This module adds a foreign trade customer communication and quotation management module inside the existing Huasheng order management system.

The goal is not a generic CRM, not a website inquiry system, and not an SEO/content system. The goal is to clearly display and safely aggregate the full foreign trade workflow from customer communication records to inquiries, specifications, costing, freight and clearance charges, quotation versions, weekly reporting, and eventual order conversion.

The CRM is not centered on employees manually filling forms. The CRM is centered on customer profile visibility, customer priority sorting, latest inquiry/specification visibility, costing and freight linkage, and later quotation visibility. Structured data may be written by users directly or by user-triggered AI/Codex parsing workflows, but the system itself does not automatically research or overwrite customer data.

Core workflow:

Customer
-> Communication Log
-> Inquiry
-> Specification Version
-> Costing Request
-> Cost Sheet
-> Freight / Clearance Charges
-> Quotation Version
-> Order

## 2. Strict Scope

This project only covers:

* Customer profiles
* Customer research notes
* Customer communication records
* Inquiry/project records
* Specification versions
* Material layer records
* Costing requests
* Cost sheet association
* Cost line items
* Freight, forwarder, clearance, and miscellaneous fee records
* Quotation versions
* Change logs
* Weekly report synchronization
* Later AI Inbox / email organization
* Later order conversion

## 3. Explicitly Out of Scope

Do not build:

* Website inquiry module
* Product image management
* Platform profile/material management
* SEO
* Blog content assets
* Quotation floor price / pricing policy module
* Feishu / Airtable / Notion / n8n integrations
* Alibaba International Station materials
* Product images / media asset library
* Automatic email sending
* Automatic quotation
* Automatic delivery lead time commitments
* Automatic compliance commitments

## 4. Current Baseline

* Branch before CRM: main
* CRM branch: feature/foreign-trade-crm
* Latest clean baseline commit: df5ddfd
* Build: PASS
* Smoke test: PASS
* GitHub: pushed
* Git status before CRM implementation: clean

## 5. Phase 0 Findings

### Tech Stack

* React 18 + TypeScript + Vite 5 + Tailwind CSS
* Express.js CommonJS
* SQLite / better-sqlite3
* JWT auth
* No react-router
* App.tsx activeTab switching
* src/server.js backend entry
* src/db.js initDb() schema initialization

### Existing Core Tables

Current core tables include:

* orders
* work_orders
* customers
* salespersons
* cost_snapshots
* audit_logs
* users
* order_stage_logs
* material_prices
* quote_sheets

The system currently has 20 tables in total.

### Existing Permission System

Current roles:

* super_admin
* manager
* ai_sales
* worker
* worker_print
* worker_film
* worker_bag
* worker_ship
* default fallback

Current permission mechanisms:

* Menu permission: App.tsx visibleNavItems
* API permission: src/middleware/auth.js allowRoles()
* Field-level permission: currently does not exist
* URL route permission: currently does not exist because the frontend has no react-router

### Existing Order Module

* orders table already has production fields including customer_name, bag_type, order_spec, order_qty, size_json, and status.
* Missing foreign trade workflow links: inquiry_id, quotation_id, specification_id, and cost_sheet_id.
* Later order conversion must extend the order module with minimal intrusion. Do not rewrite the existing order module.

### Existing Cost Module

* The cost module already has 9 bag-type calculators.
* cost_snapshots are snapshots, not formal versioned cost sheets.
* Missing customer_id, inquiry_id, and specification_id associations.
* Missing cost_sheet_lines.
* COST_USERS is a hard-coded allowlist and must be migrated cautiously if replaced by role permissions later.
* Do not break existing costing logic.

### Existing Audit Log

* audit_logs table already exists.
* audit() function already exists.
* Need to evaluate whether audit logging should be extended to field-level change logs.
* All key CRM write operations must write audit logs.

## 6. Required Permission Role

Required new role:

foreign_trade_crm_admin

Chinese meaning:

外贸客户管理负责人

Permission requirements:

* Only super_admin and foreign_trade_crm_admin can see the full "Foreign Trade Customer Management" module.
* Normal users cannot see the menu.
* Normal users cannot access CRM pages.
* Normal users cannot access CRM APIs.
* Unauthorized access must return 403.
* costing_user can only see assigned costing requests.
* costing_user must not see customer email, WhatsApp, or original raw customer communication content by default.
* freight_user can only see assigned freight and clearance charges.
* production_user can only see production information after order conversion.
* All permission changes must write audit logs.

Four permission layers must be implemented:

1. Menu permission
2. Page activeTab permission
3. Backend API permission
4. Data field permission

## 7. Role Plan

Recommended roles:

* super_admin
* foreign_trade_crm_admin
* costing_user
* freight_user
* production_user
* viewer / normal_user

Important: the existing system role is super_admin, not admin. CRM permissions must use super_admin and must not mistakenly use admin.

## 8. Core Business Requirements

1. The system must clearly show the latest order/inquiry raised by each customer.
2. Every inquiry/order specification must be fully recorded.
3. Every specification change must create a new version.
4. Costing must be bound to customer, inquiry, and specification.
5. When the boss/father reviews costing, the system must automatically bring in customer specifications, material layers, thickness, and quantity.
6. The boss/father can modify materials, thickness, profit, and fees, then generate an EXW quotation.
7. Forwarder quotation, clearance fee, port miscellaneous charges, and local charges must be entered item by item.
8. Quotations must be versioned. Old quotations must not be overwritten.
9. Any key modification must write an audit log.
10. Weekly reports must be sent/synchronized to designated people according to permissions.
11. AI only organizes and suggests. Final confirmation must be done by a human.

## 9. P0 Scope

P0 includes only:

1. foreign_trade_crm_admin role - implemented in Phase 1-3 foundation
2. CRM menu permission - implemented in Phase 1-3 foundation
3. CRM activeTab page permission - implemented in Phase 1-3 foundation
4. CRM API permission - implemented in Phase 1-3 foundation
5. customers table extension or compatibility strategy - implemented in Phase 1-3 foundation
6. communication_logs table - implemented in Phase 1-3 foundation
7. inquiries table - implemented in Phase 1-3 foundation
8. inquiry_specifications table - implemented in Phase 1-3 foundation
9. specification_layers table - implemented in Phase 1-3 foundation
10. costing_requests table - implemented in Phase 4
11. cost_sheets or cost_snapshots compatibility strategy
12. cost_sheet_lines table - implemented in Phase 4 as reserved line table
13. audit_logs reuse/enhancement - audit() reused for CRM write operations in Phase 1-3 foundation
14. Customer list page - implemented in Phase 1-3 foundation
15. Customer detail page - implemented in Phase 1-3 foundation
16. Inquiry list page - implemented in Phase 1-3 foundation
17. Inquiry detail page - implemented in Phase 1-3 foundation
18. Start costing request button
19. Costing request detail
20. Basic change log view - implemented in Phase 1-3 foundation

P0 does not include:

* IMAP email synchronization
* Real AI Inbox
* Automatic email sending
* Automatic weekly report sending
* Complete quotation export
* Order conversion
* Website inquiry
* Product images
* SEO
* Quotation floor price
* Content assets

## 10. Planned Phases

Phase 0: read-only review of the current system

Phase 1: permission and menu foundation

Phase 2: customers and communication records

Phase 3: inquiries and specification versions

Phase 4: costing integration

Phase 5: freight, clearance, and miscellaneous fee records

Phase 6: quotation versions

Phase 7: AI Inbox and email organization

Phase 8: Audit Log change history

Phase 9: Weekly Reports synchronization

Phase 10: order conversion

## 11. P0 Database Strategy

The project uses SQLite and currently has no standalone migration framework. Schema initialization and incremental changes are handled in src/db.js initDb() with CREATE TABLE and PRAGMA table_info plus ALTER TABLE ADD COLUMN checks.

Database rules:

* New tables should be created in src/db.js initDb().
* Existing table extensions must check PRAGMA table_info before ALTER TABLE ADD COLUMN.
* Do not break the existing data/app.db.
* Do not rename or delete old fields.
* The customers table already exists. Prefer compatible extension and do not blindly create a conflicting table.
* cost_sheets may not currently exist. In P0, first confirm whether to create cost_sheets or extend/associate cost_snapshots.

P0 tables:

* communication_logs - implemented
* inquiries - implemented
* inquiry_specifications - implemented
* specification_layers - implemented
* costing_requests - implemented
* cost_sheet_lines - implemented
* audit_logs reuse or enhancement - audit() reused; field-level values are stored in detail JSON for Phase 1-3

Existing tables that may need extension:

* customers
* orders
* cost_snapshots / cost_sheets - cost_snapshots extended with CRM association fields in Phase 4; formal cost_sheets still deferred

## 12. API Strategy

Suggested CRM APIs:

* GET /api/crm/customers - implemented
* POST /api/crm/customers - implemented
* GET /api/crm/customers/:id - implemented
* PATCH /api/crm/customers/:id - implemented
* GET /api/crm/customers/:id/communications - implemented
* POST /api/crm/customers/:id/communications - implemented
* GET /api/crm/inquiries - implemented
* POST /api/crm/inquiries - implemented
* GET /api/crm/inquiries/:id - implemented
* PATCH /api/crm/inquiries/:id - implemented
* POST /api/crm/inquiries/:id/specifications - implemented
* GET /api/crm/inquiries/:id/specifications - implemented
* POST /api/crm/inquiries/:id/costing-requests - implemented
* GET /api/crm/costing-requests - implemented
* GET /api/crm/costing-requests/:id - implemented
* PATCH /api/crm/costing-requests/:id - implemented
* GET /api/crm/inquiries/:id/costing-prefill - implemented
* POST /api/crm/inquiries/:id/freight-quotes - implemented in Phase 5
* GET /api/crm/freight-quotes - implemented in Phase 5
* GET /api/crm/freight-quotes/:id - implemented in Phase 5
* PATCH /api/crm/freight-quotes/:id - implemented in Phase 5
* GET /api/crm/inquiries/:id/freight-quotes - implemented in Phase 5
* GET /api/crm/inquiries/:id/freight-prefill - implemented in Phase 5
* GET /api/crm/specifications/:id - implemented
* POST /api/crm/specifications/:id/layers - implemented
* GET /api/crm/customers/:id/research-notes - implemented in CRM IA update
* POST /api/crm/customers/:id/research-notes - implemented in CRM IA update
* PATCH /api/crm/customers/:id/research-notes/:noteId - implemented in CRM IA update
* GET /api/crm/customer-priority - implemented in CRM IA update
* GET /api/crm/audit-logs - implemented

API requirements:

* All CRM APIs must pass through permission middleware.
* super_admin and foreign_trade_crm_admin can access the full CRM API.
* costing_user can only access assigned costing_request APIs.
* Unauthorized access returns 403.
* All write operations write audit logs.

## 13. Frontend Strategy

* The current frontend has no react-router and uses App.tsx activeTab.
* CRM top-level navigation should stay as one module entry in App.tsx: `crm`.
* CRM internal navigation should be handled inside a dedicated component such as `CrmModule.tsx` with local tab state.
* App.tsx must still check visibleModules.includes('crm') before rendering the CRM module.
* Unauthorized access must show Forbidden.
* New component directory: frontend-next/src/components/crm/

Suggested components:

* CrmCustomers.tsx - implemented
* CrmCustomerDetail.tsx - implemented
* CrmInquiries.tsx - implemented
* CrmInquiryDetail.tsx - implemented
* CrmCostingRequests.tsx - implemented in Phase 4
* CrmCostingRequestDetail.tsx - implemented in Phase 4
* CrmFreightQuotes.tsx - implemented in Phase 5
* CrmFreightQuoteDetail.tsx - implemented in Phase 5
* CrmAuditLogs.tsx - implemented
* CrmModule.tsx - implemented in CRM IA update
* CrmCustomerPriority.tsx - implemented in CRM IA update
* CrmCustomerResearchNotes.tsx - implemented in CRM IA update

## 14. Permission Implementation Strategy

* Add crm module key to shared/permissions-model.json.
* Update frontend-next/src/lib/permissions.ts if synchronization is needed.
* Add foreign_trade_crm_admin to the role list in src/routes/auth.js.
* Add foreign_trade_crm_admin to role selection in Admin.tsx.
* Reuse the existing allowRoles() capability in src/middleware/auth.js.
* Protect full CRM APIs in src/routes/crm.js with allowRoles('super_admin', 'foreign_trade_crm_admin').
* costing_user APIs need separate allowRoles handling plus assigned_to data filtering.
* Field-level permissions must be handled at the API response layer by hiding email, whatsapp, and raw_content.

Phase 4 implementation note: src/routes/crm.js protects full CRM APIs with super_admin and foreign_trade_crm_admin. costing_user can access only assigned costing request APIs and costing-prefill data. costing_user cannot access the full customer or inquiry CRM APIs and does not receive customer email, WhatsApp, raw communication content, or full communication timeline.

Phase 5 implementation note: freight_user has crm=false and can access only assigned freight quote APIs by assigned_to_user_id or assigned_to username. freight_user cannot access full CRM customer/inquiry APIs and does not receive customer email, WhatsApp, raw communication content, or full communication timeline.

## 15. Costing Integration Strategy

* Do not rewrite the core costing logic.
* First pass CRM inquiry/specification data to costing through costing_requests.
* Costing requests should automatically include:
  * customer_id
  * inquiry_id
  * specification_id
  * product_type
  * bag_type / film_type
  * material_structure_text
  * specification_layers
  * quantity
  * thickness
* The boss/father can continue costing based on existing Cost.tsx logic.
* Later phases can consider upgrading cost_snapshots into formal cost_sheets.
* P0 must connect conservatively and must not rewrite the 9 bag-type calculators in Cost.tsx.

## 16. Audit Log Strategy

* Reuse the existing audit() function.
* If current audit_logs fields are insufficient, put field_name, old_value, and new_value into detail JSON first.
* Do not break the audit() function signature.
* All CRM write operations must call audit().
* Permission changes must be audited.
* Specification versions, material layers, costing requests, and customer information changes must be audited.

## 17. Hard Problems / Risk Register

1. Existing customers table may conflict with CRM customer requirements.
   * Strategy: prefer compatible extension and do not create a conflicting same-name table.
2. No field-level permission exists.
   * Strategy: in P0, filter sensitive fields at the API response layer.
3. No react-router exists.
   * Strategy: use activeTab plus renderContent permission checks and avoid a major routing refactor.
4. The costing module is complex.
   * Strategy: P0 only adds association and data prefill. Do not rewrite costing calculations.
5. cost_snapshots are not formal versioned cost sheets.
   * Strategy: document a compatibility plan in P0 and abstract cost_sheets in a later phase.
6. COST_USERS is hard-coded.
   * Strategy: do not rush a refactor in P0. Add a costing_user compatibility layer first, then replace later.
7. SQLite has no migration framework.
   * Strategy: all DDL must go through safe checks in initDb() to avoid breaking data/app.db.
8. Permissions must be enforced by the backend.
   * Strategy: do not rely only on hidden menus. APIs must return 403 for unauthorized access.
9. audit log may not be field-level enough.
   * Strategy: first record old/new values in detail JSON, then upgrade table structure later if needed.
10. CRM scope can easily expand.
    * Strategy: CRM_CONTEXT.md explicitly defines out-of-scope items. Do not build website inquiries, SEO, product images, or quotation floor price modules.
11. AI research automation can easily become a hidden auto-write workflow.
    * Strategy: do not implement nightly research jobs, auto crawling, or auto overwrite. Use customer_research_notes as display/storage only, and keep writes user-triggered.

## 18. Development Rules

1. Each Phase must be committed separately.
2. After each Phase, build, tests, and smoke test must be run.
3. Do not make large all-at-once changes.
4. Do not rewrite the existing order system.
5. Do not break existing costing functionality.
6. Database changes must be clear and reviewable.
7. New APIs must include permission checks.
8. Key write operations must write audit logs.
9. After each completion, update CRM_CONTEXT.md and CRM_CHANGELOG.md.
10. If actual code differs from this documentation, report the difference first and do not continue directly.

## 19. Phase 1-3 Foundation Implementation Status

Implemented on 2026-06-24:

* foreign_trade_crm_admin role and crm module key.
* CRM menu entries: CRM 客户, CRM 询盘, CRM 日志.
* activeTab permission checks for all CRM pages.
* src/routes/crm.js mounted at /api/crm.
* Full CRM API access limited to super_admin and foreign_trade_crm_admin.
* customers compatibility columns added with PRAGMA table_info checks.
* communication_logs, inquiries, inquiry_specifications, and specification_layers tables.
* Customer list/detail, communication timeline, inquiry list/detail, specification version creation, and material layer creation.
* Basic CRM audit log view and audit() calls for CRM write operations.

Still deferred:

* costing_requests and costing_user scoped access.
* cost_sheet_lines and formal cost_sheets abstraction.
* freight_user, production_user, freight/clearance records, quotation versions, weekly reports, AI Inbox, IMAP, and order conversion.

New implementation risk:

* Root package.json has no npm run build script. Frontend build must currently be run from frontend-next with npm run build.

## 20. Phase 4 Costing Request Integration Status

Implemented on 2026-06-24:

* costing_requests table with generated CR-YYYYMMDD-0001 style codes.
* cost_sheet_lines table reserved for future line-level cost sheet detail.
* cost_snapshots extended with customer_id, inquiry_id, specification_id, costing_request_id, version_no, is_current, crm_quote_status, and crm_notes.
* POST /api/crm/inquiries/:id/costing-requests creates requests from the current inquiry specification and updates inquiry costing status.
* GET /api/crm/costing-requests, GET /api/crm/costing-requests/:id, PATCH /api/crm/costing-requests/:id.
* GET /api/crm/inquiries/:id/costing-prefill returns safe costing input data.
* costing_user role added with crm=false and cost=true in permissions model.
* costing_user can only see assigned costing requests by assigned_to_user_id or assigned_to username.
* costing_user response filtering hides customer email, WhatsApp, raw_content, and communication timeline.
* CrmCostingRequests and CrmCostingRequestDetail frontend pages.
* CrmInquiryDetail can create costing requests and copy a costing input summary.
* Existing Cost.tsx and 9 bag-type formulas were not changed.

Costing handoff strategy:

* Phase 4 does not push data directly into Cost.tsx.
* The costing request detail page shows specification, material layers, quantity, destination, trade term, and request note.
* A copyable costing summary is provided as the safe transition path for the boss/father to use with the existing Cost.tsx workflow.
* cost_snapshots can now store optional CRM link fields when a costing result is saved with crm metadata, but the old snapshot save flow remains compatible.

Still deferred:

* Deep Cost.tsx prefill or state/query integration.
* Formal versioned cost_sheets model.
* Quotation versioning, freight/clearance charges, weekly reports, AI Inbox, IMAP, and order conversion.

New implementation risk:

* costing_user has API access to assigned costing requests but no dedicated frontend menu because crm module remains false by design. A later dedicated costing queue entry may be needed if costing_user should use the React UI directly.

## 21. Phase 5 Freight and Clearance Charge Records Status

Implemented on 2026-06-24:

* freight_quotes table with generated FQ-YYYYMMDD-0001 style codes.
* freight_user role added with crm=false and no full CRM menu access.
* POST /api/crm/inquiries/:id/freight-quotes creates freight/clearance charge records tied to inquiry_id and customer_id.
* GET /api/crm/freight-quotes, GET /api/crm/freight-quotes/:id, PATCH /api/crm/freight-quotes/:id.
* GET /api/crm/inquiries/:id/freight-quotes returns all freight quotes for an inquiry.
* GET /api/crm/inquiries/:id/freight-prefill returns destination, quantity, product, package, and trade term seed data.
* CrmFreightQuotes and CrmFreightQuoteDetail frontend pages.
* CrmInquiryDetail can create freight quotes and display existing logistics/clearance charges.

freight_quotes fee model:

* Fee fields are stored as TEXT to preserve mixed currencies, remarks, and freight-forwarder formatting.
* total_freight_cost is preserved when manually provided.
* If total_freight_cost is empty, the backend attempts to sum parseable numeric fee fields.
* Sum failures do not block saving.
* Currency conversion is deferred to quotation phases.

freight_user permission rules:

* freight_user can only access assigned freight quotes.
* Assignment is checked by assigned_to_user_id or assigned_to username.
* freight_user responses hide customer email, WhatsApp, raw_content, and communication timeline.
* freight_user does not receive crm=true and has no full CRM menu by default.

selected / is_current rules:

* Each inquiry can have multiple freight_quotes.
* When a quote is updated to status=selected, that quote is set is_current=1.
* Other freight_quotes for the same inquiry are set is_current=0.
* When a quote is updated to status=expired, that quote is set is_current=0.

Still deferred:

* Quotation versions and quotation_lines.
* Currency conversion and formal quotation rollup.
* Dedicated freight_user frontend queue entry.
* AI Inbox, IMAP, weekly reports, and order conversion.

New implementation risk:

* freight_user assigned API access exists, but React navigation is still hidden because freight_user has crm=false. A later dedicated logistics queue may be needed.

## 22. CRM IA Update and Customer Profile Display Strategy

Implemented on 2026-06-24:

* CRM top-level navigation is unified into one `外贸 CRM` entry instead of multiple first-level CRM menus.
* `CrmModule.tsx` manages internal CRM tabs: customer profiles, inquiries, costing requests, freight charges, customer priority, and CRM audit logs.
* `customers` was extended with profile-display fields including website, customer_type, industry, main_product, business_background, company_size_note, buyer_authenticity_note, source_notes, customer_summary, and priority_reason.
* `customer_research_notes` was added as the only research-storage table in this phase.
* Research notes store user-provided or user-triggered AI/Codex parsed structured content. They do not imply any automatic research job.
* `GET/POST/PATCH /api/crm/customers/:id/research-notes` and `GET /api/crm/customer-priority` were added for CRM admin roles.
* `CrmCustomerDetail.tsx` was repositioned as a customer profile page with overview, latest inquiry/specification, latest costing/freight status, research notes, communication summary, and audit logs.
* `CrmCustomerPriority.tsx` provides grouped A/B/C/D visibility with pending costing and pending freight signals.

Customer research notes strategy:

* The system does not run nightly customer research jobs.
* The system does not auto crawl websites or auto write customer data.
* Users may ask AI/Codex to parse emails, chats, or manual research, then deliberately write the result into `customer_research_notes`.
* Core customer fields in `customers` remain editable and auditable, but research notes preserve the source-level trace.

Customer profile display strategy:

* Customer list pages should emphasize sorting, filtering, latest inquiry, pending costing, pending freight, next action, and last update.
* Customer detail pages should emphasize profile visibility first and forms second.
* Empty profile fields should be displayed quietly without turning the page into a noisy data-entry surface.
* raw_content remains sensitive and should continue to be restricted to full CRM roles only.

Tooltip strategy:

* Trade-term tooltip/glossary remains a valid later requirement.
* Keep it lightweight: a frontend glossary map first, optional database storage later.
* Do not implement tooltip database work in this phase.

## 23. Phase 7 IMAP Email Import and Suggestion Pipeline

Implemented on 2026-06-24:

* Added read-only IMAP sync support for Aliyun enterprise mailbox configuration via environment variables only.
* Added `email_sync_runs`, `email_messages`, and `crm_import_suggestions`.
* Email sync is manual-trigger only. No cron job, no automatic crawling, and no automatic write-back to customer master data.
* Sync stores message metadata, text/html body, cleaned text, header JSON, and attachment metadata only. Attachment binaries are not persisted.
* Email parsing currently uses a rule-based parser to generate pending CRM suggestions.
* Suggestions are stored separately and must be reviewed. They do not automatically update `customers`, `inquiries`, or `specifications`.
* `CrmModule.tsx` now includes an internal `邮件导入` tab for CRM administrators.

IMAP environment variables:

* `ALIYUN_MAIL_IMAP_HOST`
* `ALIYUN_MAIL_IMAP_PORT`
* `ALIYUN_MAIL_IMAP_SECURE`
* `ALIYUN_MAIL_USER`
* `ALIYUN_MAIL_PASSWORD`
* `ALIYUN_MAIL_SYNC_DAYS`
* `ALIYUN_MAIL_SYNC_LIMIT`

Default guidance:

* `ALIYUN_MAIL_IMAP_HOST=imap.qiye.aliyun.com`
* `ALIYUN_MAIL_IMAP_PORT=993`
* `ALIYUN_MAIL_IMAP_SECURE=true`
* `ALIYUN_MAIL_SYNC_DAYS=90`
* `ALIYUN_MAIL_SYNC_LIMIT=200`

Security rules:

* Use only the third-party client app password, not the web login password.
* Never hardcode mailbox credentials.
* Never commit `.env`.
* Do not send mail in this phase.
* Do not delete, move, mark seen, or tag remote messages.
* Do not auto overwrite official customer profile data from parsed mail.

Email data strategy:

* `email_sync_runs` records each manual sync attempt.
* `email_messages` stores deduplicated message content and metadata.
* `crm_import_suggestions` stores extracted customer-profile, communication, inquiry, specification, research-note, or follow-up suggestions.
* `message_id` is used as the primary uniqueness key when present; otherwise `mailbox + folder + message_uid` is used.

Email parsing strategy:

* First version is rule-based and intentionally conservative.
* Extract sender identity, domain, possible customer match, product keywords, quantity keywords, destination hints, and trade-term hints.
* Store only the suggestion payload and summary in `crm_import_suggestions`.
* Human review is required before any later write into formal CRM entities.

User-to-Codex structured import flow:

* A user may later send Codex raw customer notes, emails, or research text.
* Codex should first read `CRM_CONTEXT.md` and `CRM_CHANGELOG.md`.
* Codex should convert the content into structured JSON and write it to `crm_import_suggestions` with `status=pending`.
* Only when the user explicitly confirms formal import should Codex update `customers`, `inquiries`, `specifications`, or `customer_research_notes`.
* Any confirmed write must still use audit logs and avoid silently overwriting important fields.

Permission rules:

* IMAP sync, email messages, and import suggestions are restricted to `super_admin` and `foreign_trade_crm_admin`.
* `costing_user`, `freight_user`, `ai_sales`, and `worker*` roles must not access these APIs.
* Raw email text/html/body content remains sensitive and should not be exposed outside full CRM roles.

New implementation risks:

* IMAP sync depends on external mailbox configuration and third-party credentials, so smoke tests validate permission and missing-config behavior only.
* Rule-based parsing is intentionally incomplete and should remain separate from future LLM-assisted parsing.

## 24. CRM Workbench Consolidation and Email Import Hardening

Implemented on 2026-06-24:

* CRM remains a single top-level `外贸 CRM` entry in `App.tsx`.
* `CrmModule.tsx` now acts as the unified CRM workbench and keeps internal tabs for:
  * 客户档案
  * 客户优先级
  * 询盘项目
  * 核价请求
  * 物流费用
  * 邮件导入
  * CRM 日志
* `CrmCustomerDetail.tsx` is the primary customer profile page. It emphasizes overview, latest inquiry/specification, costing and freight status, related emails, research notes, communication summaries, and CRM audit logs.
* `CrmCustomerPriority.tsx` now exposes pending costing, pending freight, and pending import suggestion signals in one grouped view.
* `CrmTermTooltip.tsx` provides a lightweight static glossary for key trade, logistics, quotation, and material terms. This is a frontend-only helper and does not require database storage.

IMAP hardening strategy:

* `syncMailbox()` must always return or throw with a stable summary shape. Arrays and counters must never be undefined.
* IMAP failures are classified into DNS failure, connection refused, timeout, authentication failure, and generic sync failure.
* `email_sync_runs` must record `failed` status with sanitized error messages.
* `GET /api/crm/email/config-status` returns masked configuration status only and must never expose the mailbox password.
* Real IMAP connectivity validation should be done on the deployment server. Local or sandbox DNS restrictions must not block CRM development or break API responses.

Customer profile display strategy refinements:

* Empty values should render as quiet placeholders such as `未记录`.
* Customer detail should favor profile visibility over data-entry density.
* Related email display should use subject and cleaned-text previews instead of expanding raw HTML by default.
* `customer_research_notes` remain display/storage only. They do not auto-apply to `customers`.

Still deferred after this batch:

* Quotation foundation tables and pages were intentionally deferred in this batch to avoid destabilizing build/test quality.
* Dedicated costing_user and freight_user frontend queue entries remain deferred.
* Formal quotation rollup, export, and order conversion remain later phases.

## 25. Email Import Extraction Upgrade

Implemented on 2026-06-25:

* Email sync remains read-only and manual-triggered.
* Sync now supports both `INBOX` and sent-mail style folders through folder aliases:
  * `Sent`
  * `Sent Messages`
  * `Sent Mail`
  * `已发送`
  * `已发送邮件`
* Sync results must always return stable counts and status fields even when a folder is missing or IMAP connectivity fails.

Email message structuring:

* `email_messages` now stores:
  * `normalized_subject`
  * `conversation_key`
  * `email_domain`
  * `contact_email`
  * `contact_name`
  * `quote_detected`
  * `inquiry_detected`
  * `customer_detected`
  * `parsed_at`
* `conversation_key` priority:
  1. `thread_id`
  2. `references_header` / `in_reply_to`
  3. `normalized_subject + contact_email`
  4. `normalized_subject + email_domain`
* `normalized_subject` strips prefixes such as `Re:`, `Fwd:`, `回复：`, `转发：`, and `答复：`.

Customer matching strategy:

* First try exact `customers.email` matching.
* Then try domain matching against `customers.email` or `customers.website`.
* Then try weak body/subject matching against `company_name`, `name`, and `contact_person`.
* If matching remains uncertain, keep the result only in `crm_import_suggestions`.
* The system must not auto overwrite `customers`.

Inquiry, specification, and quotation extraction strategy:

* Rule-based parsing now extracts customer profile hints, inquiry hints, specification hints, and quotation hints into separate pending suggestions.
* Suggestion types currently used from email parsing:
  * `customer_profile`
  * `inquiry`
  * `specification`
  * `quotation_draft`
* `quotation_draft` is only a pending suggestion. It is not a formal quotation record and does not create `quotations`.
* Material structure parsing should stay conservative. If layer parsing is uncertain, preserve the original `material_structure_text` instead of forcing a broken layer split.

Customer profile display rules:

* Customer detail should show related email threads, recent related emails, pending import suggestions, and quotation clues from `quotation_draft` suggestions.
* Raw HTML email content should not be expanded by default.

Safety rules:

* No automatic update of `customers`, `inquiries`, `specifications`, or future `quotations` from parsed email.
* No SMTP, no outgoing send, no remote delete, no remote move, no mark-as-read.

## 26. Deployment IMAP Verification and Controlled Apply Flow

Implemented on 2026-06-25:

Deployment IMAP verification:

* Real mailbox connectivity must be verified on the deployment server, not in local smoke tests.
* Use the following network checks before running email sync:
  * `getent hosts imap.qiye.aliyun.com`
  * `getent hosts imap.mxhichina.com`
  * `nc -vz imap.qiye.aliyun.com 993`
  * `nc -vz imap.mxhichina.com 993`
  * if `nc` is unavailable: `openssl s_client -connect imap.qiye.aliyun.com:993 -servername imap.qiye.aliyun.com`
* Use `node scripts/verify-imap-sync.js` on the deployment server for a safe manual verification run.
* `verify-imap-sync.js`:
  * reads env configuration only
  * masks the mailbox user
  * never prints the password
  * tries `INBOX` first, then sent-folder aliases
  * prints summary counts only, not full email bodies

Controlled import-suggestion workflow:

* Email parsing still writes only to `crm_import_suggestions`.
* Formal writes happen only through manual preview and apply actions by:
  * `super_admin`
  * `foreign_trade_crm_admin`
* New review flow:
  1. `GET /api/crm/import-suggestions/:id/preview`
  2. review `diff`, `apply_plan`, and `warnings`
  3. `POST /api/crm/import-suggestions/:id/apply` with explicit `apply_fields`
* There is no batch auto-apply path.
* `priority` remains opt-in only:
  * `apply_priority` defaults to `false`
  * priority suggestions must not change customer priority unless the reviewer explicitly enables them

Apply behavior by suggestion type:

* `customer_profile`
  * may update an existing customer only for the explicitly selected fields
  * may create a new customer only when `allow_create_customer=true`
* `communication_log`
  * may create a CRM communication entry from email summary data only when `allow_create_communication_log=true`
* `inquiry`
  * may update a matched inquiry
  * may create a new inquiry only when `allow_create_inquiry=true`
* `specification`
  * requires a confirmed inquiry
  * creates a new specification version and optional layers
* `quotation_draft`
  * remains review-only unless a future `quotations` table exists and the reviewer explicitly allows creation
  * if quotation tables are unavailable, return a warning and keep the suggestion unresolved instead of crashing

Audit and safety rules:

* All preview/apply/reject/ignore paths must write CRM audit logs.
* Applying a suggestion must update suggestion status to `applied` only after a formal write succeeds.
* Rejecting or ignoring a suggestion only changes suggestion status and must not modify formal CRM tables.
* The system must never auto overwrite non-empty customer fields unless they are explicitly included in `apply_fields`.

## 27. Codex CLI Email Thread Analysis Pipeline

Implemented on 2026-06-26:

Parsing strategy adjustment:

* The rule-based parser is no longer treated as the final extraction authority for customer profile, inquiry, specification, or quotation interpretation.
* The rule-based parser remains useful for:
  * noise filtering
  * business relevance scoring
  * quote / inquiry / specification / logistics signal detection
  * lightweight hints for downstream AI prompts
* Final CRM import suggestions for valuable threads should come from Codex CLI / AI thread analysis, not from regex alone.

Email screening layer:

* `email_messages` now carries screening-oriented parser metadata:
  * `noise_level`
  * `business_relevance`
  * `detected_signals_json`
  * `parser_hints_json`
* High-noise or irrelevant mail should not be prioritized into AI analysis batches.
* The parser must not use a contact person name as `company_name` unless there is direct evidence.

AI analysis task tracking:

* Added `email_ai_analysis_runs` for thread-level AI analysis jobs.
* Important fields:
  * `run_code`
  * `scope_type`
  * `scope_key`
  * `status`
  * `prompt_path`
  * `output_path`
  * `input_email_ids_json`
  * `input_summary`
  * `result_json`
  * `error_message`
* Supported `scope_type` values:
  * `conversation`
  * `contact_email`
  * `customer_candidate`
  * `manual_batch`

Three-stage AI workflow:

1. `scripts/prepare-email-ai-batches.js`
   * reads `email_messages`
   * filters noisy / low-value messages
   * groups by `conversation_key`, `contact_email`, or requested scope
   * creates prompt files under `data/email-ai-prompts/`
   * creates `email_ai_analysis_runs` with `status='prompt_ready'`
2. `scripts/run-email-ai-analysis.js`
   * reads `prompt_ready` runs
   * calls Codex CLI when available
   * writes JSON outputs under `data/email-ai-outputs/`
   * updates run status to `completed` or `failed`
3. `scripts/import-email-ai-results.js`
   * validates completed run JSON
   * imports AI results into `crm_import_suggestions`
   * marks runs as `imported`
   * writes audit logs

Prompt and output locations:

* Prompt files: `data/email-ai-prompts/`
* Output files: `data/email-ai-outputs/`

AI output contract:

* Codex CLI / AI must output strict JSON only.
* JSON should include:
  * `customer_profile`
  * `communications`
  * `inquiries`
  * `specifications`
  * `quotation_drafts`
  * `risk_flags`
  * `recommended_apply_order`
* `company_name` must come from evidence such as:
  * signature block
  * company legal suffix
  * repeated context
  * website/domain evidence
* Personal email alone must not imply a company.
* Uncertain fields should remain `null`.
* Evidence arrays must reference email ids from the thread.

Safety rules:

* AI analysis results are imported only as `pending` suggestions.
* The system must not auto apply AI-imported suggestions.
* The system must not auto overwrite `customers`.
* The system must not auto create formal `quotations`.
* `quotation_draft` remains suggestion-only until a later explicit quotation phase.

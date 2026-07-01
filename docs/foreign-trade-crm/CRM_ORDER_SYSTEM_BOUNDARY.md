# CRM / Order System Boundary

This document records the current safety boundary between the foreign-trade CRM module and the core order management system.

## CRM write scope

CRM is allowed to write only CRM-owned tables, including:

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
* CRM-related audit log entries

## Order system write scope

The order system continues to own:

* `orders`
* `work_orders`
* `order_stage_logs`
* `quote_sheets`
* `material_prices`
* production-related worker flows
* cost engine formulas

CRM must not become a write path for these tables.

## Read-only bridge rules

If CRM needs to display order information:

* use read-only queries only
* do not change order status
* do not backfill mandatory order fields
* do not change production routing
* do not alter cost formulas

## Migration rules

* use `CREATE TABLE IF NOT EXISTS`
* use `PRAGMA table_info` before `ALTER TABLE ADD COLUMN`
* do not drop tables
* do not rename tables
* do not make CRM fields mandatory on old orders

## Permission rules

* `foreign_trade_crm_admin` is a CRM manager, not a global super-admin
* CRM roles do not gain order delete rights from CRM routes
* CRM-only roles must not gain worker-stage mutation rights
* order permissions remain enforced by the order router

## Regression expectations

After CRM initialization, these paths must continue to work:

* order list and detail
* order creation
* order stage progression
* work-order creation and export
* cost calculation and snapshots
* worker-scoped order access

## Rollback principle

If a future CRM change needs to touch the order system, it must be reviewed as a separate bridge with:

* a clear read/write contract
* null-safe schema changes
* smoke-test coverage for both systems
* no destructive migration

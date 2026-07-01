# CRM Implementation Status

Last reviewed: 2026-07-01

## Summary

The CRM is operational as a single external-trade workbench. Core customer, inquiry, email, AI suggestion, quote-readiness, costing-request, freight-quote, dashboard, and permission boundaries are implemented. Formal quotation Phase 6 is still deferred.

## Completion Table

| 模块 | 状态 | 完成度 | 关键文件 | 已验证 | 风险 | 下一步 |
| -- | -- | --: | -- | -- | -- | -- |
| CRM workbench | done | 100% | `frontend-next/src/components/crm/CrmModule.tsx`, `frontend-next/src/components/crm/CrmDashboard.tsx` | build, smoke | low | Keep tabs compact |
| Customer profiles | done | 100% | `src/routes/crm.js`, `frontend-next/src/components/crm/CrmCustomers.tsx`, `frontend-next/src/components/crm/CrmCustomerDetail.tsx` | smoke | medium | Continue manual data cleanup |
| Customer priority | done | 100% | `src/routes/crm.js`, `frontend-next/src/components/crm/CrmCustomerPriority.tsx` | smoke | medium | Tune sorting from real usage |
| Customer stage | done | 100% | `src/lib/crmStage.ts`, `src/routes/crm.js` | smoke | low | Keep normalization mapping maintained |
| Follow-up fields | done | 100% | `src/db.js`, `src/routes/crm.js`, dashboard | smoke | medium | Keep reminders conservative |
| Email sync | done | 100% | `src/lib/imapSync.js`, `src/routes/crm.js`, `scripts/verify-imap-sync.js` | manual/ smoke | medium | Deployment-server IMAP verification only |
| Email AI analysis | done | 100% | `src/lib/emailCrmParser.js`, `scripts/prepare-email-ai-batches.js`, `scripts/run-email-ai-analysis.js` | manual/ smoke | medium | Improve prompt quality on real threads |
| Import suggestions | done | 100% | `src/routes/crm.js`, `frontend-next/src/components/crm/CrmEmailImport.tsx` | smoke | medium | Keep review/apply human-gated |
| AI direct import | done | 100% | `src/routes/crm.js`, suggestion apply flow | smoke | medium | Keep field-level guardrails strict |
| Field history | partial | 30% | `src/routes/crm.js`, audit logs | smoke | medium | Add a dedicated diff/history view later |
| Inquiry management | done | 100% | `src/routes/crm.js`, `frontend-next/src/components/crm/CrmInquiries.tsx`, `frontend-next/src/components/crm/CrmInquiryDetail.tsx` | smoke | low | Keep inquiry data clean |
| Specification management | done | 100% | `src/routes/crm.js`, inquiry specification UI | smoke | medium | Apply only confirmed versions |
| Quote readiness | done | 100% | `src/lib/quoteReadiness.js`, `src/routes/crm.js`, `frontend-next/src/components/crm/CrmQuoteReadinessCard.tsx` | smoke | medium | Continue tuning missing-field rules |
| Quote readiness AI candidates | done | 100% | `src/routes/crm.js`, CRM details/dashboard | smoke | medium | Use as review hints only |
| Costing requests | done | 100% | `src/routes/crm.js`, `frontend-next/src/components/crm/CrmCostingRequests.tsx` | smoke | medium | Keep costing bridge read-first |
| Freight quotes | done | 100% | `src/routes/crm.js`, `frontend-next/src/components/crm/CrmFreightQuotes.tsx` | smoke | medium | Keep fee model text-safe |
| Formal quotations | planned | 0% | none | not started | medium | Defer until CRM data is stable |
| Sample management | deferred | 0% | none | not started | low | Add only if it blocks real CRM use |
| Attachments | planned | 0% | none | not started | medium | Consider later with permissions |
| Daily reports | deferred | 0% | none | not started | low | Keep out of current scope |
| Prospect pool | deferred | 0% | none | not started | low | Keep out of current scope |
| Website material tasks | deferred | 0% | none | not started | low | Keep out of current scope |
| Role permissions | done | 100% | `shared/permissions-model.json`, `src/middleware/auth.js`, `frontend-next/src/lib/permissions.ts` | smoke | medium | Keep CRM/admin scopes narrow |
| Audit logs | done | 100% | `src/db.js`, `src/routes/crm.js`, CRM audit views | smoke | medium | Keep write actions audited |
| Order system boundary | done | 100% | `docs/foreign-trade-crm/CRM_ORDER_SYSTEM_BOUNDARY.md`, `scripts/smoke-test.js` | smoke | low | Preserve append-only isolation |
| Smoke tests | done | 100% | `scripts/smoke-test.js` | smoke | low | Extend only for regressions |

## Recommended Next Roadmap

### P0

Current highest-priority follow-up work:

* Clean and apply only the clearly correct pending specification suggestions for the two real customers.
* Tighten quote-readiness hints around existing pending suggestions.
* Formalize field history views if the team needs per-field traceability beyond audit logs.
* Keep follow-up reminders and dashboard tasks conservative and actionable.
* Keep CRM-only permissions from drifting into order mutations.

### P1

Second-stage work after the current CRM flow is stable:

* Formal quotations
* `quotation_lines`
* quotation versioning
* attachments
* sample management
* customer export with permission control

### P2

Later work that should stay deferred:

* WhatsApp import
* website inquiry auto import
* quotation PDF
* email template management
* website material task module
* customer scoring model
* order conversion bridge

## Notes

* The `crm_import_suggestions` apply flow is intentionally human-gated.
* The current CRM is useful without Phase 6; do not force a quotation system before the CRM data quality is stable.

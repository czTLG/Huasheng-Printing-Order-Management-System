# Huasheng Foreign Trade CRM Changelog

The full line-by-line history has been archived to `archive/CRM_CHANGELOG_FULL.md`.

## Milestones

| Commit | Date | Title | Scope | Important Files | Verification | Notes |
| -- | -- | -- | -- | -- | -- | -- |
| `df5ddfd` | 2026-06-24 | Pre-CRM Baseline Cleaned | Clean baseline before CRM work | repo hygiene, `.gitignore` | build PASS, smoke PASS | Start point for CRM branch work |
| `df5ddfd` | 2026-06-24 | Phase 0 - Current System Review Completed | Read-only audit of stack, DB, permissions, order/cost risks | docs only | review complete | Established non-goals and risk register |
| `49db378` | 2026-06-24 | Phase 1-3 Foundation - CRM permissions, customers, communications and inquiries | CRM roles, customer tables, communications, inquiries, specs, layers, audit basics | `src/routes/crm.js`, `src/db.js`, CRM components | build PASS, smoke PASS | First usable CRM foundation |
| `308fdec` | 2026-06-24 | Phase 4 - Costing Request Integration | costing requests, cost sheet lines, CRM-to-cost bridge | `src/routes/crm.js`, `src/db.js`, CRM costing UI | build PASS, smoke PASS | Kept cost engine untouched |
| `5ee400e` | 2026-06-24 | Phase 5 - Freight and Clearance Charge Records | freight quotes, fees, assignments, selected/current logic | `src/routes/crm.js`, `src/db.js`, freight UI | build PASS, smoke PASS | Text-safe freight model |
| `03f8d5c` | 2026-06-24 | Phase 7 Prep - IMAP email import and suggestion pipeline | IMAP sync, email_messages, import suggestions, preview/apply, config status | `src/lib/imapSync.js`, `src/routes/crm.js`, `CrmEmailImport` | build PASS, smoke PASS | Real email data became usable CRM input |
| `1a55a653` | 2026-06-24 | Controlled Import Suggestion Apply Flow | preview/apply for customer, inquiry, spec, communication, quotation_draft handling | `src/routes/crm.js`, `CrmEmailImport`, `CrmCustomerDetail` | build PASS, smoke PASS | Human-gated import only |
| `005a039` | 2026-06-24 | CRM Dashboard Workbench | top-level operational dashboard, task lists, priority slices | `CrmDashboard`, `CrmModule` | build PASS, smoke PASS | CRM became a daily workbench |
| `5142abb` | 2026-06-24 | CRM Workbench Consolidation and Final Daily Batch | unify tabs, customer profile display, research notes, tooltip prep | CRM components and docs | build PASS, smoke PASS | Removed multi-entry CRM clutter |
| `f98fb4a` | 2026-06-24 | Email Import Extraction Upgrade | INBOX/Sent extraction, conversation threading, better parsing of customer/inquiry/spec/quote clues | email pipeline, email import UI | build PASS, smoke PASS | Rule parser became a hint layer |
| `32be03d` | 2026-07-01 | CRM / Order Boundary Review | audit CRM vs order-system isolation, add boundary doc, extend regression smoke | `scripts/smoke-test.js`, docs | build PASS, smoke PASS | No destructive order coupling found |
| `267d95e` | 2026-07-01 | Quote Readiness and CRM Stage Standardization | readiness evaluator, stage normalization, dashboard follow-up tasks | `quoteReadiness`, CRM UI, `inquiries` fields | build PASS, smoke PASS | Formal quotation still deferred |
| `5e62253` | 2026-07-01 | Quote Readiness AI Candidate Hints | pending spec candidates surfaced without changing formal readiness | quote readiness, dashboard, CRM detail pages | build PASS, smoke PASS | Candidates stay non-destructive |

## Current State

* CRM is a single `外贸 CRM` workbench with internal tabs.
* The main operational flows are customer profiles, inquiries/specifications, import suggestions, quote readiness, costing requests, freight quotes, dashboard tasks, and boundary-safe email analysis.
* Formal quotations remain deferred.

## Archive

* Full detailed history: `archive/CRM_CHANGELOG_FULL.md`

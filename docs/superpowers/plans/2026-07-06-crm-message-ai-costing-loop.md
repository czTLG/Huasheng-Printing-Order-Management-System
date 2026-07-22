# CRM Message AI Costing Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect a CRM message to persisted AI interpretation, conservative inquiry enrichment, father review, and a traceable internal costing draft.

**Architecture:** Add append-only CRM tables and a focused message interpretation service. Extend existing CRM and foreign-costing routes with narrow endpoints, then surface the returned state in the existing message and inquiry detail components.

**Tech Stack:** Node.js, Express, better-sqlite3, React, TypeScript, Vite.

---

### Task 1: Focused Verification Harness and Data Model

**Files:**
- Create: `scripts/verify-crm-message-ai-loop.js`
- Modify: `src/db.js`

- [ ] Write assertions for the two new tables and required columns, including attachment IDs and changed field history.
- [ ] Run `node scripts/verify-crm-message-ai-loop.js` and confirm it fails because the tables do not exist.
- [ ] Add `CREATE TABLE IF NOT EXISTS` definitions for `crm_ai_interpretations` and `crm_father_review_tasks` plus append-only columns on `foreign_costing_drafts`.
- [ ] Re-run the focused verification and confirm schema assertions pass.

### Task 2: Interpretation and CRM Workflow APIs

**Files:**
- Create: `src/services/crmMessageInterpreter.js`
- Modify: `src/routes/crm.js`
- Modify: `scripts/verify-crm-message-ai-loop.js`

- [ ] Add failing tests for the fixed interpretation schema, persistence, latest interpretation retrieval, blank-only inquiry updates, and changed field records.
- [ ] Implement deterministic rule-based parsing with all standard AI fields and explicit missing/risk handling.
- [ ] Implement `POST /messages/:id/ai-parse` and return the persisted interpretation.
- [ ] Implement `POST /messages/:id/update-inquiry`; create a pending-confirmation inquiry only when no safe link exists, and never overwrite non-empty fields.
- [ ] Implement father-task create/list/reply endpoints with attachment ID linkage and no send operation.
- [ ] Extend message and inquiry detail responses with latest interpretation, father tasks, and normalized task attachments.
- [ ] Run the focused verification until all workflow assertions pass.

### Task 3: CRM-linked Foreign Costing Drafts

**Files:**
- Modify: `src/routes/foreignCostingAssistant.js`
- Modify: `src/routes/crm.js`
- Modify: `scripts/verify-crm-message-ai-loop.js`

- [ ] Add failing assertions that `/draft` accepts and stores customer ID, inquiry ID, source message IDs, attachment IDs, and CRM specification JSON.
- [ ] Preserve the existing parse-to-quoteEngine pipeline and only add context merging/persistence.
- [ ] Add inquiry endpoint support to list linked costing drafts with parsed spec, calculation table, and father review panel summaries.
- [ ] Verify status remains `internal_pre_quote` and no formal quotation fields or send actions exist.

### Task 4: Message and Inquiry Detail UI

**Files:**
- Modify: `frontend-next/src/lib/mockService.ts`
- Modify: `frontend-next/src/components/crm/CrmMessageDetail.tsx`
- Modify: `frontend-next/src/components/crm/CrmInquiryDetail.tsx`

- [ ] Add API methods for parse, inquiry update, father task create/reply/list, costing draft creation, and linked draft listing.
- [ ] Add message-detail states and actions for persisted AI interpretation, extracted fields, missing information, risks, next action, and reply draft.
- [ ] Add inquiry-detail AI overview, father task cards with attachments and Chinese reply, linked costing drafts, and send-to-costing action.
- [ ] Ensure every costing label says internal pre-costing and pending Chen Yongjie review; no customer send action is added.
- [ ] Run `cd frontend-next && npm run build` and fix only errors caused by these edits.

### Task 5: Final Verification and Scope Audit

**Files:**
- Verify only; no production file additions.

- [ ] Run `node --check` for CRM routes, attachment helper, interpreter service, foreign costing service, and foreign costing route.
- [ ] Run `node scripts/verify-crm-message-ai-loop.js`.
- [ ] Run `cd frontend-next && npm run build`.
- [ ] Run source-anchor searches for interpretations, father tasks, changed fields, and costing linkage.
- [ ] Confirm `git diff --name-only` shows no changes to `quoteEngine.js` or `Cost.tsx` attributable to this task.
- [ ] Do not commit; report changed files and known pre-existing dirty files separately.

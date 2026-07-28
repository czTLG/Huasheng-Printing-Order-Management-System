# Matrix Public Mailbox Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admit and deliver to an officially published public-provider mailbox only when current official and authoritative corroboration evidence agree.

**Architecture:** Add one focused provenance validator shared by candidate intake, review, scoring, identity, and delivery. Persist the normalized evidence mode in existing JSON snapshots, and keep organization-level duplicate and cooling behavior keyed to the official domain.

**Tech Stack:** Node.js, CommonJS, SQLite, `better-sqlite3`, `tldts`, existing Matrix ledger services.

## Global Constraints

- No guessed personal contacts, private profiles, credentials, raw messages, quotations, orders, or formulas.
- `official_public_mailbox` requires an official contact page plus `government`, `industry_association`, or `official_exhibition` corroboration.
- Delivery remains behind exact immutable-version approval and final confirmation.
- Hock Xeng remains no-send until the user approves the exact final preview.

---

### Task 1: Shared provenance validator

**Files:**
- Create: `src/services/matrixRecipientProvenance.js`
- Modify: `scripts/test-matrix-intake-candidate.js`

**Interfaces:**
- Produces: `validateRecipientProvenance(input, { now, maxAgeDays })`
- Returns: normalized `{ mode, organizationDomain, email, sourceUrl, verifiedAt, corroboration }`

- [ ] Add failing candidate tests for a valid official Gmail mailbox and rejection of missing, stale, mismatched, directory-only, and one-field corroboration.
- [ ] Run `node scripts/test-matrix-intake-candidate.js` and verify failure is caused by the existing domain-mismatch rule.
- [ ] Implement the validator and use it from candidate parsing.
- [ ] Run the candidate test and verify all cases pass.

### Task 2: Preserve provenance through canonical intake and review

**Files:**
- Modify: `src/services/matrixIntakeCandidate.js`
- Modify: `src/services/matrixIntakeBridge.js`
- Modify: `src/services/matrixStreamReview.js`
- Modify: `scripts/test-matrix-intake-bridge.js`

**Interfaces:**
- Consumes: normalized recipient provenance.
- Produces: recipient-evidence snapshots whose `recipient_provenance` is validated on creation and replay.

- [ ] Add a failing bridge integration case using an official public mailbox.
- [ ] Run `node scripts/test-matrix-intake-bridge.js` and verify the trusted-evidence binding fails.
- [ ] Store and validate the provenance mode without changing immutable content hashing.
- [ ] Run candidate and bridge tests to green.

### Task 3: Keep organization-scoped delivery protections

**Files:**
- Modify: `src/services/matrixStreamGate.js`
- Modify: `src/services/matrixStreamDelivery.js`
- Modify: `scripts/test-matrix-stream-delivery.js`
- Modify: `scripts/test-matrix-stream-gate.js`

**Interfaces:**
- Consumes: `organization_domain` and normalized provenance snapshot.
- Produces: duplicate, suppression, cooling, and delivery decisions keyed to the organization domain.

- [ ] Add failing tests proving two Gmail organizations do not share cooling and one organization still does.
- [ ] Run gate and delivery tests and verify the existing email-domain equality causes failure.
- [ ] Replace equality checks with shared provenance validation and organization-domain identity.
- [ ] Run gate and delivery tests to green.

### Task 4: Full regression and Hock Xeng no-send intake

**Files:**
- Create: `runtime-data-matrix-research-private/intakes/hock-xeng-20260728.json`
- Modify: `docs/superpowers/specs/2026-07-28-matrix-public-mailbox-design.md` only if implementation evidence requires clarification.

**Interfaces:**
- Produces: one reviewed candidate, one immutable draft, and a final preview with zero delivery jobs.

- [ ] Run the Matrix intake, API, review, gate, delivery, ledger, lint, and database-integrity suites.
- [ ] Admit the reviewed Hock Xeng record using official-site and official-exhibition evidence.
- [ ] Create one immutable draft and retrieve its complete bilingual final preview.
- [ ] Verify no approval, delivery job, or follow-up task was created.
- [ ] Commit the reviewed implementation and evidence.


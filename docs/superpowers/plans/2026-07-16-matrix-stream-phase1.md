# Matrix Stream Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a safe, reproducible dry-run that classifies current overseas CRM records and imports evidence-bound public company candidates for the approved six-country campaign without sending messages or modifying formal customer data.

**Architecture:** Add small database-backed services with injected dependencies: deterministic classification, evidence normalization, guarded URL validation, and a bounded campaign runner. Phase 1 accepts results through an explicit search-provider interface, stores versioned evidence separately from CRM, exposes a read-only candidate API, and leaves Feishu delivery and email delivery disabled for later plans.

**Tech Stack:** Node.js CommonJS, Express 4, better-sqlite3, built-in `fetch`, SQLite, existing JWT/CRM permissions, Node `assert` tests.

## Global Constraints

- New components and visible feature labels use neutral codenames only.
- Countries are Vietnam, Thailand, Malaysia, Indonesia, Philippines, and Kazakhstan; India is always excluded.
- Maximum input is 20 companies per country and 120 companies per run before exclusions.
- Initial categories are approved dry foods/snacks and liquid household/personal-care products.
- China warehouse, sourcing agent, inspection, pickup, EXW, or FOB evidence is a ranking bonus, never an eligibility requirement.
- Public pages only; no login, CAPTCHA bypass, proxies, guessed personal email, private profiles, or automated form submission.
- Phase 1 performs no email/WhatsApp delivery and does not create or overwrite formal CRM customers.
- Every field requires evidence URL, retrieval time, and confidence.
- Tests are written and observed failing before production code.

---

### Task 1: Deterministic Classification Core

**Files:**
- Create: `src/lib/schemaRank.js`
- Create: `scripts/test-schema-rank.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `classifyRecord(record, context) -> { classification, priority, reason_codes, confidence }`
- Produces: `isApprovedCountry(country) -> boolean`
- Produces: `APPROVED_COUNTRIES`, `EXCLUDED_COUNTRIES`, and `RULESET_VERSION`

- [ ] **Step 1: Write the failing classifier test**

```js
const assert = require('assert');
const { classifyRecord, isApprovedCountry } = require('../src/lib/schemaRank');

assert.equal(isApprovedCountry('Vietnam'), true);
assert.equal(isApprovedCountry('India'), false);
assert.equal(classifyRecord({ fixture_marker: 'token-verification' }, {}).classification, 'test');
assert.equal(classifyRecord({ source_kind: 'security_notice', country: 'Malaysia' }, {}).classification, 'noise');
assert.equal(classifyRecord({ country: 'Thailand', business_email: 'sales@example.co.th' }, {}).classification, 'needs_review');
const valid = classifyRecord({
  country: 'Indonesia',
  official_domain: 'brand.example',
  business_email: 'sales@brand.example',
  product_evidence: ['coffee'],
  last_interaction_at: '2026-07-01'
}, { now: '2026-07-16' });
assert.equal(valid.classification, 'valid');
assert(valid.reason_codes.includes('official_domain'));
console.log('schema-rank tests passed');
```

- [ ] **Step 2: Run the test and observe the missing-module failure**

Run: `node scripts/test-schema-rank.js`

Expected: FAIL with `Cannot find module '../src/lib/schemaRank'`.

- [ ] **Step 3: Implement the minimal pure classifier**

Implement fixed precedence `test -> noise -> needs_review -> valid`, approved/excluded country normalization, reason codes, and A/B/C priority. Treat missing identity, ambiguous contacts, unknown WhatsApp sender, malformed source time, and conflicting domains as `needs_review`. Do not use an LLM in this module.

- [ ] **Step 4: Add and run the package script**

Add:

```json
"test:matrix-rank": "node scripts/test-schema-rank.js"
```

Run: `npm run test:matrix-rank`

Expected: `schema-rank tests passed`.

- [ ] **Step 5: Commit the classifier**

```bash
git add src/lib/schemaRank.js scripts/test-schema-rank.js package.json
git commit -m "feat: add schema rank classifier"
```

### Task 2: Versioned Evidence and Run Storage

**Files:**
- Modify: `src/db.js`
- Create: `src/lib/signalCache.js`
- Create: `scripts/test-signal-cache.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `RULESET_VERSION` from `src/lib/schemaRank.js`
- Produces: `createRun(db, campaign)`, `upsertEntity(db, input)`, `appendEvidence(db, entityId, evidence)`, `saveClassification(db, entityId, result, runId)`, and `listCandidates(db, filters)`

- [ ] **Step 1: Write a failing temporary-database test**

The test must set `DB_PATH` before requiring `src/db`, call `initDb()`, and assert these behaviors:

```js
const first = upsertEntity(db, { official_domain: 'brand.example', display_name: 'Brand', country: 'Vietnam' });
const second = upsertEntity(db, { official_domain: 'https://www.brand.example/', display_name: 'Brand Co', country: 'Vietnam' });
assert.equal(first.id, second.id);
appendEvidence(db, first.id, { field: 'product', value: 'coffee', source_url: 'https://brand.example/products', retrieved_at: '2026-07-16T00:00:00Z', confidence: 'high' });
saveClassification(db, first.id, { classification: 'valid', priority: 'A', reason_codes: ['official_domain'] }, run.id);
assert.equal(listCandidates(db, { classification: 'valid' }).length, 1);
assert.equal(db.prepare('select count(*) n from customers').get().n, 0);
```

- [ ] **Step 2: Run and observe missing tables/functions**

Run: `node scripts/test-signal-cache.js`

Expected: FAIL because `signalCache` or its tables do not exist.

- [ ] **Step 3: Add append-only neutral tables**

Add `CREATE TABLE IF NOT EXISTS` definitions in `initDb()` for:

- `matrix_runs`: run ID, campaign JSON, ruleset version, status, counters, timestamps, actor.
- `matrix_entities`: normalized domain, display name, country, public contact JSON, status, timestamps.
- `matrix_evidence`: entity ID, field, value, source URL, page title, retrieval time, content fingerprint, confidence, extraction method.
- `matrix_classifications`: entity ID, run ID, class, priority, reason JSON, confidence, human override fields, timestamps.

Add unique indexes for normalized domain and `(entity_id, field, source_url, content_fingerprint)`.

- [ ] **Step 4: Implement storage functions with transactions**

Normalize domains by removing scheme, credentials, port, leading `www.`, path, query, fragment, and trailing dot. Reject blank source URLs and evidence without retrieval time. Store public contacts as JSON but never place raw page HTML in these tables.

- [ ] **Step 5: Run focused and smoke tests**

Run: `node scripts/test-signal-cache.js`

Expected: `signal-cache tests passed`.

Run: `npm run verify:smoke`

Expected: existing smoke suite passes.

- [ ] **Step 6: Commit storage**

```bash
git add src/db.js src/lib/signalCache.js scripts/test-signal-cache.js package.json
git commit -m "feat: add signal cache storage"
```

### Task 3: Guarded Public Evidence Import

**Files:**
- Create: `src/lib/matrixStream.js`
- Create: `scripts/test-matrix-stream.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `validatePublicUrl(url, dnsLookup) -> Promise<{ ok, normalized_url, reason }>`
- Produces: `normalizeDiscoveryRecord(input) -> normalized record`
- Produces: `importDiscoveryBatch(db, runId, records, options) -> summary`
- Consumes: `upsertEntity`, `appendEvidence`, and `saveClassification`

- [ ] **Step 1: Write failing URL and import tests**

Cover exact rejection of `http://127.0.0.1`, `http://169.254.169.254`, `http://10.0.0.1`, URLs with credentials, non-HTTP schemes, redirects to private IPs, India, missing source URLs, and more than 20 records for one country. Cover acceptance of an HTTPS official website resolving to a public documentation-range test address through an injected DNS stub.

- [ ] **Step 2: Run and observe missing implementation**

Run: `node scripts/test-matrix-stream.js`

Expected: FAIL because `matrixStream` is missing.

- [ ] **Step 3: Implement URL and record guards**

Use `URL`, `dns.promises.lookup`, and `net.isIP`. Reject loopback, private IPv4, link-local, carrier-grade NAT, IPv6 loopback, IPv6 unique-local, IPv4-mapped private addresses, credentials, ports outside 80/443, and hostnames resolving to any blocked address. Revalidate every redirect destination.

- [ ] **Step 4: Implement bounded import**

Reject the entire batch if it exceeds 120 input records; reject individual countries after 20; exclude India before persistence; require official URL and at least one evidence item; classify every accepted record; and return counters for input, excluded, test, noise, needs-review, valid, and errors. Do not touch `customers` or `crm_messages`.

- [ ] **Step 5: Verify focused tests**

Run: `npm run test:matrix-stream`

Expected: `matrix-stream tests passed` with no network calls because DNS and fetch are injected.

- [ ] **Step 6: Commit guarded import**

```bash
git add src/lib/matrixStream.js scripts/test-matrix-stream.js package.json
git commit -m "feat: add guarded matrix stream import"
```

### Task 4: Existing CRM Dry-Run Adapter

**Files:**
- Create: `src/lib/matrixCrmAdapter.js`
- Create: `scripts/matrix-classify-current.js`
- Create: `scripts/test-matrix-crm-adapter.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `readEligibleCrmRecords(db) -> normalized records`
- Produces: `classifyCurrentCrm(db, options) -> dry-run report`
- Consumes: `classifyRecord`

- [ ] **Step 1: Write a failing fixture test**

Seed a temporary database with one domestic legacy customer, the known token-verification pattern, one system email, one unknown WhatsApp sender, one valid overseas email conversation, and one valid overseas WhatsApp conversation. Assert respectively: excluded domestic, test, noise, needs-review, valid, valid.

- [ ] **Step 2: Run and observe missing adapter**

Run: `node scripts/test-matrix-crm-adapter.js`

Expected: FAIL because `matrixCrmAdapter` is missing.

- [ ] **Step 3: Implement read-only normalization**

Read `customers`, `crm_messages`, and `email_messages`; group by deterministic customer/contact identity; retain source record IDs rather than copied private bodies in the report; detect fixture markers, automated sender patterns, missing identities, malformed timestamps, and duplicated message segments. Do not update any database row.

- [ ] **Step 4: Implement the production dry-run CLI**

`scripts/matrix-classify-current.js` must default to read-only, print aggregate counts and internal IDs only, and require `--include-private-preview` plus an authenticated local operator context before showing contact details. It must write no files unless `--output <workspace-path>` is supplied.

- [ ] **Step 5: Verify fixture and production dry run**

Run: `node scripts/test-matrix-crm-adapter.js`

Expected: `matrix CRM adapter tests passed`.

Run: `node scripts/matrix-classify-current.js`

Expected: JSON summary containing excluded domestic, test, noise, needs-review, and valid counts; known token record is counted as test; exit code 0; database checksum unchanged.

- [ ] **Step 6: Commit the adapter**

```bash
git add src/lib/matrixCrmAdapter.js scripts/matrix-classify-current.js scripts/test-matrix-crm-adapter.js package.json
git commit -m "feat: add current matrix dry run"
```

### Task 5: Read-Only Candidate API

**Files:**
- Create: `src/routes/matrix.js`
- Modify: `src/server.js`
- Create: `scripts/test-matrix-api.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `GET /api/matrix/runs`
- Produces: `GET /api/matrix/candidates?classification=&priority=&country=`
- Produces: `GET /api/matrix/candidates/:id`
- Consumes: `listCandidates(db, filters)`

- [ ] **Step 1: Write failing permission and redaction tests**

Assert unauthenticated and non-CRM roles receive 401/403; authorized CRM administrators receive paginated candidate summaries; list responses include evidence URLs and reason codes but omit raw page text, private CRM message bodies, unmasked contact values, internal rule text, and all secret/config fields.

- [ ] **Step 2: Run and observe missing routes**

Run: `node scripts/test-matrix-api.js`

Expected: FAIL with 404 for `/api/matrix/candidates`.

- [ ] **Step 3: Add the read-only router**

Follow the existing `fakeAuth` and CRM permission patterns. Validate enum filters, use parameterized SQL, cap page size at 100, default to 20, and record read audit events only for detail views. Do not add POST/PATCH/DELETE routes in phase one.

- [ ] **Step 4: Mount and verify the API**

Mount with `app.use('/api/matrix', matrixRouter)` after authentication middleware.

Run: `node scripts/test-matrix-api.js`

Expected: `matrix API tests passed`.

Run: `npm run verify:smoke`

Expected: existing smoke suite passes.

- [ ] **Step 5: Commit the API**

```bash
git add src/routes/matrix.js src/server.js scripts/test-matrix-api.js package.json
git commit -m "feat: expose read only matrix candidates"
```

### Task 6: Phase 1 Verification and Dry-Run Report

**Files:**
- Create: `scripts/verify-matrix-phase1.js`
- Create: `docs/operations/matrix-phase1-runbook.md`
- Modify: `package.json`

**Interfaces:**
- Consumes all phase-one services and APIs.
- Produces `npm run verify:matrix-phase1` with a nonzero exit code on any safety regression.

- [ ] **Step 1: Write the verification script assertions**

The script must create a temporary database, run schema initialization, classification, guarded import, current-CRM adapter, and API tests; assert zero delivery adapters and zero writes to formal CRM tables; and verify the six-country/20-per-country/India exclusion limits.

- [ ] **Step 2: Run and observe failure before wiring the script**

Run: `node scripts/verify-matrix-phase1.js`

Expected: FAIL until all checks and package wiring exist.

- [ ] **Step 3: Add the package command and runbook**

Add:

```json
"verify:matrix-phase1": "node scripts/verify-matrix-phase1.js"
```

The runbook must document read-only dry run, evidence import JSON schema, output counters, review sampling, rollback (delete only the run-owned `matrix_*` rows), secret isolation, and confirmation that delivery is unavailable.

- [ ] **Step 4: Run final verification**

Run: `npm run verify:matrix-phase1`

Expected: all matrix phase-one checks pass.

Run: `npm run verify:smoke`

Expected: existing smoke checks pass.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 5: Commit verification**

```bash
git add scripts/verify-matrix-phase1.js docs/operations/matrix-phase1-runbook.md package.json
git commit -m "test: verify matrix stream phase one"
```

## Deferred Separate Plans

The approved design includes independent subsystems that must not be bundled into phase one:

1. `packet-lens`: private-rule product analysis, English/Chinese paired versions, and semantic-difference checks.
2. `stream-card`: Feishu candidate/review/final-confirmation cards and callback security.
3. `packet-gate`: single-use final approval, SMTP delivery, suppression, bounce handling, and receipts.
4. Reply loop: full mailbox history sync, reply matching, Chinese translation, suggested replies, and a second final-confirmation gate.

Each subsystem receives its own design-derived TDD plan after phase-one evidence quality is accepted.

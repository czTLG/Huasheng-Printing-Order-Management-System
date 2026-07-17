# Matrix Stream Review Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a human-reviewed, single-recipient email loop from Matrix selection through immutable bilingual drafts, two confirmations, audited delivery, and inbound reply notification.

**Architecture:** Reuse CRM drafts and inbound email storage. Add immutable Matrix Stream version/job/event tables and focused main-application services; expose narrow endpoints through the existing bound-operator Matrix router. The Feishu extension renders state and forwards identifiers, while SMTP credentials remain only in the main application.

**Tech Stack:** Node.js 22, Express 4, better-sqlite3, nodemailer, imapflow/mailparser, Feishu interactive cards, Node `assert` integration tests.

## Global Constraints

- Only a verified public company email with source URL and verification timestamp may be sent to.
- Website contact forms, guessed personal emails, attachments, WhatsApp delivery, bulk delivery, and automatic follow-up are excluded.
- Approving a draft never sends it; a separate final-preview action is required.
- Any content or recipient change supersedes the earlier approval.
- Repeated or concurrent confirmation produces at most one delivery attempt.
- Initial outreach is capped at five accepted messages per Asia/Shanghai day and one initial contact per normalized company domain in 90 days.
- Draft quality must score at least 80/100 with no hard failure; every component is explainable and evidence-linked.
- SPF, DKIM, DMARC, TLS, SMTP, and country/channel policy readiness fail closed.
- An accepted initial message creates a reply-check task for 10:00 Asia/Shanghai on the third following weekday; replies, bounces, refusals, unsubscribes, and manual stops close it.
- Ambiguous delivery is never automatically retried.
- The Feishu runtime keeps `MATRIX_DELIVERY_ENABLED=0` and never receives SMTP credentials.
- Neutral codenames are used for internal folders, services, workflows, and UI feature names; source provenance and audit records remain accurate.
- Every behavior change follows RED-GREEN-REFACTOR and is committed separately.

---

## File Map

- `src/db.js`: schema migrations, immutable triggers, indexes.
- `shared/permissions-model.json`, `src/lib/permissions.js`, `frontend-next/src/components/Admin.tsx`: explicit `matrixSend` capability management.
- `src/services/matrixStreamReview.js`: version creation, revision, approval, recipient validation, state transitions.
- `src/services/matrixStreamText.js`: validated bilingual generation, free-form revision, inbound translation, and safe fallback results.
- `src/services/matrixStreamGate.js`: deterministic draft quality, company identity, cooling, daily quota, suppression, and country-policy gate.
- `src/services/matrixStreamReadiness.js`: cached sender-domain DNS/TLS/SMTP readiness without sending a message.
- `src/services/matrixStreamFollowup.js`: third-weekday task creation and terminal-event closure.
- `src/services/matrixStreamDelivery.js`: restricted transport, stable message identifiers, result classification, idempotency.
- `src/services/matrixStreamCorrelation.js`: reply, bounce, suppression correlation.
- `src/routes/matrix.js`: narrow bound-operator APIs.
- `.runtime/vm_debug_ci/workspace/scripts/matrix-client.js`: fixed-origin client methods only.
- `.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs`: review/edit/approve/preview/send cards and callback state.
- `src/lib/imapSync.js`: invoke correlation after durable inbound import.
- `scripts/verify-matrix-readonly-selection.js`: reviewed production-surface manifest and outbound boundary checks.
- `scripts/test-matrix-stream-review.js`: service/database tests.
- `scripts/test-matrix-stream-delivery.js`: fake-transport delivery tests.
- `scripts/test-matrix-stream-correlation.js`: inbound matching tests.
- `scripts/matrix-policy.js`: audited super-admin country/channel policy management.
- `scripts/test-matrix-policy.js`: role, expiry, source, and audit regression tests.
- `scripts/test-matrix-api.js`: bound API, permission, stale version, and concurrency tests.
- `.runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`: Feishu flow and mobile budget tests.

---

### Task 1: Persisted State and Explicit Permission

**Files:**
- Modify: `src/db.js`
- Modify: `shared/permissions-model.json`
- Modify: `src/lib/permissions.js`
- Modify: `frontend-next/src/components/Admin.tsx`
- Create: `scripts/test-matrix-stream-review.js`
- Modify: `scripts/test-admin-access-regression.js`

**Interfaces:**
- Produces tables `matrix_stream_versions`, `matrix_stream_jobs`, `matrix_stream_events`, and columns `matrix_work_items.stream_state`, `matrix_work_items.current_stream_version_id`, `crm_reply_drafts.matrix_work_item_id`.
- Produces normalized permission `capabilities.matrixSend: boolean`.

- [ ] **Step 1: Write the failing schema test**

Add to `scripts/test-matrix-stream-review.js`:

```js
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-stream-review-'));
process.env.DB_PATH = path.join(root, 'app.db');
const { db, initDb } = require('../src/db');
initDb();

for (const table of ['matrix_stream_versions', 'matrix_stream_jobs', 'matrix_stream_events']) {
  assert(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} missing`);
}
const workColumns = db.prepare('PRAGMA table_info(matrix_work_items)').all().map(row => row.name);
assert(workColumns.includes('stream_state'));
assert(workColumns.includes('current_stream_version_id'));
const draftColumns = db.prepare('PRAGMA table_info(crm_reply_drafts)').all().map(row => row.name);
assert(draftColumns.includes('matrix_work_item_id'));
db.close();
fs.rmSync(root, { recursive: true, force: true });
```

- [ ] **Step 2: Run the schema test and verify RED**

Run: `node scripts/test-matrix-stream-review.js`  
Expected: FAIL with `matrix_stream_versions missing`.

- [ ] **Step 3: Add the minimal migration**

In `src/db.js`, add the three tables with these stable constraints:

```sql
CREATE TABLE IF NOT EXISTS matrix_stream_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_item_id INTEGER NOT NULL,
  crm_draft_id INTEGER,
  revision INTEGER NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_source_url TEXT NOT NULL,
  recipient_verified_at TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_en TEXT NOT NULL,
  body_cn TEXT NOT NULL,
  strategy_summary TEXT NOT NULL DEFAULT '',
  source_snapshot_json TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL,
  quality_score INTEGER NOT NULL DEFAULT 0,
  quality_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK(status IN ('draft','approved','superseded')),
  created_by INTEGER NOT NULL,
  approved_by INTEGER,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(work_item_id, revision),
  FOREIGN KEY(work_item_id) REFERENCES matrix_work_items(id),
  FOREIGN KEY(crm_draft_id) REFERENCES crm_reply_drafts(id)
);
CREATE TABLE IF NOT EXISTS matrix_stream_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_item_id INTEGER NOT NULL,
  version_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('pending','sending','accepted','failed','ambiguous')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_class TEXT NOT NULL DEFAULT '',
  redacted_diagnostic TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(work_item_id) REFERENCES matrix_work_items(id),
  FOREIGN KEY(version_id) REFERENCES matrix_stream_versions(id)
);
CREATE TABLE IF NOT EXISTS matrix_stream_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_item_id INTEGER NOT NULL,
  version_id INTEGER,
  job_id INTEGER,
  actor_user_id INTEGER,
  matrix_binding_id INTEGER,
  chat_id TEXT NOT NULL DEFAULT '',
  card_event_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL DEFAULT '',
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  diagnostic TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS matrix_stream_sender_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_domain TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  spf_ok INTEGER NOT NULL,
  dkim_ok INTEGER NOT NULL,
  dmarc_ok INTEGER NOT NULL,
  tls_ok INTEGER NOT NULL,
  smtp_ok INTEGER NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(sender_domain, checked_at)
);
CREATE TABLE IF NOT EXISTS matrix_stream_country_policies (
  country_code TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('approved','paused','blocked')),
  sender_identity_required INTEGER NOT NULL DEFAULT 1,
  opt_out_required INTEGER NOT NULL DEFAULT 1,
  reviewed_by INTEGER NOT NULL,
  reviewed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  source_urls_json TEXT NOT NULL,
  PRIMARY KEY(country_code, channel)
);
```

Add append-only update/delete triggers for `matrix_stream_events`, content-column immutability triggers for approved versions, and indexes on `(work_item_id, revision)`, `(state, updated_at)`, and `message_id`. Add missing columns with guarded `ALTER TABLE` calls and default `stream_state='selected'`.

- [ ] **Step 4: Write and run the failing permission test**

In `scripts/test-admin-access-regression.js`, assert:

```js
const { normalizePermissions } = require('../src/lib/permissions');
assert.strictEqual(normalizePermissions('foreign_trade_crm_admin', {}).capabilities.matrixSend, false);
assert.strictEqual(normalizePermissions('foreign_trade_crm_admin', { capabilities: { matrixSend: true } }).capabilities.matrixSend, true);
assert.strictEqual(normalizePermissions('worker', { capabilities: { matrixSend: true } }).capabilities.matrixSend, false);
```

Run: `node scripts/test-admin-access-regression.js`  
Expected: FAIL because `capabilities` is missing.

- [ ] **Step 5: Implement permission normalization and admin control**

Add `capabilityKeys: ["matrixSend"]` to `shared/permissions-model.json`. Default it to `false` for every role; `all: true` remains authorized. In `src/lib/permissions.js`, return:

```js
const allowedForRole = role === 'super_admin' || role === 'foreign_trade_crm_admin';
const requested = !!permissions?.capabilities?.matrixSend;
capabilities: { matrixSend: allowedForRole && requested }
```

Add an Admin permission checkbox labeled `Matrix Stream 发送确认` that writes `capabilities.matrixSend`; preserve it when other permissions are edited.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
node scripts/test-matrix-stream-review.js
node scripts/test-admin-access-regression.js
npm run build
```

Expected: all PASS.  
Commit: `feat: add matrix stream review state`

---

### Task 2: Immutable Draft Version Service

**Files:**
- Create: `src/services/matrixStreamReview.js`
- Create: `src/services/matrixStreamText.js`
- Modify: `src/services/aiProvider.js`
- Modify: `scripts/test-matrix-stream-review.js`

**Interfaces:**
- Produces `createInitialVersion(db, input)`, `reviseVersion(db, input)`, `approveVersion(db, input)`, `getVersion(db, input)`, `validateRecipient(input, nowValue)`.
- Produces `createMatrixStreamText({ callJson })` with `revise(input)` and `translateInbound(input)`; both return validated bilingual JSON and never send messages.
- `input.actorUserId`, `input.workItemId`, and `input.expectedWorkVersion` are positive integers.

- [ ] **Step 1: Write failing recipient and version tests**

Append fixtures for an active actor/work item, then assert:

```js
const review = require('../src/services/matrixStreamReview');
assert.throws(() => review.validateRecipient({ email: 'guessed@person.test', sourceUrl: '', verifiedAt: '' }, new Date('2026-07-17T00:00:00Z')), /source/i);
const v1 = review.createInitialVersion(db, {
  actorUserId: 1,
  workItemId,
  expectedWorkVersion: 1,
  recipient: { email: 'sales@alpha.test', sourceUrl: 'https://alpha.test/contact', verifiedAt: '2026-07-16T00:00:00Z', kind: 'public_company' },
  subject: 'A focused proposal for Alpha', bodyEn: 'Dear Alpha team,\nPlease confirm your current requirements.\nBest regards', bodyCn: '您好，请确认当前需求。',
  strategySummary: '公开产品页显示匹配品类', sourceSnapshot: { url: 'https://alpha.test/products' }, idempotencyKey: 'version-create-1'
});
assert.strictEqual(v1.revision, 1);
const approved = review.approveVersion(db, { actorUserId: 1, workItemId, versionId: v1.id, expectedWorkVersion: 2, expectedContentHash: v1.content_hash, idempotencyKey: 'approve-1' });
assert.strictEqual(approved.status, 'approved');
const v2 = review.reviseVersion(db, { actorUserId: 1, workItemId, baseVersionId: v1.id, expectedWorkVersion: 3, subject: v1.subject, bodyEn: `${v1.body_en}\nPlease share annual volume.`, bodyCn: `${v1.body_cn}\n请提供年用量。`, idempotencyKey: 'revise-1' });
assert.strictEqual(v2.revision, 2);
assert.strictEqual(review.getVersion(db, { actorUserId: 1, versionId: v1.id }).status, 'superseded');
```

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/test-matrix-stream-review.js`  
Expected: FAIL with module-not-found for `matrixStreamReview`.

- [ ] **Step 3: Implement canonical hashing and transactions**

Implement `contentHash` from normalized recipient, source binding, subject, English body, and Chinese body:

```js
function contentHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify({
    recipient: normalizeEmail(value.recipientEmail),
    source: String(value.recipientSourceUrl),
    subject: String(value.subject).trim(),
    body_en: normalizeBody(value.bodyEn),
    body_cn: normalizeBody(value.bodyCn)
  })).digest('hex');
}
```

Use `db.transaction(...).immediate()` for create/revise/approve. Check ownership, expected work-item version, public-company kind, HTTPS source, valid timestamp, freshness no older than `MATRIX_RECIPIENT_MAX_AGE_DAYS` default `180`, and suppression state. Insert one append-only event per successful transition. Replaying the same idempotency key returns the recorded result.

- [ ] **Step 4: Write RED bilingual revision tests**

Inject a JSON provider and require an exact output shape:

```js
const textService = createMatrixStreamText({
  callJson: async () => ({ subject: 'Short proposal for Alpha', body_en: 'Dear Alpha team,\nCould you share annual volume?\nBest regards', body_cn: '您好，请问能否提供年用量？' })
});
const revised = await textService.revise({ current: v1, instruction: '语气更简洁，询问年用量' });
assert.strictEqual(revised.subject, 'Short proposal for Alpha');
assert.match(revised.body_en, /annual volume/i);
assert.match(revised.body_cn, /年用量/);
await assert.rejects(() => createMatrixStreamText({ callJson: async () => ({ body_en: 'missing fields' }) }).revise({ current: v1, instruction: '简化' }), /invalid bilingual output/i);
```

Run: `node scripts/test-matrix-stream-review.js`  
Expected: FAIL because `matrixStreamText` does not exist.

- [ ] **Step 5: Implement the bounded text provider**

Expose a generic JSON call in `src/services/aiProvider.js` that accepts a caller-owned exact key set, timeout, and maximum token count. `matrixStreamText` requires exactly `subject`, `body_en`, and `body_cn` for revision, and exactly `translation_cn`, `requirements_cn`, `suggested_subject`, `suggested_body_en`, and `suggested_body_cn` for inbound handling. Reject extra keys, empty bodies, URLs introduced by the model, prices not present in the source snapshot, and qualification claims not present in public evidence. The service receives no SMTP configuration and performs no delivery.

When `MATRIX_TEXT_PROVIDER=mock` or provider credentials are unavailable, initial deterministic drafts remain usable, but free-form revision/translation returns an explicit `text_provider_unavailable` result and creates no new version. It must never silently claim a revision or translation succeeded.

- [ ] **Step 6: Add stale, concurrent, and immutable tests**

Assert stale expected versions fail, replay returns the same version, changing any content changes the hash, old approval is superseded, and direct update/delete of event rows fails with `append-only`.

- [ ] **Step 7: Run and commit**

Run: `node scripts/test-matrix-stream-review.js`  
Expected: PASS.  
Commit: `feat: add matrix stream review versions`

---

### Task 2A: Explainable Quality, Identity, Readiness, and Follow-up Gates

**Files:**
- Create: `src/services/matrixStreamGate.js`
- Create: `src/services/matrixStreamReadiness.js`
- Create: `src/services/matrixStreamFollowup.js`
- Create: `scripts/test-matrix-stream-gates.js`
- Create: `scripts/matrix-policy.js`
- Create: `scripts/test-matrix-policy.js`
- Modify: `src/services/matrixStreamReview.js`

**Interfaces:**
- Produces `scoreDraft(input): { score, passed, components, hardFailures }`.
- Produces `evaluateInitialContact(db, input): { allowed, route, reasons, matchedCustomerIds }`.
- Produces `createMatrixStreamReadiness({ resolveTxt, verifyTransport, clock }).check(input)`.
- Produces `thirdWeekdayAtTen(sentAt): string`, `scheduleReplyCheck(db, input)`, and `closeReplyCheck(db, input)`.
- Produces an operator tool with only `list` and `set` commands; `set` requires an existing `super_admin` actor and writes `audit_logs`.

- [ ] **Step 1: Write the RED quality and hard-failure tests**

Create `scripts/test-matrix-stream-gates.js` with a complete evidence fixture:

```js
const assert = require('node:assert');
const { scoreDraft } = require('../src/services/matrixStreamGate');
const base = {
  subject: '250g and 500g coffee pouch options for Alpha Coffee',
  bodyEn: 'Dear Alpha Coffee team,\nWe reviewed your 250g and 500g roasted coffee range. We would like to discuss high-barrier valve pouches with stable repeat printing. Could you share your current structure and annual volume?\nBest regards',
  bodyCn: '您好，我们查看了贵司250g和500g烘焙咖啡产品，希望沟通高阻隔带阀袋及稳定套色。请问当前材料结构和年用量？',
  recipient: { email: 'sales@alpha.test', sourceUrl: 'https://alpha.test/contact', verifiedAt: '2026-07-17T00:00:00Z' },
  evidence: { company: 'Alpha Coffee', categories: ['coffee'], products: ['250g roasted coffee', '500g roasted coffee'], entryProduct: 'high-barrier valve pouch', supportedClaims: ['stable repeat printing'], evidenceIds: [11, 12] },
  now: '2026-07-18T00:00:00Z'
};
const good = scoreDraft(base);
assert.strictEqual(good.score, 100);
assert.strictEqual(good.passed, true);
const unsafe = scoreDraft({ ...base, subject: 'Guaranteed lowest price', bodyEn: 'FDA approved. Final price is USD 0.05 with guaranteed lead time.' });
assert.strictEqual(unsafe.passed, false);
assert.deepStrictEqual(unsafe.hardFailures.sort(), ['unsupported_certification', 'unsupported_lead_time', 'unsupported_price']);
```

- [ ] **Step 2: Run quality test and verify RED**

Run: `node scripts/test-matrix-stream-gates.js`
Expected: FAIL with module-not-found for `matrixStreamGate`.

- [ ] **Step 3: Implement deterministic 100-point scoring**

Use exact component maxima:

```js
const MAXIMUMS = {
  product_match: 20, company_specific: 15, entry_value: 15, questions: 15,
  subject: 10, bilingual_consistency: 10, readability: 10, recipient_provenance: 5
};
```

Each component returns `{ points, maximum, reasons, evidence_ids }`. Set `passed = score >= 80 && hardFailures.length === 0`. Detect unsupported price, certification, supplier, performance, delivery, and lead-time claims by comparing normalized claims to `evidence.supportedClaims`; AI output never changes points directly.

- [ ] **Step 4: Write RED identity, cooling, and quota tests**

Seed CRM customers, messages, orders, and accepted jobs, then assert:

```js
const { evaluateInitialContact } = require('../src/services/matrixStreamGate');
assert.strictEqual(evaluateInitialContact(db, { email: 'sales@alpha.test', domain: 'alpha.test', companyName: 'Alpha Coffee', now: '2026-07-18T00:00:00Z' }).route, 'existing_relationship');
assert.strictEqual(evaluateInitialContact(db, { email: 'new@cooling.test', domain: 'cooling.test', companyName: 'Cooling Ltd', now: '2026-07-18T00:00:00Z' }).reasons[0], 'domain_cooling_90_days');
assert.strictEqual(evaluateInitialContact(db, { email: 'sixth@fresh.test', domain: 'fresh.test', companyName: 'Fresh Ltd', now: '2026-07-18T14:00:00+08:00' }).reasons[0], 'daily_accepted_limit_5');
```

Exact normalized email/domain matches route automatically. Similar name with a different domain returns `possible_duplicate_review` and never merges.

- [ ] **Step 5: Implement fail-closed identity evaluation**

Query customers, inquiries, orders, CRM messages, suppression events, accepted jobs, and candidate aliases in one read transaction. Use Asia/Shanghai day boundaries and a 90-day domain window. Return `initial_contact`, `existing_relationship`, `possible_duplicate_review`, or `blocked`; never delete or merge rows.

- [ ] **Step 6: Write and implement sender-readiness tests**

Inject TXT and transport verifiers:

```js
const readiness = createMatrixStreamReadiness({
  clock: () => new Date('2026-07-18T00:00:00Z'),
  resolveTxt: async name => ({
    'sender.test': ['v=spf1 include:mail.test -all'],
    'selector._domainkey.sender.test': ['v=DKIM1; p=abc'],
    '_dmarc.sender.test': ['v=DMARC1; p=none']
  })[name] || [],
  verifyTransport: async () => true
});
assert.strictEqual((await readiness.check({ domain: 'sender.test', selector: 'selector' })).ok, true);
```

Cache for 24 hours in `matrix_stream_sender_checks`. Missing SPF, DKIM, DMARC, TLS, SMTP verification, selector, or unexpired approved country/channel policy returns named hard failures. The check never calls `sendMail`.

Create `scripts/test-matrix-policy.js` first. Assert a worker and a missing actor are rejected; a super admin can set one exact ISO country plus channel to `approved`, `paused`, or `blocked` only when the review time, expiry, and at least one authoritative source URL are supplied; expired policy fails closed; every change writes a redacted `audit_logs` row. Implement `scripts/matrix-policy.js list` and `set` with positional-free named flags, no bulk wildcard, and no default approval. It must not contain transport code.

- [ ] **Step 7: Write and implement third-weekday task tests**

```js
const { thirdWeekdayAtTen } = require('../src/services/matrixStreamFollowup');
assert.strictEqual(thirdWeekdayAtTen('2026-07-17T14:00:00+08:00'), '2026-07-22T10:00:00+08:00');
```

`scheduleReplyCheck` writes `next_followup_at`, purpose, channel, priority, work-item id, and originating job id exactly once after accepted delivery. `closeReplyCheck` records terminal reason and clears active due state for reply, bounce, refusal, unsubscribe, or manual stop. It never sends.

- [ ] **Step 8: Persist quality during version creation and run GREEN**

Call `scoreDraft` inside create/revise transactions and store `quality_score` plus canonical `quality_json`. Approval is allowed below 80 for internal review, but final preview reports blocked and send confirmation rejects it.

Run:

```bash
node scripts/test-matrix-stream-gates.js
node scripts/test-matrix-policy.js
node scripts/test-matrix-stream-review.js
```

Expected: PASS.
Commit: `feat: add matrix stream safety gates`

---

### Task 3: Narrow Matrix Review APIs

**Files:**
- Modify: `src/routes/matrix.js`
- Modify: `src/server.js`
- Modify: `scripts/test-matrix-api.js`

**Interfaces:**
- Produces `POST /api/matrix/work-items/:id/versions`.
- Produces `POST /api/matrix/work-items/:id/versions/:versionId/approve`.
- Produces `GET /api/matrix/work-items/:id/versions/:versionId/preview`.
- Consumes only server-loaded candidate detail and persisted version data.

- [ ] **Step 1: Write failing API tests**

Seed `permissions_json` with `{"modules":{"crm":true},"capabilities":{"matrixSend":true}}`, then add:

```js
const created = await request(`/api/matrix/work-items/${firstSelection.body.work_item_id}/versions`, {
  method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
  body: { expected_work_version: 1, idempotency_key: 'draft-api-1' }
});
assert.strictEqual(created.status, 201);
assert.strictEqual(created.body.revision, 1);
assert.strictEqual(created.body.recipient_email, 'team@alpha.test');
assert.ok(created.body.recipient_source_url.startsWith('https://'));
assert.strictEqual((await request(`/api/matrix/work-items/${firstSelection.body.work_item_id}/versions`, {
  method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: { expected_work_version: 2, recipient_email: 'other@outside.test', idempotency_key: 'bad-field' }
})).status, 400);
const approved = await request(`/api/matrix/work-items/${firstSelection.body.work_item_id}/versions/${created.body.id}/approve`, {
  method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
  body: { expected_work_version: created.body.work_item_version, expected_content_hash: created.body.content_hash, idempotency_key: 'approve-api-1' }
});
assert.strictEqual(approved.status, 200);
```

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/test-matrix-api.js`  
Expected: FAIL with HTTP 404 for the versions endpoint.

- [ ] **Step 3: Implement endpoint factories and dependency injection**

Change the router signature to:

```js
function createMatrixRouter({ db, audit, candidateDbPath = process.env.MATRIX_STREAM_DB_PATH, clock, reviewService = require('../services/matrixStreamReview'), deliveryService } = {})
```

The version endpoint accepts only `expected_work_version`, `base_version_id`, `revision_instruction`, and `idempotency_key`. With no base/instruction it loads the owned work item and `view.detail(item.candidate_id, { revealContacts: true })`, derives the recipient source from official evidence/contact page, and creates the deterministic initial draft. With both base and instruction it invokes the bounded bilingual text service and creates a new immutable revision; supplying only one is rejected. The approve endpoint accepts only expected version/hash and idempotency key. The preview endpoint returns persisted content and eligibility; it performs no delivery.

- [ ] **Step 4: Add permission and stale-card tests**

Verify inactive binding, another owner, worker role, unknown fields, stale version/hash, missing public email, contact-form-only candidate, and missing source evidence all fail without inserting a version/event.

- [ ] **Step 5: Run and commit**

Run:

```bash
node scripts/test-matrix-api.js
node scripts/test-packet-gate.js
```

Expected: PASS.  
Commit: `feat: expose matrix stream review api`

---

### Task 4: Restricted Single-Message Delivery

**Files:**
- Create: `src/services/matrixStreamDelivery.js`
- Create: `scripts/test-matrix-stream-delivery.js`
- Modify: `src/routes/matrix.js`
- Modify: `scripts/test-matrix-api.js`

**Interfaces:**
- Produces `createMatrixStreamDelivery({ db, transport, clock, fromAddress, messageIdDomain })`.
- Produces method `confirm({ actorUserId, bindingId, workItemId, versionId, expectedWorkVersion, expectedContentHash, chatId, cardEventId, idempotencyKey })`.
- Consumes current `matrixStreamGate` and `matrixStreamReadiness` results; accepted delivery calls `matrixStreamFollowup.scheduleReplyCheck`.
- Route: `POST /api/matrix/work-items/:id/versions/:versionId/send` accepts identifiers only.

- [ ] **Step 1: Write fake-transport RED tests**

In `scripts/test-matrix-stream-delivery.js`, construct approved fixtures and inject:

```js
const accepted = [];
const service = createMatrixStreamDelivery({
  db,
  fromAddress: 'sales@sender.test',
  messageIdDomain: 'sender.test',
  clock: () => new Date('2026-07-17T00:00:00Z'),
  transport: { sendMail: async mail => { accepted.push(mail); return { accepted: [mail.to], rejected: [], messageId: mail.messageId }; } }
});
const result = await service.confirm({ actorUserId: senderId, bindingId, workItemId, versionId, expectedWorkVersion, expectedContentHash, chatId: 'chat-1', cardEventId: 'card-send-1', idempotencyKey: 'send-1' });
assert.strictEqual(result.state, 'accepted');
assert.strictEqual(accepted.length, 1);
assert.strictEqual(accepted[0].to, 'sales@alpha.test');
assert.strictEqual(accepted[0].text, approvedBody);
assert.match(accepted[0].messageId, /^<matrix-stream-/);
assert.deepStrictEqual(await service.confirm({ actorUserId: senderId, bindingId, workItemId, versionId, expectedWorkVersion, expectedContentHash, chatId: 'chat-1', cardEventId: 'card-send-1', idempotencyKey: 'send-1' }), result);
assert.strictEqual(accepted.length, 1);
```

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/test-matrix-stream-delivery.js`  
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement fail-closed delivery transaction**

Before transport, reload the actor permissions, work item, approved version, suppression state, current version, content hash, recipient provenance, quality result, company identity/cooling/quota result, sender readiness, and country/channel policy. Insert a unique pending job with a stable message id derived from job id and content hash, then mark `sending`. Call transport with only:

```js
await transport.sendMail({
  from: fromAddress,
  to: version.recipient_email,
  subject: version.subject,
  text: version.body_en,
  messageId: job.message_id,
  headers: { 'X-Matrix-Stream-Version': String(version.id) }
});
```

Classify explicit rejection as `failed`; classify timeout/disconnect after `sending` as `ambiguous`; accepted recipient as `accepted`. On accepted only, schedule the third-weekday reply-check task in the same durable result transaction. Redact credentials and raw server strings from diagnostics. Never retry internally.

- [ ] **Step 4: Add definite failure, ambiguity, permission, and concurrency tests**

Use injected transports that reject with `responseCode=550`, throw `ETIMEDOUT`, and block two concurrent confirmations. Assert failed allows a new deliberate idempotency key, ambiguous blocks resend, missing `capabilities.matrixSend` never calls transport, and two identical clicks call transport once.

- [ ] **Step 5: Add the narrow send endpoint and API tests**

The route accepts exactly:

```js
new Set(['expected_work_version', 'expected_content_hash', 'chat_id', 'card_event_id', 'idempotency_key'])
```

It must not accept recipient, subject, body, SMTP host, callback URL, attachment, or retry flag. Add assertions for each rejected field.

- [ ] **Step 6: Run and commit**

Run:

```bash
node scripts/test-matrix-stream-delivery.js
node scripts/test-matrix-api.js
```

Expected: PASS.  
Commit: `feat: add restricted matrix stream delivery`

---

### Task 5: Inbound Correlation and Notification Queue

**Files:**
- Create: `src/services/matrixStreamCorrelation.js`
- Create: `scripts/test-matrix-stream-correlation.js`
- Modify: `src/lib/imapSync.js`
- Modify: `.runtime/vm_debug_ci/workspace/scripts/matrix-watch.js`
- Modify: `.runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`

**Interfaces:**
- Produces `correlateInbound(db, emailMessage, options)` returning `{ status: 'matched'|'needs_review'|'unmatched', workItemId?, jobId?, kind? }`.
- Produces one durable notification spool record per matched reply.
- Consumes `matrixStreamText.translateInbound`; if unavailable, queues a clearly labeled translation-pending notification and never fabricates translated content.

- [ ] **Step 1: Write RED correlation tests**

Create accepted job fixtures, then assert:

```js
const exact = correlateInbound(db, { message_id: '<reply-1@test>', in_reply_to: sentMessageId, references_header: sentMessageId, from_email: 'sales@alpha.test', to_emails: 'sales@sender.test', subject: 'Re: A focused proposal', cleaned_text: 'Please send specifications.' });
assert.deepStrictEqual(exact.status, 'matched');
assert.strictEqual(exact.kind, 'reply');
const ambiguous = correlateInbound(db, { message_id: '<reply-2@test>', from_email: 'sales@alpha.test', to_emails: 'sales@sender.test', subject: 'Re: A focused proposal', cleaned_text: 'Hello' });
assert.strictEqual(ambiguous.status, 'needs_review');
```

Add delivery-status and unsubscribe fixtures and assert work-item states become `bounced` and `suppressed` respectively.

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/test-matrix-stream-correlation.js`  
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement deterministic matching**

Match exact `in_reply_to`/`references_header` to `matrix_stream_jobs.message_id` first. Fallback only when normalized contact pair and normalized subject identify exactly one accepted job inside 120 days. More than one result inserts a `needs_review` event and changes no work item. Deduplicate by inbound `message_id`.

For a unique reply, update `stream_state='replied'`, close the active reply-check task with reason `reply`, append an event, request validated translation/suggested-reply fields from `matrixStreamText`, and atomically write a notification spool record containing IDs plus a safe preview—not credentials or private internal formulas. Provider failure stores `translation_status='pending'` and exposes a manual retry; it does not insert guessed translation. Bounce, refusal, unsubscribe, and manual stop close the task with their exact terminal reason.

- [ ] **Step 4: Hook correlation after durable IMAP import**

In `src/lib/imapSync.js`, call the injected/default correlation function only after `email_messages` insert/update commits. Correlation failure increments sync error diagnostics but does not roll back the durable inbound message.

- [ ] **Step 5: Render reply notifications**

Extend the watcher/extension card with original text preview, Chinese summary/translation field, extracted requirements, work-item state, and a `View reply draft` action. The action starts a new `draft_pending` review; it never sends.

- [ ] **Step 6: Run and commit**

Run:

```bash
node scripts/test-matrix-stream-correlation.js
node scripts/verify-imap-sync.js
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
```

Expected: PASS or, when IMAP production credentials are intentionally absent, the verifier reports configuration absent without modifying data.  
Commit: `feat: correlate matrix stream replies`

---

### Task 6: Feishu Two-Confirmation Cards and Revision Context

**Files:**
- Modify: `.runtime/vm_debug_ci/workspace/scripts/matrix-client.js`
- Modify: `.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs`
- Modify: `.runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`

**Interfaces:**
- Client adds `createVersion`, `reviseVersion`, `approveVersion`, `versionPreview`, and `confirmSend` using the fixed `/api/matrix` origin.
- Card actions add neutral identifiers `mx.review`, `mx.revise`, `mx.approve`, `mx.preview`, and `mx.confirm`.

- [ ] **Step 1: Write the full RED card-flow test**

Drive handlers in this order:

```js
await handlers.get('mx.select')({ evt, value: selectValue });
assert.deepStrictEqual(buttons(sent.at(-1)).map(item => item.text.content), ['确认采用', '修改草稿', '暂不处理']);
await handlers.get('mx.revise')({ evt, value: reviseValue });
assert.ok(visibleText(sent.at(-1)).includes('请回复“修改：……”'));
await registered.onMessage({ msg: { content: '修改：语气更简洁，询问年用量', chatId: evt.chatId, threadId: evt.threadId, senderId: evt.operator.openId } });
assert.strictEqual(clientCalls.at(-1)[0], 'reviseVersion');
await handlers.get('mx.approve')({ evt, value: approveValue });
assert.ok(visibleText(sent.at(-1)).includes('尚未发送'));
assert.ok(visibleText(sent.at(-1)).includes('sales@alpha.test'));
await handlers.get('mx.confirm')({ evt, value: confirmValue });
assert.ok(visibleText(sent.at(-1)).includes('邮件服务器已接受'));
```

Assert selection itself never calls `confirmSend`, approval never calls `confirmSend`, repeated confirmation uses one idempotency key, and the review/final cards stay within 1,500 Unicode code points. Add a blocked-preview fixture that displays quality score, component reasons, duplicate/cooling/quota result, sender readiness, and country-policy failures and does not render `确认发送`.

- [ ] **Step 2: Run and verify RED**

Run: `node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`  
Expected: FAIL because review actions and client methods do not exist.

- [ ] **Step 3: Add fixed-origin client methods**

Each method validates an exact field set and positive identifiers. `confirmSend` sends no content fields:

```js
function confirmSend(openId, workItemId, versionId, input) {
  const body = exactObject(input, new Set(['expected_work_version', 'expected_content_hash', 'chat_id', 'card_event_id', 'idempotency_key']), 'send confirmation');
  return call(openId, `/work-items/${positiveId(workItemId, 'work item id')}/versions/${positiveId(versionId, 'version id')}/send`, { method: 'POST', body });
}
```

- [ ] **Step 4: Implement short-lived revision context and cards**

Bind edit context by `sessionKey(chatId, openId, threadId)` with work item, base version, and ten-minute expiry. Only the same operator/context message beginning `修改：` is consumed. Clear context on success, expiry, defer, or cancel. Render distinct accepted/failed/ambiguous cards; ambiguous exposes no retry action.

- [ ] **Step 5: Run and commit**

Run:

```bash
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
node .runtime/vm_debug_ci/workspace/tests/test-bridge-patch.js
node scripts/test-bridge-artifact-0.6.9.js
```

Expected: PASS.  
Commit: `feat: add matrix stream two-step cards`

---

### Task 7: Production-Surface Gate and Full Regression

**Files:**
- Modify: `scripts/verify-matrix-readonly-selection.js`
- Modify: `scripts/test-verify-matrix-readonly-selection.js`
- Modify: `.env.example`
- Modify: `docs/matrix-stream-catalog-2026-07-16.md`

**Interfaces:**
- Adds the new services to the reviewed runtime manifest.
- Permits only the reviewed main-application delivery source to contain transport capability; the bot surface remains outbound-free.

- [ ] **Step 1: Write RED verifier tests**

Add both new service files to a test surface and assert an unreviewed transport source is rejected. Assert the reviewed delivery source is accepted only when its digest matches and it contains all of these guards:

```js
source.includes('capabilities.matrixSend')
source.includes('version.content_hash !== input.expectedContentHash')
source.includes("state = 'ambiguous'")
source.includes('recipient_source_url')
!source.includes('attachments:')
```

Mutating the source to accept `input.to`, `input.subject`, `input.smtpHost`, a callback URL, or an automatic retry must make `approvedCapabilitySource('delivery', source)` return false.

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/test-verify-matrix-readonly-selection.js`  
Expected: FAIL because `delivery` is not an approved capability kind.

- [ ] **Step 3: Extend the reviewed surface**

Add `src/services/matrixStreamReview.js`, `src/services/matrixStreamText.js`, `src/services/matrixStreamGate.js`, `src/services/matrixStreamReadiness.js`, `src/services/matrixStreamFollowup.js`, `src/services/matrixStreamDelivery.js`, and `src/services/matrixStreamCorrelation.js` to `RUNTIME_SURFACE_ROOTS` and `RUNTIME_MANIFEST`. Add a digest-bound `delivery` branch to `approvedCapabilitySource`; preserve rejection for transport code in the bot extension/client/watcher.

Document these environment names without values in `.env.example`:

```dotenv
MATRIX_STREAM_SEND_ENABLED=0
MATRIX_RECIPIENT_MAX_AGE_DAYS=180
MATRIX_MESSAGE_ID_DOMAIN=
MATRIX_TEXT_PROVIDER=mock
MATRIX_DKIM_SELECTOR=
MATRIX_DAILY_ACCEPTED_LIMIT=5
MATRIX_DOMAIN_COOLING_DAYS=90
SMTP_HOST=
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

The production service must refuse send confirmation unless `MATRIX_STREAM_SEND_ENABLED=1`; tests inject transport and do not require this flag.

- [ ] **Step 4: Run the complete suite**

Run:

```bash
node scripts/test-matrix-stream-review.js
node scripts/test-matrix-stream-gates.js
node scripts/test-matrix-policy.js
node scripts/test-matrix-stream-delivery.js
node scripts/test-matrix-stream-correlation.js
node scripts/test-matrix-api.js
node scripts/test-admin-access-regression.js
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
node .runtime/vm_debug_ci/workspace/tests/test-bridge-patch.js
node scripts/test-bridge-artifact-0.6.9.js
MATRIX_STREAM_DB_PATH=/home/admin/work/packaging-system/data/matrix-stream.db npm run verify:matrix-readonly-selection
npm run lint
npm run build
```

Expected: all PASS; verifier reports `delivery_enabled: false` until the controlled rollout step.

- [ ] **Step 5: Commit**

Commit: `test: gate matrix stream review rollout`

---

### Task 8: Controlled Rollout and Real Acceptance

**Files:**
- Modify only deployment copies/configuration after all earlier commits pass.
- Preserve the current application and bot releases as rollback artifacts.

**Interfaces:**
- Main application exposes the reviewed endpoints.
- Bot image contains matching client/card hashes and no SMTP configuration.

- [ ] **Step 1: Back up and verify databases**

Run the existing database backup command, verify SQLite integrity `ok`, verify backup permissions `600`, and record checksums. Do not print secrets or full contact records.

- [ ] **Step 2: Deploy main application with sending disabled**

Build, restart, and verify `/health`, Matrix readiness, migrations, permission checks, and SMTP connection capability. Keep `MATRIX_STREAM_SEND_ENABLED=0` and prove a send endpoint returns the disabled response without creating a job.

- [ ] **Step 3: Deploy the immutable bot release**

Build an immutable release keyed by commit hash, preflight the Matrix API, retain the previous container under `vm_debug_ci_pre_<hash>`, switch, and verify healthy status, reviewed extension hash, and `MATRIX_DELIVERY_ENABLED=0`.

- [ ] **Step 4: Grant the explicit capability**

Using the authenticated Admin permission UI, grant `Matrix Stream 发送确认` only to the bound production operator. Verify the audit log contains old/new permission state and no credential value.

- [ ] **Step 5: Enable restricted sending and perform a no-send smoke**

Set `MATRIX_STREAM_SEND_ENABLED=1` in the protected main-application environment, restart only the main service, and verify the bot environment still has no SMTP variables. Open a candidate without confirming send; assert zero new `matrix_stream_jobs` and zero accepted events.

- [ ] **Step 6: Perform the user-controlled real acceptance**

The user selects one candidate with a verified public company email, reviews/revises the bilingual draft, clicks `确认采用`, verifies the final recipient/source/subject/body, then clicks `确认发送`. Confirm exactly one accepted job/event and one stored stable `Message-ID`. Do not select or send to any additional candidate.

- [ ] **Step 7: Verify reply loop or leave it pending honestly**

If the recipient replies during the acceptance window, verify exact correlation and one Feishu notification. Otherwise leave the work item `sent` with a three-business-day review suggestion; do not fabricate a reply or automatically follow up.

- [ ] **Step 8: Record rollback evidence and commit rollout documentation**

Record release hashes, health results, enabled operator, job/event counts, and rollback container names without message bodies or credentials.  
Commit: `docs: record matrix stream review rollout`

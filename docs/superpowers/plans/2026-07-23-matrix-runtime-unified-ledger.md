# Matrix Runtime Unified Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the management database the sole authority for customer identity, versioned drafts, approvals, deliveries, inbound correlation, and follow-up tasks used by both the current Codex session and the Feishu assistant.

**Architecture:** Extend the existing `matrix_*` SQLite ledger and services instead of adding another database. Add an idempotent migration service that imports reliable legacy records and quarantines ambiguous records, expose the canonical lifecycle through the existing `/api/matrix` router, update both clients to use those APIs, and fail closed after disabling legacy direct-delivery paths.

**Tech Stack:** Node.js 22.22.0, CommonJS services, Express, better-sqlite3, Nodemailer behind `matrixRelayFactory`, ImapFlow synchronization, node-cron, Feishu card extension, `node:test`/assert-style repository tests.

## Global Constraints

- Use neutral technical codenames for skills, scripts, folders, workflow labels, and user-visible capability names.
- The management database is the only operational source of truth.
- SMTP credentials remain only in `/etc/packaging-system/smtp.env`; never print or copy their values.
- Current-session and Feishu clients may not call SMTP or write operational SQLite tables directly.
- Every external message requires a complete final preview followed by one explicit final confirmation.
- An approved version is immutable and identified by its content hash.
- Duplicate, ambiguous, stale, bounced, or suppressed states fail closed.
- Accepted SMTP means queued by the transport, not inbox placement or reading.
- Follow-up timing uses three calendar days with no weekday/weekend distinction.
- Historical records migrate only on deterministic evidence; uncertain records enter a review queue.
- After verified cutover, legacy send paths are disabled immediately and may not be used as fallback.
- Actual customer records, message bodies, credentials, and delivery identifiers remain in protected authoritative storage, not the user-level catalog.

---

## File Structure

New focused units:

- `src/services/matrixLedgerStore.js`: canonical customer/contact/thread/task reads and writes.
- `src/services/matrixLedgerMigration.js`: deterministic legacy matching, dry-run, apply, and reconciliation.
- `src/services/matrixLedgerCommand.js`: interface-neutral preview and final-confirmation orchestration.
- `src/services/matrixLedgerCutover.js`: legacy-path state and fail-closed enforcement.
- `scripts/run-matrix-ledger-migration.js`: protected migration CLI.
- `scripts/run-matrix-ledger-command.js`: protected current-session API client.
- `scripts/verify-matrix-ledger-cutover.js`: static and runtime cutover audit.
- `scripts/test-matrix-ledger-store.js`: schema/repository tests.
- `scripts/test-matrix-ledger-migration.js`: migration and idempotency tests.
- `scripts/test-matrix-ledger-command.js`: preview/approval/delivery orchestration tests.
- `scripts/test-matrix-ledger-inbox.js`: bounce/reply/follow-up tests.
- `scripts/test-matrix-ledger-cutover.js`: legacy-path failure tests.

Existing units to modify:

- `src/db.js`: canonical mapping, unresolved migration, lifecycle, and constraints.
- `src/routes/matrix.js`: canonical customer, preview, confirmation, thread, and task endpoints.
- `src/services/matrixStreamReview.js`: accept canonical contact/customer snapshots.
- `src/services/matrixStreamDelivery.js`: persist canonical lifecycle references and accepted follow-up.
- `src/services/matrixStreamCorrelation.js`: deterministic correlation into the canonical customer/thread.
- `src/services/matrixStreamFollowup.js`: three-calendar-day task creation and cancellation.
- `src/services/matrixInbox.js`: classification actions against canonical records.
- `src/services/matrixInboxScheduler.js`: lifecycle reconciliation after each synchronized folder.
- `.runtime/vm_debug_ci/workspace/scripts/matrix-client.js`: Feishu client for canonical APIs.
- `.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs`: complete preview and one-confirmation UI.
- `.runtime/vm_debug_ci/workspace/scripts/matrix-watch.js`: common state and inbound notification rendering.
- Corresponding runtime tests under `.runtime/vm_debug_ci/workspace/tests/`.
- `runtime-data-matrix-signal-private/SENDER_HANDOFF.md`: replace direct-delivery instructions with canonical API-only handoff.
- `/home/admin/.local/bin/matrix-runtime`: user-level wrapper installed from the reviewed project command.
- `/home/admin/.codex/matrix-runtime/resources/matrix-console.md`: verified capability evidence only, no business records.

---

### Task 1: Canonical Ledger Schema and Store

**Files:**
- Modify: `src/db.js`
- Create: `src/services/matrixLedgerStore.js`
- Create: `scripts/test-matrix-ledger-store.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `createMatrixLedgerStore({ db, clock })`
- Produces: `store.resolveCustomer(identity)`, `store.upsertContact(input)`, `store.recordThreadMessage(input)`, `store.createTask(input)`, `store.cancelTasks(input)`, and `store.customerSnapshot(customerId)`
- Consumes: existing `customers`, `crm_messages`, `email_messages`, `matrix_work_items`, `matrix_stream_versions`, and `matrix_stream_jobs`

- [ ] **Step 1: Write failing schema and repository tests**

Add fixtures that initialize a disposable database and assert:

```js
const assert = require('node:assert');
const { createMatrixLedgerStore } = require('../src/services/matrixLedgerStore');

const customer = store.resolveCustomer({
  candidateId: 84,
  companyName: 'Pagoda Foods (Malaysia) Sdn Bhd',
  normalizedDomain: 'pagoda.com.my',
  countryCode: 'MY'
});
assert.strictEqual(customer.canonical_customer_id > 0, true);
assert.strictEqual(
  store.resolveCustomer({ candidateId: 84 }).canonical_customer_id,
  customer.canonical_customer_id
);

const contact = store.upsertContact({
  customerId: customer.canonical_customer_id,
  channel: 'email',
  address: 'enquiry@pagoda.com.my',
  role: 'organizational',
  sourceUrl: 'https://pagoda.com.my/contact-us/',
  verifiedAt: '2026-07-23T00:00:00.000Z',
  status: 'active'
});
assert.strictEqual(contact.address, 'enquiry@pagoda.com.my');
assert.throws(() => store.upsertContact({
  ...contact,
  customerId: customer.canonical_customer_id + 1
}), /contact identity conflict/);
```

Also assert unique active task creation, immutable lifecycle events, revoked contact behavior, and snapshot exclusion of credential fields.

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
node scripts/test-matrix-ledger-store.js
```

Expected: FAIL because `matrixLedgerStore` and canonical tables do not exist.

- [ ] **Step 3: Add canonical tables and constraints**

Extend `src/db.js` with:

```sql
CREATE TABLE IF NOT EXISTS matrix_customer_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_customer_id INTEGER NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('customer','candidate','legacy_registry','protected_mapping')),
  source_id TEXT NOT NULL,
  normalized_domain TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL CHECK(confidence IN ('deterministic','reviewed')),
  created_at TEXT NOT NULL,
  UNIQUE(source_kind, source_id)
);

CREATE TABLE IF NOT EXISTS matrix_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_customer_id INTEGER NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('email','whatsapp','phone','contact_form')),
  address TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','revoked','unverified')),
  revoked_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(channel, address)
);

CREATE TABLE IF NOT EXISTS matrix_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_customer_id INTEGER NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('email','whatsapp')),
  conversation_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active','waiting_customer','waiting_internal','closed','unresolved')),
  last_message_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(channel, conversation_key)
);

CREATE TABLE IF NOT EXISTS matrix_thread_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('email_message','crm_message','legacy_delivery')),
  source_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
  classification TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(source_kind, source_id)
);

CREATE TABLE IF NOT EXISTS matrix_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_customer_id INTEGER NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  task_type TEXT NOT NULL CHECK(task_type IN ('check_reply','review_reply','replace_contact','delivery_review','review_unresolved')),
  due_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','completed','cancelled','blocked')),
  priority TEXT NOT NULL DEFAULT 'normal',
  next_action TEXT NOT NULL DEFAULT '',
  cancellation_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_kind, source_id, task_type)
);

CREATE TABLE IF NOT EXISTS matrix_lifecycle_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_customer_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  actor_user_id INTEGER,
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
```

Add indexes for customer, contact, thread, task state/due time, and lifecycle event lookup. Add append-only update/delete triggers for `matrix_lifecycle_events`.

- [ ] **Step 4: Implement the store**

Create `matrixLedgerStore.js` with normalized domain/email helpers, immediate transactions, deterministic conflict handling, and these exports:

```js
module.exports = {
  createMatrixLedgerStore,
  normalizeDomain,
  normalizeAddress
};
```

`resolveCustomer()` must first use a unique source link, then an exact active contact, then a normalized verified domain. It must throw on multiple matches and never use product similarity or telephone suffixes.

- [ ] **Step 5: Run tests**

Run:

```bash
node scripts/test-matrix-ledger-store.js
npm run verify:matrix-relay-schema
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db.js src/services/matrixLedgerStore.js scripts/test-matrix-ledger-store.js package.json
git commit -m "feat: add canonical matrix ledger"
```

---

### Task 2: Idempotent Historical Migration and Review Queue

**Files:**
- Modify: `src/db.js`
- Create: `src/services/matrixLedgerMigration.js`
- Create: `scripts/run-matrix-ledger-migration.js`
- Create: `scripts/test-matrix-ledger-migration.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `createMatrixLedgerStore`
- Produces: `createMatrixLedgerMigration({ db, candidateDb, store, clock })`
- Produces: `migration.scan(sources)`, `migration.apply(plan, { actorUserId, idempotencyKey })`
- Produces report shape `{ imported, matched, unresolved, skipped, conflicts, fingerprints }`

- [ ] **Step 1: Write failing migration tests**

Create fixtures for candidate rows, current customers, legacy registry rows, exact draft bodies, private evidence metadata, Sent messages, replies, bounces, and ambiguous records.

Assert:

```js
const first = migration.apply(migration.scan(fixtures), {
  actorUserId: 1,
  idempotencyKey: 'migration-fixture-1'
});
assert.deepStrictEqual(first.counts, {
  imported: 8,
  matched: 5,
  unresolved: 3,
  skipped: 0,
  conflicts: 1
});

const second = migration.apply(migration.scan(fixtures), {
  actorUserId: 1,
  idempotencyKey: 'migration-fixture-2'
});
assert.strictEqual(second.counts.imported, 0);
assert.strictEqual(second.counts.unresolved, 0);
```

Add negative fixtures proving that a shared public mailbox, telephone suffix, product specification, and semantic similarity do not auto-link.

- [ ] **Step 2: Run and verify failure**

Run:

```bash
node scripts/test-matrix-ledger-migration.js
```

Expected: FAIL because migration tables and service are absent.

- [ ] **Step 3: Add migration tables**

Add:

```sql
CREATE TABLE IF NOT EXISTS matrix_migration_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK(mode IN ('dry_run','apply')),
  source_fingerprint TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matrix_migration_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  resolution TEXT NOT NULL CHECK(resolution IN ('imported','matched','unresolved','skipped','conflict')),
  canonical_customer_id INTEGER,
  reason_code TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(source_kind, source_id, source_fingerprint)
);

CREATE TABLE IF NOT EXISTS matrix_unresolved_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  review_payload_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','resolved','dismissed')),
  resolved_customer_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_kind, source_id, source_fingerprint)
);
```

- [ ] **Step 4: Implement deterministic migration**

Implement evidence ranking:

```js
const MATCH_RULES = [
  'explicit_source_id',
  'exact_official_email',
  'verified_domain_and_company',
  'exact_subject_and_body_hash',
  'message_reference_chain',
  'protected_explicit_mapping'
];
```

Return `unresolved` for any record that lacks one of these rules. Store only source paths and hashes for private evidence; copy the actual protected record into the canonical protected tables only when authorized by the migration run.

- [ ] **Step 5: Implement dry-run/apply CLI**

`run-matrix-ledger-migration.js` must require:

```text
--dry-run
--apply --report <protected-json-path> --idempotency-key <key>
```

It must refuse `--apply` unless the database backup preflight succeeds and the report path is under a permission-restricted runtime directory. Output counts only, never message bodies or credentials.

- [ ] **Step 6: Run migration tests twice**

Run:

```bash
node scripts/test-matrix-ledger-migration.js
node scripts/run-matrix-ledger-migration.js --dry-run
```

Expected: test PASS; dry-run returns counts and creates no operational rows.

- [ ] **Step 7: Commit**

```bash
git add src/db.js src/services/matrixLedgerMigration.js scripts/run-matrix-ledger-migration.js scripts/test-matrix-ledger-migration.js package.json
git commit -m "feat: add idempotent ledger migration"
```

---

### Task 3: Canonical Preview and One-Confirmation Command

**Files:**
- Create: `src/services/matrixLedgerCommand.js`
- Modify: `src/routes/matrix.js`
- Modify: `src/services/matrixStreamReview.js`
- Modify: `src/services/matrixStreamPreview.js`
- Modify: `src/services/matrixStreamDelivery.js`
- Create: `scripts/test-matrix-ledger-command.js`
- Modify: `scripts/test-matrix-api.js`

**Interfaces:**
- Consumes: canonical customer/contact/store and existing review/preview/delivery services
- Produces: `command.finalPreview(input)` and `command.confirmDelivery(input)`
- API:
  - `GET /api/matrix/customers/:customerId/final-preview`
  - `POST /api/matrix/customers/:customerId/final-preview/:versionId/confirm`

- [ ] **Step 1: Write failing command and API tests**

Test a complete preview:

```js
assert.deepStrictEqual(preview, {
  customer_id: customerId,
  customer_name: 'UNITEA Kazakhstan',
  contact_id: contactId,
  recipient: 'procurement@unitea.kz',
  subject: 'Tea pouch and roll-film review for one UNITEA SKU',
  body_en: exactBody,
  body_cn: exactChinese,
  attachments: [],
  version_id: versionId,
  content_hash: contentHash,
  allowed: true,
  blockers: []
});
```

Test that `确认采用`, candidate selection, and opening a preview create zero delivery jobs. Test that only exact `确认发送 UNITEA Kazakhstan` with the expected version/hash creates one job. Repeating it returns the same job result.

- [ ] **Step 2: Run and verify failure**

Run:

```bash
node scripts/test-matrix-ledger-command.js
```

Expected: FAIL because the orchestration service does not exist.

- [ ] **Step 3: Implement preview orchestration**

`finalPreview()` must:

```js
return Object.freeze({
  customer_id: customer.id,
  customer_name: customer.name,
  contact_id: contact.id,
  recipient: version.recipient_email,
  subject: version.subject,
  body_en: version.body_en,
  body_cn: version.body_cn,
  attachments: JSON.parse(version.attachment_manifest_json || '[]'),
  version_id: version.id,
  content_hash: version.content_hash,
  allowed: gate.allowed,
  blockers: gate.blockers
});
```

It must reject stale research, stale route readiness, inactive contact, quality score below threshold, suppression, sender-readiness failure, and an existing accepted/ambiguous delivery.

- [ ] **Step 4: Implement exact confirmation**

`confirmDelivery()` accepts only:

```js
{
  actorUserId,
  bindingId,
  customerId,
  versionId,
  expectedContentHash,
  confirmationText,
  chatId,
  cardEventId,
  idempotencyKey
}
```

Normalize only outer whitespace. Require exact `确认发送 ${customer.name}` or an explicitly labelled card action carrying the same version/hash. Persist approval before invoking `matrixStreamDelivery.confirm()`.

- [ ] **Step 5: Wire canonical routes**

Add authenticated routes with unknown-field rejection, actor binding, capability checks, ownership/admin checks, and existing API idempotency claim behavior.

- [ ] **Step 6: Run focused and existing regressions**

Run:

```bash
node scripts/test-matrix-ledger-command.js
node scripts/test-matrix-api.js
node scripts/test-matrix-stream-review.js
node scripts/test-matrix-stream-preview.js
node scripts/test-matrix-stream-delivery.js
```

Expected: all PASS; duplicate send count remains one.

- [ ] **Step 7: Commit**

```bash
git add src/services/matrixLedgerCommand.js src/routes/matrix.js src/services/matrixStreamReview.js src/services/matrixStreamPreview.js src/services/matrixStreamDelivery.js scripts/test-matrix-ledger-command.js scripts/test-matrix-api.js
git commit -m "feat: unify preview and delivery confirmation"
```

---

### Task 4: Reply, Bounce, Attachment, and Follow-Up Lifecycle

**Files:**
- Modify: `src/services/matrixStreamCorrelation.js`
- Modify: `src/services/matrixStreamFollowup.js`
- Modify: `src/services/matrixInbox.js`
- Modify: `src/services/matrixInboxScheduler.js`
- Modify: `src/services/matrixThreadContext.js`
- Create: `scripts/test-matrix-ledger-inbox.js`
- Modify: `scripts/test-matrix-stream-correlation.js`
- Modify: `scripts/test-matrix-inbox-scheduler.js`

**Interfaces:**
- Consumes: canonical store, synchronized `email_messages`, attachment records, delivery jobs
- Produces: `reconcileLifecycle({ emailMessageId })`
- Produces: one canonical task per delivery/reply/bounce state

- [ ] **Step 1: Write failing lifecycle tests**

Fixtures must cover:

```js
assert.strictEqual(realReply.classification, 'customer_reply');
assert.strictEqual(realReply.customer_id, customerId);
assert.strictEqual(store.pendingTasks(customerId, 'check_reply').length, 0);
assert.strictEqual(store.pendingTasks(customerId, 'review_reply').length, 1);

assert.strictEqual(permanentBounce.classification, 'permanent_bounce');
assert.strictEqual(store.contact(contactId).status, 'revoked');
assert.throws(() => command.finalPreview({ customerId }), /active contact/);

assert.strictEqual(temporaryDelay.classification, 'temporary_delay');
assert.strictEqual(store.pendingTasks(customerId, 'delivery_review').length, 1);

assert.strictEqual(automaticReply.classification, 'automatic_reply');
assert.strictEqual(store.pendingTasks(customerId, 'check_reply')[0].due_at, returnDate);

assert.strictEqual(unresolved.customer_id, null);
assert.strictEqual(store.unresolved().length, 1);
```

Also assert that a synchronized attachment belongs to the same canonical thread and cannot be reused externally while quarantined.

- [ ] **Step 2: Run and verify failure**

Run:

```bash
node scripts/test-matrix-ledger-inbox.js
```

Expected: FAIL because canonical reconciliation actions are missing.

- [ ] **Step 3: Implement deterministic correlation order**

Apply correlation in this order:

```js
const CORRELATION_ORDER = [
  'message_reference_chain',
  'exact_contact',
  'verified_organization_domain',
  'normalized_thread_subject',
  'explicit_source_mapping'
];
```

Stop and create an unresolved record when a step returns multiple customers. Never continue to a weaker rule after an ambiguous stronger rule.

- [ ] **Step 4: Implement classification actions**

Persist a lifecycle event and:

- customer reply: cancel `check_reply`, create `review_reply`;
- permanent bounce: revoke contact, cancel `check_reply`, create `replace_contact`;
- temporary delay: create `delivery_review`;
- automatic reply: reschedule `check_reply` only when a parsed return date is reliable;
- noise: archive without a customer task;
- unresolved: create `review_unresolved`.

- [ ] **Step 5: Enforce three-calendar-day follow-up**

Change accepted-delivery scheduling to:

```js
const dueAt = new Date(Date.parse(acceptedAt) + 3 * 86400000).toISOString();
```

Before generating a follow-up draft, recheck reply, bounce, automatic-reply date, contact status, suppression, and existing follow-up delivery.

- [ ] **Step 6: Reconcile after each inbox folder cycle**

After `INBOX` synchronization, process only newly inserted IDs. After `Sent` synchronization, bind outbound records to delivery jobs. Lifecycle reconciliation failure must leave ingestion successful and create a retryable internal job.

- [ ] **Step 7: Run focused regressions**

Run:

```bash
node scripts/test-matrix-ledger-inbox.js
node scripts/test-matrix-stream-correlation.js
node scripts/test-matrix-inbox-scheduler.js
node scripts/test-matrix-inbox-import.js
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/services/matrixStreamCorrelation.js src/services/matrixStreamFollowup.js src/services/matrixInbox.js src/services/matrixInboxScheduler.js src/services/matrixThreadContext.js scripts/test-matrix-ledger-inbox.js scripts/test-matrix-stream-correlation.js scripts/test-matrix-inbox-scheduler.js
git commit -m "feat: reconcile replies and follow-up tasks"
```

---

### Task 5: Shared Current-Session and Feishu Clients

**Files:**
- Create: `scripts/run-matrix-ledger-command.js`
- Modify: `.runtime/vm_debug_ci/workspace/scripts/matrix-client.js`
- Modify: `.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs`
- Modify: `.runtime/vm_debug_ci/workspace/scripts/matrix-watch.js`
- Create: `.runtime/vm_debug_ci/workspace/tests/test-matrix-ledger-client.js`
- Modify: `.runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`
- Modify: `.runtime/vm_debug_ci/workspace/tests/test-matrix-inbox-watch.js`
- Install after review: `/home/admin/.local/bin/matrix-runtime`

**Interfaces:**
- Consumes: canonical `/api/matrix` routes from Task 3
- Produces: identical customer snapshot, preview, confirmation, thread, and task views in both clients

- [ ] **Step 1: Write failing shared-client contract tests**

Use a fake API and assert both clients render:

```js
{
  customer_id: 115,
  stage: 'waiting_customer',
  last_delivery_state: 'accepted',
  pending_task: { type: 'check_reply', due_at: '2026-07-26T11:32:16.000Z' },
  next_action: '等待客户回复'
}
```

Assert the card includes recipient, subject, full body, attachment list, version ID, and one `确认发送 UNITEA Kazakhstan` action. Assert plain `确认`, `A`, and `确认采用` do not invoke confirmation.

- [ ] **Step 2: Run and verify failure**

Run:

```bash
node .runtime/vm_debug_ci/workspace/tests/test-matrix-ledger-client.js
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
```

Expected: at least one FAIL because clients still use separate state restoration.

- [ ] **Step 3: Implement the protected current-session command**

`run-matrix-ledger-command.js` supports:

```text
customer get --id <id>
preview get --customer-id <id>
delivery confirm --customer-id <id> --version-id <id> --content-hash <hash> --confirmation <exact-text> --idempotency-key <key>
thread list --customer-id <id>
task list --customer-id <id>
```

The script calls the localhost API with protected actor binding and prints sanitized JSON. It never opens SQLite or SMTP configuration.

- [ ] **Step 4: Update Feishu client and card**

Replace assistant-local customer stage, active-list, and delivery state with canonical API reads. Card buttons carry opaque customer/version/hash values and call only the canonical confirmation endpoint.

Render long text in copyable plain-text blocks after the card where required. Preserve quoted-message context so candidate choices cannot intercept pricing or other A–E choices.

- [ ] **Step 5: Add the user-level wrapper**

Install a reviewed wrapper:

```bash
#!/usr/bin/env bash
set -euo pipefail
exec /home/admin/.nvm/versions/node/v22.22.0/bin/node \
  /home/admin/work/packaging-system/scripts/run-matrix-ledger-command.js "$@"
```

Set mode `0750`, owner `admin:admin`, and register only its path and variable names in the user-level catalog.

- [ ] **Step 6: Run client regressions**

Run:

```bash
node .runtime/vm_debug_ci/workspace/tests/test-matrix-ledger-client.js
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-inbox-watch.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-choice-context.js
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/run-matrix-ledger-command.js .runtime/vm_debug_ci/workspace/scripts/matrix-client.js .runtime/vm_debug_ci/workspace/extensions/stream-card.cjs .runtime/vm_debug_ci/workspace/scripts/matrix-watch.js .runtime/vm_debug_ci/workspace/tests
git commit -m "feat: share canonical ledger across clients"
```

---

### Task 6: Legacy Path Cutover and Fail-Closed Audit

**Files:**
- Create: `src/services/matrixLedgerCutover.js`
- Create: `scripts/verify-matrix-ledger-cutover.js`
- Create: `scripts/test-matrix-ledger-cutover.js`
- Modify: `runtime-data-matrix-signal-private/SENDER_HANDOFF.md`
- Modify: `scripts/verify-matrix-readonly-selection.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `assertCanonicalDeliveryOnly({ db, sourceTree, runtimeTree })`
- Consumes: migration completion state and canonical service readiness

- [ ] **Step 1: Write failing cutover tests**

Create fixtures containing a direct `nodemailer.sendMail`, a writable legacy registry, a temporary sender script, a legacy HTTP endpoint, and a management-API outage.

Assert:

```js
assert.throws(() => audit.scan(directSenderTree), /direct delivery path/);
assert.throws(() => audit.scan(writableRegistry), /legacy ledger must be read-only/);
assert.throws(() => legacySend(), /canonical delivery required/);
assert.throws(() => client.confirm(input), /management service unavailable/);
assert.strictEqual(fallbackTransport.calls.length, 0);
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
node scripts/test-matrix-ledger-cutover.js
```

Expected: FAIL because cutover enforcement is absent.

- [ ] **Step 3: Implement cutover state**

Add one singleton state row:

```sql
CREATE TABLE IF NOT EXISTS matrix_runtime_state (
  state_key TEXT PRIMARY KEY,
  state_value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by INTEGER
);
```

Require `canonical_delivery_only=1` before production clients can confirm delivery. Once set after migration verification, no application endpoint may set it back to `0`.

- [ ] **Step 4: Replace the legacy handoff**

Update `SENDER_HANDOFF.md` to state:

- direct SMTP use is disabled;
- the only supported route is canonical preview plus confirmation API;
- historical CSV/private evidence is read-only;
- management-service failure is a hard stop;
- credentials remain protected.

- [ ] **Step 5: Implement static/runtime audit**

The verifier must:

- scan current-session and Feishu runtime code for unauthorized `nodemailer`, SMTP variables, or `sendMail`;
- confirm the canonical relay factory remains the sole transport owner;
- confirm legacy registry/evidence permissions are read-only for operational users;
- confirm the runtime state flag is enabled;
- perform a no-send API readiness check;
- fail if a fallback path exists.

- [ ] **Step 6: Run cutover and security tests**

Run:

```bash
node scripts/test-matrix-ledger-cutover.js
node scripts/verify-matrix-ledger-cutover.js --no-send
npm run verify:matrix-readonly-selection
```

Expected: all PASS and `send_invoked=false`.

- [ ] **Step 7: Commit**

```bash
git add src/services/matrixLedgerCutover.js scripts/verify-matrix-ledger-cutover.js scripts/test-matrix-ledger-cutover.js runtime-data-matrix-signal-private/SENDER_HANDOFF.md scripts/verify-matrix-readonly-selection.js package.json
git commit -m "feat: enforce canonical delivery cutover"
```

---

### Task 7: Full Regression, Migration Rehearsal, and Deployment Package

**Files:**
- Create: `scripts/test-matrix-ledger-e2e.js`
- Create: `docs/operations/matrix-runtime-ledger-runbook.md`
- Modify: `scripts/verify-matrix-readonly-selection.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: all prior tasks
- Produces: one repeatable pre-deployment verification command and rollback-safe runbook

- [ ] **Step 1: Write the end-to-end test**

The test must simulate:

```text
candidate → canonical customer → ready route → draft v1
→ full preview → exact confirmation → one accepted job
→ Sent correlation → one check_reply task
→ inbound customer reply with attachment
→ translated review work → original follow-up cancelled
```

Then simulate permanent bounce, temporary delay, automatic reply, unresolved message, stale preview, altered recipient, altered attachment, repeated confirmation, and management API failure.

- [ ] **Step 2: Run and verify failure before final wiring**

Run:

```bash
node scripts/test-matrix-ledger-e2e.js
```

Expected: FAIL until all lifecycle wiring is complete.

- [ ] **Step 3: Add package verification command**

Add:

```json
{
  "scripts": {
    "test:matrix-ledger": "node scripts/test-matrix-ledger-store.js && node scripts/test-matrix-ledger-migration.js && node scripts/test-matrix-ledger-command.js && node scripts/test-matrix-ledger-inbox.js && node scripts/test-matrix-ledger-cutover.js && node scripts/test-matrix-ledger-e2e.js",
    "verify:matrix-ledger": "npm run test:matrix-ledger && node scripts/verify-matrix-ledger-cutover.js --no-send"
  }
}
```

- [ ] **Step 4: Write the runbook**

Document exact commands for:

- protected backup;
- dry-run migration;
- dry-run report review;
- apply migration;
- unchanged second-run verification;
- unresolved/conflict review;
- current-session and Feishu client smoke tests;
- enable `canonical_delivery_only`;
- no-send cutover audit;
- service/container restart;
- production read-only verification;
- rollback of code without rollback of authoritative data;
- monitoring the first inbox/Sent polling cycle.

- [ ] **Step 5: Run full test suite**

Run:

```bash
npm run test:matrix-ledger
npm run verify:matrix-ledger
npm run verify:matrix-readonly-selection
npm run lint
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 6: Run migration rehearsal on protected copies**

Run the migrator against copies of:

- the production management database;
- the candidate database;
- tracked legacy registry and drafts;
- permission-restricted delivery evidence.

Expected:

- dry-run and apply reports have matching planned counts;
- unchanged second apply imports zero rows;
- no credential, raw secret, or unauthorized business body appears in logs;
- all unresolved/conflict records have reason codes.

- [ ] **Step 7: Commit**

```bash
git add scripts/test-matrix-ledger-e2e.js docs/operations/matrix-runtime-ledger-runbook.md scripts/verify-matrix-readonly-selection.js package.json
git commit -m "test: verify unified matrix lifecycle"
```

---

### Task 8: Production Migration, Cutover, and Live Verification

**Files:**
- Runtime write: protected database configured by `DB_PATH`
- Runtime write: protected migration reports under `runtime-data-*`
- Runtime update: Feishu production container from reviewed source
- Update after verification: `/home/admin/.codex/matrix-runtime/resources/matrix-console.md`

**Interfaces:**
- Consumes: approved release, migration runbook, production backup, explicit deployment approval
- Produces: canonical production lifecycle with legacy delivery disabled

- [ ] **Step 1: Obtain explicit production approval**

Show:

- target commit;
- migration dry-run counts;
- unresolved/conflict counts;
- affected services;
- rollback boundary;
- confirmation that no email will be sent during migration or verification.

Do not proceed without explicit approval.

- [ ] **Step 2: Back up and verify**

Create a protected database backup, verify SQLite integrity, record only backup path, size, checksum, and timestamp, and confirm mode `0600`.

- [ ] **Step 3: Apply migration**

Run:

```bash
node scripts/run-matrix-ledger-migration.js \
  --apply \
  --report <protected-report-path> \
  --idempotency-key <approved-run-key>
```

Expected: counts match the reviewed dry run.

- [ ] **Step 4: Prove migration idempotency**

Run the same source scan with a new reconciliation key.

Expected: `imported=0`, `unresolved=0`, and no duplicate operational rows.

- [ ] **Step 5: Deploy project and Feishu runtime**

Restart only the approved management service and Feishu container. Confirm both are healthy and source hashes match the reviewed release.

- [ ] **Step 6: Enable canonical-only cutover**

Set `canonical_delivery_only=1` through the protected administrative operation, then run:

```bash
node scripts/verify-matrix-ledger-cutover.js --no-send
```

Expected: PASS with `send_invoked=false`.

- [ ] **Step 7: Verify both interfaces**

From a clean non-project current session and from the Feishu production container:

- retrieve the same known customer snapshot;
- retrieve the same pending task;
- retrieve the same final preview;
- verify candidate selection and `确认采用` create no job;
- stop before final confirmation so no external message is sent.

- [ ] **Step 8: Verify inbox and Sent polling**

Wait for one complete five-minute cycle. Confirm:

- INBOX completed;
- Sent completed;
- inserted messages reconcile once;
- no duplicate tasks;
- no consecutive failures;
- unresolved records remain isolated.

- [ ] **Step 9: Update the user-level catalog**

Record only:

- canonical project/API paths;
- command path;
- service/container identifiers;
- verification date and commit;
- status and approval boundary.

Run a credential/business-record safety scan and a clean-directory discovery simulation.

- [ ] **Step 10: Final production report**

Report:

- migrated/matched/unresolved/conflict counts;
- idempotency rerun result;
- service and container health;
- cutover audit result;
- current-session/Feishu consistency result;
- inbox/Sent cycle result;
- remaining unresolved operational issues.

Do not report SMTP acceptance, inbox placement, or customer response unless independently observed.

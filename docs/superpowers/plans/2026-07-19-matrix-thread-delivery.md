# Matrix Thread Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scoped Feishu `发送邮件` open a real, immutable existing-inquiry reply draft and let a second explicit confirmation invoke the protected `sales@gdhspack.com` sender exactly once.

**Architecture:** Add an isolated `matrix-thread-route` snapshot and delivery service backed by authoritative CRM/email rows. The Feishu extension resolves only its persisted customer context, calls narrow Matrix API endpoints, renders draft/review/final-preview cards, and never sees SMTP configuration. Existing cold-development delivery remains unchanged.

**Tech Stack:** Node.js 22, Express, SQLite/better-sqlite3, Nodemailer transport injection, Feishu interactive cards, CommonJS regression scripts.

## Global Constraints

- Keep internal names neutral: `matrix-thread-route`; do not introduce business-descriptive skill, plugin, workflow or folder names.
- Never treat free text, model memory, or a globally latest record as recipient authority.
- Pin `from` and `replyTo` to `sales@gdhspack.com`; SMTP values remain outside the Feishu container and API responses.
- The first action previews; only a second digest-bound `确认发送` may invoke transport.
- Existing-thread replies skip cold-contact cooling, cold daily quota and marketing country policy, but retain operator authorization, suppression, sender readiness, idempotency and audit gates.
- No automatic resend after `failed` or `ambiguous`; ambiguous requires manual reconciliation.
- Do not send a real message in automated tests or production smoke tests.

---

### Task 1: Immutable Thread Snapshot Schema and Resolver

**Files:**
- Modify: `src/db.js`
- Create: `src/services/matrixThreadRoute.js`
- Create: `scripts/test-matrix-thread-route.js`

**Interfaces:**
- Consumes: `crm_reply_drafts`, `crm_messages`, `email_messages`, `customers`, `inquiries`, `matrix_actor_bindings`, `users`.
- Produces: `createMatrixThreadRoute({ db, clock })` with `prepare(input)`, `revise(input)`, `approve(input)`, `preview(input)` and `get(id)`.
- Snapshot shape: `{ id, revision, status, customer_id, inquiry_id, crm_draft_id, source_crm_message_id, source_email_message_id, recipient_email, subject, body_en, body_cn, attachment_manifest, content_hash, approved_by, approved_at }`.

- [ ] **Step 1: Write the failing resolver tests**

Add fixtures proving that `prepare({ actorUserId, bindingId, customerId, chatId, threadId, idempotencyKey })`:

```js
const route = createMatrixThreadRoute({ db, clock: () => new Date(NOW) });
const prepared = route.prepare({
  actorUserId, bindingId, customerId,
  chatId: 'chat-build', threadId: 'thread-acepac',
  idempotencyKey: 'thread-prepare-1'
});
assert.strictEqual(prepared.route, 'existing_relationship');
assert.strictEqual(prepared.recipient_email, 'buyer@example.sg');
assert.strictEqual(prepared.status, 'draft');
assert.ok(/^[a-f0-9]{64}$/.test(prepared.content_hash));
```

Also assert that zero/multiple active inquiries, non-email source, outbound source message, recipient mismatch, inactive binding, wrong owner, suppression/unsubscribe, and unknown input fields fail closed. Prove that inbound referenced attachments are not copied into the outbound manifest.

- [ ] **Step 2: Run the resolver test and verify RED**

Run: `node scripts/test-matrix-thread-route.js`  
Expected: FAIL because `src/services/matrixThreadRoute.js` and the route tables do not exist.

- [ ] **Step 3: Add the schema**

Add tables and indexes in `src/db.js`:

```sql
CREATE TABLE IF NOT EXISTS matrix_thread_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER NOT NULL,
  customer_id INTEGER NOT NULL,
  inquiry_id INTEGER NOT NULL,
  crm_draft_id INTEGER NOT NULL,
  source_crm_message_id INTEGER NOT NULL,
  source_email_message_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  thread_id TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_en TEXT NOT NULL,
  body_cn TEXT NOT NULL,
  in_reply_to TEXT NOT NULL,
  references_header TEXT NOT NULL DEFAULT '',
  attachment_manifest_json TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','approved','superseded','sent','delivery_ambiguous')),
  approved_by INTEGER,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(customer_id, inquiry_id, revision),
  FOREIGN KEY(crm_draft_id) REFERENCES crm_reply_drafts(id),
  FOREIGN KEY(source_crm_message_id) REFERENCES crm_messages(id),
  FOREIGN KEY(source_email_message_id) REFERENCES email_messages(id)
);

CREATE TABLE IF NOT EXISTS matrix_thread_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id INTEGER NOT NULL,
  actor_user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(route_id) REFERENCES matrix_thread_routes(id)
);
```

- [ ] **Step 4: Implement the minimal resolver**

Implement exact-object validation, active Matrix binding/capability checks, exact-one active inquiry selection, latest inbound `crm_messages` → `email_messages` binding, recipient equality, immutable content hashing, idempotent event replay and draft revision/approval. If no CRM draft exists, create one through the existing deterministic `crmReplyDraftService.generateReplyDraft` path and return it for review; do not approve it automatically.

- [ ] **Step 5: Run resolver and existing database tests**

Run:

```bash
node scripts/test-matrix-thread-route.js
node scripts/test-matrix-stream-review.js
node scripts/test-matrix-stream-correlation.js
```

Expected: all PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/db.js src/services/matrixThreadRoute.js scripts/test-matrix-thread-route.js
git commit -m "feat: add matrix thread route snapshots"
```

---

### Task 2: Existing-Thread Preview Gates

**Files:**
- Create: `src/services/matrixThreadPreview.js`
- Create: `scripts/test-matrix-thread-preview.js`
- Modify: `src/services/matrixStreamReadiness.js`

**Interfaces:**
- Consumes: approved snapshot from Task 1 and `readinessService.checkSender({ db, domain, selector })`.
- Produces: `createMatrixThreadPreview({ db, readinessService, clock, senderDomain, dkimSelector }).project(route)`.
- Preview gates: `authorization`, `thread`, `approval`, `suppression`, `readiness`, `duplicate`.

- [ ] **Step 1: Write failing preview tests**

Assert a verified existing thread can pass without cold cooling/quota/country-policy rows:

```js
const preview = await service.project(approvedRoute);
assert.strictEqual(preview.allowed, true);
assert.deepStrictEqual(preview.readiness, { ok: true, reasons: [] });
assert.strictEqual(Object.hasOwn(preview, 'policy'), false);
```

Assert missing DMARC/SPF/DKIM/TLS/SMTP readiness, suppression, changed latest inbound message, changed recipient, changed draft digest, missing approval and an existing accepted job for the same route all block with normalized reason codes.

- [ ] **Step 2: Run preview test and verify RED**

Run: `node scripts/test-matrix-thread-preview.js`  
Expected: FAIL because the thread preview service is absent.

- [ ] **Step 3: Split sender-only readiness from cold policy readiness**

Expose `checkSender({ db, domain, selector })` from `matrixStreamReadiness` while preserving existing `check({ ..., countryCode, channel })` behavior for initial contact. The sender-only result must require SPF, DKIM, DMARC, TLS and SMTP and return only normalized hard failures.

- [ ] **Step 4: Implement thread preview projection**

Compute every gate from fresh database state. Do not accept gate booleans supplied by the caller. Return the approved snapshot fields needed by the card, but replace `in_reply_to`, `references_header`, raw source payloads and SMTP diagnostics with booleans/counts.

- [ ] **Step 5: Run preview and cold-route regressions**

Run:

```bash
node scripts/test-matrix-thread-preview.js
node scripts/test-matrix-stream-preview.js
node scripts/test-matrix-stream-gates.js
```

Expected: all PASS and existing initial-contact policy behavior unchanged.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/services/matrixThreadPreview.js src/services/matrixStreamReadiness.js scripts/test-matrix-thread-preview.js
git commit -m "feat: add matrix thread preview gates"
```

---

### Task 3: Idempotent Protected Thread Delivery

**Files:**
- Create: `src/services/matrixThreadDelivery.js`
- Create: `scripts/test-matrix-thread-delivery.js`
- Modify: `src/services/matrixStreamFollowup.js`

**Interfaces:**
- Consumes: `previewService.project(route)`, protected Nodemailer-like `transport.sendMail(message)`, and an exact confirmation object.
- Produces: `createMatrixThreadDelivery({ db, transport, previewService, clock, fromAddress, replyToAddress, messageIdDomain }).confirm(input)` returning `{ state, error_class, route_revision }`.

- [ ] **Step 1: Write failing delivery tests**

Assert the first valid confirmation invokes transport once with:

```js
assert.deepStrictEqual(sent[0], {
  from: 'sales@sender.test',
  replyTo: 'sales@sender.test',
  to: 'buyer@example.sg',
  subject: 'Re: RFQ',
  text: 'Approved body',
  messageId: expectedMessageId,
  inReplyTo: '<inbound@example.sg>',
  references: '<root@example.sg> <inbound@example.sg>',
  attachments: []
});
```

Test repeated identical confirmation, concurrent confirmation, changed digest, wrong chat/thread/operator, rejected recipient, ambiguous response, expired lease, explicit suppression, unapproved attachment and path traversal. Confirm no credentials or protected source identifiers are returned.

- [ ] **Step 2: Run delivery test and verify RED**

Run: `node scripts/test-matrix-thread-delivery.js`  
Expected: FAIL because the delivery service and job table are absent.

- [ ] **Step 3: Add the job table**

Add `matrix_thread_jobs` with unique `idempotency_key`, unique `(route_id, content_hash)`, state constraint `pending|sending|accepted|failed|ambiguous`, owner lease, protected message identifier, redacted error class and timestamps.

- [ ] **Step 4: Implement reserve → send → finalize**

Use an immediate SQLite transaction to re-run all gates and reserve one job. Call transport outside the transaction. Finalize only while owning the lease; otherwise mark ambiguous. Allow only attachments whose manifest entry is explicitly `approved`, whose current file SHA-256 matches, and whose real path stays inside the configured protected attachment root.

- [ ] **Step 5: Update state and follow-up behavior**

On accepted: set route `sent`, set the CRM draft to `sent`, update inquiry next action, insert an outbound CRM communication record without copying SMTP diagnostics, and schedule a three-calendar-day reply check. On failed: retain approved route for manual action but block implicit retry. On ambiguous: set route `delivery_ambiguous` and require reconciliation.

- [ ] **Step 6: Run delivery regressions**

Run:

```bash
node scripts/test-matrix-thread-delivery.js
node scripts/test-matrix-stream-delivery.js
node scripts/test-matrix-stream-correlation.js
```

Expected: all PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/db.js src/services/matrixThreadDelivery.js src/services/matrixStreamFollowup.js scripts/test-matrix-thread-delivery.js
git commit -m "feat: add protected matrix thread delivery"
```

---

### Task 4: Narrow Management API and Runtime Wiring

**Files:**
- Modify: `src/routes/matrix.js`
- Modify: `src/server.js`
- Modify: `.runtime/vm_debug_ci/workspace/scripts/matrix-client.js`
- Create: `scripts/test-matrix-thread-api.js`
- Modify: `scripts/test-matrix-api.js`

**Interfaces:**
- Produces endpoints:
  - `POST /api/matrix/thread-routes/prepare`
  - `PATCH /api/matrix/thread-routes/:id`
  - `POST /api/matrix/thread-routes/:id/approve`
  - `GET /api/matrix/thread-routes/:id/preview`
  - `POST /api/matrix/thread-routes/:id/send`
- Produces client methods: `prepareThreadRoute`, `reviseThreadRoute`, `approveThreadRoute`, `previewThreadRoute`, `confirmThreadRoute`.

- [ ] **Step 1: Write failing API contract tests**

Verify exact request field allowlists, Matrix bridge authentication, active binding, owner/chat/thread scoping, normalized error responses, no raw message IDs, no SMTP diagnostics and no redirect following. Confirm `/send` rejects a first-stage draft and requires exact `expected_content_hash`, `expected_revision`, `chat_id`, `thread_id`, `card_event_id`, and `idempotency_key`.

- [ ] **Step 2: Run API tests and verify RED**

Run: `node scripts/test-matrix-thread-api.js`  
Expected: FAIL with 404/missing client methods.

- [ ] **Step 3: Add routes and dependency injection**

Construct the route, preview and delivery services in `src/server.js` only when the protected relay is enabled. Inject them into `createMatrixRouter`; when unavailable, preview/send must fail closed with `sender_unavailable`, not claim inbox-only access.

- [ ] **Step 4: Add strict client methods**

Use the existing `call()` origin pin, bridge token, operator binding, exact-object allowlists and 10-second timeout. Never add a generic URL, recipient or arbitrary body method.

- [ ] **Step 5: Run API and sender wiring regressions**

Run:

```bash
node scripts/test-matrix-thread-api.js
node scripts/test-matrix-api.js
node scripts/test-matrix-relay-server-wiring.js
```

Expected: all PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/routes/matrix.js src/server.js .runtime/vm_debug_ci/workspace/scripts/matrix-client.js scripts/test-matrix-thread-api.js scripts/test-matrix-api.js
git commit -m "feat: expose scoped matrix thread actions"
```

---

### Task 5: Feishu Scoped Command, Cards and Dual Confirmation

**Files:**
- Modify: `.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs`
- Modify: `.runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`
- Modify: `.runtime/vm_debug_ci/workspace/scripts/matrix-asset-context.js`
- Modify: `.runtime/vm_debug_ci/workspace/tests/test-matrix-context-bridge.js`

**Interfaces:**
- Consumes: persisted `assetContext.resolve({ chatId, operatorId })` customer binding and Task 4 client methods.
- Produces: scoped `发送邮件` → draft review/final preview and `确认发送` → one digest-bound confirmation.

- [ ] **Step 1: Add failing command-routing tests**

Prove `发送邮件` returns `true` from `onMessage` and never falls through. With a bound Acepac customer it calls `prepareThreadRoute`; without a binding it renders `当前没有绑定到本会话的客户邮件上下文，尚未发送。` With a draft it renders edit/approve controls; with an approved route it renders final preview. Another operator/chat/thread and expired state cannot reuse the route.

- [ ] **Step 2: Run the extension test and verify RED**

Run: `node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`  
Expected: FAIL because `发送邮件` currently returns `false` and reaches the agent.

- [ ] **Step 3: Implement scoped cards and actions**

Add neutral actions `mx.thread_revise`, `mx.thread_approve`, `mx.thread_preview`, `mx.thread_confirm`. Render recipient, customer/inquiry, subject, English body, Chinese translation, attachment count, reply-thread presence and normalized gates. Never render protected message IDs or source payloads.

- [ ] **Step 4: Implement command state machine**

`发送邮件` resolves the persisted customer binding and calls prepare. `修改：…` applies only to its bound draft. Approval stores a ten-minute context. The first send command opens preview; only `确认发送` in `previewed` state calls confirm. Consume context after any terminal response and keep ambiguous blocked.

- [ ] **Step 5: Run extension, bridge and artifact regressions**

Run:

```bash
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-context-bridge.js
node .runtime/vm_debug_ci/workspace/tests/test-bridge-patch.js
node scripts/test-bridge-artifact-0.6.9.js
```

Expected: all PASS and the bridge checksum patch remains exact.

- [ ] **Step 6: Commit Task 5**

```bash
git add .runtime/vm_debug_ci/workspace/extensions/stream-card.cjs .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js .runtime/vm_debug_ci/workspace/scripts/matrix-asset-context.js .runtime/vm_debug_ci/workspace/tests/test-matrix-context-bridge.js
git commit -m "feat: route scoped thread confirmations"
```

---

### Task 6: Verification, Catalog Reconciliation and Production Rollout

**Files:**
- Modify: `scripts/verify-matrix-readonly-selection.js`
- Modify: `scripts/test-verify-matrix-readonly-selection.js`
- Modify: `docs/matrix-stream-catalog-2026-07-16.md`
- Reconcile after deployment: `/home/admin/.codex/matrix-runtime/INDEX.md`
- Reconcile after deployment: `/home/admin/.codex/matrix-runtime/capabilities/message-relay.md`

**Interfaces:**
- Produces one verifier covering thread resolver, preview, delivery, API and Feishu extension without real transport delivery.

- [ ] **Step 1: Add failing verifier expectations**

Require the new files, test commands, endpoint/client symbols, neutral action names, no arbitrary-send surface, and safe production deployment language. Update expected runtime file hashes only after all code is final.

- [ ] **Step 2: Run verifier test and verify RED**

Run: `node scripts/test-verify-matrix-readonly-selection.js`  
Expected: FAIL for missing thread-route manifest entries.

- [ ] **Step 3: Update verifier and catalog**

Add the thread-route tests to the strict command list and document that existing replies are a distinct route. Keep `message-relay` status `partial` until sender-domain readiness and a no-send production preview pass; do not claim a real delivery.

- [ ] **Step 4: Run full local verification**

Run:

```bash
git diff --check
MATRIX_VERIFY_FIXTURE=1 npm run verify:matrix-readonly-selection
node scripts/test-matrix-thread-route.js
node scripts/test-matrix-thread-preview.js
node scripts/test-matrix-thread-delivery.js
node scripts/test-matrix-thread-api.js
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
```

Expected: all exit 0; no transport test uses production configuration.

- [ ] **Step 5: Commit, push and deploy one revision**

Commit verifier/catalog changes, push `main`, restart `packaging-system.service`, build `matrix_runtime_<commit>-stream-node`, retain the prior container as `vm_debug_ci_pre_<commit>`, and start the new container with the existing protected volumes and environment file.

- [ ] **Step 6: Perform read-only production acceptance**

Verify service `/health`, protected `--no-send` readiness, Docker `healthy`, authenticated `matrix-runtime.js health`, extension hash and Feishu `client ready`. Use fixture/API preview only; do not invoke `/send` and do not send a Feishu test message unless separately approved.

- [ ] **Step 7: Simulate new-session discovery and scan**

From `/tmp`, read only `/home/admin/.codex/matrix-runtime/INDEX.md`, find `message-relay`, verify catalog files remain mode `0600`, and scan for credentials, SMTP Message-ID values and actual CRM records. Update only status, paths, variable names, verified date and unresolved gates.

- [ ] **Step 8: Final evidence report**

Report commit, remote branch equality, production image, health checks, tests, rollback container, whether any real message was sent, and any remaining sender-domain or draft-approval blocker.

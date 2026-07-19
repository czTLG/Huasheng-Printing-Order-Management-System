# Matrix Relay Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the current 智能桓 production runtime send an exact, freshly approved email through the existing protected `sales@gdhspack.com` sender, without exposing SMTP credentials to the bot or treating old conversation text as approval.

**Architecture:** Preserve the current inbox, customer context, attachment, image-alias, and short-command implementation. Selectively port the proven Matrix review/gate/delivery components from `feature/matrix-stream-relay` into the current branch. The bot may prepare and confirm immutable versions through fixed API methods; only the management service may load protected SMTP environment variables and call `sendMail`. Every send is bound to an operator, chat, customer, current version, content hash, and single-use idempotency key.

**Tech Stack:** Node.js CommonJS, Express, better-sqlite3, Nodemailer, Feishu runtime extension, `node:assert` integration tests, systemd, Docker Compose.

**Approved design:** `docs/superpowers/specs/2026-07-19-matrix-relay-integration-design.md`

**Reference implementation:** `feature/matrix-stream-relay` is read-only source material. Do not merge it wholesale because it predates the current inbox/context/attachment work.

**Security invariants:**

- Never read, print, copy, commit, or pass the SMTP password to the bot container.
- Never read the legacy commented credential block or change credentials in this implementation.
- Sender and Reply-To are fixed to `sales@gdhspack.com` inside the protected service.
- Route callers cannot supply recipient, subject, body, sender, Reply-To, SMTP settings, or local attachment paths at send time.
- A preview, an approval, and a confirmation are separate persisted events. Only a fresh scoped confirmation may send.
- Attachments are excluded from the first rollout unless each exact attachment digest has its own approval.
- No production email is sent by test, preflight, deployment, or smoke verification.

---

## Task 1: Establish the regression baseline and preserve current behavior

**Files:**

- Inspect: `src/db.js`
- Inspect: `src/routes/matrix.js`
- Inspect: `src/routes/crm.js`
- Inspect: `src/services/crmReplyDraftService.js`
- Inspect: `.runtime/vm_debug_ci/workspace/scripts/matrix-client.js`
- Inspect: `.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs`
- Test: `scripts/test-verify-matrix-readonly-selection.js`
- Test: `.runtime/vm_debug_ci/workspace/tests/test-matrix-context-bridge.js`
- Test: `.runtime/vm_debug_ci/workspace/tests/test-matrix-choice-context.js`
- Test: `.runtime/vm_debug_ci/workspace/tests/test-matrix-asset-context.js`
- Test: `.runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`

- [ ] **Step 1: Record the exact base commit and dirty paths**

Run:

```bash
git rev-parse --short HEAD
git status --short
```

Expected: the current feature branch and the user's unrelated modified/untracked files are visible. Do not stage or edit those unrelated files.

- [ ] **Step 2: Run the existing management and bot regression tests**

Run:

```bash
node scripts/test-verify-matrix-readonly-selection.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-context-bridge.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-choice-context.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-asset-context.js
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
```

Expected: all pass. If a pre-existing failure occurs, record the command/output and isolate it before changing relay code.

- [ ] **Step 3: Add a preservation test for current Matrix routes**

Create `scripts/test-matrix-relay-current-surface.js` with assertions that current health, actor context, records, inbox, and attachment/image-context routes remain registered after the relay router is constructed.

Representative assertion:

```js
assert.ok(routePaths.includes('/context'));
assert.ok(routePaths.includes('/inbox'));
assert.ok(routePaths.includes('/work-items/:id/relay-preview'));
```

- [ ] **Step 4: Run the new test and confirm it fails only for the missing relay route**

Run:

```bash
node scripts/test-matrix-relay-current-surface.js
```

Expected: failure identifies `/work-items/:id/relay-preview` as missing; existing route assertions pass.

- [ ] **Step 5: Commit only the baseline test**

```bash
git add scripts/test-matrix-relay-current-surface.js
git commit -m "test: preserve current matrix runtime surface"
```

---

## Task 2: Add fail-closed permission and persistence primitives

**Files:**

- Modify: `src/db.js`
- Modify: `src/lib/permissions.js`
- Modify: `shared/permissions-model.json`
- Create: `scripts/test-matrix-relay-schema.js`
- Create: `scripts/test-matrix-relay-permissions.js`
- Reference: `feature/matrix-stream-relay:src/db.js`
- Reference: `feature/matrix-stream-relay:src/lib/permissions.js`

- [ ] **Step 1: Write failing schema tests**

In `scripts/test-matrix-relay-schema.js`, initialize a temporary SQLite database and assert the presence and essential constraints of:

- `matrix_stream_versions`
- `matrix_stream_recipient_evidence`
- `matrix_stream_events`
- `matrix_stream_jobs`
- `matrix_stream_sender_checks`
- `matrix_stream_country_policies`
- `matrix_stream_reply_checks`
- the current-version reference on `matrix_work_items`

Also assert unique indexes for immutable version numbers, event/idempotency keys, and delivery request fingerprints.

- [ ] **Step 2: Write failing permission tests**

In `scripts/test-matrix-relay-permissions.js`, prove:

```js
assert.strictEqual(normalizePermissions('super_admin', null).capabilities.matrixSend, false);
assert.strictEqual(normalizePermissions('foreign_trade_crm_admin', null).capabilities.matrixSend, false);
assert.strictEqual(normalizePermissions('staff', { capabilities: { matrixSend: true } }).capabilities.matrixSend, false);
assert.strictEqual(
  normalizePermissions('foreign_trade_crm_admin', { capabilities: { matrixSend: true } }).capabilities.matrixSend,
  true
);
```

This capability must be explicit and must never arise from role defaults.

- [ ] **Step 3: Run both tests to verify the expected failures**

```bash
node scripts/test-matrix-relay-schema.js
node scripts/test-matrix-relay-permissions.js
```

Expected: missing tables/columns and missing `matrixSend` fail the tests.

- [ ] **Step 4: Port only the required schema into the current initializer**

Copy and adapt the relay tables, indexes, migrations, and triggers from the reference branch into `src/db.js`. Preserve every current CRM inbox, reply-draft, attachment, and knowledge table. Make migrations additive and idempotent for existing production databases.

The version row must persist at least:

```text
work_item_id, version_no, status, recipient_email, recipient_source_url,
recipient_verified_at, recipient_evidence_id, subject, body_en, body_cn,
source_snapshot_json, quality_score, quality_json, content_hash,
approved_by, approved_at, created_by, created_at
```

The job row must persist the request fingerprint, single-use idempotency key, state, lease owner/time, redacted error class, accepted timestamp, and restricted receipt reference.

- [ ] **Step 5: Implement explicit capability normalization**

Add `matrixSend: false` to the shared capability model. In `src/lib/permissions.js`, allow it to become `true` only when the stored permission explicitly says `true` and the role is `super_admin` or `foreign_trade_crm_admin`.

- [ ] **Step 6: Run schema and permission tests**

```bash
node scripts/test-matrix-relay-schema.js
node scripts/test-matrix-relay-permissions.js
```

Expected: pass.

- [ ] **Step 7: Re-run database and auth regressions**

```bash
node scripts/test-admin-access-regression.js
node scripts/test-verify-matrix-readonly-selection.js
```

Expected: pass; no existing role gains send permission.

- [ ] **Step 8: Commit the persistence and permission layer**

```bash
git add src/db.js src/lib/permissions.js shared/permissions-model.json scripts/test-matrix-relay-schema.js scripts/test-matrix-relay-permissions.js
git commit -m "feat: add fail-closed matrix relay state"
```

---

## Task 3: Convert authoritative CRM reply drafts into immutable relay versions

**Files:**

- Create: `src/services/matrixRelayContext.js`
- Create: `scripts/test-matrix-relay-context.js`
- Modify only if required for a stable getter: `src/services/crmReplyDraftService.js`
- Inspect: `src/routes/crm.js`
- Reference: `feature/matrix-stream-relay:src/services/matrixStreamReview.js`
- Reference: `feature/matrix-stream-relay:src/services/matrixStreamText.js`

- [ ] **Step 1: Write failing context-adapter tests**

Seed a customer, contact, inquiry, inbound email thread, and `crm_reply_drafts` row. Test this interface:

```js
const result = prepareRelayPreview(db, {
  actorUserId,
  bindingId,
  chatId,
  sourceType: 'crm_reply_draft',
  sourceId: draftId,
  idempotencyKey
});
```

Assert that `result` contains only server-derived data:

```js
{
  workItemId,
  versionId,
  workItemVersion,
  contentHash,
  preview: {
    company, contact, recipient, subject, bodyEn, bodyCn,
    sender: 'sales@gdhspack.com', attachments: [], versionNo
  }
}
```

Cover rejection when the draft is unapproved, superseded, assigned to another customer, missing a verified recipient, contains an empty English body, or has an unreviewed attachment.

- [ ] **Step 2: Run the test to confirm the module is missing**

```bash
node scripts/test-matrix-relay-context.js
```

Expected: module-not-found or missing-function failure.

- [ ] **Step 3: Implement `prepareRelayPreview`**

The adapter must:

1. Load the active actor binding and explicit capability.
2. Load the reply draft, linked inquiry/customer/contact, and complete email-thread metadata from SQLite.
3. Choose the authoritative recipient from a verified inbound sender/contact record, never from the chat command.
4. Require the exact current approved draft.
5. Normalize the subject and English body; keep Chinese as internal translation only.
6. Persist a recipient-evidence snapshot identifying its protected CRM/email provenance.
7. Create a new immutable version or return the exact prior result for the same idempotency key.
8. Persist a server-side preview binding to operator, chat, work item, version, hash, and expiry.
9. Return no SMTP configuration and no attachment file paths.

- [ ] **Step 4: Make provenance types explicit**

Support two evidence kinds:

- `public_company`: official public company contact source.
- `inbound_thread`: a verified address from an existing inbound inquiry/thread linked to the same customer.

For `inbound_thread`, require a stored message/thread identifier and matching customer/contact link. Do not require the official-web-domain equality check used for first contact.

- [ ] **Step 5: Run tests**

```bash
node scripts/test-matrix-relay-context.js
node scripts/test-matrix-stream-review.js
```

If `scripts/test-matrix-stream-review.js` is not yet present on the current branch, port it from the reference branch in this task and adjust fixture names only where required by the current schema.

Expected: pass.

- [ ] **Step 6: Commit the authoritative adapter**

```bash
git add src/services/matrixRelayContext.js src/services/crmReplyDraftService.js scripts/test-matrix-relay-context.js scripts/test-matrix-stream-review.js
git commit -m "feat: prepare immutable matrix relay previews"
```

---

## Task 4: Port review, content, policy, and follow-up gates

**Files:**

- Create: `src/services/matrixStreamReview.js`
- Create: `src/services/matrixStreamText.js`
- Create: `src/services/matrixStreamGate.js`
- Create: `src/services/matrixStreamFollowup.js`
- Create: `scripts/test-matrix-stream-review.js` if not created in Task 3
- Create: `scripts/test-matrix-stream-gates.js`
- Modify: `scripts/test-matrix-relay-context.js`
- Reference: matching files on `feature/matrix-stream-relay`

- [ ] **Step 1: Port the reference tests before implementation**

Copy the review and gate tests, then add cases distinguishing:

- `initial_contact`: first outbound contact, 90-day cooling and maximum five accepted first contacts per Shanghai calendar day.
- `existing_inquiry_reply`: a reply in a verified inbound thread; exempt from first-contact cooling/quota, but still blocked by suppression, opt-out, bounce, duplicate content, stale approval, and ambiguous prior delivery.

- [ ] **Step 2: Run the tests to see the expected missing-module or route-classification failures**

```bash
node scripts/test-matrix-stream-review.js
node scripts/test-matrix-stream-gates.js
```

- [ ] **Step 3: Port and adapt the four services**

Keep canonical JSON and SHA-256 content hashing deterministic. A content hash must cover recipient, source evidence reference, subject, English body, Chinese translation, and approved attachment digest list.

Editing any covered field must create a new version and invalidate the old approval and preview binding.

- [ ] **Step 4: Add the existing-inquiry classification**

Implement a single policy result shape:

```js
{
  allowed: true,
  route: 'existing_inquiry_reply',
  blocks: [],
  checks: { suppression: 'pass', duplicate: 'pass', threadLink: 'pass' }
}
```

Do not infer `existing_inquiry_reply` from a same-domain email alone; require an actual linked inbound thread.

- [ ] **Step 5: Verify follow-up scheduling semantics**

An accepted email creates one reply-check task due three calendar days later, including weekends. Replaying the same accepted result must not create another task.

- [ ] **Step 6: Run the gate suite**

```bash
node scripts/test-matrix-stream-review.js
node scripts/test-matrix-stream-gates.js
```

Expected: pass.

- [ ] **Step 7: Commit the gate layer**

```bash
git add src/services/matrixStreamReview.js src/services/matrixStreamText.js src/services/matrixStreamGate.js src/services/matrixStreamFollowup.js scripts/test-matrix-stream-review.js scripts/test-matrix-stream-gates.js scripts/test-matrix-relay-context.js
git commit -m "feat: enforce matrix relay review gates"
```

---

## Task 5: Add a protected SMTP factory and no-send readiness check

**Files:**

- Create: `src/services/matrixRelayFactory.js`
- Create: `scripts/test-matrix-relay-factory.js`
- Create: `scripts/check-matrix-relay-readiness.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing factory tests**

Test an injected environment and fake Nodemailer implementation. The public interface is:

```js
const relay = createMatrixRelayFactory({ env, nodemailerImpl });
await relay.readiness();
await relay.transport.sendMail(mail);
```

Cover missing required variables, wrong `SMTP_FROM`, sender mismatch, Reply-To mismatch, `verify()` failure, and secret redaction. Assert that the fixed sender identity is exactly `sales@gdhspack.com`.

- [ ] **Step 2: Write a no-send test**

Run the readiness command with a fake transport and assert:

```js
assert.strictEqual(verifyCalls, 1);
assert.strictEqual(sendMailCalls, 0);
assert.strictEqual(deliveryJobCount, 0);
assert.strictEqual(deliveryEventCount, 0);
```

- [ ] **Step 3: Run tests and confirm failure**

```bash
node scripts/test-matrix-relay-factory.js
node scripts/check-matrix-relay-readiness.js --no-send --test-fixture
```

Expected: missing-module or missing-command failure.

- [ ] **Step 4: Implement the factory**

Read values from the provided `env` object only. Do not call dotenv and do not open any environment file. Validate these names without logging their values:

```text
SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
```

If the protected configuration uses an established Reply-To variable, validate it; otherwise set Reply-To internally to `sales@gdhspack.com`. Return only safe readiness fields such as `ready`, `checkedAt`, and `errorClass`.

- [ ] **Step 5: Implement the no-send readiness command**

`--no-send` may call `transport.verify()` but must never construct or send a message and must never write a delivery job/event. It exits nonzero if configuration or SMTP handshake readiness fails.

- [ ] **Step 6: Add package scripts**

Add neutral commands:

```json
{
  "test:matrix-relay-factory": "node scripts/test-matrix-relay-factory.js",
  "check:matrix-relay-readiness": "node scripts/check-matrix-relay-readiness.js --no-send"
}
```

- [ ] **Step 7: Run tests**

```bash
npm run test:matrix-relay-factory
node scripts/check-matrix-relay-readiness.js --no-send --test-fixture
```

Expected: pass and zero send calls.

- [ ] **Step 8: Scan changed files for credentials**

```bash
rg -n "SMTP_PASS\s*=|SMTP_PASSWORD\s*=|BEGIN (RSA |OPENSSH )?PRIVATE KEY|Authorization: Bearer" src/services/matrixRelayFactory.js scripts/test-matrix-relay-factory.js scripts/check-matrix-relay-readiness.js package.json
```

Expected: no secret values. References to the variable name `SMTP_PASS` are permitted only in validation code/tests.

- [ ] **Step 9: Commit the factory**

```bash
git add src/services/matrixRelayFactory.js scripts/test-matrix-relay-factory.js scripts/check-matrix-relay-readiness.js package.json package-lock.json
git commit -m "feat: add protected matrix relay factory"
```

---

## Task 6: Port idempotent delivery with authoritative reloading

**Files:**

- Create: `src/services/matrixRelayRuntime.js`
- Create: `scripts/test-matrix-relay-runtime.js`
- Modify: `src/services/matrixStreamFollowup.js`
- Reference: `feature/matrix-stream-relay:src/services/matrixStreamDelivery.js`
- Reference: `feature/matrix-stream-relay:scripts/test-matrix-stream-delivery.js`

- [ ] **Step 1: Port the reference delivery tests under the new neutral filename**

Retain accepted, explicit failure, ambiguous timeout, replay, concurrent confirmation, stale lease, permission, sender readiness, country policy, duplicate, quota, cooling, and redaction coverage.

Add these current-system cases:

- an existing-inquiry reply bypasses first-contact quota/cooling only;
- recipient is reloaded from the bound inbound thread;
- caller attempts to replace recipient/body are structurally impossible;
- no approved attachments means no `attachments` property is passed to Nodemailer;
- accepted delivery updates the correct inquiry and schedules exactly one reply check;
- a timeout is `ambiguous` and cannot be retried under a different key until reconciled;
- returned/card-safe data never contains the complete SMTP Message-ID.

- [ ] **Step 2: Run the test to confirm failure**

```bash
node scripts/test-matrix-relay-runtime.js
```

- [ ] **Step 3: Implement `createMatrixRelayRuntime`**

Expose only:

```js
const runtime = createMatrixRelayRuntime({ db, transport, clock, senderAddress, messageIdDomain, dkimSelector });
await runtime.confirm({
  actorUserId,
  bindingId,
  workItemId,
  versionId,
  expectedWorkVersion,
  expectedContentHash,
  chatId,
  cardEventId,
  idempotencyKey
});
```

Reject unknown input fields before database work. Reload the current work item, immutable version, approval event, preview binding, evidence, suppression state, readiness, and policy inside the confirmation transaction/lease flow.

- [ ] **Step 4: Preserve exact outcome semantics**

- `accepted`: persist acceptance and schedule one reply check.
- `failed`: persist a redacted definite failure class; a deliberate new confirmation may be allowed only by policy.
- `ambiguous`: persist an unresolved state and prohibit all automatic or new-key retry until manual reconciliation.
- same idempotency key and fingerprint: return the stored safe result without transport invocation.
- same key with different fingerprint: reject.

- [ ] **Step 5: Enforce fixed transport fields**

The runtime constructs mail from database fields only:

```js
{
  from: 'sales@gdhspack.com',
  replyTo: 'sales@gdhspack.com',
  to: version.recipient_email,
  subject: version.subject,
  text: version.body_en,
  headers: { 'X-Matrix-Stream-Version': String(version.id) }
}
```

Do not include the Chinese translation in the outgoing message.

- [ ] **Step 6: Run the delivery suite**

```bash
node scripts/test-matrix-relay-runtime.js
```

Expected: pass; fake transport is invoked only in the explicitly confirmed accepted/failure/ambiguous cases.

- [ ] **Step 7: Commit the delivery runtime**

```bash
git add src/services/matrixRelayRuntime.js src/services/matrixStreamFollowup.js scripts/test-matrix-relay-runtime.js
git commit -m "feat: add idempotent matrix relay runtime"
```

---

## Task 7: Expose narrow management-system endpoints

**Files:**

- Modify: `src/routes/matrix.js`
- Modify: `src/server.js`
- Create: `scripts/test-matrix-relay-api.js`
- Modify: `scripts/test-matrix-relay-current-surface.js`
- Reference: `feature/matrix-stream-relay:src/routes/matrix.js`
- Reference: `feature/matrix-stream-relay:scripts/test-matrix-api.js`

- [ ] **Step 1: Write failing API tests**

Add tests for:

```text
POST /api/matrix/work-items/:id/relay-preview
POST /api/matrix/work-items/:id/versions/:versionId/approve
GET  /api/matrix/work-items/:id/versions/:versionId/preview
POST /api/matrix/work-items/:id/versions/:versionId/send
```

The preview route accepts identifiers such as `sourceType`, `sourceId`, and `idempotencyKey`. The send route accepts only `expectedWorkVersion`, `expectedContentHash`, `chatId`, `cardEventId`, and `idempotencyKey`; actor and binding come from authenticated bridge context.

Assert HTTP 400 for every extra transport/content field:

```text
recipient, to, subject, body, bodyEn, bodyCn, from, sender, replyTo,
smtpHost, smtpUser, smtpPass, attachments, attachmentPath
```

- [ ] **Step 2: Prove disabled behavior before implementation**

```bash
node scripts/test-matrix-relay-api.js
```

Expected: route-not-found failures.

- [ ] **Step 3: Wire injected services into the router**

Extend the constructor without breaking current callers:

```js
createMatrixRouter({ db, audit, candidateDbPath, clock, relayContext, relayRuntime })
```

When `relayRuntime` is disabled/unready, preview and approval may remain available, but send returns a stable `503` safe error such as `matrix_relay_unavailable`. Never suggest Outlook or Gmail.

- [ ] **Step 4: Wire the protected factory in `src/server.js`**

Use a distinct host-side flag, default off:

```text
MATRIX_RELAY_ENABLED=0
```

When disabled, inject a disabled runtime. When enabled, construct the protected factory from `process.env`, validate readiness, then inject the runtime. Do not change the bot-side `MATRIX_DELIVERY_ENABLED=0` safety assertion into an SMTP toggle.

- [ ] **Step 5: Add audit events without sensitive payloads**

Audit preview creation, approval, send confirmation, outcome, and reconciliation using IDs, hashes, actor, chat, and safe state only. Exclude bodies, password, full Message-ID, and transport debug strings.

- [ ] **Step 6: Run API and surface tests**

```bash
node scripts/test-matrix-relay-api.js
node scripts/test-matrix-relay-current-surface.js
node scripts/test-verify-matrix-readonly-selection.js
```

Expected: pass, including all pre-existing context/inbox/image endpoints.

- [ ] **Step 7: Commit API wiring**

```bash
git add src/routes/matrix.js src/server.js scripts/test-matrix-relay-api.js scripts/test-matrix-relay-current-surface.js
git commit -m "feat: expose guarded matrix relay endpoints"
```

---

## Task 8: Update 智能桓 interaction without giving it SMTP access

**Files:**

- Modify: `.runtime/vm_debug_ci/workspace/scripts/matrix-client.js`
- Modify: `.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs`
- Create: `.runtime/vm_debug_ci/workspace/tests/test-matrix-relay-client.js`
- Create: `.runtime/vm_debug_ci/workspace/tests/test-matrix-relay-card.js`
- Modify: `.runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`
- Inspect: `.runtime/vm_debug_ci/workspace/scripts/matrix-choice-context.js`
- Inspect: `.runtime/vm_debug_ci/workspace/scripts/matrix-asset-context.js`

- [ ] **Step 1: Write failing fixed-client tests**

Add only named methods:

```js
prepareRelayPreview(input)
approveRelayVersion(input)
getRelayPreview(input)
confirmRelaySend(input)
```

Assert the client has no generic request method exposed to the model and rejects extra recipient/body/SMTP/attachment fields locally before making HTTP calls.

- [ ] **Step 2: Write failing conversational-scope tests**

Cover both natural confirmations:

```text
确认发送
你直接发送给他
```

They may invoke `confirmRelaySend` only when the server-backed current preview matches the same operator, chat, customer/work item, version, hash, and unexpired binding. Missing, stale, edited, cross-chat, cross-operator, or unclear context regenerates/displays preview and sends nothing.

Also prove:

- quoted reply context takes priority over a stale A/B/C/D candidate choice;
- `显示`, `看照片`, and short image aliases keep using the current customer context;
- candidate A-E selection remains isolated from send confirmation;
- old phrases in chat history do not authorize a send.

- [ ] **Step 3: Write the final-preview card test**

The card must display company/contact, country, recipient, subject, complete English body, Chinese translation, fixed sender, attachment status, version/hash suffix, and duplicate result. The confirm button carries IDs/hash only.

The bot should follow the card with copyable plain text where needed. The English customer-facing message must never be truncated with `...`.

- [ ] **Step 4: Run tests and confirm expected failures**

```bash
node .runtime/vm_debug_ci/workspace/tests/test-matrix-relay-client.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-relay-card.js
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
```

- [ ] **Step 5: Implement the fixed client methods**

The client authenticates only to the management bridge and sends identifier-only payloads. It must not read or reference `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, or sender credentials.

- [ ] **Step 6: Implement scoped confirmation and the two-step card flow**

First confirmation request without a valid preview: fetch/rebuild and display the final preview, do not send. Confirmation from the current preview/button: call the send endpoint exactly once with a stable card-event idempotency key.

On success, show `已提交发送`/`accepted for SMTP queue`, not `客户已收到`. On ambiguous outcome, show `状态待核对，禁止重复发送`.

- [ ] **Step 7: Run all bot regressions**

```bash
node .runtime/vm_debug_ci/workspace/tests/test-matrix-relay-client.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-relay-card.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-context-bridge.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-choice-context.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-asset-context.js
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
```

Expected: pass.

- [ ] **Step 8: Prove the bot workspace contains no credential capability**

```bash
rg -n "SMTP_(HOST|PORT|USER|PASS|PASSWORD)|nodemailer|sendMail\(" .runtime/vm_debug_ci/workspace
```

Expected: no matches in source/config; test strings documenting rejection may be explicitly reviewed.

- [ ] **Step 9: Commit bot behavior**

```bash
git add .runtime/vm_debug_ci/workspace/scripts/matrix-client.js .runtime/vm_debug_ci/workspace/extensions/stream-card.cjs .runtime/vm_debug_ci/workspace/tests/test-matrix-relay-client.js .runtime/vm_debug_ci/workspace/tests/test-matrix-relay-card.js .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
git commit -m "feat: add scoped matrix relay confirmation"
```

---

## Task 9: Full verification, deployment, and user-level catalog reconciliation

**Files:**

- Modify after verification: `/home/admin/.codex/matrix-runtime/INDEX.md`
- Modify after verification: `/home/admin/.codex/matrix-runtime/capabilities/message-relay.md`
- Inspect only: `/etc/packaging-system/smtp.env`
- Inspect: production systemd unit and environment-file path
- Inspect: production bot compose/runtime configuration

- [ ] **Step 1: Run the complete focused suite**

```bash
node scripts/test-matrix-relay-schema.js
node scripts/test-matrix-relay-permissions.js
node scripts/test-matrix-relay-context.js
node scripts/test-matrix-stream-review.js
node scripts/test-matrix-stream-gates.js
npm run test:matrix-relay-factory
node scripts/test-matrix-relay-runtime.js
node scripts/test-matrix-relay-api.js
node scripts/test-matrix-relay-current-surface.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-relay-client.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-relay-card.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-context-bridge.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-choice-context.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-asset-context.js
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
```

Expected: every command passes.

- [ ] **Step 2: Run repository verification**

```bash
npm run lint
npm run build
git diff --check
```

Expected: pass. If the repository has documented unrelated baseline failures, report them distinctly and demonstrate that focused relay tests pass.

- [ ] **Step 3: Back up and validate the production database before migration**

Use the existing protected backup workflow. Verify backup existence and SQLite integrity without printing business rows. Then start the service once with delivery disabled so additive migrations run.

- [ ] **Step 4: Perform protected no-send readiness**

Run the readiness command in the management service environment with `--no-send`. Confirm configuration availability, SMTP handshake readiness, fixed sender identity, and zero created delivery jobs/events. Do not display environment values.

- [ ] **Step 5: Grant the exact operator permission**

Identify the active Feishu binding for the approved operator and update that single user's stored `permissions_json` to include `matrixSend: true`. Record actor, target user id, timestamp, and capability change in the audit log. Do not enable it for the role globally.

- [ ] **Step 6: Enable and restart the management service**

Set only the host-side `MATRIX_RELAY_ENABLED=1` through its protected deployment configuration, restart `packaging-system.service`, and verify health plus relay readiness. Do not alter or expose SMTP credential values.

- [ ] **Step 7: Synchronize and restart the production bot runtime**

Copy the tested Matrix client/extension changes to the actual ignored runtime mount if deployment does not use the tracked paths directly. Restart the `vm_debug_ci` production container and prove:

- container is healthy;
- the loaded file checksum matches the tested source;
- preview methods are available;
- no SMTP variables or protected env file are mounted in the container;
- a no-send preview request reaches the management service.

- [ ] **Step 8: Run a production no-send Feishu smoke**

For Acepac, regenerate a fresh final preview from the authoritative inquiry, thread, recipient, and current approved reply draft. Verify recipient, subject, complete English, Chinese translation, sender, empty attachment list, version/hash, and confirmation button. Stop before actual confirmation.

Expected: 智能桓 no longer asks for Outlook/Gmail and does not claim the interface is unavailable.

- [ ] **Step 9: Reconcile the user-level capability catalog**

Query `/home/admin/.codex/matrix-runtime/INDEX.md` before editing. After all verification succeeds, update the existing single `message-relay` entry from `partial` to `ready`; record authoritative service/API paths, protected config path, and environment variable names only. Do not duplicate the entry or record recipient/body/business records.

From a non-project directory, simulate a new session discovery by reading only `INDEX.md` and confirm it points to the sender handoff and management bridge without exposing secrets.

- [ ] **Step 10: Run the final security scan**

Scan tracked changes, the bot runtime, and the user-level catalog for:

```text
password values, API keys, OAuth tokens, cookies, SMTP Message-ID values,
recipient message bodies, actual order/customer/quotation rows
```

Allow only documented protected paths and environment variable names. Confirm file permissions remain restrictive for protected config and private ledgers.

- [ ] **Step 11: Commit final deployment/catalog metadata that belongs in the repository**

```bash
git status --short
git diff --check
git add src/db.js src/lib/permissions.js shared/permissions-model.json \
  src/services/matrixRelayContext.js src/services/matrixRelayFactory.js \
  src/services/matrixRelayRuntime.js src/services/matrixStreamReview.js \
  src/services/matrixStreamText.js src/services/matrixStreamGate.js \
  src/services/matrixStreamFollowup.js src/routes/matrix.js src/server.js \
  scripts/test-matrix-relay-schema.js scripts/test-matrix-relay-permissions.js \
  scripts/test-matrix-relay-context.js scripts/test-matrix-stream-review.js \
  scripts/test-matrix-stream-gates.js scripts/test-matrix-relay-factory.js \
  scripts/check-matrix-relay-readiness.js scripts/test-matrix-relay-runtime.js \
  scripts/test-matrix-relay-api.js scripts/test-matrix-relay-current-surface.js \
  .runtime/vm_debug_ci/workspace/scripts/matrix-client.js \
  .runtime/vm_debug_ci/workspace/extensions/stream-card.cjs \
  .runtime/vm_debug_ci/workspace/tests/test-matrix-relay-client.js \
  .runtime/vm_debug_ci/workspace/tests/test-matrix-relay-card.js \
  .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js \
  package.json package-lock.json
git commit -m "chore: verify matrix relay production bridge"
```

Do not stage unrelated dirty files.

- [ ] **Step 12: Require fresh approval for the first real Acepac send**

Present the exact new final preview in Feishu. The user must confirm that version there. Only then may the management system submit it. Record the outcome and schedule the reply check. Implementation approval, this plan approval, and prior chat phrases are not authorization to send that email.

---

## Final Acceptance Criteria

- [ ] 智能桓 can prepare and display an exact bilingual final preview for a linked current inquiry.
- [ ] `确认发送` and `你直接发送给他` are context-aware and cannot select stale candidate A-E actions.
- [ ] A first phrase without a valid current preview never sends.
- [ ] A confirmation bound to the exact current preview invokes the protected management sender once.
- [ ] The bot has no SMTP secret, SMTP library, generic outbound primitive, or protected config mount.
- [ ] The management route ignores no caller content because forbidden fields are rejected outright.
- [ ] Sender and Reply-To are always `sales@gdhspack.com`.
- [ ] Accepted, failed, ambiguous, duplicate, replay, concurrent, and crash-recovery cases are covered.
- [ ] Existing-inquiry replies and first contacts use the correct distinct quota/cooling policy.
- [ ] Successful submission updates the correct inquiry and creates one three-calendar-day reply check.
- [ ] Current inbox, attachment, customer image alias, short-command, and candidate-choice behavior still passes regression.
- [ ] Production readiness is verified without sending; first real send still requires a fresh exact Feishu confirmation.
- [ ] The user-level resource catalog is reconciled once, contains no secret/business rows, and is discoverable from a new session.

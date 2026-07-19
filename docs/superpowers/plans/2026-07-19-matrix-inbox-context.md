# Matrix Inbox and Context Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continuously import inbound mailbox replies and attachments, notify the exact `build` Feishu project, and prevent standalone `A–E` answers from being consumed by the wrong option workflow.

**Architecture:** The main application owns IMAP, durable import, protected attachment storage, correlation, and notification jobs. The existing bot container claims jobs through the authenticated Matrix API, reads attachments from a read-only mount, and publishes cards/images/files to the exact `build` project. The card extension handles candidate letters only when an explicit candidate prefix or exact quoted-card binding proves candidate context.

**Tech Stack:** Node.js 22, Express 4, better-sqlite3 11, imapflow 1.4, mailparser 3.9, node-cron 3, Feishu Open API, Node `assert` integration tests.

## Global Constraints

- Use neutral technical codenames in file, workflow, agent, folder, and UI labels.
- Poll every five minutes in `Asia/Shanghai`, seven days a week, with startup catch-up and overlap prevention.
- Backfill 90 days with Message-ID and mailbox/folder/UID deduplication.
- Route inbound reply and attachment notifications only to the exact `build` project; never fall back to `vm_debug_ci` or `STREAM_CHAT_ID`.
- Keep SMTP/IMAP passwords, Feishu secrets, tokens, cookies, customer records, message bodies, and attachments out of Git, logs, plans, catalog files, and test fixtures.
- The main application receives no Feishu secret; the bot receives no SMTP/IMAP secret.
- Store private attachment directories as `0700` and files as `0600`; never execute or extract untrusted attachments.
- Maximum 20 attachments per message, 20 MiB per attachment, and 60 MiB total per message.
- Inbox synchronization and suggested-reply generation never authorize external delivery; the existing exact-recipient/body/approval/deduplication gates remain mandatory.
- Candidate buttons stay functional. Bare `A–E` is candidate input only when replying to a registered candidate card; `候选A` and `开发客户 A` remain explicit shortcuts.
- Implement every behavior test-first and preserve unrelated dirty-worktree changes.

---

### Task 1: Deterministic Choice Context

**Files:**
- Create: `.runtime/vm_debug_ci/workspace/scripts/matrix-choice-context.js`
- Modify: `.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs`
- Modify: `.runtime/vm_debug_ci/workspace/scripts/matrix-watch.js`
- Test: `.runtime/vm_debug_ci/workspace/tests/test-matrix-choice-context.js`
- Test: `.runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`

**Interfaces:**
- Produces: `parseScopedChoice(text) -> { index, explicit } | null`.
- Produces: `registerChoiceContext(record, options) -> record`, where `record` contains `message_id`, `chat_id`, `kind`, `created_at`, and `expires_at`.
- Produces: `resolveChoiceContext({ messageId, chatId, now }, options) -> record | null`.
- Consumes: bridge message fields `content`, `chatId`, `senderId`, `threadId`, `messageId`, and `replyToMessageId`.

- [ ] **Step 1: Write RED helper tests**

Create a temporary context file and assert exact routing:

```js
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const context = require('../scripts/matrix-choice-context.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-choice-'));
const storePath = path.join(root, 'contexts.json');
const now = new Date('2026-07-19T03:00:00.000Z');

assert.deepStrictEqual(context.parseScopedChoice('候选A'), { index: 0, explicit: true });
assert.deepStrictEqual(context.parseScopedChoice('开发客户 E'), { index: 4, explicit: true });
assert.deepStrictEqual(context.parseScopedChoice('A'), { index: 0, explicit: false });
context.registerChoiceContext({
  message_id: 'om-candidate', chat_id: 'build-chat', kind: 'candidate',
  created_at: now.toISOString(), expires_at: new Date(now.getTime() + 1800000).toISOString()
}, { storePath });
assert.strictEqual(context.resolveChoiceContext({ messageId: 'om-candidate', chatId: 'build-chat', now }, { storePath }).kind, 'candidate');
assert.strictEqual(context.resolveChoiceContext({ messageId: 'om-other', chatId: 'build-chat', now }, { storePath }), null);
assert.strictEqual(context.resolveChoiceContext({ messageId: 'om-candidate', chatId: 'other-chat', now }, { storePath }), null);
```

- [ ] **Step 2: Run the helper test and verify RED**

Run: `node .runtime/vm_debug_ci/workspace/tests/test-matrix-choice-context.js`  
Expected: FAIL because `matrix-choice-context.js` does not exist.

- [ ] **Step 3: Implement the atomic context registry**

Implement strict JSON validation, `0600` atomic writes, 30-minute expiration, maximum 200 retained records, exact message/chat matching, and these parsers:

```js
function parseScopedChoice(value) {
  const raw = String(value || '').trim().toUpperCase();
  const explicit = /^(?:候选|开发客户\s*)[A-E]$/.test(raw);
  const normalized = raw.replace(/^候选/, '').replace(/^开发客户\s*/, '');
  return /^[A-E]$/.test(normalized)
    ? { index: normalized.charCodeAt(0) - 65, explicit }
    : null;
}
```

- [ ] **Step 4: Add RED extension assertions**

Extend `test-stream-card-extension.js` to assert:

```js
assert.strictEqual(await registered.onMessage({ msg: {
  content: 'A', chatId: 'chat-1', senderId: 'ou-1', replyToMessageId: 'non-candidate-card'
} }), false);
assert.strictEqual(await registered.onMessage({ msg: {
  content: 'A', chatId: 'chat-1', senderId: 'ou-1'
} }), false);
assert.strictEqual(await registered.onMessage({ msg: {
  content: '候选A', chatId: 'chat-1', senderId: 'ou-1'
} }), true);
assert.strictEqual(await registered.onMessage({ msg: {
  content: 'A', chatId: 'chat-1', senderId: 'ou-1', replyToMessageId: candidateCardMessageId
} }), true);
```

- [ ] **Step 5: Run the extension test and verify RED**

Run: `node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`  
Expected: FAIL because bare `A` is still always consumed.

- [ ] **Step 6: Bind candidate handling to exact context**

Change `onMessage` so explicit input uses the active session, quoted bare input requires `resolveChoiceContext(...).kind === 'candidate'`, and all other bare letters return `false`. Capture the `messageId` returned by `sendManagedCard` whenever `renderCandidates` is sent and register it. After `matrix-watch.js` delivers the daily card, register its returned message ID with the same helper. Change visible guidance to `点击按钮、引用本卡回复 A-E，或输入“候选A”`.

- [ ] **Step 7: Run context and existing card tests**

Run:

```bash
node .runtime/vm_debug_ci/workspace/tests/test-matrix-choice-context.js
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
node runtime-data-matrix-86e2c31/.runtime/vm_debug_ci/workspace/tests/test-bridge-patch.js
```

Expected: all PASS; unquoted bare `A` produces no candidate client call.

- [ ] **Step 8: Commit only Task 1 files**

```bash
git add .runtime/vm_debug_ci/workspace/scripts/matrix-choice-context.js .runtime/vm_debug_ci/workspace/extensions/stream-card.cjs .runtime/vm_debug_ci/workspace/scripts/matrix-watch.js .runtime/vm_debug_ci/workspace/tests/test-matrix-choice-context.js .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
git commit -m "fix: bind matrix choices to message context"
```

### Task 2: Durable Inbox Schema and Protected Store

**Files:**
- Modify: `src/db.js`
- Create: `src/lib/matrixInboxStore.js`
- Create: `scripts/test-matrix-inbox-store.js`

**Interfaces:**
- Produces: `createAttachmentStore({ root })` with `save({ emailMessageId, index, filename, contentType, content })`.
- Produces: `enqueueInboxJob(db, emailMessageId) -> { id, inserted }`.
- Produces tables: `matrix_inbox_attachments`, `matrix_inbox_jobs`, and `matrix_inbox_leases`.

- [ ] **Step 1: Write the RED store test**

The test must initialize an isolated database and private temporary root, save `../产品图.png`, and assert sanitized storage, content hash, mode, and deduplication:

```js
const saved = store.save({
  emailMessageId: 7, index: 0, filename: '../产品图.png',
  contentType: 'image/png', content: Buffer.from('safe-fixture')
});
assert.strictEqual(saved.original_file_name, '产品图.png');
assert.match(saved.sha256, /^[0-9a-f]{64}$/);
assert.strictEqual(fs.statSync(saved.absolute_path).mode & 0o777, 0o600);
assert.ok(saved.absolute_path.startsWith(fs.realpathSync(root) + path.sep));
assert.throws(() => store.save({
  emailMessageId: 7, index: 1, filename: 'large.bin',
  contentType: 'application/octet-stream', content: Buffer.alloc(20 * 1024 * 1024 + 1)
}), /attachment exceeds 20 MiB/);
```

- [ ] **Step 2: Run the store test and verify RED**

Run: `node scripts/test-matrix-inbox-store.js`  
Expected: FAIL because `matrixInboxStore.js` and the new tables do not exist.

- [ ] **Step 3: Add schema with exact uniqueness rules**

Add:

```sql
CREATE TABLE IF NOT EXISTS matrix_inbox_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_message_id INTEGER NOT NULL,
  media_order INTEGER NOT NULL,
  original_file_name TEXT NOT NULL,
  storage_key TEXT,
  detected_mime_type TEXT,
  declared_mime_type TEXT,
  file_size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  availability_state TEXT NOT NULL,
  quarantine_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(email_message_id, media_order),
  FOREIGN KEY(email_message_id) REFERENCES email_messages(id)
);
CREATE TABLE IF NOT EXISTS matrix_inbox_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_message_id INTEGER NOT NULL UNIQUE,
  correlation_state TEXT NOT NULL DEFAULT 'pending',
  matched_customer_id INTEGER,
  matched_inquiry_id INTEGER,
  analysis_json TEXT NOT NULL DEFAULT '{}',
  analysis_state TEXT NOT NULL DEFAULT 'pending',
  delivery_state TEXT NOT NULL DEFAULT 'pending',
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  notification_uuid TEXT NOT NULL UNIQUE,
  lease_token TEXT,
  lease_expires_at TEXT,
  receipt_json TEXT NOT NULL DEFAULT '{}',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(email_message_id) REFERENCES email_messages(id)
);
CREATE TABLE IF NOT EXISTS matrix_inbox_leases (
  lease_key TEXT PRIMARY KEY,
  owner_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 4: Implement bounded protected storage**

Use `crypto.randomUUID()` for storage keys, `crypto.createHash('sha256')`, `path.basename` for filenames, `O_EXCL` writes, canonical-root checks, and exact limits from Global Constraints. Store relative keys only in SQLite. Mark unsupported, mismatched, or oversized items `quarantined` without persisting their bytes.

- [ ] **Step 5: Run schema/store tests and baseline migration smoke**

Run:

```bash
node scripts/test-matrix-inbox-store.js
node scripts/smoke-test.js
```

Expected: PASS, with the isolated attachment root deleted by the test.

- [ ] **Step 6: Commit only Task 2 files**

```bash
git add src/db.js src/lib/matrixInboxStore.js scripts/test-matrix-inbox-store.js
git commit -m "feat: add matrix inbox durable store"
```

### Task 3: Import Attachment Bytes and Enqueue Replies

**Files:**
- Modify: `src/lib/imapSync.js`
- Create: `src/services/matrixInbox.js`
- Modify: `scripts/verify-imap-sync.js`
- Create: `scripts/test-matrix-inbox-import.js`

**Interfaces:**
- Produces: `processInboundEmail(db, emailMessageId) -> { jobId, correlationState, inserted }`.
- Extends: `syncMailbox({ folder, days, limit, operator, syncType, attachmentStore, afterImport })`.
- Consumes: `matrixInboxStore.createAttachmentStore` and `enqueueInboxJob`.

- [ ] **Step 1: Write a RED MIME import test**

Use a local RFC822 fixture assembled in memory with one PNG attachment. Inject a fake IMAP fetch source and assert message commit precedes attachment/job processing. Force `afterImport` to throw and assert the email row and attachment row remain durable while the run records one processing error.

- [ ] **Step 2: Run the import test and verify RED**

Run: `node scripts/test-matrix-inbox-import.js`  
Expected: FAIL because attachment buffers are discarded and no inbox job is created.

- [ ] **Step 3: Persist parsed attachment buffers after email upsert**

For each `parsed.attachments`, pass only these fields to the store:

```js
{
  emailMessageId: Number(imported.id),
  index,
  filename: item.filename || `attachment-${index + 1}`,
  contentType: item.contentType || 'application/octet-stream',
  content: Buffer.isBuffer(item.content) ? item.content : Buffer.from(item.content || '')
}
```

Keep `email_messages.attachments_json` as safe metadata and add attachment record IDs/states; never put bytes or absolute paths in JSON.

- [ ] **Step 4: Implement deterministic correlation**

In `matrixInbox.js`, query exact `in_reply_to`/`references_header` against outbound `email_messages.message_id` first, then exact conversation/contact, then a unique normalized subject/contact match within 120 days. More than one fallback match returns `needs_review` and writes no guessed customer/inquiry IDs. Reuse `interpretCrmMessage` for bounded structured analysis and suggested English text; label unknown fields `待核实`.

- [ ] **Step 5: Enqueue every inbound message idempotently**

Call `processInboundEmail` only after `upsertEmailMessage` commits. Run it for inserted and existing inbound messages so backfill can create missing jobs. A unique `email_message_id` makes repeated polls return `{ inserted: false }`.

- [ ] **Step 6: Run import, IMAP, and CRM loop tests**

Run:

```bash
node scripts/test-matrix-inbox-import.js
node scripts/verify-imap-sync.js
node scripts/verify-crm-message-ai-loop.js
```

Expected: local tests PASS. The production-connectivity verifier may report `configured:false` when run outside the protected service environment, without modifying production data.

- [ ] **Step 7: Commit only Task 3 files**

```bash
git add src/lib/imapSync.js src/services/matrixInbox.js scripts/verify-imap-sync.js scripts/test-matrix-inbox-import.js
git commit -m "feat: enqueue matrix inbox replies"
```

### Task 4: Seven-Day Scheduler and Health

**Files:**
- Create: `src/services/matrixInboxScheduler.js`
- Modify: `src/server.js`
- Modify: `src/routes/crm.js`
- Create: `scripts/test-matrix-inbox-scheduler.js`

**Interfaces:**
- Produces: `createInboxScheduler({ db, sync, cronImpl, clock, enabled })`.
- Produces: `runCycle({ syncType, days, limit }) -> summary`.
- Produces: redacted `getInboxHealth(db) -> { configured, verified, last_success_at, last_success_age_seconds, consecutive_failures, pending_jobs, oldest_pending_at, quarantined_attachments }`.

- [ ] **Step 1: Write RED scheduler tests**

Inject a fake cron and clock. Assert exact expression `*/5 * * * *`, timezone `Asia/Shanghai`, startup catch-up, lease exclusion, seven-day behavior, no overlapping promise, and failure counter recovery.

- [ ] **Step 2: Run scheduler tests and verify RED**

Run: `node scripts/test-matrix-inbox-scheduler.js`  
Expected: FAIL because the scheduler module does not exist.

- [ ] **Step 3: Implement lease-protected cycles**

Acquire `matrix_inbox_leases.lease_key='inbox-poll'` in an immediate transaction with a random owner and a 10-minute expiry. Only the owner may release it. Scheduled cycles use a bounded incremental window; startup uses seven days; the separately invoked rollout backfill uses 90 days.

- [ ] **Step 4: Wire startup and cron without weekday restrictions**

In `src/server.js`, create the scheduler after `initDb()`. Enable only when `MATRIX_INBOX_ENABLED === '1'`. Start one guarded catch-up and register `*/5 * * * *` with `{ timezone: 'Asia/Shanghai' }`. Do not add SMTP or Feishu sending to the scheduler.

- [ ] **Step 5: Add redacted health endpoint**

Add authenticated `GET /api/crm/email/inbox-health`. It returns booleans, timestamps, ages, counts, and classified errors only. It must never include mailbox password, token, message body, sender address, subject, filename, or storage key.

- [ ] **Step 6: Run scheduler, smoke, and syntax tests**

Run:

```bash
node scripts/test-matrix-inbox-scheduler.js
node --check src/services/matrixInboxScheduler.js
node --check src/server.js
node scripts/smoke-test.js
```

Expected: all PASS.

- [ ] **Step 7: Commit only Task 4 files**

```bash
git add src/services/matrixInboxScheduler.js src/server.js src/routes/crm.js scripts/test-matrix-inbox-scheduler.js
git commit -m "feat: schedule matrix inbox observation"
```

### Task 5: Authenticated Job Claim and Receipt API

**Files:**
- Modify: `src/routes/matrix.js`
- Modify: `.runtime/vm_debug_ci/workspace/scripts/matrix-client.js`
- Create: `scripts/test-matrix-inbox-api.js`

**Interfaces:**
- Produces: `POST /api/matrix/inbox/jobs/claim` with no user-supplied recipient/chat ID.
- Produces: `POST /api/matrix/inbox/jobs/:id/ack` accepting exact `lease_token`, `notification_uuid`, and redacted receipt status.
- Produces: `POST /api/matrix/inbox/jobs/:id/fail` accepting exact `lease_token` and classified error code.
- Produces client methods: `claimInboxJob(openId)`, `ackInboxJob(openId, id, input)`, `failInboxJob(openId, id, input)`.

- [ ] **Step 1: Write RED API tests**

Seed two pending jobs and assert atomic single-claim behavior, 10-minute lease, stale-token rejection, idempotent repeated acknowledgment, bounded attempts, and rejection of `recipient`, `chat_id`, `token`, `smtp`, `body`, or arbitrary path fields.

- [ ] **Step 2: Run API tests and verify RED**

Run: `node scripts/test-matrix-inbox-api.js`  
Expected: FAIL with route not found.

- [ ] **Step 3: Implement strict claim hydration**

Return only the claimed job's IDs, safe display fields, bounded original preview, parsed `analysis_json`, and attachment descriptors containing `attachment_id`, `storage_key`, sanitized filename, detected MIME, size, digest, and availability. Ensure `storage_key` matches `/^[0-9a-f-]{36}\/[0-9]+$/` and never return an absolute path.

- [ ] **Step 4: Implement ack/fail transitions**

Use immediate transactions. `ack` changes `delivery_state` to `delivered` once and stores a redacted receipt without Feishu Message-ID. `fail` clears the lease, increments attempts, records a fixed error code, and sets `manual_review` after five failures.

- [ ] **Step 5: Run API and existing Matrix verifier**

Run:

```bash
node scripts/test-matrix-inbox-api.js
npm run verify:matrix-readonly-selection
```

Expected: PASS; the existing public candidate API remains read-only and delivery-disabled behavior remains unchanged.

- [ ] **Step 6: Commit only Task 5 files**

```bash
git add src/routes/matrix.js .runtime/vm_debug_ci/workspace/scripts/matrix-client.js scripts/test-matrix-inbox-api.js
git commit -m "feat: add matrix inbox relay API"
```

### Task 6: Feishu Card, Image, and File Relay

**Files:**
- Create: `.runtime/vm_debug_ci/workspace/scripts/matrix-inbox-watch.js`
- Modify: `.runtime/vm_debug_ci/workspace/scripts/matrix-runtime.js`
- Modify: `.runtime/vm_debug_ci/compose.yaml`
- Modify: `.runtime/vm_debug_ci/compose.production.yaml`
- Create: `.runtime/vm_debug_ci/workspace/tests/test-matrix-inbox-watch.js`

**Interfaces:**
- Produces: `resolveProjectChatId({ appId, projectName, bridgeRoot }) -> chatId` with exact single-project matching.
- Produces: `buildInboxCard(job) -> Feishu card`.
- Produces: `uploadImage(token, absolutePath) -> imageKey` and `uploadFile(token, absolutePath, filename) -> fileKey`.
- Consumes: Task 5 client claim/ack/fail methods and the attachment root mounted at `/refs/matrix-inbox-attachments:ro`.

- [ ] **Step 1: Write RED relay tests**

Inject fake API/client/fetch functions and assert:

```js
assert.strictEqual(resolveProjectChatId({ appId: 'app-test', projectName: 'build', bridgeRoot: fixture }), 'build-chat');
assert.throws(() => resolveProjectChatId({ appId: 'app-test', projectName: 'build', bridgeRoot: missingBuild }), /project not found/);
assert.throws(() => resolveProjectChatId({ appId: 'app-test', projectName: 'build', bridgeRoot: duplicateBuild }), /multiple projects/);
assert.match(JSON.stringify(buildInboxCard(job)), /新邮件回复/);
assert.match(JSON.stringify(buildInboxCard(job)), /中文摘要/);
assert.match(JSON.stringify(buildInboxCard(job)), /生成建议回复/);
assert.strictEqual(sentCards[0].chatId, 'build-chat');
assert.strictEqual(sentImages[0].replyTo, sentCards[0].messageId);
assert.strictEqual(ackCalls.length, 1);
```

Also assert traversal storage keys, hash mismatches, missing files, files over limits, and unsupported types are never uploaded.

- [ ] **Step 2: Run relay tests and verify RED**

Run: `node .runtime/vm_debug_ci/workspace/tests/test-matrix-inbox-watch.js`  
Expected: FAIL because the relay module does not exist.

- [ ] **Step 3: Implement exact `build` resolution and card rendering**

Read `/home/node/.feishu-codex-bridge/bots/${STREAM_APP_ID}/projects.json`, require exactly one project named `build`, and never inspect `STREAM_CHAT_ID`. Render company/country, sender, subject, received time, original preview, Chinese summary/status, correlation, extracted changes, attachment count/warnings, and suggested next action. Clip bounded fields without replacing the full CRM record.

- [ ] **Step 4: Implement safe attachment uploads**

Resolve every `storage_key` below `/refs/matrix-inbox-attachments`, verify size and SHA-256 before upload, and use official Feishu `/im/v1/images` or `/im/v1/files` multipart endpoints. Send each upload as a reply to the notification card. Do not persist tenant tokens or output API response bodies containing identifiers.

- [ ] **Step 5: Add bounded polling and receipt semantics**

Start one poll loop from `matrix-runtime.js`. Claim at most one job per cycle, send the card before attachments, acknowledge only after all available attachments are sent or explicitly represented as quarantined, and call `fail` with a fixed error class on transient failure. Use the job's server-generated notification UUID for Feishu idempotency.

- [ ] **Step 6: Add read-only attachment mount**

Mount `${MATRIX_INBOX_ATTACHMENT_ROOT:?required}:/refs/matrix-inbox-attachments:ro`. Do not add SMTP/IMAP variables to the bot container. Keep `MATRIX_DELIVERY_ENABLED=0`.

- [ ] **Step 7: Run relay, runtime, and secret-boundary tests**

Run:

```bash
node .runtime/vm_debug_ci/workspace/tests/test-matrix-inbox-watch.js
node --check .runtime/vm_debug_ci/workspace/scripts/matrix-runtime.js
if rg -n "SMTP_|SMTP_PASS|ALIYUN_MAIL_PASSWORD|IMAP_PASS" .runtime/vm_debug_ci/workspace/scripts/matrix-inbox-watch.js .runtime/vm_debug_ci/compose*.yaml; then exit 1; fi
```

Expected: tests PASS and the secret-boundary scan prints no matches.

- [ ] **Step 8: Commit only Task 6 files**

```bash
git add .runtime/vm_debug_ci/workspace/scripts/matrix-inbox-watch.js .runtime/vm_debug_ci/workspace/scripts/matrix-runtime.js .runtime/vm_debug_ci/compose.yaml .runtime/vm_debug_ci/compose.production.yaml .runtime/vm_debug_ci/workspace/tests/test-matrix-inbox-watch.js
git commit -m "feat: relay matrix inbox notifications"
```

### Task 7: Protected Production Configuration and Backfill

**Files:**
- Create: `deploy/systemd/packaging-system-inbox.conf`
- Create: `scripts/verify-matrix-inbox-production.js`
- Modify: `.env.example`
- Modify: `/etc/packaging-system/inbox.env` during deployment only, with mode `0600 root:root`
- Modify: `/etc/systemd/system/packaging-system.service.d/inbox.conf` during deployment only

**Interfaces:**
- Consumes: existing protected in-process `SMTP_USER`/`SMTP_PASS` only after provider verification.
- Produces: non-secret settings `MATRIX_INBOX_ENABLED`, `MATRIX_INBOX_IMAP_HOST`, `MATRIX_INBOX_IMAP_PORT`, `MATRIX_INBOX_IMAP_SECURE`, and `MATRIX_INBOX_ATTACHMENT_ROOT`.

- [ ] **Step 1: Write RED production verifier assertions**

The verifier must output only:

```json
{
  "configured": true,
  "tls": true,
  "authenticated": true,
  "inbox_opened": true,
  "attachment_root_private": true
}
```

It must exit nonzero when any condition is false and must reject debug logging, environment dumps, mailbox values, passwords, tokens, message subjects, and message bodies.

- [ ] **Step 2: Run verifier locally and verify RED**

Run: `node scripts/verify-matrix-inbox-production.js`  
Expected: FAIL closed because protected production configuration is absent from the ordinary shell.

- [ ] **Step 3: Implement protected configuration loading**

The deployment verifier loads `/etc/packaging-system/smtp.env` with `dotenv` quiet mode only inside an approved privileged process, asserts the sender mailbox identity without printing it, tests the configured IMAP host, and exits. Test the two documented provider endpoints sequentially only until one authenticates; record only the successful endpoint in `/etc/packaging-system/inbox.env`. Never copy the password into the new file.

- [ ] **Step 4: Create the private attachment root**

Create the configured neutral runtime directory as the service user with mode `0700`. Verify it is outside Git, not a symlink, not group/world accessible, and writable only by the application service. Add the exact path as a read-only bot mount.

- [ ] **Step 5: Install the systemd drop-in and restart the main service**

The drop-in adds only `EnvironmentFile=/etc/packaging-system/inbox.env`. Run `systemctl daemon-reload`, restart `packaging-system.service`, and verify `/health` plus the redacted inbox health endpoint. Do not print `systemctl show Environment` or `/proc/.../environ` values.

- [ ] **Step 6: Deploy and recreate only the bot container**

Copy reviewed scripts into the production merged-script directory, update the production Compose mount, recreate `stream-node`, and assert container health. Verify from inside the container only that SMTP/IMAP credential variables are absent and the attachment root is read-only.

- [ ] **Step 7: Run the 90-day backfill once**

Invoke the protected backfill command with `syncType='backfill'`, `days=90`, and a bounded page limit. Report only run ID and scanned/inserted/updated/skipped/error/pending-job counts. Do not output message bodies, addresses, subjects, filenames, Message-IDs, or attachment keys.

- [ ] **Step 8: Verify missed replies create jobs without external sends**

Compare inbound message count, inbox job count, delivered notification count, and pending/manual-review count. Assert SMTP send audit count is unchanged during backfill.

- [ ] **Step 9: Commit deploy templates and verifier**

```bash
git add deploy/systemd/packaging-system-inbox.conf scripts/verify-matrix-inbox-production.js .env.example
git commit -m "ops: add matrix inbox protected rollout"
```

### Task 8: Production Browser/Message Smoke and Catalog Reconciliation

**Files:**
- Modify: `/home/admin/.codex/matrix-runtime/INDEX.md` only if the verified capability entry is missing or stale
- Modify: `/home/admin/.codex/matrix-runtime/capabilities/` only with a neutral metadata entry when required
- Create: `docs/matrix-inbox-rollout-2026-07-19.md` containing redacted verification evidence only

**Interfaces:**
- Verifies: inbound mail -> durable import -> attachment hash -> `build` notification -> image/file thread -> idempotent second poll -> no outbound send.
- Verifies: general option card -> unquoted `A` continues to normal conversation; candidate card -> quoted `A` opens the candidate; explicit `候选A` opens the candidate.

- [ ] **Step 1: Re-read the user-level capability index before deployment verification**

Read `/home/admin/.codex/matrix-runtime/INDEX.md`, locate `matrix-console` and `message-relay`, and record only whether the new inbox observer is already represented. Do not copy business data into the catalog.

- [ ] **Step 2: Send one controlled inbound smoke message with a harmless image**

Use a separately controlled mailbox and a subject containing a random smoke identifier. The message asks for no quotation and authorizes no external reply. Confirm it arrives in `build` with the image visible and not in `vm_debug_ci`.

- [ ] **Step 3: Poll again and verify idempotency**

Run one additional inbox cycle. Assert email row count, job count, card receipt count, and image receipt count for the smoke identifier remain exactly one.

- [ ] **Step 4: Run live context-routing regression**

In `build`, create a harmless non-candidate A/B choice, reply with bare `A`, and verify no candidate detail appears. Then quote a candidate card and reply `A`, verify the correct candidate detail, and test `候选A` without a quote. Perform no candidate selection or external communication.

- [ ] **Step 5: Reconcile the user-level capability catalog**

If the index is stale, add only authoritative code path, service/timer, protected configuration path, variable names, status, verification timestamp, and security boundary. Do not add credentials, chat IDs, contact data, Message-IDs, subjects, or attachment records. Avoid duplicate entries.

- [ ] **Step 6: Simulate a new session outside the project**

From `/tmp`, read only the user-level `INDEX.md` and prove it locates the verified main service, bot relay, protected configuration path, and inbox capability metadata without relying on project chat history.

- [ ] **Step 7: Run final security and regression gates**

Run:

```bash
node scripts/test-matrix-inbox-store.js
node scripts/test-matrix-inbox-import.js
node scripts/test-matrix-inbox-scheduler.js
node scripts/test-matrix-inbox-api.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-choice-context.js
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-inbox-watch.js
node scripts/smoke-test.js
npm run build
```

Expected: every command exits 0.

- [ ] **Step 8: Scan tracked and catalog files for prohibited data**

Scan new/modified files for password/token assignments, SMTP Message-ID values, Feishu chat IDs, contact addresses other than the approved sender identity, real subjects, real message bodies, and attachment filenames. Fail the rollout if any prohibited value is present.

- [ ] **Step 9: Record redacted rollout evidence**

Document code commit, service/container health, last successful poll timestamp, backfill counts, pending/manual-review counts, context-routing results, and unresolved items. Do not include customer records or provider identifiers.

- [ ] **Step 10: Commit the redacted evidence and any catalog metadata separately**

```bash
git add docs/matrix-inbox-rollout-2026-07-19.md
git commit -m "docs: record matrix inbox rollout"
```

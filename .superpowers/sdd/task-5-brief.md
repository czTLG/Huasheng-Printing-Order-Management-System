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


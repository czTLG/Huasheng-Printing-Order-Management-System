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


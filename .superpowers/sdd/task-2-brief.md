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


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


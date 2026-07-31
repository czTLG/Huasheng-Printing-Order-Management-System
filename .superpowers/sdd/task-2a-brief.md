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


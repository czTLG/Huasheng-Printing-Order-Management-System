# Matrix Intake Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admit a reviewed public organization and exact human-approved message into the canonical immutable-version workflow without bypassing candidate provenance, identity deduplication, or delivery gates.

**Architecture:** A bounded candidate-store writer validates public evidence and writes only the reviewed candidate database. A management-service intake unit reloads that candidate through the existing read-only view, resolves canonical identity, and atomically creates recipient evidence, one work item, and one exact immutable draft. Existing approval, preview, delivery, and follow-up services remain the only path to SMTP submission.

**Tech Stack:** Node.js 22, Express, better-sqlite3, existing Matrix ledger/review/delivery services, deterministic Node regression scripts.

## Global Constraints

- Use neutral codenames in files, APIs, commands, logs, and UI labels.
- Do not add SMTP, credential, cookie, token, or direct-database fallbacks to the sender path.
- The management service must continue opening the candidate database read-only/query-only.
- Accept only public organizational information and official HTTPS sources.
- Never guess personal contact details or accept a recipient without official source binding.
- Preserve the existing two-stage approval and exact final confirmation.
- Intake must create no approval, delivery job, or outbound communication.
- Every write must be idempotent, audited, and fail closed on ambiguity.
- Production deployment, service restart, and actual external send remain separately approval-gated.

---

### Task 0: UAE snack route profile

**Files:**
- Modify: `src/services/matrixRouteProfile.js`
- Modify: `scripts/test-matrix-route-profile.js`

**Interfaces:**
- Consumes: `profileFor({ countryCode: 'AE', categories })`.
- Produces: a deterministic `food_snack_ar` route profile with Arabic market, application, product, and company URLs.

- [ ] **Step 1: Write the failing UAE route-profile tests**

Assert:

```js
const profile = profileFor({ countryCode: 'AE', categories: ['nuts', 'snacks'] });
assert.equal(profile.kind, 'food_snack_ar');
assert.equal(profile.market, '/ar/markets/middle-east-food-packaging');
assert.equal(profile.application, '/ar/applications/snack-packaging');
assert.equal(profile.product, '/ar/products/food-packaging-roll-film');
assert.equal(profile.about, '/ar/about');
assert.equal(profile.expectedLanguage, 'ar');
```

Also assert that unrelated UAE categories do not inherit the snack profile and that another country's snack candidate does not receive the UAE market URL.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node scripts/test-matrix-route-profile.js
```

Expected: failure because the UAE snack profile is absent.

- [ ] **Step 3: Implement the minimal profile**

Add one reusable AE profile selected only when `countryCode === 'AE'` and categories include nuts, dried fruit, snacks, spices, beans, lentils, or herbs. Use the canonical Arabic URLs above and require Arabic title/description, `lang=ar`, production canonical equality, HTTP 200, and no desktop/mobile overflow.

- [ ] **Step 4: Preserve readiness evidence in the snapshot**

Ensure the verified profile result records `status`, canonical URLs, expected language, verification timestamp, and deployed commit. `candidateDraft` and reviewed intake must place this object in `localizedRouteSet`; `assertVersionStrategyCurrent` must invalidate a version when any of these values changes.

- [ ] **Step 5: Run profile and API regressions**

Run:

```bash
node scripts/test-matrix-route-profile.js
node scripts/test-matrix-api.js
```

Expected: all pass, with no network call in unit tests.

- [ ] **Step 6: Commit**

```bash
git add src/services/matrixRouteProfile.js scripts/test-matrix-route-profile.js
git commit -m "feat(matrix): add Arabic snack route profile"
```

---

### Task 1: Reviewed candidate-store admission

**Files:**
- Create: `src/services/matrixIntakeCandidate.js`
- Create: `scripts/test-matrix-intake-candidate.js`
- Modify: `scripts/matrix-record-import.js`

**Interfaces:**
- Consumes: `admitReviewedCandidate(db, input, { clock })`.
- Produces: `{ candidate_id, resolution, fingerprint }`, where `resolution` is `inserted` or `replayed`.

- [ ] **Step 1: Write the failing candidate admission tests**

Create real temporary candidate databases with the production `cache_records`, `cache_evidence`, and `cache_discovery` schema. Assert:

```js
const admitted = admitReviewedCandidate(db, fixture, { clock: () => NOW });
assert.equal(admitted.resolution, 'inserted');
assert.equal(admitReviewedCandidate(db, fixture, { clock: () => NOW }).resolution, 'replayed');
assert.throws(() => admitReviewedCandidate(db, { ...fixture, company_name: 'Conflicting Name' }), /identity conflict/);
assert.throws(() => admitReviewedCandidate(db, staleFixture), /evidence is stale/);
assert.throws(() => admitReviewedCandidate(db, missingProcessFixture), /required official source role/);
assert.throws(() => admitReviewedCandidate(db, mismatchedEmailFixture), /recipient domain mismatch/);
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node scripts/test-matrix-intake-candidate.js
```

Expected: failure because `matrixIntakeCandidate` does not exist.

- [ ] **Step 3: Implement the minimal candidate admission service**

Implement strict allow-listed parsing for:

```js
{
  candidate_key, company_name, country_code, normalized_domain, official_url,
  recipient: { email, source_url, verified_at, role },
  categories, formats, size_signals, scale_tier, priority, fit_score, confidence,
  sources: [{ role, source_url, page_title, observed_at, excerpt }],
  discovery: { source_adapter, source_url, source_query, collected_at },
  route_readiness: { id, status, commit, verified_at, urls }
}
```

Require source roles `home`, `profile`, `products`, `process`, and `contact`; require at least three distinct official URLs; require `route_readiness.status === 'ready'`; bind recipient and source registrable domains to `normalized_domain`; insert discovery and every evidence row in one candidate-database transaction; set `status='valid'`, `audit_state='audited'`, and `audited_at` only after all validation passes.

- [ ] **Step 4: Preserve the existing importer contract**

Keep `matrix-record-import.js` behavior unchanged for its version-1 batch. Export or reuse shared public-URL/domain helpers without broadening accepted legacy fields.

- [ ] **Step 5: Run focused and existing importer tests**

Run:

```bash
node scripts/test-matrix-intake-candidate.js
node scripts/test-matrix-signal-import.js
```

Expected: all pass, and the candidate test proves zero partial rows after every rejected fixture.

- [ ] **Step 6: Commit**

```bash
git add src/services/matrixIntakeCandidate.js scripts/test-matrix-intake-candidate.js scripts/matrix-record-import.js
git commit -m "feat(matrix): add reviewed intake admission"
```

---

### Task 2: Canonical exact-version intake transaction

**Files:**
- Create: `src/services/matrixIntakeBridge.js`
- Create: `scripts/test-matrix-intake-bridge.js`
- Modify: `src/services/matrixStreamReview.js`
- Modify: `src/services/matrixLedgerStore.js`

**Interfaces:**
- Consumes: `createMatrixIntakeBridge({ db, view, store, reviewService, clock })`.
- Produces: `intake.create(input)` returning `{ customer_id, work_item_id, work_item_version, version_id, content_hash, status }`.

- [ ] **Step 1: Write failing exact-intake tests**

Use real temporary operational and candidate databases. Assert:

```js
const result = intake.create(fixture);
assert.equal(result.status, 'draft');
assert.equal(count('customers'), 1);
assert.equal(count('matrix_customer_links'), 1);
assert.equal(count('matrix_contacts'), 1);
assert.equal(count('matrix_work_items'), 1);
assert.equal(count('matrix_stream_recipient_evidence'), 1);
assert.equal(count('matrix_stream_versions'), 1);
assert.equal(count('matrix_stream_delivery_jobs'), 0);
assert.equal(count("matrix_stream_versions WHERE status='approved'"), 0);
```

Also assert exact line-break preservation, identical replay, idempotency-key conflict on changed body, domain/email ambiguity rejection, route-readiness rejection, quality-gate rollback, and unchanged row counts after every rejection.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node scripts/test-matrix-intake-bridge.js
```

Expected: failure because `createMatrixIntakeBridge` does not exist.

- [ ] **Step 3: Add an exact immutable-version method**

Add a narrowly named review-service method:

```js
createReviewedVersion(db, {
  actorUserId, workItemId, expectedWorkVersion, recipient,
  subject, bodyEn, bodyCn, strategySummary, sourceSnapshot,
  attachmentManifest, idempotencyKey
})
```

Reuse recipient evidence validation, content hashing, deterministic quality scoring, immutable version insertion, event recording, and work-item optimistic versioning. Include the normalized attachment manifest in the content hash. Require it to be `[]` for the first rollout.

- [ ] **Step 4: Implement the canonical intake transaction**

Inside one `better-sqlite3` immediate transaction:

- reload candidate detail with contacts exposed;
- require `valid`, `audited`, fresh evidence, current route readiness, and official recipient binding;
- resolve candidate link, exact official email, then verified domain and company;
- reject multiple canonical matches;
- create/reuse customer through `matrixLedgerStore`;
- upsert candidate link and verified email contact;
- create/reuse one owned work item;
- bind recipient evidence;
- call `createReviewedVersion`;
- record one intake idempotency event and return the immutable identifiers.

- [ ] **Step 5: Run bridge and ledger suites**

Run:

```bash
node scripts/test-matrix-intake-bridge.js
npm run test:matrix-ledger-store
npm run test:matrix-ledger
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/matrixIntakeBridge.js scripts/test-matrix-intake-bridge.js src/services/matrixStreamReview.js src/services/matrixLedgerStore.js
git commit -m "feat(matrix): create exact reviewed versions"
```

---

### Task 3: Authenticated management API and current-session command

**Files:**
- Modify: `src/routes/matrix.js`
- Modify: `src/server.js`
- Modify: `.runtime/vm_debug_ci/workspace/scripts/matrix-client.js`
- Modify: `scripts/run-matrix-ledger-command.js`
- Modify: `/home/admin/.local/bin/matrix-runtime` only after project verification
- Modify: `scripts/test-matrix-api.js`
- Modify: `scripts/test-matrix-ledger-cli.js`

**Interfaces:**
- Adds: `POST /api/matrix/intakes`.
- Adds command: `matrix-runtime intake create --input <protected-path> --idempotency-key <key>`.
- Does not add any send flag or SMTP operation.

- [ ] **Step 1: Write failing API authorization and validation tests**

Assert unauthenticated and non-administrative callers receive denial; unknown fields receive 400; valid bound input returns 201 draft identifiers; identical replay returns the same identifiers; a changed payload with the same idempotency key receives 409; no delivery job exists.

- [ ] **Step 2: Run API and CLI tests and verify RED**

Run:

```bash
node scripts/test-matrix-api.js
node scripts/test-matrix-ledger-cli.js
```

Expected: failures because the intake route and command are absent.

- [ ] **Step 3: Add the route**

Add an exact field allow-list:

```js
const INTAKE_FIELDS = new Set([
  'candidate_id', 'expected_candidate_fingerprint', 'subject', 'body_en', 'body_cn',
  'strategy_summary', 'attachment_manifest', 'route_readiness_id',
  'approval_reference', 'idempotency_key'
]);
```

Require existing review access plus administrative intake permission. Return only IDs, version, hash, and status. Map stale evidence, ambiguity, quality failure, idempotency conflict, and unavailable services to deterministic 4xx/503 responses without logging body content.

- [ ] **Step 4: Add the protected current-session command**

The command reads a mode-`0600` JSON package from a protected runtime directory, sends it to the authenticated API through the existing client, and prints only the safe response. Reject symlinks, paths outside the protected directory, broad permissions, unknown flags, and embedded credential-like keys.

- [ ] **Step 5: Run API, CLI, syntax, and security tests**

Run:

```bash
node scripts/test-matrix-api.js
node scripts/test-matrix-ledger-cli.js
npm run lint
```

Expected: all pass; tests confirm body text and recipient data are not written to stdout or error logs.

- [ ] **Step 6: Commit project changes**

```bash
git add src/routes/matrix.js src/server.js .runtime/vm_debug_ci/workspace/scripts/matrix-client.js scripts/run-matrix-ledger-command.js scripts/test-matrix-api.js scripts/test-matrix-ledger-cli.js
git commit -m "feat(matrix): expose protected intake command"
```

- [ ] **Step 7: Install the user command after verification**

Install the reviewed wrapper at `/home/admin/.local/bin/matrix-runtime` with mode `0750`. Do not place endpoint tokens or actor identifiers in the wrapper.

---

### Task 4: Delivery and follow-up regression protection

**Files:**
- Modify: `scripts/test-matrix-stream-delivery.js`
- Create: `scripts/test-matrix-stream-followup.js`
- Modify: `scripts/test-matrix-ledger-e2e.js`
- Modify: `package.json`

**Interfaces:**
- Consumes the draft created by `matrixIntakeBridge`.
- Proves existing approval, final preview, delivery, and reply-check behavior remains unchanged.

- [ ] **Step 1: Write the failing end-to-end fixture**

Create a reviewed candidate and exact draft, approve its hash, project final preview, and confirm delivery through a fake transport. Assert:

```js
assert.equal(transport.calls.length, 1);
assert.equal(delivery.state, 'accepted');
assert.equal(checkReplyTasks.length, 1);
assert.equal(checkReplyTasks[0].due_at, THREE_CALENDAR_DAYS_LATER);
```

Replay the same confirmation and assert one transport call, one accepted job, and one task. Add rejection cases for changed hash, stale route evidence, suppression, duplicate delivery, quota, and sender-not-ready.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node scripts/test-matrix-ledger-e2e.js
```

Expected: failure because the reviewed intake fixture cannot yet enter the delivery workflow.

- [ ] **Step 3: Wire only missing compatibility**

Make the smallest compatibility changes required for reviewed versions to flow through existing preview, approval, delivery, and follow-up services. Do not add a new delivery implementation.

- [ ] **Step 4: Run the complete Matrix regression set**

Run:

```bash
node scripts/test-matrix-intake-candidate.js
node scripts/test-matrix-intake-bridge.js
node scripts/test-matrix-api.js
node scripts/test-matrix-stream-review.js
node scripts/test-matrix-stream-delivery.js
node scripts/test-matrix-stream-followup.js
npm run verify:matrix-ledger
npm run verify:matrix-readonly-selection
npm run baseline:verify
npm run lint
```

Expected: all pass with no real transport invocation.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-matrix-stream-delivery.js scripts/test-matrix-stream-followup.js scripts/test-matrix-ledger-e2e.js package.json
git commit -m "test(matrix): verify reviewed intake lifecycle"
```

---

### Task 5: Nutty Nuts no-send production preparation

**Files:**
- Create in protected ignored storage: `runtime-data-matrix-research-private/intakes/nutty-nuts-20260728.json`
- Modify after verification: `docs/operations/matrix-runtime-ledger-runbook.md`
- Reconcile after verified deployment: `/home/admin/.codex/matrix-runtime/resources/matrix-console.md`
- Reconcile after verified deployment: `/home/admin/.codex/matrix-runtime/capabilities/message-relay.md`

**Interfaces:**
- Consumes the exact user-approved recipient, subject, bodies, public evidence, and production route readiness.
- Produces a canonical draft and final preview with zero send invocation.

- [ ] **Step 1: Build the protected package**

Record Nutty Nuts official domain, organization name, public recipient, official contact page, at least three official source-role pages, current production route readiness, exact approved English body, Chinese translation, empty attachment manifest, and approval reference. Set file mode `0600`; do not commit it.

- [ ] **Step 2: Run candidate and management dry runs**

Run the reviewed candidate admission in dry-run mode, then call the intake API against isolated databases. Confirm deterministic IDs, score 100, `draft` status, zero approvals, zero delivery jobs, and zero follow-up tasks.

- [ ] **Step 3: Verify the deployable source**

Run the full Task 4 command set, database integrity checks, character-integrity checks for English, Chinese, and Arabic text, and a no-secret scan.

- [ ] **Step 4: Commit and push**

Commit only reviewed source, tests, and documentation. Push `main`. Do not commit the protected intake package.

- [ ] **Step 5: Request production deployment approval**

Report the exact commit, tests, protected package path, and that no send occurred. Obtain explicit approval before restarting `packaging-system.service` or the assistant container.

- [ ] **Step 6: Deploy and verify no-send intake**

After approval, deploy the exact commit, verify service and assistant health with zero restart loops, admit Nutty Nuts, create the canonical exact draft, and retrieve the final preview. Confirm recipient, subject, body hash, empty attachment manifest, and every delivery gate. Stop before delivery.

- [ ] **Step 7: Obtain final production send confirmation**

Show the exact production preview and require the user to confirm it. Only then invoke the existing delivery confirmation once. Report `accepted`, `failed`, or `ambiguous` accurately and verify exactly one reply-check task after `accepted`.

- [ ] **Step 8: Reconcile the user-level catalog**

Update only existing neutral-codename entries with paths, status, commit, verification date, and remaining limitations. Scan the catalog for credentials, SMTP identifiers, and actual business records.

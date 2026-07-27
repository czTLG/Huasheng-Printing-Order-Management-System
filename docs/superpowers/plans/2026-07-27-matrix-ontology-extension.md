# Matrix Ontology Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recognize evidenced sauce and seasoning concepts in bilingual draft-quality checks and save one reviewable Dh Foods draft without approving or sending it.

**Architecture:** Extend the existing shared concept ontology rather than adding prospect-specific exceptions. Keep evidence scoring in `matrixStreamGate` and candidate research scoring in `matrixSignalMatch`; the new concepts flow through the existing bilingual extractor, evidence snapshot, immutable version, and approval gates.

**Tech Stack:** Node.js 22, CommonJS, `better-sqlite3`, deterministic regular expressions, existing script-based regression suites.

## Global Constraints

- Use neutral technical codenames in source, documentation, commits, and user-visible internal labels.
- Do not weaken provenance, duplicate prevention, quality thresholds, country policy, delivery limits, or two-step outbound confirmation.
- Questions about possible formats must not become assertions that a prospect currently uses those formats.
- No production deployment, service restart, approval record, delivery job, or external communication is included.

---

### Task 1: Extend deterministic bilingual concepts

**Files:**
- Modify: `scripts/test-matrix-stream-gates.js`
- Modify: `src/services/matrixStreamGate.js`
- Modify: `src/services/matrixStreamOntology.js`

**Interfaces:**
- Consumes: `extractBilingualFacts(text, language)` and `scoreDraft(input)`.
- Produces: deterministic concept keys `sauce`, `seasoning`, `seasoning_powder`, `soup_base`, `sachet`, and `roll_film`.

- [ ] **Step 1: Write failing concept-alignment tests**

Add literal English/Chinese pairs to `scripts/test-matrix-stream-gates.js`:

```js
for (const [bodyEn, bodyCn] of [
  ['Could you confirm the sauce sachet size?', '请确认酱料小袋的尺寸？'],
  ['Could you confirm the seasoning powder roll film width?', '请确认调味粉卷膜的宽度？'],
  ['Could you confirm the soup base pouch size?', '请确认汤底包装袋的尺寸？']
]) {
  const result = scoreDraft({ ...base, bodyEn, bodyCn });
  assert.ok(!result.hardFailures.includes('bilingual_key_fact_conflict'));
}
```

Add a direct extractor assertion proving `supplier evaluation` creates no named-supplier fact:

```js
assert.deepStrictEqual(
  extractBilingualFacts('official factory and supplier-evaluation process', 'en').supplier || [],
  []
);
```

- [ ] **Step 2: Run the gate suite and verify RED**

Run:

```bash
node scripts/test-matrix-stream-gates.js
```

Expected: at least one new sauce/seasoning/sachet/roll-film assertion fails because the concepts are absent from the shared ontology.

- [ ] **Step 3: Add minimal ontology mappings**

Extend `src/services/matrixStreamOntology.js` and the concept list consumed by `matrixStreamGate.js` with bounded mappings:

```js
['sauce', /\bsauces?\b/i, /(?:酱料|酱汁)/u],
['seasoning', /\bseasonings?\b/i, /(?:调味料|调味品)/u],
['seasoning_powder', /\bseasoning\s+powder\b/i, /调味粉/u],
['soup_base', /\bsoup[ -]?base\b/i, /(?:汤底|汤料)/u],
['sachet', /\bsachets?\b/i, /小袋/u],
['roll_film', /\b(?:printed\s+)?roll\s+(?:film|stock)\b/i, /(?:印刷卷膜|卷膜)/u]
```

Keep URLs removed before extraction and keep material abbreviations bounded.

- [ ] **Step 4: Run the focused gate suite and verify GREEN**

Run:

```bash
node scripts/test-matrix-stream-gates.js
```

Expected: `matrix stream gate tests passed`.

- [ ] **Step 5: Commit the ontology behavior**

```bash
git add scripts/test-matrix-stream-gates.js src/services/matrixStreamGate.js src/services/matrixStreamOntology.js
git commit -m "feat: extend matrix bilingual ontology"
```

### Task 2: Protect questions and supplier-process wording

**Files:**
- Modify: `scripts/test-matrix-stream-gates.js`
- Modify: `src/services/matrixStreamGate.js`

**Interfaces:**
- Consumes: `scoreDraft({ subject, bodyEn, bodyCn, recipient, evidence, now })`.
- Produces: a passing evidence-bound score for process wording while retaining named-supplier blockers.

- [ ] **Step 1: Add a failing Dh Foods-style quality fixture**

Create a literal official-evidence snapshot in `scripts/test-matrix-stream-gates.js`. Score this pair:

```js
const dhFoodsDraft = scoreDraft({
  subject: 'Sauce sachet and roll-film sourcing for Dh Foods',
  bodyEn: 'Dear Dh Foods Purchasing Team,\n\nWe reviewed your official factory and supplier-evaluation process, as well as your sauce, soup-base, and seasoning portfolio.\n\nIs your team currently evaluating printed sachets, pouches, or roll film for any sauce or seasoning line? If yes, could you share one current pack photo, size, fill weight, estimated quantity, and packing-machine type?\n\nBest regards,\nGavin',
  bodyCn: 'Dh Foods采购团队，您好：\n\n我们查看了贵司官网公开的工厂及供应商评价流程，以及酱料、汤底和调味品产品系列。\n\n贵司目前是否正在评估用于酱料或调味品产品线的印刷小袋、包装袋或卷膜？如果是，能否提供一个现有包装的照片、尺寸、灌装重量、预计数量和包装机类型？\n\n此致\nGavin',
  recipient: dhFoodsRecipient,
  evidence: dhFoodsEvidence,
  now: '2026-07-27T10:00:00.000Z'
});
assert.strictEqual(dhFoodsDraft.score, 100);
assert.strictEqual(dhFoodsDraft.passed, true);
```

Also assert that a body naming an unevidenced current supplier still contains `unsupported_supplier`.

- [ ] **Step 2: Run the gate suite and verify RED**

Run:

```bash
node scripts/test-matrix-stream-gates.js
```

Expected: the Dh Foods fixture fails because generic supplier-process wording is treated as a supplier claim or the new product concepts are not credited through every component.

- [ ] **Step 3: Restrict supplier failure detection to relationship claims**

Adjust the supplier assertion pattern in `src/services/matrixStreamGate.js` so phrases such as `supplier-evaluation process` and `供应商评价流程` are treated as operating-process evidence, while named or possessive supplier assertions remain blocked.

- [ ] **Step 4: Run focused and review suites**

Run:

```bash
node scripts/test-matrix-stream-gates.js
node scripts/test-matrix-stream-review.js
```

Expected: both suites pass.

- [ ] **Step 5: Commit question and process protections**

```bash
git add scripts/test-matrix-stream-gates.js src/services/matrixStreamGate.js
git commit -m "fix: distinguish matrix process evidence"
```

### Task 3: Save and verify the Dh Foods draft

**Files:**
- Modify through authoritative SQLite service: `data/app.db`
- Verify: `scripts/test-matrix-stream-review.js`

**Interfaces:**
- Consumes: selected work item `3`, candidate `1`, recipient `purchase@dhfoods.com.vn`, current evidence snapshot, and `matrixStreamReview.createInitialVersion`.
- Produces: one immutable `draft` version with score `100`; no approval or delivery job.

- [ ] **Step 1: Recalculate current evidence and route readiness**

Run a read-only script using `createCacheIndexView` and `scoreSignalMatch` with `localizedRouteStatus: 'ready'`.

Expected literals:

```json
{"score":100,"passed":true,"blockers":[]}
```

- [ ] **Step 2: Create the initial immutable version**

Call:

```js
review.createInitialVersion(db, {
  actorUserId: 4,
  workItemId: 3,
  expectedWorkVersion: 1,
  recipient,
  subject,
  bodyEn,
  bodyCn,
  strategySummary: 'Official evidence reviewed for Dh Foods Joint Stock Company',
  sourceSnapshot,
  idempotencyKey: 'dh-foods-initial-draft-20260727'
});
```

The English body contains the verified Vietnamese application and company links and one short Vietnamese courtesy closing. The Chinese body is a faithful internal translation.

- [ ] **Step 3: Verify immutable state and absence of side effects**

Query only work item `3` and assert:

```js
version.status === 'draft';
version.quality_score === 100;
JSON.parse(version.quality_json).passed === true;
jobCount === 0;
approvalCount === 0;
```

- [ ] **Step 4: Run full proportional verification**

Run:

```bash
node scripts/test-matrix-stream-gates.js
node scripts/test-matrix-stream-review.js
npm run lint
git diff --check
```

Expected: all commands exit zero.

- [ ] **Step 5: Commit remaining source changes and push**

If Task 3 required no additional source changes, do not create an empty commit. Otherwise:

```bash
git add <changed-source-and-test-files>
git commit -m "fix: complete matrix draft evidence support"
git push
```

Do not deploy or restart production.

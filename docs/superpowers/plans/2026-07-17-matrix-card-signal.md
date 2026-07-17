# Matrix Card Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scheduled Feishu A-E recommendations directly usable, add evidence-backed supplier/strategy detail, and restrict active recommendations to the approved nearby-country set.

**Architecture:** Keep candidate facts in the read-only `matrix-stream.db` and add two provenance-bearing tables through a separate validated importer. Extend the existing query adapter to return optional supplier and strategy signals, then let the Feishu extension create a fresh operator-scoped session whenever a letter/button is used without one. Scheduled cards remain idempotent and carry stateless `mx.quick` callbacks; authoritative A-E mappings are always created by the application API before detail or selection.

**Tech Stack:** Node.js 22, CommonJS, Express, better-sqlite3, Feishu CardKit schema 2.0, Docker Compose, node:test-style assertions.

## Global Constraints

- Use neutral technical codenames in filenames, manifests, workflow labels, and internal UI labels.
- Recommend at most five candidates and keep each mobile card under 1,500 Unicode code points.
- Priority countries are `JP,KR,VN,TH,MY,ID,PH,MN,RU,KZ,UZ,KG,PK,BD,NP,LK`.
- Exclude China, India, and all EU member states from active recommendations.
- Supplier relationships are `confirmed`, `public_lead`, or `unknown`; every named relationship retains public provenance.
- Never use login bypass, CAPTCHA evasion, private profiles, guessed personal contacts, or unsupported relationship claims.
- External email, WhatsApp, and website outreach remains disabled without explicit human approval.
- A letter opens detail and never selects; only `确认选择` writes an idempotent selection event.

---

## File map

- `src/lib/cacheIndexView.js`: nearby-country recommendation predicate and optional supplier/strategy read model.
- `scripts/matrix-signal-import.js`: validated, transactional writer for public relationship and strategy signals.
- `scripts/test-cache-index-view.js`: query, geography, provenance, and missing-signal tests.
- `scripts/test-matrix-signal-import.js`: importer validation/idempotency tests.
- `.runtime/vm_debug_ci/workspace/scripts/matrix-watch.js`: attractive scheduled CardKit card with A-E callbacks.
- `.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs`: quick-choice parsing, fresh-session recovery, rich detail layout, and callback handling.
- `.runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`: scheduled card, message, callback, isolation, mobile-budget, and fail-closed tests.
- `scripts/verify-matrix-readonly-selection.js`: reviewed runtime hashes and nearby/signal production gates.
- `docs/matrix-stream-catalog-2026-07-16.md`: operator contract and acceptance evidence.

### Task 1: Nearby-country and public-signal read model

**Files:**
- Modify: `src/lib/cacheIndexView.js`
- Modify: `scripts/test-cache-index-view.js`

**Interfaces:**
- Produces: `NEARBY_COUNTRY_CODES: ReadonlySet<string>`, recommendation summaries with `supplier_signal`/`strategy_signal`, and the same fields on `detail(...)`.
- Consumes: existing `cache_records`, `cache_evidence`, and `cache_discovery` rows.

- [ ] **Step 1: Write failing nearby-country and detail-signal tests**

Add fixture tables and assertions:

```js
db.exec(`
  CREATE TABLE cache_relationships (
    id INTEGER PRIMARY KEY, record_id INTEGER NOT NULL, supplier_name TEXT NOT NULL,
    supplier_country_code TEXT, supplied_category TEXT, confidence TEXT NOT NULL,
    source_url TEXT NOT NULL, source_type TEXT NOT NULL, observed_at TEXT NOT NULL,
    excerpt TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE
  );
  CREATE TABLE cache_strategy_signals (
    id INTEGER PRIMARY KEY, record_id INTEGER NOT NULL, entry_product TEXT NOT NULL,
    differentiation_angle TEXT NOT NULL, first_contact_goal TEXT NOT NULL,
    questions_json TEXT NOT NULL, risks_json TEXT NOT NULL, source_url TEXT NOT NULL,
    observed_at TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE
  );
`);
```

Insert one audited VN row and one audited US row with otherwise identical strict evidence. Assert `view.recommend({ limit: 5 })` returns VN and excludes US. Insert a confirmed relationship and strategy for VN, then assert:

```js
assert.deepStrictEqual(detail.supplier_signal, {
  supplier_name: 'Benchmark Supplier', supplier_country_code: 'CN',
  supplied_category: 'fruit jelly laminated film', confidence: 'confirmed',
  source_url: 'https://trade.test/record', source_type: 'public_trade_record',
  observed_at: '2026-07-17T00:00:00Z', excerpt: 'Named buyer and supplier'
});
assert.deepStrictEqual(detail.strategy_signal.questions, ['年用量', '现有结构']);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/test-cache-index-view.js`

Expected: FAIL because US remains recommendable and `supplier_signal` is undefined.

- [ ] **Step 3: Implement the nearby predicate and optional signal readers**

Add:

```js
const NEARBY_COUNTRY_CODES = Object.freeze(new Set([
  'JP','KR','VN','TH','MY','ID','PH','MN','RU','KZ','UZ','KG','PK','BD','NP','LK'
]));
const NEARBY_SQL = `r.country_code IN (${[...NEARBY_COUNTRY_CODES].map(code => `'${code}'`).join(',')})`;
```

Append `AND ${NEARBY_SQL}` to `RECOMMENDATION_WHERE`, not `BASE_WHERE`, so deferred records remain visible to administrators. Add `tableExists(db, name)`, `signalsForRecord(db, id)`, and `enrichRecommendation(db, row)`. Query the newest valid relationship/strategy row only when the table exists. Use `enrichRecommendation` for `recommendPage`, `recommend`, and `recommendationById`, while `detail` includes the same full signals. Reject relationship confidence values outside `confirmed/public_lead`; return `supplier_signal: null` and `strategy_signal: null` when absent. Parse `questions_json` and `risks_json` with `jsonArray`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node scripts/test-cache-index-view.js`

Expected: `cache index view tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cacheIndexView.js scripts/test-cache-index-view.js
git commit -m "feat: add nearby signal read model"
```

### Task 2: Validated signal importer and benchmark seed

**Files:**
- Create: `scripts/matrix-signal-import.js`
- Create: `scripts/test-matrix-signal-import.js`
- Create: `data/matrix-signal-batch-2026-07-17.json`

**Interfaces:**
- Consumes: `node scripts/matrix-signal-import.js --db <path> --input <json> --dry-run|--apply`.
- Produces: `cache_relationships` and `cache_strategy_signals` rows in one immediate transaction.

- [ ] **Step 1: Write failing importer tests**

Create a temporary candidate DB with record `normalized_domain='vietnamthd.vn'`. Exercise dry-run, apply, repeat apply, missing record, invalid confidence, non-public URL, and unknown input fields. Use an input object with exact keys:

```json
{
  "version": 1,
  "records": [{
    "normalized_domain": "vietnamthd.vn",
    "relationship": {
      "supplier_name": "Guangdong Shunshun Packaging Co., Ltd.",
      "supplier_country_code": "CN",
      "supplied_category": "fruit jelly laminated film",
      "confidence": "confirmed",
      "source_url": "https://www.trademo.com/companies/thd-agricultural-processing-joint-stock-company/33328049",
      "source_type": "public_trade_record",
      "observed_at": "2026-07-17T00:00:00.000Z",
      "excerpt": "Public record names buyer, supplier and MOPP/kraft/PE laminated film."
    },
    "strategy": {
      "entry_product": "fruit jelly laminated roll film",
      "differentiation_angle": "stable nearby supply and structure review",
      "first_contact_goal": "confirm current structure and annual consumption",
      "questions": ["Current laminate structure?", "Annual roll-film consumption?"],
      "risks": ["Public relationship may not represent current exclusive supply"],
      "source_url": "https://www.trademo.com/companies/thd-agricultural-processing-joint-stock-company/33328049",
      "observed_at": "2026-07-17T00:00:00.000Z"
    }
  }]
}
```

- [ ] **Step 2: Run the importer test and verify RED**

Run: `node scripts/test-matrix-signal-import.js`

Expected: FAIL with `Cannot find module './matrix-signal-import.js'`.

- [ ] **Step 3: Implement strict parsing and transactional upsert**

Export `parseBatch`, `ensureSchema`, `applyBatch`, and `fingerprint`. Enforce HTTPS URLs, ISO timestamps, two-letter uppercase country codes, exact object keys, `confirmed|public_lead`, non-empty excerpts, maximum 500 characters per prose field, and maximum ten questions/risks. Derive fingerprints with SHA-256 from normalized domain + source URL + signal payload. Use `INSERT ... ON CONFLICT(fingerprint) DO UPDATE` inside `db.transaction(...).immediate()`.

- [ ] **Step 4: Add the three initial nearby-company records**

The batch must contain:

- THD Agricultural Processing JSC / `vietnamthd.vn`: confirmed Shunshun trade relationship.
- Sao Mai Agro Processing JSC / `saomai-agrovietnam.com`: supplier unknown, tropical fruit ingredient strategy from its official site.
- Tien Thinh Group JSC / `tienthinh.vn`: supplier unknown, fruit puree/juice/dried-product strategy from its official site.

If a domain is not yet in `cache_records`, importer output must report it under `unmatched` and write no relationship/strategy row. Candidate creation remains a separate reviewed discovery step.

- [ ] **Step 5: Run tests, dry-run production, then apply matched rows**

Run:

```bash
node scripts/test-matrix-signal-import.js
node scripts/matrix-signal-import.js --db data/matrix-stream.db --input data/matrix-signal-batch-2026-07-17.json --dry-run
node scripts/matrix-signal-import.js --db data/matrix-stream.db --input data/matrix-signal-batch-2026-07-17.json --apply
```

Expected: tests pass; dry-run and apply report identical matched/unmatched counts; second apply produces zero duplicates.

- [ ] **Step 6: Commit**

```bash
git add scripts/matrix-signal-import.js scripts/test-matrix-signal-import.js data/matrix-signal-batch-2026-07-17.json
git commit -m "feat: add validated matrix signal importer"
```

### Task 3: Attractive scheduled card and sessionless A-E flow

**Files:**
- Modify: `.runtime/vm_debug_ci/workspace/scripts/matrix-watch.js`
- Modify: `.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs`
- Modify: `.runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`

**Interfaces:**
- Produces: `parseQuickChoice(text): number|null`, `freshState(msg): Promise<State>`, callback `mx.quick` with `{ a:'mx.quick', i:0..4 }`.
- Consumes: existing `client.today`, `client.createSession`, `client.candidateDetail`, and idempotent `client.selectCandidate`.

- [ ] **Step 1: Write failing scheduled-card button tests**

Extend `testWatcherWholeCardBudget()` to assert five button objects use CardKit schema 2.0:

```js
const quick = buttons(watcher.reminderCard(rows)).filter(item => item.behaviors?.[0]?.value?.a === 'mx.quick');
assert.deepStrictEqual(quick.map(item => item.behaviors[0].value.i), [0,1,2,3,4]);
assert.deepStrictEqual(quick.map(item => item.text.content), ['查看 A','查看 B','查看 C','查看 D','查看 E']);
```

Also assert the visible text contains `也可 @智能桓 回复 A-E`, supplier state, and approach angle while remaining within 1,500 code points.

- [ ] **Step 2: Write failing message/callback recovery tests**

For a newly registered extension with no persisted session, assert each input `A`, `a`, and `开发客户 A` calls `today`, then `createSession`, then `candidateDetail`, sends detail, and never calls `selectCandidate`. Trigger `handlers.get('mx.quick')` with index 1 and assert it opens B detail. Add two open IDs in one chat and assert distinct `createSession` calls and state keys.

- [ ] **Step 3: Run the extension test and verify RED**

Run: `node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`

Expected: FAIL because scheduled cards contain no buttons and sessionless A sends the restart card.

- [ ] **Step 4: Implement CardKit quick buttons**

In `matrix-watch.js`, add:

```js
function quickButton(index) {
  const letter = String.fromCharCode(65 + index);
  return {
    tag: 'button', text: { tag: 'plain_text', content: `查看 ${letter}` }, type: 'default',
    behaviors: [{ type: 'callback', value: { a: 'mx.quick', i: index } }]
  };
}
```

Render compact two-column action rows after candidate summaries and keep the footer instruction. Supplier state defaults to `未知`; do not invent names from summary-only data.

- [ ] **Step 5: Implement fresh session recovery and rich detail sections**

Add `mx.quick` to `ACTIONS`. Implement:

```js
function parseQuickChoice(value) {
  const text = String(value || '').trim().toUpperCase().replace(/^开发客户\s*/, '');
  return /^[A-E]$/.test(text) ? LETTERS.indexOf(text) : null;
}
```

Extract today's existing query/session logic into `freshState(msg)` returning state without sending. `start(msg)` calls `freshState` and renders the list. `openQuick(msg,index)` first tries the active/recoverable state; if none exists, calls `freshState`; then fetches authoritative detail using the created session. `mx.quick` builds a message-shaped context from the callback operator/chat/thread and calls `openQuick`. Detail rendering adds `为什么推荐`, `产品结构`, `供应链线索`, and `开发策略`, with compact fallbacks and existing contact masking.

- [ ] **Step 6: Run extension, bridge, and artifact tests**

Run:

```bash
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
node .runtime/vm_debug_ci/workspace/tests/test-bridge-patch.js
MATRIX_BRIDGE_ARTIFACT_DIR=/tmp/matrix-bridge-artifact-0.6.9/package node scripts/test-bridge-artifact-0.6.9.js
```

Expected: all three pass; artifact hashes remain the reviewed 0.6.9 values.

- [ ] **Step 7: Commit**

```bash
git add .runtime/vm_debug_ci/workspace/scripts/matrix-watch.js .runtime/vm_debug_ci/workspace/extensions/stream-card.cjs .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
git commit -m "feat: add matrix quick detail cards"
```

### Task 4: Production gate, documentation, and controlled rollout

**Files:**
- Modify: `scripts/verify-matrix-readonly-selection.js`
- Modify: `scripts/test-verify-matrix-readonly-selection.js`
- Modify: `docs/matrix-stream-catalog-2026-07-16.md`
- Modify: production release copy under ignored `runtime-data-matrix-<commit>/.runtime/vm_debug_ci/`

**Interfaces:**
- Produces: one verifier report covering nearby eligibility, signal provenance, card callbacks, and disabled external delivery.
- Consumes: Task 1-3 functions and runtime files.

- [ ] **Step 1: Write failing verifier assertions**

Add fixture US and VN rows and assert strict count includes VN only. Require runtime tests to prove quick buttons and sessionless A. Add manifest entries/hashes for every reviewed production file changed by Tasks 1-3.

- [ ] **Step 2: Run verifier and verify RED**

Run:

```bash
MATRIX_BRIDGE_ARTIFACT_DIR=/tmp/matrix-bridge-artifact-0.6.9/package \
MATRIX_STREAM_DB_PATH=/home/admin/work/packaging-system/data/matrix-stream.db \
MATRIX_DELIVERY_ENABLED=0 npm run verify:matrix-readonly-selection
```

Expected: FAIL on old manifest hashes before they are updated.

- [ ] **Step 3: Update reviewed hashes and catalog**

Document exact commands, country set, A-E recovery semantics, relationship evidence levels, mobile limit, external-delivery boundary, database mode `600`, and rollback container name. Update hashes only after reviewing diffs of the corresponding production files.

- [ ] **Step 4: Run complete verification**

Run:

```bash
node --check src/lib/cacheIndexView.js
node --check .runtime/vm_debug_ci/workspace/extensions/stream-card.cjs
node --check .runtime/vm_debug_ci/workspace/scripts/matrix-watch.js
npm run verify:smoke
MATRIX_BRIDGE_ARTIFACT_DIR=/tmp/matrix-bridge-artifact-0.6.9/package MATRIX_STREAM_DB_PATH=/home/admin/work/packaging-system/data/matrix-stream.db MATRIX_DELIVERY_ENABLED=0 npm run verify:matrix-readonly-selection
git diff --check
```

Expected: syntax checks exit 0, `SMOKE PASS`, strict verifier passes, recommendation count is at most five, excluded-country count is zero, and delivery remains disabled.

- [ ] **Step 5: Build and preflight an immutable production release**

Archive the committed runtime into `runtime-data-matrix-<commit>`, reuse external volumes `vm_debug_ci_bridge_state` and `vm_debug_ci_codex_state`, preserve hostname `vm-debug-ci`, and mount only reviewed legacy tools. Build the image and run `probeApi()` inside a one-off container before stopping production.

- [ ] **Step 6: Switch with rollback preservation**

Stop the current container, rename it `vm_debug_ci_pre_<commit>`, start the new release, and require Docker health `healthy`, authenticated `/api/matrix/ready` 200, database integrity `ok`, bridge credential validation, and WebSocket `client ready`. On any failure, stop the new container and restart the preserved container.

- [ ] **Step 7: Perform real Feishu acceptance**

In the build group, send `@智能桓 A` with no active session, click `查看 B`, return to list, click `确认选择` once, repeat the callback once, and restart the container. Verify one selection event only and recovery of the same operator/chat/thread mapping. Capture no contact values or tokens in logs.

- [ ] **Step 8: Commit verifier and catalog**

```bash
git add scripts/verify-matrix-readonly-selection.js scripts/test-verify-matrix-readonly-selection.js docs/matrix-stream-catalog-2026-07-16.md
git commit -m "test: gate matrix quick card rollout"
```

# Matrix Atlas Read-Only Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `智能桓` immediately recommend up to five evidence-backed overseas candidates as stable A–E choices, show full provenance/detail, and persist human selection, stage, and next action while all outbound delivery remains disabled.

**Architecture:** The main application opens `data/matrix-stream.db` through a dedicated read-only adapter and stores only sessions, bindings, work items, and append-only selection events in the existing application database. A narrow authenticated `/api/matrix` router serves both JWT-authorized CRM users and a Feishu bridge service identity mapped to an application user. The pinned Feishu bridge receives a checksum-verified extension seam; a project-local CommonJS extension handles the exact `开发客户` intent and card callbacks before the general agent.

**Tech Stack:** Node.js 22, Express, better-sqlite3, node:test/assert-style script tests, Feishu CardKit through `@modelzen/feishu-codex-bridge@0.6.9`, Docker Compose.

## Global Constraints

- Discover at most 100 new companies per calendar day.
- Deep-review at most 20 P0/P1 companies per calendar day.
- Recommend at most 5 companies per daily Feishu review batch.
- Deliver at most 5 approved first-contact emails per calendar day.
- All internal components, folders, workflow identifiers, configuration keys, skill names, and user-visible feature labels use neutral technical codenames.
- The natural-language trigger `开发客户` remains supported because it is user input, not an internal capability name.
- China and India remain excluded from discovery and recommendations.
- Domestic legacy customers remain outside this workflow.
- `开发客户` returns the current global-overseas recommendation set immediately; it never asks for a region, city, or category first.
- Region, country, and category controls exist only under `高级筛选`.
- An official directory may discover a company but cannot replace official-site verification.
- No material structure, thickness, dimension, price, MOQ, compatibility, purchasing plan, or contact role is invented.
- Unsupported values remain `待核实`.
- The Feishu container receives read-only access to the candidate database.
- All writes and all delivery operations go through narrow authenticated application APIs; the container never receives direct write access or arbitrary SMTP credentials.
- Phase one has no SMTP, WhatsApp, LinkedIn, website-form, or other outbound call path.
- Neutral naming protects commercial confidentiality only; real upstream names, licenses, versions, checksums, network behavior, and source URLs remain auditable.

## File Structure

### Main application

- `src/lib/matrixRegions.json`: neutral country-to-region mapping used only for filtering and labels.
- `src/lib/cacheIndexView.js`: read-only access to `cache_records`, `cache_evidence`, and `cache_discovery`.
- `src/lib/packetGate.js`: session, binding, work-item, selection-event, version, and idempotency operations.
- `src/routes/matrix.js`: JWT/service authentication and read/selection APIs.
- `src/db.js`: operational tables only; candidate facts remain in the separate database.
- `src/server.js`: mount the router; no scheduled discovery or delivery in this slice.
- `scripts/matrix-bind-actor.js`: explicit administrator CLI for Feishu-to-application identity binding.
- `scripts/test-cache-index-view.js`: adapter and evidence-bound filtering tests.
- `scripts/test-packet-gate.js`: state, authorization binding, and idempotency tests.
- `scripts/test-matrix-api.js`: protected route contract tests.
- `scripts/verify-matrix-readonly-selection.js`: integrated no-outbound verification.

### Feishu runtime

- `.runtime/vm_debug_ci/bridge-patch/patch-stream-card.cjs`: checksum-pinned seam installer for bridge 0.6.9.
- `.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs`: deterministic intent and action handlers.
- `.runtime/vm_debug_ci/workspace/scripts/matrix-client.js`: narrow HTTP client with no generic request primitive.
- `.runtime/vm_debug_ci/workspace/scripts/matrix-watch.js`: 09:00 daily read-only recommendation notifier.
- `.runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`: intent, card, action, stale callback, and mobile-content tests.
- `.runtime/vm_debug_ci/Dockerfile`: run the checksum-verified patch after the pinned package install.
- `.runtime/vm_debug_ci/compose.yaml`: mount candidate DB read-only and pass only narrow service configuration.

---

### Task 1: Read-Only Candidate Index

**Files:**

- Create: `src/lib/matrixRegions.json`
- Create: `src/lib/cacheIndexView.js`
- Create: `scripts/test-cache-index-view.js`

**Interfaces:**

- Consumes: SQLite path from `MATRIX_STREAM_DB_PATH`, defaulting to `<repo>/data/matrix-stream.db`.
- Produces: `createCacheIndexView({ dbPath })` returning `{ facets, list, detail, recommend, close }`.
- `facets(): { regions, countries, categories }`.
- `list(filters): { rows, page, page_size, total, total_pages, snapshot_key }`.
- `detail(id): CandidateDetail | null`.
- `recommend({ limit, excludeIds }): CandidateSummary[]`, hard-clamped to 5.

- [ ] **Step 1: Write the failing adapter test**

Create a temporary candidate database with three records, discovery rows, and evidence rows. Test region/category filters, stable ordering, source separation, contact masking, excluded countries, and a five-record recommendation clamp.

```js
// scripts/test-cache-index-view.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { createCacheIndexView } = require('../src/lib/cacheIndexView');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-index-view-'));
const dbPath = path.join(dir, 'matrix.db');
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE cache_records (
    id INTEGER PRIMARY KEY, company_name TEXT, country_code TEXT, city TEXT,
    normalized_domain TEXT UNIQUE, official_url TEXT, product_categories_json TEXT,
    format_signals_json TEXT, size_signals_json TEXT, scale_tier TEXT,
    public_email TEXT, public_phone TEXT, public_whatsapp TEXT, contact_url TEXT,
    priority TEXT, fit_score REAL, demand_fit_score REAL, access_score REAL,
    confidence REAL, status TEXT, assessment_cn TEXT, next_action_cn TEXT,
    stage_code TEXT, audit_state TEXT, audit_note TEXT, audited_at TEXT, updated_at TEXT
  );
  CREATE TABLE cache_evidence (
    id INTEGER PRIMARY KEY, record_id INTEGER, source_url TEXT, source_type TEXT,
    page_title TEXT, observed_at TEXT, excerpt TEXT, fingerprint TEXT
  );
  CREATE TABLE cache_discovery (
    id INTEGER PRIMARY KEY, record_id INTEGER, normalized_domain TEXT,
    discovered_via TEXT, discovery_url TEXT, official_url TEXT, source_type TEXT,
    verified_at TEXT, fingerprint TEXT
  );
`);
const insertRecord = db.prepare(`INSERT INTO cache_records VALUES (
  @id,@company_name,@country_code,'',@domain,@url,@categories,@formats,@sizes,'medium',
  @email,'','','https://example.test/contact',@priority,@fit,@fit,@access,@confidence,
  @status,@assessment,'核实联系入口','observed',@audit_state,NULL,NULL,@updated_at
)`);
insertRecord.run({ id: 1, company_name: 'Alpha Foods', country_code: 'US', domain: 'alpha.test', url: 'https://alpha.test/', categories: '["coffee"]', formats: '["pouches"]', sizes: '["own factory"]', email: 'team@alpha.test', priority: 'P0', fit: 91, access: 80, confidence: .92, status: 'valid', assessment: '官网确认咖啡产品。', audit_state: 'audited', updated_at: '2026-07-16T00:00:00Z' });
insertRecord.run({ id: 2, company_name: 'Beta Tea', country_code: 'GB', domain: 'beta.test', url: 'https://beta.test/', categories: '["tea"]', formats: '["sachets"]', sizes: '["exports"]', email: '', priority: 'P1', fit: 82, access: 60, confidence: .84, status: 'valid', assessment: '官网确认茶产品。', audit_state: 'audited', updated_at: '2026-07-15T00:00:00Z' });
insertRecord.run({ id: 3, company_name: 'Blocked', country_code: 'IN', domain: 'blocked.test', url: 'https://blocked.test/', categories: '["coffee"]', formats: '[]', sizes: '[]', email: '', priority: 'P0', fit: 99, access: 90, confidence: .99, status: 'valid', assessment: 'excluded', audit_state: 'audited', updated_at: '2026-07-17T00:00:00Z' });
db.prepare('INSERT INTO cache_evidence VALUES (1,1,?,?,?,?,?,?)').run('https://alpha.test/products','official_website','Products','2026-07-16T00:00:00Z','Coffee products','e1');
db.prepare('INSERT INTO cache_discovery VALUES (1,1,?,?,?,?,?,?,?)').run('alpha.test','official_association_directory','https://association.test/members','https://alpha.test/','official_association_directory','2026-07-16T00:00:00Z','d1');
db.close();

const view = createCacheIndexView({ dbPath });
const page = view.list({ region: 'americas', category: 'coffee', page: 1, pageSize: 10 });
assert.deepStrictEqual(page.rows.map(row => row.id), [1]);
assert.strictEqual(page.rows[0].contacts.email, 't***@alpha.test');
assert.match(page.snapshot_key, /^[a-f0-9]{64}$/);
const detail = view.detail(1);
assert.strictEqual(detail.discovery.discovered_via, 'official_association_directory');
assert.strictEqual(detail.evidence[0].source_url, 'https://alpha.test/products');
assert.deepStrictEqual(view.recommend({ limit: 99, excludeIds: [] }).map(row => row.id), [1, 2]);
view.close();
console.log('cache index view tests passed');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/test-cache-index-view.js`

Expected: FAIL with `Cannot find module '../src/lib/cacheIndexView'`.

- [ ] **Step 3: Implement region mapping and adapter**

`matrixRegions.json` must map ISO alpha-2 codes to exactly `africa`, `americas`, `asia`, `europe`, or `oceania`; omit `CN` and `IN`. The adapter must:

```js
function createCacheIndexView({ dbPath }) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  return {
    facets: () => facets(db),
    list: (filters) => list(db, filters),
    detail: (id) => detail(db, id),
    recommend: ({ limit = 5, excludeIds = [] } = {}) => recommend(db, Math.min(5, limit), excludeIds),
    close: () => db.close()
  };
}
```

Use this stable SQL ordering for list and recommendation:

```sql
ORDER BY
  CASE r.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
  CASE r.audit_state WHEN 'audited' THEN 0 ELSE 1 END,
  COALESCE(r.demand_fit_score, r.fit_score) DESC,
  COALESCE(r.access_score, 0) DESC,
  r.id ASC
```

Always apply:

```sql
r.country_code NOT IN ('CN','IN')
AND r.stage_code <> 'suppressed'
AND r.status IN ('valid','needs_review')
```

Mask email as first character plus `***@domain`; mask phones/WhatsApp to the last four digits; return `[available]` for a contact page. Detail may return the complete *public organizational* contact only when the caller passes `{ revealContacts: true }`; the default remains masked.

- [ ] **Step 4: Run the adapter test and existing database verifier**

Run:

```bash
node scripts/test-cache-index-view.js
node /tmp/verify-matrix-stream.cjs data/matrix-stream.db
```

Expected: `cache index view tests passed`; integrity `ok`; duplicate/excluded/missing evidence counts all zero.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/lib/matrixRegions.json src/lib/cacheIndexView.js scripts/test-cache-index-view.js
git commit -m "feat: add read-only matrix index"
```

---

### Task 2: Selection Sessions and Append-Only Work State

**Files:**

- Modify: `src/db.js`
- Create: `src/lib/packetGate.js`
- Create: `scripts/test-packet-gate.js`

**Interfaces:**

- Consumes: application `db`, candidate numeric ID, application user ID, Feishu open ID, chat/thread ID, filter object, expected version, and idempotency key.
- Produces: `bindActor`, `resolveActor`, `createSession`, `updateSession`, `selectCandidate`, `listWorkItems`, and `getWorkItem`.

- [ ] **Step 1: Write failing state/idempotency tests**

The test initializes a temporary application database schema, binds one Feishu actor, creates a session, selects candidate 42 twice with the same key, rejects another actor, and verifies exactly one work item and one selection event.

```js
const first = gate.selectCandidate({
  candidateId: 42, actorUserId: 7, sessionId: session.id,
  expectedVersion: 1, idempotencyKey: 'evt-001',
  nextAction: '查看产品页和联系页'
});
const second = gate.selectCandidate({
  candidateId: 42, actorUserId: 7, sessionId: session.id,
  expectedVersion: 1, idempotencyKey: 'evt-001',
  nextAction: '查看产品页和联系页'
});
assert.strictEqual(first.work_item_id, second.work_item_id);
assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM matrix_work_items').get().n, 1);
assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM matrix_selection_events').get().n, 1);
assert.throws(() => gate.updateSession({ sessionId: session.id, actorUserId: 8, expectedVersion: 2, patch: { page: 2 } }), /not authorized/);
```

- [ ] **Step 2: Run test and verify RED**

Run: `node scripts/test-packet-gate.js`

Expected: FAIL because operational tables and `packetGate` do not exist.

- [ ] **Step 3: Add operational tables in `initDb()`**

Add exactly these tables and indexes to `src/db.js`:

```sql
CREATE TABLE IF NOT EXISTS matrix_actor_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feishu_open_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  bound_by INTEGER NOT NULL,
  bound_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(bound_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS matrix_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  thread_id TEXT NOT NULL DEFAULT '',
  filters_json TEXT NOT NULL,
  page INTEGER NOT NULL DEFAULT 1 CHECK(page >= 1),
  version INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(actor_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS matrix_work_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL UNIQUE,
  stage TEXT NOT NULL DEFAULT 'selected' CHECK(stage IN ('selected','draft_pending','review_pending','suppressed')),
  owner_user_id INTEGER NOT NULL,
  current_summary TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  next_followup_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(owner_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS matrix_selection_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_item_id INTEGER NOT NULL,
  candidate_id INTEGER NOT NULL,
  actor_user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY(work_item_id) REFERENCES matrix_work_items(id),
  FOREIGN KEY(actor_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_matrix_sessions_actor ON matrix_sessions(actor_user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_matrix_work_items_owner ON matrix_work_items(owner_user_id, stage, updated_at);
```

- [ ] **Step 4: Implement `packetGate` transactions**

Use `BEGIN IMMEDIATE` through `better-sqlite3` transactions. `selectCandidate` first queries by `idempotency_key`; if found, return the existing result. Otherwise insert-or-read the unique candidate work item, append one event, and increment the session version only when `actor_user_id` and `expectedVersion` match.

Reject expired sessions, revoked bindings, stale versions, empty idempotency keys, and next actions over 500 characters. Store only IDs and workflow summaries; do not copy candidate facts or contact details into the application DB.

- [ ] **Step 5: Run state tests and DB smoke tests**

Run:

```bash
node scripts/test-packet-gate.js
node scripts/smoke-test.js
```

Expected: `packet gate tests passed`; smoke suite exits zero.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/db.js src/lib/packetGate.js scripts/test-packet-gate.js
git commit -m "feat: add matrix selection state"
```

---

### Task 3: Protected Matrix API

**Files:**

- Create: `src/routes/matrix.js`
- Modify: `src/server.js`
- Create: `scripts/matrix-bind-actor.js`
- Create: `scripts/test-matrix-api.js`

**Interfaces:**

- Consumes: Task 1 `createCacheIndexView` and Task 2 `packetGate` functions.
- Produces these endpoints:
  - `GET /api/matrix/facets`
  - `GET /api/matrix/candidates`
  - `GET /api/matrix/candidates/:id`
  - `GET /api/matrix/recommendations/today`
  - `POST /api/matrix/sessions`
  - `PATCH /api/matrix/sessions/:id`
  - `POST /api/matrix/selections`
  - `GET /api/matrix/work-items`
  - `GET /api/matrix/work-items/:id`

- [ ] **Step 1: Write failing route tests**

Start the Express app with injected temporary application/candidate databases and assert:

```js
assert.strictEqual((await request('/api/matrix/facets')).status, 401);
assert.strictEqual((await request('/api/matrix/facets', { token: workerToken })).status, 403);
assert.strictEqual((await request('/api/matrix/facets', { token: crmAdminToken })).status, 200);
assert.strictEqual((await request('/api/matrix/recommendations/today', { token: crmAdminToken })).body.rows.length <= 5, true);
assert.strictEqual((await request('/api/matrix/candidates/1', { token: crmAdminToken })).body.discovery.discovered_via, 'official_association_directory');
assert.strictEqual((await request('/api/matrix/selections', { method: 'POST', serviceToken: 'bad', openId: 'ou_test' })).status, 401);
```

Also verify unknown filters return 400, `CN`/`IN` return 400, a service token without an active binding returns 403, repeated selection returns the same work item, and no response contains internal formulas or unmasked contacts for list routes.

- [ ] **Step 2: Run test and verify RED**

Run: `node scripts/test-matrix-api.js`

Expected: FAIL because `/api/matrix` is not mounted.

- [ ] **Step 3: Implement dual authentication without weakening `fakeAuth`**

Keep normal JWT authentication unchanged. Before `fakeAuth`, mount only an internal pre-auth middleware for `/api/matrix` that recognizes both headers:

```text
x-matrix-bridge-token: <secret>
x-feishu-open-id: <operator open id>
```

Compare the service token with `crypto.timingSafeEqual`, require a configured secret of at least 32 characters in production, resolve an active `matrix_actor_bindings` row, load the current active application user, and assign `req.user` plus `req.authMode = 'matrix_bridge'`. Requests without the service headers continue through `fakeAuth`; they do not bypass JWT.

The router allows only `super_admin` and `foreign_trade_crm_admin`. Candidate list responses always mask contact fields. Candidate detail reveals complete public organizational contacts only for those roles and records an `audit_logs` event.

- [ ] **Step 4: Implement validation and stable responses**

Allow only:

```js
const REGIONS = new Set(['africa','americas','asia','europe','oceania']);
const PRIORITIES = new Set(['P0','P1','P2','P3']);
const STATUSES = new Set(['valid','needs_review']);
```

`page_size` is a positive integer clamped to 20. Recommendations are hard-clamped to five. Return the stable `snapshot_key` generated by the adapter and persist the chosen filters in `matrix_sessions`. Reject unknown query/body fields.

- [ ] **Step 5: Add explicit actor-binding CLI**

`scripts/matrix-bind-actor.js` accepts `--open-id`, `--username`, and `--bound-by`. It refuses missing users, inactive users, non-CRM roles, empty IDs, and replacement of an active binding unless `--replace` is explicitly provided. It writes an audit event without printing tokens or other secrets.

- [ ] **Step 6: Run route, syntax, and smoke tests**

Run:

```bash
node --check src/routes/matrix.js
node --check scripts/matrix-bind-actor.js
node scripts/test-matrix-api.js
node scripts/smoke-test.js
```

Expected: all commands exit zero; route test prints `matrix API tests passed`.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/routes/matrix.js src/server.js scripts/matrix-bind-actor.js scripts/test-matrix-api.js
git commit -m "feat: expose protected matrix API"
```

---

### Task 4: Checksum-Pinned Feishu Extension Seam

**Files:**

- Create: `.runtime/vm_debug_ci/bridge-patch/patch-stream-card.cjs`
- Modify: `.runtime/vm_debug_ci/Dockerfile`
- Create: `.runtime/vm_debug_ci/workspace/tests/test-bridge-patch.js`

**Interfaces:**

- Consumes: pinned global package `@modelzen/feishu-codex-bridge@0.6.9`.
- Produces: synchronous CommonJS extension contract:

```ts
register(context: {
  channel: object;
  dispatcher: object;
  sendManagedCard: Function;
  updateManagedCard: Function;
  card: { card: Function; md: Function; note: Function; hr: Function; actions: Function; button: Function; linkButton: Function };
}): { onMessage(context: { msg: object; project: object }): Promise<boolean> };
```

- [ ] **Step 1: Write failing patch tests against a fixture bundle**

The fixture contains the two exact 0.6.9 anchors:

```js
const text = msg.content.trim();
const cmd = parseCommand(text);
```

and:

```js
const dispatcher = new CardDispatcher(channel, cfg);
cliBridge?.register(dispatcher);
```

Assert that the patcher:

- Refuses an unknown SHA-256.
- Refuses a missing or repeated anchor.
- Adds one synchronous extension registration block.
- Adds one pre-general-agent `onMessage` call.
- Is idempotent on the already-patched output.

- [ ] **Step 2: Run patch test and verify RED**

Run: `node .runtime/vm_debug_ci/workspace/tests/test-bridge-patch.js`

Expected: FAIL because the patcher does not exist.

- [ ] **Step 3: Implement checksum and exact-anchor patching**

Pin the unmodified 0.6.9 bundle SHA-256:

```text
b8016fbab2d60bc4da32b45f48564aec76059b184f943df1c1f0a4a1a1e32233
```

The registration insertion must be:

```js
const streamCardPath = process.env.STREAM_CARD_EXTENSION;
const streamCardExtension = streamCardPath ? require(streamCardPath) : null;
const streamCardHandler = streamCardExtension?.register?.({
  channel, dispatcher, sendManagedCard, updateManagedCard,
  card: { card, md, note, hr, actions, button, linkButton }
});
```

The message insertion, immediately before `parseCommand`, must be:

```js
if (streamCardHandler?.onMessage && await streamCardHandler.onMessage({ msg, project })) return;
```

The patcher writes through a same-directory temporary file and atomic rename, prints original and patched hashes, and exits nonzero on any mismatch. It does not fetch code or accept arbitrary patch content.

- [ ] **Step 4: Run the patch at Docker build time**

After the pinned global `npm install`, copy and run only the patcher:

```dockerfile
COPY bridge-patch/patch-stream-card.cjs /tmp/patch-stream-card.cjs
RUN node /tmp/patch-stream-card.cjs "$(npm root -g)/@modelzen/feishu-codex-bridge/dist/cli.js" \
    && rm /tmp/patch-stream-card.cjs
```

- [ ] **Step 5: Run patch tests and build the runtime image**

Run:

```bash
node .runtime/vm_debug_ci/workspace/tests/test-bridge-patch.js
docker compose -f .runtime/vm_debug_ci/compose.yaml build vm_debug_ci
```

Expected: patch tests pass; Docker build logs show the expected original hash and one patched hash; build exits zero.

- [ ] **Step 6: Commit Task 4**

```bash
git add .runtime/vm_debug_ci/bridge-patch/patch-stream-card.cjs .runtime/vm_debug_ci/Dockerfile .runtime/vm_debug_ci/workspace/tests/test-bridge-patch.js
git commit -m "feat: add pinned bridge extension seam"
```

---

### Task 5: Feishu Candidate Cards and Daily Read-Only Reminder

**Files:**

- Create: `.runtime/vm_debug_ci/workspace/scripts/matrix-client.js`
- Create: `.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs`
- Create: `.runtime/vm_debug_ci/workspace/scripts/matrix-watch.js`
- Create: `.runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`
- Modify: `.runtime/vm_debug_ci/compose.yaml`

**Interfaces:**

- Consumes: Task 3 HTTP API and Task 4 extension contract.
- Produces deterministic actions:
  - `mx.today`
  - `mx.pick`
  - `mx.page`
  - `mx.detail`
  - `mx.back`
  - `mx.select`
  - `mx.work`
  - `mx.filters`
  - `mx.region`
  - `mx.category`

- [ ] **Step 1: Write failing extension tests**

Use fake `channel`, `dispatcher`, card helpers, and API client. Assert:

- Exact trimmed text `开发客户` returns `true`, calls `today()`, and sends up to five global-overseas candidates labelled `A` through `E` without asking for region/city/category.
- A plain `A`, `B`, `C`, `D`, or `E` reply inside the active session opens the matching candidate detail; the same letter outside an active session returns a short restart instruction.
- `高级筛选` is the only action that exposes region/country/category choices; Guangzhou and all other domestic-city choices are absent.
- Unrelated text returns `false` and reaches the general agent.
- Region/category callbacks preserve server-side session and version.
- Candidate card shows company, country, priority, category, reason, stage, and next action.
- Detail shows discovery channel, discovery URL, official URL, evidence links, confirmed formats/spec signals, and `待核实` labels.
- A stale callback results in an informational card and no selection write.
- Repeated select callback uses the same action-event idempotency key.
- No rendered card includes internal price/cost/formula fields.
- Compact card text remains below 1,500 Unicode code points and does not use Markdown tables, preserving mobile usability.

- [ ] **Step 2: Run extension test and verify RED**

Run: `node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`

Expected: FAIL because extension/client files do not exist.

- [ ] **Step 3: Implement a narrow HTTP client**

Export named methods only: `facets`, `createSession`, `listCandidates`, `candidateDetail`, `today`, `selectCandidate`, `workItems`. Each call:

- Uses the fixed `MATRIX_API_BASE_URL` origin.
- Adds `x-matrix-bridge-token` and the current operator `x-feishu-open-id`.
- Uses a 10-second `AbortSignal.timeout`.
- Accepts and returns JSON only.
- Rejects redirects, non-JSON responses, non-2xx status, and URLs outside the fixed origin.
- Never logs headers, tokens, contact values, or response bodies.

- [ ] **Step 4: Implement cards and callback authorization**

`register()` attaches all `mx.*` handlers to the provided dispatcher and returns `onMessage`. `onMessage` first matches exact `开发客户`, then active-session letter replies `A` through `E`; it does not ask a free-form geographic question. Every handler validates:

- `evt.operator.openId` exists.
- Card value contains an opaque session ID, expected version, and action event ID only.
- The server accepts the operator/session/version.
- Chat/thread in the returned session matches the callback context.

Candidate summaries must use buttons with values such as:

```js
button('查看详情', { a: 'mx.detail', s: session.id, v: session.version, c: candidate.id }, 'default')
button('选择', { a: 'mx.select', s: session.id, v: session.version, c: candidate.id, e: actionEventId }, 'primary')
```

The initial card renders candidates in stable order as:

```text
A｜Company｜Country｜P0
推荐理由：one evidence-backed sentence
品类：confirmed categories
下一步：current next action
```

Repeat for `B` through `E`, followed by `查看详情`, `选择`, `换一批`, `高级筛选`, and `查看进行中`. `换一批` advances the stable snapshot page; `高级筛选` opens explicit overseas regions/countries/categories and never generates city names.

Contact values appear only in detail cards returned to an authorized operator. Group detail cards prefer contact type plus a CRM detail link; raw addresses are omitted when the chat is not an approved restricted chat.

- [ ] **Step 5: Add the 09:00 reminder without a second Feishu consumer**

`matrix-watch.js` reuses the same bounded notification pattern as `stream-watch.js`; it does not open another WebSocket event connection. It retrieves the configured Feishu application secret with `feishu-codex-bridge secrets get`, exchanges it for a tenant token at the official Feishu token endpoint, and sends one interactive card to the fixed `STREAM_CHAT_ID`. It never prints the secret or token. At `09:00 Asia/Shanghai`, once per date:

1. Call `today()` for the configured owner binding.
2. If zero rows, send `今日没有达到证据标准的候选`.
3. Otherwise send one compact card with at most five summaries.
4. Persist only the last successful date and message ID in `/workspace/store/matrix-watch-state.json`.

Set `MATRIX_DELIVERY_ENABLED=0`; the extension must throw during registration if it is anything other than the string `0` in this slice.

- [ ] **Step 6: Mount read-only data and configure the extension**

Add to Compose:

```yaml
environment:
  STREAM_CARD_EXTENSION: /workspace/extensions/stream-card.cjs
  MATRIX_API_BASE_URL: http://host.docker.internal:3333/api/matrix
  MATRIX_BRIDGE_TOKEN: ${MATRIX_BRIDGE_TOKEN:?MATRIX_BRIDGE_TOKEN must be set}
  MATRIX_DELIVERY_ENABLED: "0"
  MATRIX_RECOMMEND_HOUR: "9"
  MATRIX_RECOMMEND_MINUTE: "0"
extra_hosts:
  - "host.docker.internal:host-gateway"
volumes:
  - /home/admin/work/packaging-system/data/matrix-stream.db:/refs/matrix-stream.db:ro
```

Pass `MATRIX_BRIDGE_TOKEN` from the deployment environment; Compose must fail interpolation when it is absent. Do not place its value in the Compose file, repository, logs, cards, or command output. Do not add SMTP/IMAP credentials to this container.

- [ ] **Step 7: Run extension tests and runtime configuration checks**

Run:

```bash
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
docker compose -f .runtime/vm_debug_ci/compose.yaml config
if rg -n "SMTP_|IMAP_|WHATSAPP" .runtime/vm_debug_ci/workspace/extensions .runtime/vm_debug_ci/workspace/scripts/matrix-*.js; then exit 1; fi
```

Expected: extension tests pass; Compose config exits zero; `rg` returns no matches.

- [ ] **Step 8: Commit Task 5**

```bash
git add .runtime/vm_debug_ci/workspace/scripts/matrix-client.js \
  .runtime/vm_debug_ci/workspace/extensions/stream-card.cjs \
  .runtime/vm_debug_ci/workspace/scripts/matrix-watch.js \
  .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js \
  .runtime/vm_debug_ci/compose.yaml
git commit -m "feat: add matrix selection cards"
```

---

### Task 6: Integrated Verification and Deployment Gate

**Files:**

- Create: `scripts/verify-matrix-readonly-selection.js`
- Modify: `.env.example`
- Modify: `docs/matrix-stream-catalog-2026-07-16.md`
- Modify: `package.json`

**Interfaces:**

- Consumes all previous tasks.
- Produces `npm run verify:matrix-readonly-selection` and a deployment checklist with delivery disabled.

- [ ] **Step 1: Write the failing integrated verifier**

The verifier must fail unless all conditions hold:

```js
assert.strictEqual(candidateIntegrity, 'ok');
assert.strictEqual(candidateMode, '600');
assert.strictEqual(duplicateDomains, 0);
assert.strictEqual(excludedCountries, 0);
assert.strictEqual(missingEvidence, 0);
assert.strictEqual(missingDiscovery, 0);
assert.ok(recommendations.length <= 5);
assert.strictEqual(process.env.MATRIX_DELIVERY_ENABLED || '0', '0');
assert.strictEqual(outboundAdapterFiles.length, 0);
assert.strictEqual(await duplicateSelectionCount(), 1);
```

It runs the adapter, packet-gate, API, bridge-patch, and extension tests as child commands and exits nonzero on any failure.

- [ ] **Step 2: Run verifier and verify RED**

Run: `node scripts/verify-matrix-readonly-selection.js`

Expected: FAIL because the package script/docs/env contract are not complete.

- [ ] **Step 3: Add configuration contract and package script**

Add only names and safe defaults to `.env.example`:

```dotenv
MATRIX_STREAM_DB_PATH=./data/matrix-stream.db
MATRIX_BRIDGE_TOKEN=
MATRIX_DELIVERY_ENABLED=0
MATRIX_RECOMMEND_HOUR=9
MATRIX_RECOMMEND_MINUTE=0
```

Add:

```json
"verify:matrix-readonly-selection": "node scripts/verify-matrix-readonly-selection.js"
```

Document the new read-only API, binding CLI, Feishu trigger, mobile card constraints, source separation, and explicit statement that no delivery adapter exists in this slice.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm run verify:matrix-readonly-selection
npm run lint
npm run build
git diff --check
```

Expected: all commands exit zero; verifier reports candidate count, evidence/discovery coverage, five-or-fewer recommendations, one idempotent selection event, and `delivery_enabled=false`.

- [ ] **Step 5: Build and restart only after explicit deployment authorization**

When authorized:

```bash
docker compose -f .runtime/vm_debug_ci/compose.yaml build vm_debug_ci
docker compose -f .runtime/vm_debug_ci/compose.yaml up -d vm_debug_ci
docker compose -f .runtime/vm_debug_ci/compose.yaml ps
```

Expected: container is `Up`; logs show one bridge connection and extension registration; no delivery adapter registration.

- [ ] **Step 6: Perform real Feishu desktop/mobile acceptance**

Using an authorized bound account:

1. `@智能桓 开发客户` immediately returns at most five global-overseas recommendations labelled `A`–`E`, with no geographic question.
2. Reply `A`; the detail for candidate A opens. Repeat with a card button and confirm the same record opens.
3. Confirm every recommendation includes an evidence-backed reason, confirmed categories, priority, stage, and next action.
4. Open `高级筛选`; only overseas region/country/category filters appear, with no Guangzhou or other domestic-city option.
5. Open a detail; discovery and evidence URLs are distinct and clickable.
6. Select one candidate twice; only one work item/event exists.
7. Open `查看进行中`; stage and next action match the application DB.
8. Repeat on Feishu mobile; compact cards require no horizontal scrolling and expose the same A–E choices and actions.
9. Confirm no email, WhatsApp, or website request was generated.

- [ ] **Step 7: Commit Task 6**

```bash
git add scripts/verify-matrix-readonly-selection.js .env.example package.json \
  docs/matrix-stream-catalog-2026-07-16.md
git commit -m "test: verify matrix read-only selection"
```

## Deferred Plans

This plan intentionally stops before any outbound delivery. Write and approve separate implementation plans for:

1. Daily discovery of 100 and deep review of 20.
2. Immutable bilingual draft versions.
3. Sender authentication, jurisdiction policy, and single-use delivery capped at 5/day.
4. IMAP reply matching, translation, Feishu notification, and suggested-reply approval.

Each deferred plan must preserve the same evidence, identity, idempotency, and delivery-disabled-by-default constraints.

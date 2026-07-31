### Task 1: Persisted State and Explicit Permission

**Files:**
- Modify: `src/db.js`
- Modify: `shared/permissions-model.json`
- Modify: `src/lib/permissions.js`
- Modify: `frontend-next/src/components/Admin.tsx`
- Create: `scripts/test-matrix-stream-review.js`
- Modify: `scripts/test-admin-access-regression.js`

**Interfaces:**
- Produces tables `matrix_stream_versions`, `matrix_stream_jobs`, `matrix_stream_events`, and columns `matrix_work_items.stream_state`, `matrix_work_items.current_stream_version_id`, `crm_reply_drafts.matrix_work_item_id`.
- Produces normalized permission `capabilities.matrixSend: boolean`.

- [ ] **Step 1: Write the failing schema test**

Add to `scripts/test-matrix-stream-review.js`:

```js
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-stream-review-'));
process.env.DB_PATH = path.join(root, 'app.db');
const { db, initDb } = require('../src/db');
initDb();

for (const table of ['matrix_stream_versions', 'matrix_stream_jobs', 'matrix_stream_events']) {
  assert(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} missing`);
}
const workColumns = db.prepare('PRAGMA table_info(matrix_work_items)').all().map(row => row.name);
assert(workColumns.includes('stream_state'));
assert(workColumns.includes('current_stream_version_id'));
const draftColumns = db.prepare('PRAGMA table_info(crm_reply_drafts)').all().map(row => row.name);
assert(draftColumns.includes('matrix_work_item_id'));
db.close();
fs.rmSync(root, { recursive: true, force: true });
```

- [ ] **Step 2: Run the schema test and verify RED**

Run: `node scripts/test-matrix-stream-review.js`  
Expected: FAIL with `matrix_stream_versions missing`.

- [ ] **Step 3: Add the minimal migration**

In `src/db.js`, add the three tables with these stable constraints:

```sql
CREATE TABLE IF NOT EXISTS matrix_stream_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_item_id INTEGER NOT NULL,
  crm_draft_id INTEGER,
  revision INTEGER NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_source_url TEXT NOT NULL,
  recipient_verified_at TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_en TEXT NOT NULL,
  body_cn TEXT NOT NULL,
  strategy_summary TEXT NOT NULL DEFAULT '',
  source_snapshot_json TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL,
  quality_score INTEGER NOT NULL DEFAULT 0,
  quality_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK(status IN ('draft','approved','superseded')),
  created_by INTEGER NOT NULL,
  approved_by INTEGER,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(work_item_id, revision),
  FOREIGN KEY(work_item_id) REFERENCES matrix_work_items(id),
  FOREIGN KEY(crm_draft_id) REFERENCES crm_reply_drafts(id)
);
CREATE TABLE IF NOT EXISTS matrix_stream_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_item_id INTEGER NOT NULL,
  version_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('pending','sending','accepted','failed','ambiguous')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_class TEXT NOT NULL DEFAULT '',
  redacted_diagnostic TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(work_item_id) REFERENCES matrix_work_items(id),
  FOREIGN KEY(version_id) REFERENCES matrix_stream_versions(id)
);
CREATE TABLE IF NOT EXISTS matrix_stream_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_item_id INTEGER NOT NULL,
  version_id INTEGER,
  job_id INTEGER,
  actor_user_id INTEGER,
  matrix_binding_id INTEGER,
  chat_id TEXT NOT NULL DEFAULT '',
  card_event_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL DEFAULT '',
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  diagnostic TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS matrix_stream_sender_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_domain TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  spf_ok INTEGER NOT NULL,
  dkim_ok INTEGER NOT NULL,
  dmarc_ok INTEGER NOT NULL,
  tls_ok INTEGER NOT NULL,
  smtp_ok INTEGER NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(sender_domain, checked_at)
);
CREATE TABLE IF NOT EXISTS matrix_stream_country_policies (
  country_code TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('approved','paused','blocked')),
  sender_identity_required INTEGER NOT NULL DEFAULT 1,
  opt_out_required INTEGER NOT NULL DEFAULT 1,
  reviewed_by INTEGER NOT NULL,
  reviewed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  source_urls_json TEXT NOT NULL,
  PRIMARY KEY(country_code, channel)
);
```

Add append-only update/delete triggers for `matrix_stream_events`, content-column immutability triggers for approved versions, and indexes on `(work_item_id, revision)`, `(state, updated_at)`, and `message_id`. Add missing columns with guarded `ALTER TABLE` calls and default `stream_state='selected'`.

- [ ] **Step 4: Write and run the failing permission test**

In `scripts/test-admin-access-regression.js`, assert:

```js
const { normalizePermissions } = require('../src/lib/permissions');
assert.strictEqual(normalizePermissions('foreign_trade_crm_admin', {}).capabilities.matrixSend, false);
assert.strictEqual(normalizePermissions('foreign_trade_crm_admin', { capabilities: { matrixSend: true } }).capabilities.matrixSend, true);
assert.strictEqual(normalizePermissions('worker', { capabilities: { matrixSend: true } }).capabilities.matrixSend, false);
```

Run: `node scripts/test-admin-access-regression.js`  
Expected: FAIL because `capabilities` is missing.

- [ ] **Step 5: Implement permission normalization and admin control**

Add `capabilityKeys: ["matrixSend"]` to `shared/permissions-model.json`. Default it to `false` for every role; `all: true` remains authorized. In `src/lib/permissions.js`, return:

```js
const allowedForRole = role === 'super_admin' || role === 'foreign_trade_crm_admin';
const requested = !!permissions?.capabilities?.matrixSend;
capabilities: { matrixSend: allowedForRole && requested }
```

Add an Admin permission checkbox labeled `Matrix Stream 发送确认` that writes `capabilities.matrixSend`; preserve it when other permissions are edited.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
node scripts/test-matrix-stream-review.js
node scripts/test-admin-access-regression.js
npm run build
```

Expected: all PASS.  
Commit: `feat: add matrix stream review state`

---


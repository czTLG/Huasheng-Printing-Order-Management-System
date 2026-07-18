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

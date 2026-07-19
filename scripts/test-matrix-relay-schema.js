'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-relay-schema-'));
process.env.DB_PATH = path.join(root, 'app.db');
const { db, initDb } = require('../src/db');

try {
  initDb();
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  for (const table of [
    'matrix_stream_versions', 'matrix_stream_recipient_evidence', 'matrix_stream_events',
    'matrix_stream_jobs', 'matrix_stream_sender_checks', 'matrix_stream_country_policies',
    'matrix_stream_reply_checks'
  ]) assert.ok(tables.has(table), `missing relay table ${table}`);

  const workColumns = new Set(db.prepare('PRAGMA table_info(matrix_work_items)').all().map(row => row.name));
  assert.ok(workColumns.has('stream_state'));
  assert.ok(workColumns.has('current_stream_version_id'));

  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_matrix_stream_%'").all().map(row => row.name);
  assert.ok(indexes.some(name => name.includes('versions_work_revision')));
  assert.ok(indexes.some(name => name.includes('jobs_state_updated')));
  console.log('matrix relay schema tests passed');
} finally {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

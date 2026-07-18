const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-stream-review-'));
process.env.DB_PATH = path.join(root, 'app.db');

let db;

try {
  const LegacyDatabase = require('better-sqlite3');
  const legacyDb = new LegacyDatabase(process.env.DB_PATH);
  legacyDb.exec(`
    CREATE TABLE matrix_stream_versions (
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
      UNIQUE(work_item_id, revision)
    );
    CREATE TRIGGER trg_matrix_stream_versions_approved_content_immutable
    BEFORE UPDATE ON matrix_stream_versions
    WHEN OLD.status = 'approved' AND NEW.subject IS NOT OLD.subject
    BEGIN
      SELECT RAISE(ABORT, 'approved matrix_stream_versions content is immutable');
    END;
  `);
  legacyDb.close();

  const database = require('../src/db');
  db = database.db;
  database.initDb();

  for (const table of ['matrix_stream_versions', 'matrix_stream_jobs', 'matrix_stream_events']) {
    assert(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} missing`);
  }

  const workColumns = db.prepare('PRAGMA table_info(matrix_work_items)').all().map(row => row.name);
  assert(workColumns.includes('stream_state'));
  assert(workColumns.includes('current_stream_version_id'));

  const draftColumns = db.prepare('PRAGMA table_info(crm_reply_drafts)').all().map(row => row.name);
  assert(draftColumns.includes('matrix_work_item_id'));

  const indexColumns = indexName => db.prepare(`PRAGMA index_info(${indexName})`).all().map(row => row.name);
  assert.deepStrictEqual(indexColumns('idx_matrix_stream_versions_work_revision'), ['work_item_id', 'revision']);
  assert.deepStrictEqual(indexColumns('idx_matrix_stream_jobs_state_updated'), ['state', 'updated_at']);
  assert.deepStrictEqual(indexColumns('idx_matrix_stream_jobs_message_id'), ['message_id']);

  const now = '2026-07-18T00:00:00.000Z';
  const userId = Number(db.prepare(`
    INSERT INTO users (username, password, role, status, created_at)
    VALUES ('matrix_stream_review_guard', 'unused', 'super_admin', 'active', ?)
  `).run(now).lastInsertRowid);
  const workItemId = Number(db.prepare(`
    INSERT INTO matrix_work_items (candidate_id, owner_user_id, created_at, updated_at)
    VALUES (900001, ?, ?, ?)
  `).run(userId, now, now).lastInsertRowid);

  const insertVersion = db.prepare(`
    INSERT INTO matrix_stream_versions (
      work_item_id, revision, recipient_email, recipient_source_url,
      recipient_verified_at, subject, body_en, body_cn, content_hash,
      status, created_by, approved_by, approved_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'https://example.test/source', ?, ?, 'Body EN', '正文', ?, ?, ?, ?, ?, ?, ?)
  `);
  const approvedVersionId = Number(insertVersion.run(
    workItemId, 1, 'recipient@example.test', now, 'Approved subject',
    'approved-hash', 'approved', userId, userId, now, now, now
  ).lastInsertRowid);
  const supersededVersionId = Number(insertVersion.run(
    workItemId, 2, 'recipient@example.test', now, 'Superseded subject',
    'superseded-hash', 'approved', userId, userId, now, now, now
  ).lastInsertRowid);

  assert.throws(
    () => db.prepare('UPDATE matrix_stream_versions SET subject=? WHERE id=?').run('Changed', approvedVersionId),
    /immutable/
  );
  assert.throws(
    () => db.prepare("UPDATE matrix_stream_versions SET status='draft' WHERE id=?").run(approvedVersionId),
    /lifecycle/
  );
  db.prepare("UPDATE matrix_stream_versions SET status='superseded', updated_at=? WHERE id=?").run(now, supersededVersionId);
  assert.throws(
    () => db.prepare('UPDATE matrix_stream_versions SET body_en=? WHERE id=?').run('Changed after supersession', supersededVersionId),
    /immutable/
  );
  assert.throws(
    () => db.prepare('DELETE FROM matrix_stream_versions WHERE id=?').run(supersededVersionId),
    /immutable/
  );
  assert.throws(
    () => db.prepare("UPDATE matrix_stream_versions SET status='draft' WHERE id=?").run(supersededVersionId),
    /lifecycle/
  );
  assert.throws(
    () => db.prepare('DELETE FROM matrix_stream_versions WHERE id=?').run(approvedVersionId),
    /immutable/
  );

  assert.throws(
    () => insertVersion.run(
      workItemId, 1, 'duplicate@example.test', now, 'Duplicate revision',
      'duplicate-hash', 'draft', userId, null, null, now, now
    ),
    /UNIQUE constraint failed: matrix_stream_versions.work_item_id, matrix_stream_versions.revision/
  );

  const eventId = Number(db.prepare(`
    INSERT INTO matrix_stream_events (work_item_id, version_id, action, idempotency_key, created_at)
    VALUES (?, ?, 'approved', 'event-key-1', ?)
  `).run(workItemId, approvedVersionId, now).lastInsertRowid);
  assert.throws(
    () => db.prepare(`
      INSERT INTO matrix_stream_events (work_item_id, version_id, action, idempotency_key, created_at)
      VALUES (?, ?, 'duplicate', 'event-key-1', ?)
    `).run(workItemId, approvedVersionId, now),
    /UNIQUE constraint failed: matrix_stream_events.idempotency_key/
  );
  assert.throws(
    () => db.prepare('UPDATE matrix_stream_events SET action=? WHERE id=?').run('changed', eventId),
    /append-only/
  );
  assert.throws(
    () => db.prepare('DELETE FROM matrix_stream_events WHERE id=?').run(eventId),
    /append-only/
  );

  const insertJob = db.prepare(`
    INSERT INTO matrix_stream_jobs (
      work_item_id, version_id, idempotency_key, content_hash, message_id,
      state, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `);
  insertJob.run(workItemId, approvedVersionId, 'job-key-1', 'approved-hash', 'message-1', userId, now, now);
  assert.throws(
    () => insertJob.run(workItemId, approvedVersionId, 'job-key-1', 'approved-hash', 'message-2', userId, now, now),
    /UNIQUE constraint failed: matrix_stream_jobs.idempotency_key/
  );
  assert.throws(
    () => insertJob.run(workItemId, approvedVersionId, 'job-key-2', 'approved-hash', 'message-1', userId, now, now),
    /UNIQUE constraint failed: matrix_stream_jobs.message_id/
  );
} finally {
  if (db?.open) db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

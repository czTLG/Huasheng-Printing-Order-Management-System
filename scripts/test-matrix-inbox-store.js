'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-inbox-store-'));
process.env.DB_PATH = path.join(root, 'app.db');

const { db, initDb, now } = require('../src/db');
const { createAttachmentStore, enqueueInboxJob } = require('../src/lib/matrixInboxStore');

try {
  const originalLog = console.log;
  console.log = () => {};
  try { initDb(); } finally { console.log = originalLog; }
  const ts = now();
  const emailMessageId = Number(db.prepare(`
    INSERT INTO email_messages (
      mailbox, folder, message_uid, message_id, direction, processing_status,
      attachments_json, created_at, updated_at
    ) VALUES ('sales@example.test', 'INBOX', '1', '<fixture-1@example.test>', 'inbound', 'new', '[]', ?, ?)
  `).run(ts, ts).lastInsertRowid);

  const attachmentRoot = path.join(root, 'attachments');
  const store = createAttachmentStore({ root: attachmentRoot, dbHandle: db });
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('safe-fixture')
  ]);
  const saved = store.save({
    emailMessageId,
    index: 0,
    filename: '../产品图.png',
    contentType: 'image/png',
    content: png
  });

  assert.strictEqual(saved.original_file_name, '产品图.png');
  assert.match(saved.sha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(saved.availability_state, 'available');
  assert.strictEqual(fs.statSync(attachmentRoot).mode & 0o777, 0o700);
  assert.strictEqual(fs.statSync(saved.absolute_path).mode & 0o777, 0o600);
  assert.ok(saved.absolute_path.startsWith(fs.realpathSync(attachmentRoot) + path.sep));
  assert.strictEqual(fs.readFileSync(saved.absolute_path).equals(png), true);

  const repeated = store.save({
    emailMessageId,
    index: 0,
    filename: '../产品图.png',
    contentType: 'image/png',
    content: png
  });
  assert.strictEqual(repeated.id, saved.id);
  assert.strictEqual(db.prepare('SELECT COUNT(*) total FROM matrix_inbox_attachments').get().total, 1);

  assert.throws(() => store.save({
    emailMessageId,
    index: 1,
    filename: 'large.bin',
    contentType: 'application/octet-stream',
    content: Buffer.alloc(20 * 1024 * 1024 + 1)
  }), /attachment exceeds 20 MiB/);

  const firstJob = enqueueInboxJob(db, emailMessageId);
  const secondJob = enqueueInboxJob(db, emailMessageId);
  assert.strictEqual(firstJob.inserted, true);
  assert.strictEqual(secondJob.inserted, false);
  assert.strictEqual(secondJob.id, firstJob.id);
  assert.match(firstJob.notification_uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.strictEqual(db.prepare('SELECT COUNT(*) total FROM matrix_inbox_jobs').get().total, 1);

  console.log('PASS matrix inbox store');
} finally {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

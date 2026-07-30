'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-manual-outbound-'));
const dbPath = path.join(root, 'app.db');
process.env.DB_PATH = dbPath;
const { db, initDb } = require('../src/db');
const { createMatrixManualOutbound } = require('../src/services/matrixManualOutbound');

try {
  initDb();
  const actorUserId = db.prepare("SELECT id FROM users WHERE role = 'super_admin' ORDER BY id LIMIT 1").get().id;
  db.prepare(`
    INSERT INTO customers (id, name, company_name, active, created_at, updated_at)
    VALUES (10, 'Mit Mongkol Industry Co., Ltd.', 'Mit Mongkol Industry Co., Ltd.', 1, ?, ?)
  `).run('2026-07-30T00:00:00.000Z', '2026-07-30T00:00:00.000Z');

  const service = createMatrixManualOutbound({
    db,
    clock: () => new Date('2026-07-30T07:00:00.000Z')
  });
  db.prepare(`
    INSERT INTO matrix_tasks (
      canonical_customer_id, source_kind, source_id, task_type, due_at, state,
      priority, next_action, cancellation_reason, created_at, updated_at
    ) VALUES (
      10, 'matrix_stream_job', '99', 'replace_contact', '2026-07-29T00:00:00.000Z',
      'pending', 'high', '更换有效联系人', '', '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z'
    )
  `).run();
  const input = {
    actorUserId,
    customerId: 10,
    channel: 'whatsapp',
    recipient: '+66 86-324-1394',
    sourceUrl: 'https://www.mitmongkol.com/about-us/contact-us.html',
    sentAt: '2026-07-30T06:45:00.000Z',
    messageText: 'Hello, this is Gavin. Please share one current pouch requirement.',
    idempotencyKey: 'manual-mit-20260730'
  };

  const first = service.record(input);
  assert.strictEqual(first.recorded, true);
  assert.strictEqual(first.state, 'waiting_customer');
  assert.strictEqual(first.followup_due_at, '2026-08-02T06:45:00.000Z');
  const second = service.record(input);
  assert.strictEqual(second.recorded, false);
  assert.strictEqual(db.prepare('SELECT COUNT(*) total FROM crm_messages').get().total, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) total FROM matrix_thread_messages').get().total, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) total FROM matrix_tasks').get().total, 2);
  assert.strictEqual(
    db.prepare("SELECT state FROM matrix_tasks WHERE task_type = 'replace_contact'").get().state,
    'cancelled'
  );
  assert.strictEqual(
    db.prepare("SELECT COUNT(*) total FROM matrix_tasks WHERE task_type = 'check_reply'").get().total,
    1
  );
  const customer = db.prepare(`
    SELECT whatsapp, stage, is_waiting_reply, next_followup_channel, next_followup_at
    FROM customers WHERE id = 10
  `).get();
  assert.deepStrictEqual(customer, {
    whatsapp: '66863241394',
    stage: 'contacted',
    is_waiting_reply: 1,
    next_followup_channel: 'whatsapp',
    next_followup_at: '2026-08-02T06:45:00.000Z'
  });
  assert.throws(() => service.record({ ...input, messageText: 'Changed text' }), /idempotency request conflict/);
  assert.throws(() => service.record({ ...input, idempotencyKey: 'bad-channel', channel: 'email' }), /valid manual outbound channel/);
  console.log('matrix manual outbound tests passed');
} finally {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

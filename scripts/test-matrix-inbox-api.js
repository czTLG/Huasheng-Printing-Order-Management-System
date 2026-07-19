'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-inbox-api-'));
process.env.DB_PATH = path.join(root, 'app.db');

const { db, initDb, now } = require('../src/db');
const { enqueueInboxJob } = require('../src/lib/matrixInboxStore');
const { claimInboxJob, ackInboxJob, failInboxJob, inboxWorkbench } = require('../src/routes/matrix');

function insertInbound(uid) {
  const ts = now();
  return Number(db.prepare(`
    INSERT INTO email_messages (
      mailbox, folder, message_uid, message_id, from_email, to_emails, subject,
      cleaned_text, attachments_json, received_at, direction, processing_status,
      normalized_subject, contact_email, created_at, updated_at
    ) VALUES (
      'sales@example.test', 'INBOX', ?, ?, 'buyer@example.test', 'sales@example.test',
      'Fixture reply', 'Fixture body', '[]', ?, 'inbound', 'new', 'fixture reply',
      'buyer@example.test', ?, ?
    )
  `).run(uid, `<${uid}@example.test>`, ts, ts, ts).lastInsertRowid);
}

try {
  const originalLog = console.log;
  console.log = () => {};
  try { initDb(); } finally { console.log = originalLog; }

  const firstMessage = insertInbound('in-1');
  const firstJob = enqueueInboxJob(db, firstMessage);
  db.prepare(`
    UPDATE matrix_inbox_jobs
    SET analysis_state = 'ready', analysis_json = '{"summary_cn":"测试摘要"}'
    WHERE id = ?
  `).run(firstJob.id);

  const clock = () => new Date('2026-07-19T03:00:00.000Z');
  const claim = claimInboxJob(db, { clock });
  assert.strictEqual(claim.id, firstJob.id);
  assert.match(claim.lease_token, /^[0-9a-f-]{36}$/);
  assert.strictEqual(claim.notification_uuid, firstJob.notification_uuid);
  assert.strictEqual(claimInboxJob(db, { clock }), null);
  assert.strictEqual('absolute_path' in claim, false);
  assert.strictEqual('mailbox' in claim, false);

  assert.throws(() => ackInboxJob(db, firstJob.id, {
    lease_token: 'wrong', notification_uuid: firstJob.notification_uuid, status: 'delivered'
  }), /lease/);
  const ack = ackInboxJob(db, firstJob.id, {
    lease_token: claim.lease_token,
    notification_uuid: firstJob.notification_uuid,
    status: 'delivered'
  }, { clock });
  assert.strictEqual(ack.delivery_state, 'delivered');
  assert.strictEqual(ackInboxJob(db, firstJob.id, {
    lease_token: claim.lease_token,
    notification_uuid: firstJob.notification_uuid,
    status: 'delivered'
  }, { clock }).delivery_state, 'delivered');
  const receipt = JSON.parse(db.prepare('SELECT receipt_json FROM matrix_inbox_jobs WHERE id = ?').get(firstJob.id).receipt_json);
  assert.deepStrictEqual(Object.keys(receipt).sort(), ['delivered_at', 'status']);

  const secondMessage = insertInbound('in-2');
  const secondJob = enqueueInboxJob(db, secondMessage);
  const secondClaim = claimInboxJob(db, { clock });
  const failed = failInboxJob(db, secondJob.id, {
    lease_token: secondClaim.lease_token,
    error_code: 'feishu_rate_limited'
  }, { clock });
  assert.strictEqual(failed.delivery_state, 'retry');
  assert.strictEqual(failed.delivery_attempts, 1);

  db.prepare(`
    INSERT INTO matrix_inbox_actions (job_id, action_type, state, payload_json, created_at, updated_at)
    VALUES (?, 'quote_review', 'pending', '{"summary_cn":"客户请求报价"}', ?, ?)
  `).run(secondJob.id, now(), now());
  db.prepare(`
    UPDATE matrix_inbox_jobs
    SET message_class = 'quote_request', workflow_state = 'quote_required',
        analysis_json = '{"summary_cn":"客户请求报价","full_translation_cn":"请报价。","translation_state":"complete"}'
    WHERE id = ?
  `).run(secondJob.id);
  const workbench = inboxWorkbench(db);
  assert.strictEqual(workbench.counts.quote_review, 1);
  assert.strictEqual(workbench.items[0].message_class, 'quote_request');
  assert.match(workbench.items[0].summary_cn, /报价/);
  assert.strictEqual('sender_email' in workbench.items[0], false);

  console.log('PASS matrix inbox API');
} finally {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

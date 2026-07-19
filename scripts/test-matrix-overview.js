'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-overview-'));
process.env.DB_PATH = path.join(root, 'app.db');
const { db, initDb, now } = require('../src/db');
const { buildMatrixOverview } = require('../src/services/matrixOverview');

function email({ uid, contact, subject, direction, received, body = '', inReplyTo = '', customerId = null, inquiryId = null, analysis = null }) {
  const emailId = Number(db.prepare(`
    INSERT INTO email_messages (
      mailbox, folder, message_uid, message_id, in_reply_to, from_email, to_emails,
      subject, cleaned_text, received_at, direction, processing_status, normalized_subject,
      contact_email, email_domain, matched_customer_id, matched_inquiry_id, created_at, updated_at
    ) VALUES ('sales@example.test', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    direction === 'outbound' ? 'Sent' : 'INBOX', uid, `<${uid}@example.test>`, inReplyTo,
    direction === 'outbound' ? 'sales@example.test' : contact,
    direction === 'outbound' ? contact : 'sales@example.test', subject, body, received, direction,
    subject.replace(/^re:\s*/i, '').toLowerCase(), contact, contact.split('@')[1], customerId, inquiryId, now(), now()
  ).lastInsertRowid);
  if (analysis) {
    db.prepare(`INSERT INTO matrix_inbox_jobs (email_message_id, correlation_state, matched_customer_id, matched_inquiry_id, analysis_json, analysis_state, delivery_state, notification_uuid, message_class, workflow_state, created_at, updated_at) VALUES (?, 'matched', ?, ?, ?, 'ready', 'triage_hold', ?, ?, ?, ?, ?)`)
      .run(emailId, customerId, inquiryId, JSON.stringify(analysis), `notification-${uid}`, analysis.message_class || 'customer_reply', analysis.workflow_state || 'reply_review', now(), now());
  }
  return emailId;
}

try {
  const originalLog = console.log;
  console.log = () => {};
  try { initDb(); } finally { console.log = originalLog; }

  email({ uid: 'first', contact: 'new@buyer.sg', subject: 'New RFQ', direction: 'inbound', received: '2026-07-10T01:00:00.000Z', body: 'Please quote pouches FOB.' });
  email({ uid: 'b-in', contact: 'wait@buyer.ae', subject: 'Pouch', direction: 'inbound', received: '2026-07-10T02:00:00.000Z', body: 'Need pouches.' });
  email({ uid: 'b-out', contact: 'wait@buyer.ae', subject: 'Re: Pouch', direction: 'outbound', received: '2026-07-10T03:00:00.000Z', body: 'We need the size.' });
  email({ uid: 'c-in1', contact: 'reply@buyer.tn', subject: 'Bag', direction: 'inbound', received: '2026-07-10T04:00:00.000Z', body: 'Need bags.' });
  email({ uid: 'c-out', contact: 'reply@buyer.tn', subject: 'Re: Bag', direction: 'outbound', received: '2026-07-10T05:00:00.000Z', body: 'Please confirm quantity.' });
  email({ uid: 'c-in2', contact: 'reply@buyer.tn', subject: 'Re: Bag', direction: 'inbound', received: '2026-07-10T06:00:00.000Z', body: 'Quantity is 20000 pcs.', inReplyTo: '<c-out@example.test>' });
  const customerId = Number(db.prepare(`INSERT INTO customers (name, company_name, email, country, active, created_at, updated_at) VALUES ('Quote Buyer', 'Quote Buyer', 'quote@buyer.sg', 'Singapore', 1, ?, ?)`).run(now(), now()).lastInsertRowid);
  const inquiryId = Number(db.prepare(`INSERT INTO inquiries (inquiry_code, customer_id, inquiry_title, status, costing_required, created_at, updated_at) VALUES ('RFQ-QUOTE', ?, 'RFQ quote', 'quote_pending', 1, ?, ?)`).run(customerId, now(), now()).lastInsertRowid);
  email({ uid: 'q-in1', contact: 'quote@buyer.sg', subject: 'RFQ quote', direction: 'inbound', received: '2026-07-12T01:00:00.000Z', body: 'Please quote.', customerId, inquiryId, analysis: { message_class: 'quote_request', translation_state: 'complete', summary_cn: '客户首次询价。', quote_required: true } });
  email({ uid: 'q-out', contact: 'quote@buyer.sg', subject: 'Re: RFQ quote', direction: 'outbound', received: '2026-07-12T02:00:00.000Z', body: 'Please send photos.', customerId, inquiryId });
  email({ uid: 'q-in2', contact: 'quote@buyer.sg', subject: 'Re: RFQ quote', direction: 'inbound', received: '2026-07-12T03:00:00.000Z', body: 'Photos attached; please provide official quotation.', customerId, inquiryId, analysis: { message_class: 'technical_question', translation_state: 'pending_ai', summary_cn: '客户补充图片并要求正式报价。' } });

  const overview = buildMatrixOverview(db, {
    backlogItems: [{ priority: 'P0', company: 'Amid David 2006 Ltd.', state: 'pending_forwarder_review', summary: 'Six-item FOB', next_actions: ['货代复核'] }]
  });
  assert.strictEqual(overview.items[0].source, 'supervisor_backlog');
  const byContact = Object.fromEntries(overview.threads.map(item => [item.contact_email, item]));
  assert.strictEqual(byContact['new@buyer.sg'].state, 'first_contact_unanswered');
  assert.strictEqual(byContact['new@buyer.sg'].country, 'Singapore');
  assert.strictEqual(byContact['wait@buyer.ae'].state, 'waiting_customer');
  assert.strictEqual(byContact['reply@buyer.tn'].state, 'awaiting_our_reply');
  assert.strictEqual(byContact['reply@buyer.tn'].message_count, 3);
  assert.strictEqual(byContact['reply@buyer.tn'].last_outbound_at, '2026-07-10T05:00:00.000Z');
  assert.strictEqual(byContact['reply@buyer.tn'].last_inbound_at, '2026-07-10T06:00:00.000Z');
  assert.strictEqual(byContact['quote@buyer.sg'].state, 'quote_required');
  assert.strictEqual(byContact['quote@buyer.sg'].message_count, 3);
  assert.strictEqual(byContact['quote@buyer.sg'].inbound_count, 2);
  assert.strictEqual(byContact['quote@buyer.sg'].outbound_count, 1);
  assert.strictEqual(byContact['quote@buyer.sg'].translation_state, 'pending_ai');
  assert.ok(overview.counts.awaiting_our_reply >= 1);
  console.log('PASS matrix overview');
} finally {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-context-search-'));
process.env.DB_PATH = path.join(root, 'app.db');

const { db, initDb, now } = require('../src/db');
const { searchMatrixContext, resolveMatrixContext, contextByRecordId } = require('../src/services/matrixContextSearch');

try {
  const originalLog = console.log;
  console.log = () => {};
  try { initDb(); } finally { console.log = originalLog; }
  const ts = now();
  const customerId = Number(db.prepare(`
    INSERT INTO customers (
      name, company_name, contact_person, email, country, website, active, created_at, updated_at
    ) VALUES ('Acepac Singapore', 'Acepac International (S) Pte Ltd', 'Tio Jia Ling',
      'jia.ling@acepac.example', 'Singapore', 'https://acepac.example', 1, ?, ?)
  `).run(ts, ts).lastInsertRowid);
  const inquiryId = Number(db.prepare(`
    INSERT INTO inquiries (
      inquiry_code, customer_id, inquiry_title, status, costing_required,
      destination_country, trade_term_requested, created_at, updated_at
    ) VALUES ('MX-ACEPAC', ?, 'Acepac printed pouch request', 'quote_pending', 1,
      'Singapore', 'FOB', ?, ?)
  `).run(customerId, ts, ts).lastInsertRowid);
  db.prepare(`
    INSERT INTO costing_requests (
      costing_request_code, customer_id, inquiry_id, status, request_note, created_at, updated_at
    ) VALUES ('MX-ACEPAC-COST', ?, ?, 'pending', 'Prepare item-by-item review', ?, ?)
  `).run(customerId, inquiryId, ts, ts);
  const insertMessage = db.prepare(`
    INSERT INTO email_messages (
      mailbox, folder, message_uid, message_id, from_email, from_name, to_emails,
      subject, cleaned_text, received_at, direction, processing_status,
      normalized_subject, contact_email, email_domain, matched_customer_id,
      matched_inquiry_id, created_at, updated_at
    ) VALUES ('sales@example.test', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new',
      'printed pouch request', 'jia.ling@acepac.example', 'acepac.example', ?, ?, ?, ?)
  `);
  insertMessage.run('INBOX', '1', '<acepac-1@example.test>', 'jia.ling@acepac.example',
    'Tio Jia Ling', 'sales@example.test', 'Printed pouch request',
    'Please quote the attached printed pouch.', '2026-07-18T01:00:00.000Z',
    'inbound', customerId, inquiryId, ts, ts);
  const latestId = Number(insertMessage.run('INBOX', '2', '<acepac-2@example.test>',
    'jia.ling@acepac.example', 'Tio Jia Ling', 'sales@example.test',
    'Re: Printed pouch request', 'The artwork and specifications are attached.',
    '2026-07-18T02:00:00.000Z', 'inbound', customerId, inquiryId, ts, ts).lastInsertRowid);
  db.prepare(`
    INSERT INTO matrix_inbox_attachments (
      email_message_id, media_order, original_file_name, detected_mime_type,
      file_size, availability_state, created_at, updated_at
    ) VALUES (?, 0, 'acepac-spec.png', 'image/png', 321, 'available', ?, ?)
  `).run(latestId, ts, ts);
  db.prepare(`
    INSERT INTO email_messages (
      mailbox, folder, message_uid, message_id, from_email, from_name, to_emails,
      subject, cleaned_text, received_at, direction, processing_status,
      normalized_subject, contact_email, email_domain, created_at, updated_at
    ) VALUES ('sales@example.test', 'INBOX', '3', '<security@example.test>',
      'security@example.test', 'Security', 'sales@example.test',
      'New login near Singapore', 'A new device signed in near Singapore.',
      '2026-07-18T03:00:00.000Z', 'inbound', 'new', 'new login near singapore',
      'security@example.test', 'example.test', ?, ?)
  `).run(ts, ts);

  const byCompany = searchMatrixContext(db, 'Acepac Singapore');
  assert.strictEqual(byCompany.matches.length, 1);
  assert.strictEqual(byCompany.matches[0].customer.contact_person, 'Tio Jia Ling');
  assert.strictEqual(byCompany.matches[0].messages.length, 2);
  assert.strictEqual(byCompany.matches[0].attachments[0].filename, 'acepac-spec.png');
  assert.strictEqual(byCompany.matches[0].existing_tasks.length, 1);
  assert.strictEqual(byCompany.matches[0].inquiry.inquiry_code, 'MX-ACEPAC');

  const byContact = searchMatrixContext(db, 'Tio Jia Ling');
  assert.strictEqual(byContact.matches[0].customer.id, customerId);

  const fromConversation = resolveMatrixContext(db, '新加坡的客户你能看到了吗？');
  assert.strictEqual(fromConversation.matches.length, 1);
  assert.strictEqual(fromConversation.matches[0].customer.id, customerId);

  const fromShortCompanyCommand = resolveMatrixContext(db, '显示 Acepac International 客户图片');
  assert.strictEqual(fromShortCompanyCommand.matches.length, 1);
  assert.strictEqual(fromShortCompanyCommand.matches[0].customer.id, customerId);

  const byStableId = contextByRecordId(db, customerId);
  assert.strictEqual(byStableId.matches.length, 1);
  assert.strictEqual(byStableId.matches[0].customer.id, customerId);

  const unknown = searchMatrixContext(db, 'Unknown Company');
  assert.deepStrictEqual(unknown.matches, []);
  assert.throws(() => searchMatrixContext(db, 'a'), /at least 2/);

  console.log('PASS matrix context search');
} finally {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

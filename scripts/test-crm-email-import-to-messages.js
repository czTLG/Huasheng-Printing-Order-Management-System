const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-email-import-'));
process.env.DB_PATH = path.join(tmpRoot, 'app.db');

const { db, initDb, now } = require('../src/db');
const { importEmailToCrmMessage, batchImportEmailsToCrmMessages } = require('../src/lib/emailToCrmMessage');
const { normalizeCrmAttachments } = require('../src/lib/crmAttachments');
const { interpretCrmMessage } = require('../src/services/crmMessageInterpreter');

function insertEmail(overrides) {
  const ts = now();
  return db.prepare(`
    INSERT INTO email_messages (
      mailbox, folder, message_uid, message_id, thread_id, from_email, from_name, to_emails,
      subject, text_body, html_body, cleaned_text, attachments_json, received_at, direction,
      processing_status, matched_customer_id, matched_inquiry_id, created_at, updated_at
    ) VALUES (
      'test', 'INBOX', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?
    )
  `).run(
    overrides.message_uid,
    overrides.message_id,
    overrides.thread_id || '',
    overrides.from_email || 'buyer@example.com',
    overrides.from_name || 'Buyer',
    overrides.to_emails || 'sales@example.com',
    overrides.subject || 'Inquiry',
    overrides.text_body || overrides.cleaned_text || '',
    overrides.html_body || '',
    overrides.cleaned_text || overrides.text_body || '',
    JSON.stringify(overrides.attachments || []),
    overrides.received_at || ts,
    overrides.direction || 'inbound',
    overrides.matched_customer_id || null,
    overrides.matched_inquiry_id || null,
    ts,
    ts
  ).lastInsertRowid;
}

try {
  initDb();
  const ts = now();
  const customerId = db.prepare(`INSERT INTO customers (name, company_name, active, created_at, updated_at) VALUES ('Email Buyer', 'Email Buyer LLC', 1, ?, ?)`)
    .run(ts, ts).lastInsertRowid;
  const inquiryId = db.prepare(`INSERT INTO inquiries (customer_id, inquiry_title, status, priority, created_at, updated_at) VALUES (?, 'Email inquiry', 'new', 'C', ?, ?)`)
    .run(customerId, ts, ts).lastInsertRowid;

  const coffeeId = insertEmail({
    message_uid: 'uid-coffee',
    message_id: '<coffee@example.com>',
    thread_id: 'thread-coffee',
    subject: 'Coffee Bags with Valve Inquiry',
    cleaned_text: `Hello, we need custom coffee bags with valve and zipper.
Size: 250g and 500g.
Material: matte finish, high barrier, maybe PET/VMPET/PE.
Quantity: 30,000 pcs each size.
Printing: 6 colors.
Destination: Ajman, UAE.
Can you quote FOB and CIF?
Also please check if you can make it with flat bottom pouch.`,
    attachments: [
      { file_name: 'coffee-bag-reference.jpg', mime_type: 'image/jpeg', size: 12345 },
      { file_name: 'coffee-spec.pdf', mime_type: 'application/pdf', size: 45678 }
    ],
    matched_customer_id: customerId,
    matched_inquiry_id: inquiryId
  });
  const rollFilmId = insertEmail({
    message_uid: 'uid-roll',
    message_id: '<roll@example.com>',
    subject: 'Printed roll film inquiry',
    cleaned_text: 'We need printed roll film, width 320mm, PET/PE, 500kg for automatic packing machine. Destination Oman.',
  });
  const tenderId = insertEmail({
    message_uid: 'uid-tender',
    message_id: '<tender@example.com>',
    subject: 'Tender for laminated film',
    cleaned_text: 'Please check attached PDF tender for laminated film and advise.',
    attachments: [{ file_name: 'laminated-film-tender.pdf', mime_type: 'application/pdf', size: 98765 }]
  });

  const coffeeImport = importEmailToCrmMessage(db, coffeeId);
  assert.strictEqual(coffeeImport.ok, true);
  assert.strictEqual(coffeeImport.already_exists, false);
  assert(coffeeImport.crm_message_id > 0);

  const duplicateImport = importEmailToCrmMessage(db, coffeeId);
  assert.strictEqual(duplicateImport.already_exists, true);
  assert.strictEqual(duplicateImport.crm_message_id, coffeeImport.crm_message_id);

  const batch = batchImportEmailsToCrmMessages(db, {
    email_message_ids: [coffeeId, rollFilmId, tenderId],
    only_unimported: true
  });
  assert.strictEqual(batch.imported, 2);
  assert.strictEqual(batch.skipped, 1);
  assert.strictEqual(batch.failed, 0);
  assert.strictEqual(batch.crm_message_ids.length, 2);

  const message = db.prepare('SELECT * FROM crm_messages WHERE id = ?').get(coffeeImport.crm_message_id);
  assert.strictEqual(message.source_type, 'email');
  assert.strictEqual(String(message.source_message_id), String(coffeeId));
  assert.strictEqual(message.customer_id, customerId);
  assert.strictEqual(message.inquiry_id, inquiryId);
  assert.strictEqual(message.ai_status, 'pending');
  assert.strictEqual(message.workflow_status, 'new');
  assert(message.raw_payload_json.includes('Coffee Bags with Valve Inquiry'));

  const attachments = normalizeCrmAttachments(db, message).attachments;
  assert.strictEqual(attachments.length, 2);
  assert(attachments.some((item) => item.attachment_type === 'image' && item.can_preview === false && item.can_download === false));
  assert(attachments.some((item) => item.attachment_type === 'pdf' && item.can_preview === false && item.can_download === false));
  assert(attachments.every((item) => item.source_type === 'email'));

  const parsed = interpretCrmMessage(message, attachments);
  assert.strictEqual(parsed.product_type, 'coffee_bags');
  assert.strictEqual(parsed.bag_type, 'flat_bottom_pouch');
  assert.strictEqual(parsed.destination_port, 'Ajman');
  assert.strictEqual(parsed.trade_term, 'FOB and CIF');

  const importedRows = db.prepare("SELECT COUNT(*) AS total FROM crm_messages WHERE source_type = 'email'").get().total;
  const attachmentRows = db.prepare("SELECT COUNT(*) AS total FROM crm_message_attachments WHERE source_type = 'email'").get().total;
  assert.strictEqual(importedRows, 3);
  assert.strictEqual(attachmentRows, 3);

  const serialized = JSON.stringify({ coffeeImport, duplicateImport, batch, message, attachments, parsed });
  ['undefined', 'NaN', '[object Object]', '正式报价已确认', '已发送客户', '自动报价成功'].forEach((word) => {
    assert(!serialized.includes(word), `forbidden text: ${word}`);
  });

  console.log('CRM email import to messages verification PASS');
  console.log(JSON.stringify({
    coffee_email_id: coffeeId,
    coffee_crm_message_id: coffeeImport.crm_message_id,
    batch,
    importedRows,
    attachmentRows,
    parsed: {
      product_type: parsed.product_type,
      bag_type: parsed.bag_type,
      destination_port: parsed.destination_port,
      trade_term: parsed.trade_term
    }
  }, null, 2));
} finally {
  db.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

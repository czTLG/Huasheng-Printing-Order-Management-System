'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-thread-context-'));
process.env.DB_PATH = path.join(root, 'app.db');
const { db, initDb, now } = require('../src/db');
const { buildThreadContext } = require('../src/services/matrixThreadContext');

try {
  const originalLog = console.log;
  console.log = () => {};
  try { initDb(); } finally { console.log = originalLog; }
  const ts = now();
  const customerId = Number(db.prepare(`INSERT INTO customers (name, company_name, email, country, website, active, created_at, updated_at) VALUES ('Buyer', 'Buyer Pte Ltd', 'buyer@buyer.sg', 'Singapore', 'https://buyer.sg', 1, ?, ?)`).run(ts, ts).lastInsertRowid);
  const inquiryId = Number(db.prepare(`INSERT INTO inquiries (inquiry_code, customer_id, inquiry_title, status, costing_required, destination_country, trade_term_requested, created_at, updated_at) VALUES ('RFQ-CONTEXT', ?, 'Pouch RFQ', 'quote_pending', 1, 'United Kingdom', 'FOB', ?, ?)`).run(customerId, ts, ts).lastInsertRowid);
  const specificationId = Number(db.prepare(`INSERT INTO inquiry_specifications (inquiry_id, version_no, is_current, product_type, bag_type, size_width, size_height, material_structure_text, printing_colors, artwork_status, created_at, updated_at) VALUES (?, 1, 1, 'Printed pouch', 'stand_up_pouch', '160mm', '220mm', 'PET/PE', '8', 'attached', ?, ?)`).run(inquiryId, ts, ts).lastInsertRowid);
  db.prepare(`INSERT INTO specification_layers (specification_id, layer_order, material_name, thickness, thickness_unit, is_customer_required, created_at, updated_at) VALUES (?, 1, 'PET', '12', 'um', 1, ?, ?)`).run(specificationId, ts, ts);
  db.prepare(`INSERT INTO customer_research_notes (customer_id, source_type, title, research_summary, website, country, sources_json, status, created_at, updated_at) VALUES (?, 'public_official', 'Official', 'Verified official background.', 'https://buyer.sg', 'Singapore', '[{"url":"https://buyer.sg/about"}]', 'active', ?, ?)`).run(customerId, ts, ts);
  db.prepare(`INSERT INTO costing_requests (costing_request_code, customer_id, inquiry_id, status, request_note, created_at, updated_at) VALUES ('MX-CONTEXT', ?, ?, 'pending', 'Continue one task', ?, ?)`).run(customerId, inquiryId, ts, ts);
  const insert = db.prepare(`INSERT INTO email_messages (mailbox, folder, message_uid, message_id, from_email, to_emails, subject, cleaned_text, received_at, direction, processing_status, normalized_subject, contact_email, email_domain, matched_customer_id, matched_inquiry_id, created_at, updated_at) VALUES ('sales@example.test', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 'pouch rfq', 'buyer@buyer.sg', 'buyer.sg', ?, ?, ?, ?)`);
  const first = Number(insert.run('INBOX', '1', '<1@test>', 'buyer@buyer.sg', 'sales@example.test', 'Pouch RFQ', 'Please quote FOB.', '2026-07-10T01:00:00.000Z', 'inbound', customerId, inquiryId, ts, ts).lastInsertRowid);
  insert.run('Sent', '2', '<2@test>', 'sales@example.test', 'buyer@buyer.sg', 'Re: Pouch RFQ', 'Please send photos.', '2026-07-10T02:00:00.000Z', 'outbound', customerId, inquiryId, ts, ts);
  const latest = Number(insert.run('INBOX', '3', '<3@test>', 'buyer@buyer.sg', 'sales@example.test', 'Re: Pouch RFQ', 'Photos attached. Please send official quote.', '2026-07-10T03:00:00.000Z', 'inbound', customerId, inquiryId, ts, ts).lastInsertRowid);
  db.prepare(`INSERT INTO matrix_inbox_attachments (email_message_id, media_order, storage_key, original_file_name, detected_mime_type, file_size, availability_state, created_at, updated_at) VALUES (?, 0, '2026/07/product.png', 'product.png', 'image/png', 123, 'available', ?, ?)`).run(latest, ts, ts);
  const crmMessageId = Number(db.prepare(`INSERT INTO crm_messages (source_type, source_message_id, customer_id, inquiry_id, direction, message_text, raw_payload_json, received_at, ai_status, workflow_status, dedupe_hash, created_at, updated_at) VALUES ('email', ?, ?, ?, 'inbound', 'Photos attached.', '{}', ?, 'complete', 'new', 'context-attachment', ?, ?)`).run(String(latest), customerId, inquiryId, ts, ts, ts).lastInsertRowid);
  db.prepare(`INSERT INTO crm_message_attachments (message_id, customer_id, inquiry_id, source_type, source_message_id, email_message_id, original_file_name, mime_type, attachment_type, media_order, ai_status, ai_summary_cn, extracted_specs_json, raw_metadata_json, created_at, updated_at) VALUES (?, ?, ?, 'email', ?, ?, 'product.png', 'image/png', 'image', 1, 'human_verified', '自立拉链袋产品正面参考图', '{"visible_facts":["12 x 250g"],"unconfirmed":["exact_dimensions","material_structure"]}', '{"evidence_role":"product_reference","display_recommended":true}', ?, ?)`).run(crmMessageId, customerId, inquiryId, String(latest), String(latest), ts, ts);

  const context = buildThreadContext(db, latest);
  assert.strictEqual(context.messages.length, 3);
  assert.deepStrictEqual(context.messages.map(row => row.direction), ['inbound', 'outbound', 'inbound']);
  assert.strictEqual(context.customer.company_name, 'Buyer Pte Ltd');
  assert.strictEqual(context.inquiry.inquiry_code, 'RFQ-CONTEXT');
  assert.strictEqual(context.research.summary_cn, 'Verified official background.');
  assert.strictEqual(context.existing_tasks.length, 1);
  assert.strictEqual(context.attachments.length, 1);
  assert.strictEqual(context.attachments[0].local_path, '/refs/matrix-inbox-attachments/2026/07/product.png');
  assert.strictEqual(context.attachments[0].customer_id, customerId);
  assert.strictEqual(context.attachments[0].inquiry_id, inquiryId);
  assert.strictEqual(context.attachments[0].evidence_role, 'product_reference');
  assert.strictEqual(context.attachments[0].display_recommended, true);
  assert.match(context.attachments[0].summary_cn, /自立拉链袋/);
  assert.strictEqual(context.specifications.length, 1);
  assert.strictEqual(context.specifications[0].bag_type, 'stand_up_pouch');
  assert.strictEqual(context.specifications[0].layers[0].material_name, 'PET');
  assert.strictEqual(context.target_email_message_id, latest);
  assert.strictEqual(context.first_email_message_id, first);
  console.log('PASS matrix thread context');
} finally {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-attachment-review-'));
process.env.DB_PATH = path.join(root, 'app.db');
const { db, initDb, now } = require('../src/db');
const { applyAttachmentReviews } = require('../src/services/matrixAttachmentReview');

try {
  const originalLog = console.log;
  console.log = () => {};
  try { initDb(); } finally { console.log = originalLog; }
  const ts = now();
  const customerId = Number(db.prepare(`INSERT INTO customers (name, company_name, active, created_at, updated_at) VALUES ('Buyer', 'Buyer Ltd', 1, ?, ?)`).run(ts, ts).lastInsertRowid);
  const inquiryId = Number(db.prepare(`INSERT INTO inquiries (customer_id, inquiry_title, status, created_at, updated_at) VALUES (?, 'Photo inquiry', 'new', ?, ?)`).run(customerId, ts, ts).lastInsertRowid);
  const messageId = Number(db.prepare(`INSERT INTO crm_messages (source_type, source_message_id, customer_id, inquiry_id, direction, message_text, raw_payload_json, received_at, dedupe_hash, created_at, updated_at) VALUES ('email', '91', ?, ?, 'inbound', 'See photos', '{}', ?, 'review-message', ?, ?)`).run(customerId, inquiryId, ts, ts, ts).lastInsertRowid);
  const insert = db.prepare(`INSERT INTO crm_message_attachments (message_id, customer_id, inquiry_id, source_type, source_message_id, email_message_id, original_file_name, mime_type, attachment_type, media_order, ai_status, raw_metadata_json, created_at, updated_at) VALUES (?, ?, ?, 'email', '91', '91', ?, 'image/jpeg', 'image', ?, 'skipped', '{"imported":true}', ?, ?)`);
  const productId = Number(insert.run(messageId, customerId, inquiryId, 'product-photo.jpg', 1, ts, ts).lastInsertRowid);
  const logoId = Number(insert.run(messageId, customerId, inquiryId, 'image001.jpg', 2, ts, ts).lastInsertRowid);

  const result = applyAttachmentReviews(db, [
    { attachment_id: productId, evidence_role: 'product_reference', display_recommended: true, summary_cn: '自立拉链袋正面参考图', visible_facts: ['12 x 250g'], unconfirmed_fields: ['exact_dimensions', 'material_structure'], source: 'human_verified' },
    { attachment_id: logoId, evidence_role: 'signature_asset', display_recommended: false, summary_cn: '邮件签名品牌标识', visible_facts: [], unconfirmed_fields: [], source: 'human_verified' }
  ], { reviewer: 'test-owner' });
  assert.deepStrictEqual(result, { updated: 2, attachment_ids: [productId, logoId] });
  const product = db.prepare('SELECT * FROM crm_message_attachments WHERE id = ?').get(productId);
  const productMeta = JSON.parse(product.raw_metadata_json);
  assert.strictEqual(product.customer_id, customerId);
  assert.strictEqual(product.inquiry_id, inquiryId);
  assert.strictEqual(product.ai_status, 'human_verified');
  assert.strictEqual(productMeta.imported, true);
  assert.strictEqual(productMeta.evidence_role, 'product_reference');
  assert.strictEqual(productMeta.display_recommended, true);
  assert.deepStrictEqual(JSON.parse(product.extracted_specs_json), { visible_facts: ['12 x 250g'], unconfirmed_fields: ['exact_dimensions', 'material_structure'] });
  assert.throws(() => applyAttachmentReviews(db, [{ attachment_id: productId, evidence_role: 'product_reference', display_recommended: true, summary_cn: '', visible_facts: [], unconfirmed_fields: [], source: 'human_verified' }]), /summary/);
  assert.throws(() => applyAttachmentReviews(db, [{ attachment_id: productId, evidence_role: 'unknown', display_recommended: false, summary_cn: 'x', visible_facts: [], unconfirmed_fields: [], source: 'human_verified' }]), /evidence role/);
  console.log('PASS matrix attachment review');
} finally {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

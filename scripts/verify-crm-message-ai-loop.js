const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-message-ai-loop-'));
process.env.DB_PATH = path.join(tmpRoot, 'app.db');

const { db, initDb, now } = require('../src/db');
const { interpretCrmMessage, buildInquiryFillPlan } = require('../src/services/crmMessageInterpreter');

function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}

try {
  initDb();
  assert(columns('crm_ai_interpretations').includes('changed_fields_json'));
  assert(columns('crm_father_review_tasks').includes('attachment_ids_json'));
  assert(columns('foreign_costing_drafts').includes('source_message_ids_json'));
  assert(columns('foreign_costing_drafts').includes('attachment_ids_json'));
  assert(columns('foreign_costing_drafts').includes('crm_spec_json'));

  const parsed = interpretCrmMessage({
    message_text: 'Need 25,000 stand up zipper pouches, size 15 x 25 x 8 cm, material PET/PE, CIF Chittagong, Bangladesh. Please quote.',
    direction: 'inbound'
  }, [{ id: 1, attachment_type: 'pdf' }]);
  const requiredKeys = [
    'message_type', 'summary_cn', 'summary_en', 'customer_intent', 'product_type', 'bag_type', 'roll_or_bag',
    'size_text', 'material_structure', 'thickness_text', 'quantity_text', 'printing_colors', 'artwork_status',
    'destination_country', 'destination_port', 'trade_term', 'technical_requirements', 'barrier_requirements',
    'compliance_requirements', 'missing_information', 'risk_flags', 'should_update_inquiry',
    'should_create_father_task', 'father_task_type', 'question_for_father_cn', 'suggested_next_action_cn',
    'suggested_customer_reply_en', 'confidence_score'
  ];
  requiredKeys.forEach((key) => assert(Object.prototype.hasOwnProperty.call(parsed, key), `missing ${key}`));
  assert.strictEqual(parsed.bag_type, 'stand_zipper_bag');
  assert.strictEqual(parsed.destination_country, 'Bangladesh');
  assert.strictEqual(parsed.destination_port, 'Chittagong');
  assert.strictEqual(parsed.trade_term, 'CIF');

  const fillPlan = buildInquiryFillPlan({
    product_type: 'Manual product', packaging_type: '', quantity: '', destination_country: ''
  }, { ...parsed, product_type: 'AI product' });
  assert(!fillPlan.updates.product_type, 'manual value must not be overwritten');
  assert.strictEqual(fillPlan.updates.packaging_type, 'stand_zipper_bag');
  assert(fillPlan.skipped_fields.some((row) => row.field === 'product_type'));

  const ts = now();
  const customerId = db.prepare(`INSERT INTO customers (name, company_name, active, created_at, updated_at) VALUES ('Test', 'Test Customer', 1, ?, ?)`)
    .run(ts, ts).lastInsertRowid;
  const inquiryId = db.prepare(`INSERT INTO inquiries (customer_id, inquiry_title, status, priority, created_at, updated_at) VALUES (?, 'Test inquiry', 'new', 'C', ?, ?)`)
    .run(customerId, ts, ts).lastInsertRowid;
  const messageId = db.prepare(`
    INSERT INTO crm_messages (
      source_type, customer_id, inquiry_id, direction, message_text, raw_payload_json,
      received_at, ai_status, workflow_status, dedupe_hash, created_at, updated_at
    ) VALUES ('whatsapp', ?, ?, 'inbound', 'Test message', '{}', ?, 'parsed', 'pending', 'verify-loop', ?, ?)
  `).run(customerId, inquiryId, ts, ts, ts).lastInsertRowid;
  const attachmentId = db.prepare(`
    INSERT INTO crm_message_attachments (message_id, customer_id, inquiry_id, original_file_name, attachment_type, created_at, updated_at)
    VALUES (?, ?, ?, 'spec.pdf', 'pdf', ?, ?)
  `).run(messageId, customerId, inquiryId, ts, ts).lastInsertRowid;
  const interpretationId = db.prepare(`
    INSERT INTO crm_ai_interpretations (
      message_id, customer_id, inquiry_id, parsed_json, changed_fields_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'parsed', ?, ?)
  `).run(messageId, customerId, inquiryId, JSON.stringify(parsed), JSON.stringify([{
    field: 'packaging_type', old_value: '', new_value: parsed.bag_type,
    source_message_id: messageId, interpretation_id: 1, changed_at: ts
  }]), ts, ts).lastInsertRowid;
  const fatherTaskId = db.prepare(`
    INSERT INTO crm_father_review_tasks (
      customer_id, inquiry_id, source_message_id, interpretation_id, task_type, question_cn,
      attachment_ids_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'quote', '请确认内部核价参数。', ?, 'pending', ?, ?)
  `).run(customerId, inquiryId, messageId, interpretationId, JSON.stringify([attachmentId]), ts, ts).lastInsertRowid;
  db.prepare(`UPDATE crm_father_review_tasks SET father_reply_cn = '先确认材料价格。', status = 'done', completed_at = ?, updated_at = ? WHERE id = ?`)
    .run(ts, ts, fatherTaskId);
  const draftId = db.prepare(`
    INSERT INTO foreign_costing_drafts (
      crm_inquiry_id, customer_id, source_text, parsed_spec_json, source_message_ids_json,
      attachment_ids_json, crm_spec_json, status, created_at, updated_at
    ) VALUES (?, ?, 'Test', '{}', ?, ?, ?, 'internal_pre_quote', ?, ?)
  `).run(inquiryId, customerId, JSON.stringify([messageId]), JSON.stringify([attachmentId]), JSON.stringify(parsed), ts, ts).lastInsertRowid;

  const task = db.prepare('SELECT * FROM crm_father_review_tasks WHERE id = ?').get(fatherTaskId);
  const draft = db.prepare('SELECT * FROM foreign_costing_drafts WHERE id = ?').get(draftId);
  assert.strictEqual(task.status, 'done');
  assert.deepStrictEqual(JSON.parse(task.attachment_ids_json), [attachmentId]);
  assert.strictEqual(draft.crm_inquiry_id, inquiryId);
  assert.strictEqual(draft.customer_id, customerId);
  assert.deepStrictEqual(JSON.parse(draft.source_message_ids_json), [messageId]);
  assert.deepStrictEqual(JSON.parse(draft.attachment_ids_json), [attachmentId]);

  const serialized = JSON.stringify({ parsed, fillPlan, task, draft });
  ['undefined', 'NaN', '[object Object]', '正式报价已确认', '已发送客户', '自动报价成功'].forEach((word) => {
    assert(!serialized.includes(word), `forbidden text: ${word}`);
  });
  console.log('CRM message AI loop persistence verification PASS');
} finally {
  db.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

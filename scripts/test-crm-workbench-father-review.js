const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-workbench-'));
process.env.DB_PATH = path.join(tmpRoot, 'app.db');

const { db, initDb, now } = require('../src/db');
const {
  buildCrmWorkbench,
  getFatherReviewTaskDetail,
  listFatherReviewTasks,
  markFatherTaskSalesHandled
} = require('../src/lib/crmWorkbench');

try {
  initDb();
  const ts = now();
  const customerId = db.prepare(`
    INSERT INTO customers (
      name, company_name, country, priority, stage, next_action, active, created_at, updated_at
    ) VALUES ('Coffee Buyer', 'Coffee Buyer LLC', 'UAE', 'A', 'quoted_no_reply', 'Follow up quote', 1, ?, ?)
  `).run(ts, ts).lastInsertRowid;
  const inquiryId = db.prepare(`
    INSERT INTO inquiries (
      customer_id, inquiry_title, product_type, packaging_type, quantity, destination_country,
      destination_port, trade_term_requested, status, priority, created_at, updated_at
    ) VALUES (?, 'Coffee bags inquiry', 'coffee_bags', 'flat_bottom_pouch', '30,000 pcs each size', 'UAE', 'Ajman', 'FOB and CIF', 'quoted_no_reply', 'A', ?, ?)
  `).run(customerId, ts, ts).lastInsertRowid;

  const pendingMessageId = db.prepare(`
    INSERT INTO crm_messages (
      source_type, source_message_id, customer_id, inquiry_id, direction, sender_name,
      sender_contact, receiver_contact, message_text, attachments_json, raw_payload_json,
      received_at, ai_status, workflow_status, dedupe_hash, created_at, updated_at
    ) VALUES ('whatsapp', 'wa-pending', ?, ?, 'inbound', 'Buyer', '+971', 'sales', 'Need price update', '[]', '{}', ?, 'pending', 'new', 'wa-pending', ?, ?)
  `).run(customerId, inquiryId, ts, ts, ts).lastInsertRowid;

  const parsedMessageId = db.prepare(`
    INSERT INTO crm_messages (
      source_type, source_message_id, customer_id, inquiry_id, direction, sender_name,
      sender_contact, receiver_contact, message_text, attachments_json, raw_payload_json,
      received_at, ai_status, workflow_status, dedupe_hash, created_at, updated_at
    ) VALUES ('email', 'em-parsed', ?, ?, 'inbound', 'Buyer', 'buyer@example.com', 'sales@example.com', 'Coffee bag specs', '[]', '{"subject":"Coffee Specs"}', ?, 'parsed', 'new', 'em-parsed', ?, ?)
  `).run(customerId, inquiryId, ts, ts, ts).lastInsertRowid;

  const interpretationId = db.prepare(`
    INSERT INTO crm_ai_interpretations (
      message_id, customer_id, inquiry_id, parsed_json, changed_fields_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'parsed', ?, ?)
  `).run(
    parsedMessageId,
    customerId,
    inquiryId,
    JSON.stringify({ summary_cn: '客户询问咖啡袋规格和 FOB/CIF 报价。', product_type: 'coffee_bags', risk_flags: ['FOB and CIF require separate logistics calculation'] }),
    JSON.stringify([]),
    ts,
    ts
  ).lastInsertRowid;

  const pendingTaskId = db.prepare(`
    INSERT INTO crm_father_review_tasks (
      customer_id, inquiry_id, source_message_id, interpretation_id, task_type, question_cn,
      ai_context_cn, customer_original_text, attachment_ids_json, required_fields_json,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'quote', '请确认咖啡袋核价参数。', '客户需要咖啡袋报价。', 'Need coffee bags', '[]', '[]', 'pending', ?, ?)
  `).run(customerId, inquiryId, parsedMessageId, interpretationId, ts, ts).lastInsertRowid;

  const doneTaskId = db.prepare(`
    INSERT INTO crm_father_review_tasks (
      customer_id, inquiry_id, source_message_id, interpretation_id, task_type, question_cn,
      ai_context_cn, customer_original_text, attachment_ids_json, required_fields_json,
      father_reply_cn, status, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'material', '请确认材料结构。', '客户材料不确定。', 'PET/VMPET/PE?', '[]', '[]', '先按 PET/VMPET/PE 核价。', 'done', ?, ?, ?)
  `).run(customerId, inquiryId, parsedMessageId, interpretationId, ts, ts, ts).lastInsertRowid;

  const draftId = db.prepare(`
    INSERT INTO foreign_costing_drafts (
      crm_inquiry_id, customer_id, source_text, parsed_spec_json, quote_input_json,
      quote_result_json, calculation_table_json, status, created_at, updated_at
    ) VALUES (?, ?, 'Coffee draft', '{}', '{}', '{}', '[]', 'internal_pre_quote', ?, ?)
  `).run(inquiryId, customerId, ts, ts).lastInsertRowid;

  const workbench = buildCrmWorkbench(db);
  assert.strictEqual(workbench.counts.messages_pending_ai, 1);
  assert.strictEqual(workbench.counts.messages_parsed_pending_inquiry, 1);
  assert.strictEqual(workbench.counts.father_tasks_pending, 1);
  assert.strictEqual(workbench.counts.father_tasks_done_pending_sales, 1);
  assert.strictEqual(workbench.counts.costing_drafts_pending_review, 1);
  assert.strictEqual(workbench.counts.quoted_waiting_customer, 1);
  assert.strictEqual(workbench.counts.a_customers_updated, 1);
  assert(workbench.items.some((item) => item.type === 'message_pending_ai' && item.message_id === pendingMessageId));
  assert(workbench.items.some((item) => item.type === 'father_done_pending_sales' && item.father_task_id === doneTaskId));
  assert(workbench.items.some((item) => item.type === 'costing_draft_pending_review' && item.costing_draft_id === draftId));

  const pendingTasks = listFatherReviewTasks(db, { status: 'pending' });
  assert.strictEqual(pendingTasks.rows.length, 1);
  assert.strictEqual(pendingTasks.rows[0].id, pendingTaskId);
  assert.strictEqual(pendingTasks.rows[0].customer_display_name, 'Coffee Buyer LLC');

  const detail = getFatherReviewTaskDetail(db, pendingTaskId);
  assert.strictEqual(detail.task.id, pendingTaskId);
  assert.strictEqual(detail.customer.id, customerId);
  assert.strictEqual(detail.inquiry.id, inquiryId);
  assert.strictEqual(detail.source_message.id, parsedMessageId);
  assert.strictEqual(detail.latest_interpretation.id, interpretationId);

  const handled = markFatherTaskSalesHandled(db, doneTaskId, {
    sales_handled_by: 'sales',
    sales_note: '已根据父亲意见准备英文回复。'
  });
  assert.strictEqual(handled.task.status, 'done');
  assert(handled.task.sales_handled_at, 'sales_handled_at should be set');
  assert.strictEqual(buildCrmWorkbench(db).counts.father_tasks_done_pending_sales, 0);

  const serialized = JSON.stringify({ workbench, pendingTasks, detail, handled });
  ['undefined', 'NaN', '[object Object]', '正式报价已确认', '已发送客户', '自动报价成功'].forEach((word) => {
    assert(!serialized.includes(word), `forbidden text: ${word}`);
  });

  console.log('CRM workbench father review verification PASS');
  console.log(JSON.stringify({
    customer_id: customerId,
    inquiry_id: inquiryId,
    pending_message_id: pendingMessageId,
    parsed_message_id: parsedMessageId,
    pending_task_id: pendingTaskId,
    done_task_id: doneTaskId,
    costing_draft_id: draftId,
    counts: workbench.counts
  }, null, 2));
} finally {
  db.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

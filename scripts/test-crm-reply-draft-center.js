const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-reply-draft-'));
process.env.DB_PATH = path.join(tmpRoot, 'app.db');

const { db, initDb, now } = require('../src/db');
const { interpretCrmMessage } = require('../src/services/crmMessageInterpreter');
const {
  approveReplyDraft,
  buildReplyDraftContext,
  generateReplyDraft,
  listReplyDrafts,
  markReplyDraftSentManually,
  updateReplyDraft
} = require('../src/services/crmReplyDraftService');

function insertCustomer(name = 'Reply Draft Customer') {
  const ts = now();
  return Number(db.prepare(`
    INSERT INTO customers (name, company_name, country, priority, stage, active, created_at, updated_at)
    VALUES (?, ?, 'UAE', 'A', 'new', 1, ?, ?)
  `).run(name, name, ts, ts).lastInsertRowid);
}

function insertMessage(customerId, text, sourceType = 'whatsapp') {
  const ts = now();
  return Number(db.prepare(`
    INSERT INTO crm_messages (
      source_type, source_message_id, customer_id, direction, sender_name, sender_contact, receiver_contact,
      message_text, attachments_json, raw_payload_json, received_at, ai_status, workflow_status, dedupe_hash,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'inbound', 'Buyer', 'buyer@example.com', 'sales', ?, '[]', '{}', ?, 'pending', 'new', ?, ?, ?)
  `).run(sourceType, `${sourceType}-${Date.now()}-${Math.random()}`, customerId, text, ts, `${sourceType}-${text.slice(0, 20)}-${Math.random()}`, ts, ts).lastInsertRowid);
}

function addAttachment(messageId, customerId, fileName, mimeType) {
  const ts = now();
  return Number(db.prepare(`
    INSERT INTO crm_message_attachments (
      message_id, customer_id, source_type, original_file_name, mime_type, attachment_type,
      file_size, media_order, ai_status, raw_metadata_json, created_at, updated_at
    ) VALUES (?, ?, 'email', ?, ?, ?, 1234, 1, 'skipped', '{}', ?, ?)
  `).run(messageId, customerId, fileName, mimeType, mimeType === 'application/pdf' ? 'pdf' : 'image', ts, ts).lastInsertRowid);
}

function insertInquiry(customerId, parsed) {
  const ts = now();
  return Number(db.prepare(`
    INSERT INTO inquiries (
      customer_id, inquiry_title, product_type, packaging_type, quantity, destination_country,
      destination_port, trade_term_requested, missing_info, technical_risks, status, priority, next_action,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 'A', ?, ?, ?)
  `).run(
    customerId,
    parsed.product_type || parsed.bag_type || 'Reply draft inquiry',
    parsed.product_type || '',
    parsed.bag_type || '',
    parsed.quantity_text || '',
    parsed.destination_country || '',
    parsed.destination_port || '',
    parsed.trade_term || '',
    JSON.stringify(parsed.missing_information || []),
    JSON.stringify(parsed.risk_flags || []),
    parsed.suggested_next_action_cn || '',
    ts,
    ts
  ).lastInsertRowid);
}

function insertInterpretation(messageId, customerId, inquiryId, parsed) {
  const ts = now();
  return Number(db.prepare(`
    INSERT INTO crm_ai_interpretations (message_id, customer_id, inquiry_id, parsed_json, changed_fields_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, '[]', 'parsed', ?, ?)
  `).run(messageId, customerId, inquiryId, JSON.stringify(parsed), ts, ts).lastInsertRowid);
}

function insertFatherTask(customerId, inquiryId, messageId, interpretationId, parsed, status = 'done') {
  const ts = now();
  return Number(db.prepare(`
    INSERT INTO crm_father_review_tasks (
      customer_id, inquiry_id, source_message_id, interpretation_id, task_type, question_cn, ai_context_cn,
      customer_original_text, attachment_ids_json, required_fields_json, father_reply_cn, status,
      created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?)
  `).run(
    customerId,
    inquiryId,
    messageId,
    interpretationId,
    parsed.father_task_type || 'general',
    parsed.question_for_father_cn || '请确认该客户问题。',
    parsed.summary_cn || '',
    db.prepare('SELECT message_text FROM crm_messages WHERE id = ?').get(messageId).message_text,
    JSON.stringify(parsed.missing_information || []),
    status === 'done' ? '可以做，但正式报价前必须确认材料、数量、交付条款和特殊工艺。' : '',
    status,
    ts,
    ts,
    status === 'done' ? ts : null
  ).lastInsertRowid);
}

function insertCostingDraft(customerId, inquiryId, messageId, parsed) {
  const ts = now();
  return Number(db.prepare(`
    INSERT INTO foreign_costing_drafts (
      crm_inquiry_id, customer_id, source_text, parsed_spec_json, quote_input_json, quote_result_json,
      calculation_table_json, source_message_ids_json, attachment_ids_json, crm_spec_json, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, '{}', '{}', '[]', ?, '[]', ?, 'internal_pre_quote', ?, ?)
  `).run(
    inquiryId,
    customerId,
    parsed.summary_cn || '',
    JSON.stringify(parsed),
    JSON.stringify([messageId]),
    JSON.stringify({ ...parsed, status_note: 'internal_pre_quote only' }),
    ts,
    ts
  ).lastInsertRowid);
}

function setupCase(name, text, options = {}) {
  const customerId = insertCustomer(name);
  const messageId = insertMessage(customerId, text, options.sourceType || 'whatsapp');
  if (options.pdf) addAttachment(messageId, customerId, 'tender.pdf', 'application/pdf');
  const parsed = interpretCrmMessage(db.prepare('SELECT * FROM crm_messages WHERE id = ?').get(messageId), []);
  const inquiryId = insertInquiry(customerId, parsed);
  db.prepare("UPDATE crm_messages SET inquiry_id = ?, ai_status = 'parsed', workflow_status = 'created_inquiry' WHERE id = ?").run(inquiryId, messageId);
  const interpretationId = insertInterpretation(messageId, customerId, inquiryId, parsed);
  const fatherTaskId = options.father !== false ? insertFatherTask(customerId, inquiryId, messageId, interpretationId, parsed, options.fatherStatus || 'done') : null;
  const costingDraftId = options.costingDraft ? insertCostingDraft(customerId, inquiryId, messageId, parsed) : null;
  return { customerId, messageId, inquiryId, interpretationId, fatherTaskId, costingDraftId, parsed };
}

function assertSafeDraft(draft, label) {
  assert(draft.id || draft.reply_draft_id, `${label} should have draft id`);
  assert.strictEqual(draft.status, 'draft', `${label} should start as draft`);
  assert(draft.draft_text_en && draft.draft_text_en.length > 30, `${label} should have English draft`);
  const text = draft.draft_text_en.toLowerCase();
  [
    'formal quotation is confirmed',
    'we have sent',
    'automatic quote',
    'guaranteed lead time',
    'fda approved',
    'final price is'
  ].forEach((phrase) => assert(!text.includes(phrase), `${label} contains unsafe phrase: ${phrase}`));
  assert(!/\busd\s*\d+(?:\.\d+)?\b/i.test(draft.draft_text_en), `${label} should not invent price`);
}

function main() {
  initDb();

  const coffee = setupCase('Coffee Reply Draft', `Hello, we need custom coffee bags with valve and zipper.
Size: 250g and 500g. Material: matte finish, high barrier, maybe PET/VMPET/PE.
Quantity: 30,000 pcs each size. Destination: Ajman, UAE. Can you quote FOB and CIF?`, { costingDraft: true });
  const coffeeDraft = generateReplyDraft(db, { source: 'father_task', father_task_id: coffee.fatherTaskId, reply_channel: 'whatsapp' });
  assertSafeDraft(coffeeDraft, 'coffee father task');
  assert(/confirm|please/i.test(coffeeDraft.draft_text_en));

  const barrier = setupCase('Barrier Reply Draft', 'The barrier requirements are OTR ≤ 4 cc/m²/day and WVTR ≤ 1 g/m²/day. Structure BOPP30/PEWHB55. Please confirm.', { father: true });
  const barrierDraft = generateReplyDraft(db, { source: 'message', message_id: barrier.messageId });
  assertSafeDraft(barrierDraft, 'OTR/WVTR technical');
  assert(/barrier|OTR|WVTR|testing|structure/i.test(barrierDraft.draft_text_en));

  const logistics = setupCase('Logistics Reply Draft', 'Please check CIF Ajman port and FOB China. We need freight estimate first.', { father: false });
  const logisticsDraft = generateReplyDraft(db, { source: 'message', message_id: logistics.messageId });
  assertSafeDraft(logisticsDraft, 'logistics');
  assert(/destination port|shipment quantity|freight/i.test(logisticsDraft.draft_text_en));
  assert.strictEqual(logisticsDraft.crm_context.is_logistics_followup, true);

  const tender = setupCase('Tender PDF Reply Draft', 'Please check attached tender PDF and advise if you can quote.', { sourceType: 'email', pdf: true, father: true });
  const tenderDraft = generateReplyDraft(db, { source: 'message', message_id: tender.messageId, reply_channel: 'email' });
  assertSafeDraft(tenderDraft, 'tender PDF');
  assert(/attachment|review/i.test(tenderDraft.draft_text_en));
  assert(!/we have reviewed all pdf requirements/i.test(tenderDraft.draft_text_en));

  const preQuote = setupCase('Internal Pre Quote Reply Draft', 'Please send quotation for flat bottom pouch, EXW and CIF.', { costingDraft: true });
  const preQuoteDraft = generateReplyDraft(db, { source: 'inquiry', inquiry_id: preQuote.inquiryId });
  assertSafeDraft(preQuoteDraft, 'internal pre quote');
  assert(/reviewing the cost internally|formal quotation/i.test(preQuoteDraft.draft_text_en));
  assert(!/price is/i.test(preQuoteDraft.draft_text_en));

  const negotiation = setupCase('Price Negotiation Reply Draft', 'Your price is too high. Can you reduce price for double quantity?', { father: true });
  const negotiationDraft = generateReplyDraft(db, { source: 'message', message_id: negotiation.messageId });
  assertSafeDraft(negotiationDraft, 'price negotiation');
  assert(/target price|cost-effective|reduce quality|quantity/i.test(negotiationDraft.draft_text_en));

  const updated = updateReplyDraft(db, coffeeDraft.id, { draft_text_en: `${coffeeDraft.draft_text_en}\n\nBest regards,`, tone: 'friendly', status: 'edited' });
  assert.strictEqual(updated.status, 'edited');
  const approved = approveReplyDraft(db, coffeeDraft.id, { approved_by: 'test_sales' });
  assert.strictEqual(approved.status, 'approved');
  const sent = markReplyDraftSentManually(db, coffeeDraft.id, { updated_by: 'test_sales' });
  assert.strictEqual(sent.status, 'sent_manually');

  const listed = listReplyDrafts(db, { customer_id: coffee.customerId });
  assert(listed.rows.some((row) => row.id === coffeeDraft.id), 'list should include coffee draft');
  const context = buildReplyDraftContext(db, { source: 'father_task', father_task_id: coffee.fatherTaskId });
  assert(context.customer && context.message && context.interpretation, 'context should include customer/message/interpretation');

  console.log('CRM reply draft center verification PASS');
  console.log(JSON.stringify({
    drafts_created: 6,
    coffee_draft_id: coffeeDraft.id,
    barrier_draft_id: barrierDraft.id,
    logistics_draft_id: logisticsDraft.id,
    tender_draft_id: tenderDraft.id,
    pre_quote_draft_id: preQuoteDraft.id,
    negotiation_draft_id: negotiationDraft.id,
    coffee_final_status: sent.status
  }, null, 2));
}

main();

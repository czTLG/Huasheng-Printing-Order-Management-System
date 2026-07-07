const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-real-workflow-'));
process.env.DB_PATH = path.join(tmpRoot, 'app.db');

const { db, initDb, now } = require('../src/db');
const { normalizeCrmAttachments } = require('../src/lib/crmAttachments');
const { importEmailToCrmMessage } = require('../src/lib/emailToCrmMessage');
const { buildCrmWorkbench, listFatherReviewTasks, markFatherTaskSalesHandled } = require('../src/lib/crmWorkbench');
const { interpretCrmMessage, buildInquiryFillPlan, deriveInquiryAiSummary } = require('../src/services/crmMessageInterpreter');

function insertCustomer(sample) {
  const ts = now();
  return db.prepare(`
    INSERT INTO customers (name, company_name, country, priority, stage, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(sample.contact || sample.company, sample.company, sample.country || '', sample.priority || 'C', sample.stage || 'new_unprocessed', ts, ts).lastInsertRowid;
}

function insertEmailMessage(sample, customerId) {
  const ts = now();
  return db.prepare(`
    INSERT INTO email_messages (
      mailbox, folder, message_uid, message_id, from_email, from_name, to_emails, subject,
      cleaned_text, attachments_json, received_at, direction, processing_status, matched_customer_id,
      created_at, updated_at
    ) VALUES ('test', 'INBOX', ?, ?, ?, ?, 'sales@example.com', ?, ?, ?, ?, 'inbound', 'new', ?, ?, ?)
  `).run(
    `uid-${sample.key}`,
    `<${sample.key}@example.com>`,
    `${sample.key}@buyer.example`,
    sample.contact || sample.company,
    sample.subject || sample.company,
    sample.text,
    JSON.stringify(sample.attachments || []),
    ts,
    customerId,
    ts,
    ts
  ).lastInsertRowid;
}

function insertWhatsappMessage(sample, customerId) {
  const ts = now();
  const result = db.prepare(`
    INSERT INTO crm_messages (
      source_type, source_message_id, customer_id, direction, sender_name, sender_contact,
      receiver_contact, message_text, attachments_json, raw_payload_json, received_at,
      ai_status, workflow_status, dedupe_hash, created_at, updated_at
    ) VALUES ('whatsapp', ?, ?, 'inbound', ?, ?, 'sales', ?, ?, ?, ?, 'pending', 'new', ?, ?, ?)
  `).run(
    `wa-${sample.key}`,
    customerId,
    sample.contact || sample.company,
    sample.phone || '',
    sample.text || sample.fallback_text || '[文件消息]',
    JSON.stringify(sample.attachments || []),
    JSON.stringify({ sample: sample.key }),
    ts,
    `wa-${sample.key}`,
    ts,
    ts
  );
  const messageId = Number(result.lastInsertRowid);
  const insertAttachment = db.prepare(`
    INSERT INTO crm_message_attachments (
      message_id, customer_id, source_type, source_message_id, original_file_name, mime_type,
      file_size, attachment_type, media_order, ai_status, raw_metadata_json, created_at, updated_at
    ) VALUES (?, ?, 'whatsapp', ?, ?, ?, ?, ?, ?, 'skipped', ?, ?, ?)
  `);
  (sample.attachments || []).forEach((attachment, index) => {
    insertAttachment.run(
      messageId,
      customerId,
      `wa-${sample.key}`,
      attachment.file_name || attachment.original_file_name || `attachment-${index + 1}`,
      attachment.mime_type || attachment.content_type || '',
      Number(attachment.size || attachment.file_size || 0) || 0,
      attachment.attachment_type || (String(attachment.mime_type || '').includes('pdf') ? 'pdf' : String(attachment.mime_type || '').startsWith('image/') ? 'image' : 'other'),
      index + 1,
      JSON.stringify(attachment),
      now(),
      now()
    );
  });
  return messageId;
}

function createOrUpdateInquiry(customerId, messageId, parsed, sample) {
  const ts = now();
  const inquiryId = db.prepare(`
    INSERT INTO inquiries (customer_id, inquiry_title, status, priority, created_at, updated_at)
    VALUES (?, ?, 'new', ?, ?, ?)
  `).run(customerId, `${sample.company} ${parsed.product_type || parsed.bag_type || 'inquiry'}`, sample.priority || 'C', ts, ts).lastInsertRowid;
  const inquiry = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(inquiryId);
  const plan = buildInquiryFillPlan(inquiry, parsed);
  const fields = Object.keys(plan.updates);
  if (fields.length) {
    const sets = fields.map((field) => `${field} = ?`).join(', ');
    db.prepare(`UPDATE inquiries SET ${sets}, updated_at = ? WHERE id = ?`).run(...fields.map((field) => plan.updates[field]), ts, inquiryId);
  }
  const inquiryCols = db.prepare('PRAGMA table_info(inquiries)').all().map((row) => row.name);
  if (inquiryCols.includes('ai_summary_cn')) {
    db.prepare('UPDATE inquiries SET ai_summary_cn = COALESCE(NULLIF(ai_summary_cn, ""), ?), updated_at = ? WHERE id = ?')
      .run(deriveInquiryAiSummary({}, parsed), ts, inquiryId);
  }
  db.prepare("UPDATE crm_messages SET inquiry_id = ?, workflow_status = 'created_inquiry', updated_at = ? WHERE id = ?").run(inquiryId, ts, messageId);
  db.prepare('UPDATE crm_message_attachments SET inquiry_id = ?, updated_at = ? WHERE message_id = ?').run(inquiryId, ts, messageId);
  db.prepare('UPDATE crm_ai_interpretations SET inquiry_id = ?, changed_fields_json = ?, updated_at = ? WHERE message_id = ?')
    .run(inquiryId, JSON.stringify(fields.map((field) => ({ field, old_value: '', new_value: plan.updates[field], source_message_id: messageId, changed_at: ts }))), ts, messageId);
  db.prepare('UPDATE customers SET latest_inquiry_id = ?, updated_at = ? WHERE id = ?').run(inquiryId, ts, customerId);
  return { inquiryId, changedFields: fields };
}

function createFatherTask(customerId, inquiryId, messageId, interpretationId, parsed) {
  const attachments = normalizeCrmAttachments(db, db.prepare('SELECT * FROM crm_messages WHERE id = ?').get(messageId)).attachments;
  const attachmentIds = attachments.map((item) => Number(item.id)).filter(Boolean);
  const ts = now();
  const result = db.prepare(`
    INSERT INTO crm_father_review_tasks (
      customer_id, inquiry_id, source_message_id, interpretation_id, task_type, question_cn,
      ai_context_cn, customer_original_text, attachment_ids_json, required_fields_json,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    customerId,
    inquiryId,
    messageId,
    interpretationId,
    parsed.father_task_type || 'general',
    parsed.question_for_father_cn || '请确认该客户需求是否可做以及下一步核价边界。',
    parsed.summary_cn || '',
    db.prepare('SELECT message_text FROM crm_messages WHERE id = ?').get(messageId).message_text,
    JSON.stringify(attachmentIds),
    JSON.stringify(parsed.missing_information || []),
    ts,
    ts
  );
  return Number(result.lastInsertRowid);
}

function replyFatherTask(taskId, reply) {
  const ts = now();
  db.prepare("UPDATE crm_father_review_tasks SET father_reply_cn = ?, status = 'done', completed_at = ?, updated_at = ? WHERE id = ?")
    .run(reply, ts, ts, taskId);
}

function createCostingDraft(customerId, inquiryId, messageId, parsed) {
  const attachments = normalizeCrmAttachments(db, db.prepare('SELECT * FROM crm_messages WHERE id = ?').get(messageId)).attachments;
  const attachmentIds = attachments.map((item) => Number(item.id)).filter(Boolean);
  const ts = now();
  const crmSpec = {
    product_type: parsed.product_type,
    bag_type: parsed.bag_type,
    roll_or_bag: parsed.roll_or_bag,
    size_text: parsed.size_text,
    material_structure: parsed.material_structure,
    thickness_text: parsed.thickness_text,
    quantity_text: parsed.quantity_text,
    printing_colors: parsed.printing_colors,
    destination_country: parsed.destination_country,
    destination_port: parsed.destination_port,
    trade_term: parsed.trade_term,
    ai_summary_cn: parsed.summary_cn,
    missing_information: parsed.missing_information,
    risk_flags: parsed.risk_flags
  };
  return Number(db.prepare(`
    INSERT INTO foreign_costing_drafts (
      crm_inquiry_id, customer_id, source_text, parsed_spec_json, quote_input_json,
      quote_result_json, calculation_table_json, source_message_ids_json, attachment_ids_json,
      crm_spec_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '{}', '{}', '[]', ?, ?, ?, 'internal_pre_quote', ?, ?)
  `).run(
    inquiryId,
    customerId,
    parsed.summary_cn || '',
    JSON.stringify(parsed),
    JSON.stringify([messageId]),
    JSON.stringify(attachmentIds),
    JSON.stringify(crmSpec),
    ts,
    ts
  ).lastInsertRowid);
}

function runSample(sample) {
  const customerId = insertCustomer(sample);
  let messageId;
  if (sample.source_type === 'email') {
    const emailId = insertEmailMessage(sample, customerId);
    const imported = importEmailToCrmMessage(db, emailId);
    messageId = imported.crm_message_id;
  } else {
    messageId = insertWhatsappMessage(sample, customerId);
  }
  const messageBefore = db.prepare('SELECT * FROM crm_messages WHERE id = ?').get(messageId);
  const attachments = normalizeCrmAttachments(db, messageBefore).attachments;
  assert.strictEqual(messageBefore.ai_status, 'pending', `${sample.key} should start pending AI`);
  assert(attachments.length >= sample.min_attachments, `${sample.key} should have attachments`);
  assert(buildCrmWorkbench(db).items.some((item) => item.type === 'message_pending_ai' && item.message_id === messageId), `${sample.key} should appear in pending AI queue`);

  const parsed = interpretCrmMessage(messageBefore, attachments);
  const ts = now();
  const interpretationId = Number(db.prepare(`
    INSERT INTO crm_ai_interpretations (message_id, customer_id, parsed_json, changed_fields_json, status, created_at, updated_at)
    VALUES (?, ?, ?, '[]', 'parsed', ?, ?)
  `).run(messageId, customerId, JSON.stringify(parsed), ts, ts).lastInsertRowid);
  db.prepare("UPDATE crm_messages SET ai_status = 'parsed', updated_at = ? WHERE id = ?").run(ts, messageId);
  assert(buildCrmWorkbench(db).items.some((item) => item.type === 'message_parsed_pending_inquiry' && item.message_id === messageId), `${sample.key} should appear in parsed pending inquiry queue`);

  sample.checkParsed(parsed, attachments);
  const { inquiryId, changedFields } = createOrUpdateInquiry(customerId, messageId, parsed, sample);
  assert(changedFields.length > 0, `${sample.key} should update inquiry fields`);
  assert(!buildCrmWorkbench(db).items.some((item) => item.type === 'message_parsed_pending_inquiry' && item.message_id === messageId), `${sample.key} should leave parsed pending inquiry queue`);

  const fatherTaskId = createFatherTask(customerId, inquiryId, messageId, interpretationId, parsed);
  assert.strictEqual(listFatherReviewTasks(db, { status: 'pending' }).rows.some((row) => row.id === fatherTaskId), true, `${sample.key} father task pending`);
  replyFatherTask(fatherTaskId, sample.father_reply);
  assert(buildCrmWorkbench(db).items.some((item) => item.type === 'father_done_pending_sales' && item.father_task_id === fatherTaskId), `${sample.key} should enter father done pending sales`);

  const costingDraftId = createCostingDraft(customerId, inquiryId, messageId, parsed);
  const draft = db.prepare('SELECT * FROM foreign_costing_drafts WHERE id = ?').get(costingDraftId);
  assert.strictEqual(draft.customer_id, customerId);
  assert.strictEqual(draft.crm_inquiry_id, inquiryId);
  assert.deepStrictEqual(JSON.parse(draft.source_message_ids_json), [messageId]);
  assert(JSON.parse(draft.crm_spec_json).ai_summary_cn, `${sample.key} draft should save CRM spec`);

  markFatherTaskSalesHandled(db, fatherTaskId, { sales_handled_by: 'acceptance', sales_note: '试运行验收已处理父亲意见。' });
  assert(!buildCrmWorkbench(db).items.some((item) => item.type === 'father_done_pending_sales' && item.father_task_id === fatherTaskId), `${sample.key} should leave father done pending sales after handled`);

  return { key: sample.key, customerId, messageId, inquiryId, interpretationId, fatherTaskId, costingDraftId, parsed };
}

try {
  initDb();
  const samples = [
    {
      key: 'coffee_whatsapp',
      source_type: 'whatsapp',
      company: 'Ajman Coffee Trading',
      country: 'UAE',
      priority: 'A',
      min_attachments: 2,
      text: `Hello, we need custom coffee bags with valve and zipper.
Size: 250g and 500g.
Material: matte finish, high barrier, maybe PET/VMPET/PE.
Quantity: 30,000 pcs each size.
Printing: 6 colors.
Destination: Ajman, UAE.
Can you quote FOB and CIF?
Also please check if you can make it with flat bottom pouch.`,
      attachments: [
        { file_name: 'coffee-bag.jpg', mime_type: 'image/jpeg', size: 12000 },
        { file_name: 'coffee-spec.pdf', mime_type: 'application/pdf', size: 45000 }
      ],
      father_reply: '咖啡袋可做，阀和拉链要确认位置，FOB/CIF 分开核算。',
      checkParsed(parsed, attachments) {
        assert.strictEqual(parsed.product_type, 'coffee_bags');
        assert.strictEqual(parsed.destination_port, 'Ajman');
        assert.strictEqual(parsed.trade_term, 'FOB and CIF');
        assert(parsed.technical_requirements.includes('valve'));
        assert(parsed.technical_requirements.includes('zipper'));
        assert(attachments.every((item) => item.can_preview === false));
      }
    },
    {
      key: 'roll_email',
      source_type: 'email',
      company: 'Oman Food Packing',
      country: 'Oman',
      min_attachments: 0,
      subject: 'Printed roll film inquiry',
      text: 'We need printed roll film for automatic packing machine. Width 320mm. Material PET/PE. Quantity 500kg. Destination Oman.',
      attachments: [],
      father_reply: '卷膜按 PET/PE 方向，需确认印刷颜色、卷膜长度和贸易条款。',
      checkParsed(parsed) {
        assert.strictEqual(parsed.roll_or_bag, 'roll');
        assert.strictEqual(parsed.bag_type, 'auto_bag');
        assert.strictEqual(parsed.quantity_text, '500kg');
        assert.strictEqual(parsed.destination_country, 'Oman');
      }
    },
    {
      key: 'retort_whatsapp',
      source_type: 'whatsapp',
      company: 'Ready Meal Buyer',
      country: 'UAE',
      min_attachments: 0,
      text: 'Need retort pouch for ready meal, 121°C 30 minutes, PA/AL/RCPP, quantity 20,000 pcs, destination UAE.',
      attachments: [],
      father_reply: '蒸煮袋必须先技术确认，121°C 30min 按 PA/AL/RCPP 方向。',
      checkParsed(parsed) {
        assert.strictEqual(parsed.bag_type, 'retort_pouch');
        assert(parsed.technical_requirements.includes('retort'));
        assert(parsed.risk_flags.some((item) => /Retort|high-temperature/i.test(item)));
        assert.strictEqual(parsed.should_create_father_task, true);
      }
    },
    {
      key: 'multi_sku_whatsapp',
      source_type: 'whatsapp',
      company: 'Multi SKU Snacks',
      country: 'China',
      min_attachments: 0,
      text: 'We need stand up pouches for snacks, 100g 150x220mm 20000 pcs, 250g 180x260mm 15000 pcs, 3 artwork variants, matte PET/VMPET/PE, EXW China.',
      attachments: [],
      father_reply: '多规格多 artwork 需要分款核价，版费和损耗按 3 款分别确认。',
      checkParsed(parsed) {
        assert.strictEqual(parsed.bag_type, 'stand_zipper_bag');
        assert(parsed.quantity_text.includes('20000 pcs'), 'should keep first SKU quantity');
        assert(parsed.quantity_text.includes('15000 pcs'), 'should keep second SKU quantity');
        assert(parsed.risk_flags.some((item) => /SKU|artwork|variant|多款/i.test(item)), 'should flag multi-SKU/artwork risk');
      }
    },
    {
      key: 'tender_pdf_email',
      source_type: 'email',
      company: 'Tender Buyer',
      country: '',
      min_attachments: 1,
      subject: 'Tender for laminated film',
      text: 'Please check attached PDF tender for laminated film and advise.',
      attachments: [{ file_name: 'laminated-film-tender.pdf', mime_type: 'application/pdf', size: 98000 }],
      father_reply: '需要人工查看 PDF 招标文件，不能只按正文报价。',
      checkParsed(parsed, attachments) {
        assert(attachments.some((item) => item.attachment_type === 'pdf' && item.can_preview === false));
        assert(parsed.risk_flags.some((item) => /attachment|PDF|人工|manual/i.test(item)), 'should warn manual PDF review');
        assert(parsed.missing_information.includes('manual attachment review'), 'should require manual attachment review');
      }
    }
  ];

  const results = samples.map(runSample);
  const workbench = buildCrmWorkbench(db);
  assert.strictEqual(workbench.counts.father_tasks_done_pending_sales, 0, 'all father replies were marked handled');
  assert(workbench.counts.costing_drafts_pending_review >= 5, 'five costing drafts should wait for review');

  const serialized = JSON.stringify({ results, workbench });
  ['undefined', 'NaN', '[object Object]', '正式报价已确认', '已发送客户', '自动报价成功'].forEach((word) => {
    assert(!serialized.includes(word), `forbidden text: ${word}`);
  });

  console.log('CRM real workflow acceptance PASS');
  console.log(JSON.stringify({
    sample_count: results.length,
    final_counts: workbench.counts,
    results: results.map((item) => ({
      key: item.key,
      customer_id: item.customerId,
      message_id: item.messageId,
      inquiry_id: item.inquiryId,
      interpretation_id: item.interpretationId,
      father_task_id: item.fatherTaskId,
      costing_draft_id: item.costingDraftId,
      product_type: item.parsed.product_type,
      bag_type: item.parsed.bag_type,
      quantity_text: item.parsed.quantity_text,
      trade_term: item.parsed.trade_term
    }))
  }, null, 2));
} finally {
  db.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

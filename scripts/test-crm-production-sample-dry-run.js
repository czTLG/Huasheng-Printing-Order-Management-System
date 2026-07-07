const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const sourceDbPath = process.env.SOURCE_DB_PATH
  ? path.resolve(process.env.SOURCE_DB_PATH)
  : path.join(repoRoot, 'data', 'app.db');
if (!fs.existsSync(sourceDbPath)) {
  throw new Error(`source database not found: ${sourceDbPath}`);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-production-dry-run-'));
const dryRunDbPath = path.join(tmpRoot, 'app.db');
fs.copyFileSync(sourceDbPath, dryRunDbPath);
process.env.DB_PATH = dryRunDbPath;

const { db, initDb, now } = require('../src/db');
const { normalizeCrmAttachments } = require('../src/lib/crmAttachments');
const { importEmailToCrmMessage } = require('../src/lib/emailToCrmMessage');
const { buildCrmWorkbench, listFatherReviewTasks, markFatherTaskSalesHandled } = require('../src/lib/crmWorkbench');
const { interpretCrmMessage, buildInquiryFillPlan, deriveInquiryAiSummary } = require('../src/services/crmMessageInterpreter');

function parseIdList(flagName) {
  const prefix = `--${flagName}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  if (!arg) return [];
  return arg.slice(prefix.length).split(',').map((id) => Number(id.trim())).filter((id) => Number.isInteger(id) && id > 0);
}

function text(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function safeJson(value, fallback = []) {
  if (!text(value)) return fallback;
  try {
    const parsed = JSON.parse(String(value));
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

function tableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}

function customerDisplay(customerId) {
  if (!customerId) return '';
  const row = db.prepare(`
    SELECT COALESCE(NULLIF(company_name, ''), NULLIF(name, ''), NULLIF(contact_person, ''), '未命名客户') AS name
    FROM customers
    WHERE id = ?
  `).get(customerId);
  return row?.name || '';
}

function ensureCustomerForMessage(message, fallbackName) {
  if (message.customer_id) return Number(message.customer_id);
  const ts = now();
  const name = fallbackName || text(message.sender_name || message.sender_contact) || `Dry Run Customer ${message.id}`;
  const result = db.prepare(`
    INSERT INTO customers (name, company_name, contact, email, whatsapp, source_channel, priority, stage, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'C', 'dry_run_unlinked', 1, ?, ?)
  `).run(
    name,
    name,
    text(message.sender_name),
    message.source_type === 'email' ? text(message.sender_contact) : '',
    message.source_type === 'whatsapp' ? text(message.sender_contact) : '',
    message.source_type || 'unknown',
    ts,
    ts
  );
  const customerId = Number(result.lastInsertRowid);
  db.prepare('UPDATE crm_messages SET customer_id = ?, updated_at = ? WHERE id = ?').run(customerId, ts, message.id);
  db.prepare('UPDATE crm_message_attachments SET customer_id = ?, updated_at = ? WHERE message_id = ?').run(customerId, ts, message.id);
  return customerId;
}

function sourceMessageFromEmail(emailId) {
  const imported = importEmailToCrmMessage(db, emailId);
  const message = db.prepare('SELECT * FROM crm_messages WHERE id = ?').get(imported.crm_message_id);
  return { message, already_exists: imported.already_exists, original_email_id: emailId };
}

function sourceMessageFromCrm(messageId) {
  const message = db.prepare('SELECT * FROM crm_messages WHERE id = ?').get(messageId);
  if (!message) throw new Error(`crm message not found: ${messageId}`);
  return { message, already_exists: true, original_message_id: messageId };
}

function candidateSamples() {
  const explicitMessages = parseIdList('message-ids');
  const explicitEmails = parseIdList('email-ids');
  if (explicitMessages.length || explicitEmails.length) {
    return [
      ...explicitMessages.map((id) => ({ sample_name: `crm_message_${id}`, source: 'crm', id, reason: 'CLI 指定 CRM message_id' })),
      ...explicitEmails.map((id) => ({ sample_name: `email_message_${id}`, source: 'email', id, reason: 'CLI 指定 email_message_id' }))
    ];
  }

  const candidates = [
    { sample_name: 'Ferreno flat bottom pouch quotation follow-up', source: 'crm', id: 115, reason: '真实 WhatsApp，多 SKU / 平底袋 / 材料 / 尺寸 / 议价请求' },
    { sample_name: 'Barrier technical confirmation OTR WVTR', source: 'crm', id: 69, reason: '真实 WhatsApp，OTR/WVTR/阻隔技术确认' },
    { sample_name: 'Ferreno CIF multi-port logistics', source: 'crm', id: 120, reason: '真实 WhatsApp，CIF Ajman / UAQ / RAK / Abu Dhabi 物流条款' },
    { sample_name: 'Vexel chub film tender email', source: 'email', id: 38, reason: '真实 Email，tender / roll film / 图片附件 metadata' },
    { sample_name: 'Pannonbloom sachet PDF email', source: 'email', id: 50, reason: '真实 Email，sachet 项目，图片 + PDF 附件 metadata 且无 URL' }
  ];

  return candidates.filter((candidate) => {
    if (candidate.source === 'crm') {
      return !!db.prepare('SELECT id FROM crm_messages WHERE id = ?').get(candidate.id);
    }
    return !!db.prepare('SELECT id FROM email_messages WHERE id = ?').get(candidate.id);
  }).slice(0, 5);
}

function createOrUpdateInquiry(customerId, messageId, parsed, sampleName) {
  const ts = now();
  const existingMessage = db.prepare('SELECT * FROM crm_messages WHERE id = ?').get(messageId);
  const originalInquiryId = existingMessage?.inquiry_id ? Number(existingMessage.inquiry_id) : null;
  let inquiryId = originalInquiryId;

  if (!inquiryId) {
    const result = db.prepare(`
      INSERT INTO inquiries (customer_id, inquiry_title, status, priority, created_at, updated_at)
      VALUES (?, ?, 'dry_run', 'C', ?, ?)
    `).run(
      customerId,
      `${sampleName} - ${parsed.product_type || parsed.bag_type || 'CRM inquiry dry run'}`,
      ts,
      ts
    );
    inquiryId = Number(result.lastInsertRowid);
  }

  const before = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(inquiryId) || {};
  const plan = buildInquiryFillPlan(before, parsed);
  const fields = Object.keys(plan.updates);
  if (fields.length) {
    const sets = fields.map((field) => `${field} = ?`).join(', ');
    db.prepare(`UPDATE inquiries SET ${sets}, updated_at = ? WHERE id = ?`).run(
      ...fields.map((field) => plan.updates[field]),
      ts,
      inquiryId
    );
  }

  if (tableColumns('inquiries').includes('ai_summary_cn')) {
    db.prepare('UPDATE inquiries SET ai_summary_cn = COALESCE(NULLIF(ai_summary_cn, ""), ?), updated_at = ? WHERE id = ?')
      .run(deriveInquiryAiSummary(before, parsed), ts, inquiryId);
  }

  const changedFields = fields.map((field) => ({
    field,
    old_value: before[field] || '',
    new_value: plan.updates[field],
    source_message_id: messageId,
    changed_at: ts
  }));
  db.prepare("UPDATE crm_messages SET inquiry_id = ?, workflow_status = 'created_inquiry', updated_at = ? WHERE id = ?").run(inquiryId, ts, messageId);
  db.prepare('UPDATE crm_message_attachments SET inquiry_id = ?, updated_at = ? WHERE message_id = ?').run(inquiryId, ts, messageId);
  db.prepare('UPDATE crm_ai_interpretations SET inquiry_id = ?, changed_fields_json = ?, updated_at = ? WHERE message_id = ?')
    .run(inquiryId, JSON.stringify(changedFields), ts, messageId);
  db.prepare('UPDATE customers SET latest_inquiry_id = ?, updated_at = ? WHERE id = ?').run(inquiryId, ts, customerId);

  return { inquiryId, changedFields, skippedFields: plan.skipped_fields || [], originalInquiryId };
}

function createFatherTask(customerId, inquiryId, message, interpretationId, parsed, attachments) {
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
    message.id,
    interpretationId,
    parsed.father_task_type || 'general',
    parsed.question_for_father_cn || '请确认该客户需求是否可做，以及下一步核价边界。',
    parsed.summary_cn || '',
    message.message_text || '',
    JSON.stringify(attachmentIds),
    JSON.stringify(parsed.missing_information || []),
    ts,
    ts
  );
  return Number(result.lastInsertRowid);
}

function replyFatherTask(taskId) {
  const ts = now();
  db.prepare(`
    UPDATE crm_father_review_tasks
    SET father_reply_cn = ?, status = 'done', completed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    '【dry-run 模拟父亲回复】请按客户规格先做内部核价，材料结构、附件内容、物流条款和特殊工艺需业务员再次确认；不要直接给客户承诺价格或交期。',
    ts,
    ts,
    taskId
  );
}

function createCostingDraft(customerId, inquiryId, message, parsed, attachments) {
  const attachmentIds = attachments.map((item) => Number(item.id)).filter(Boolean);
  const ts = now();
  const crmSpec = {
    customer_id: customerId,
    inquiry_id: inquiryId,
    source_message_ids: [Number(message.id)],
    attachment_ids: attachmentIds,
    product_type: parsed.product_type,
    bag_type: parsed.bag_type,
    roll_or_bag: parsed.roll_or_bag,
    size_text: parsed.size_text,
    capacity_text: parsed.capacity_text,
    material_structure: parsed.material_structure,
    thickness_text: parsed.thickness_text,
    quantity_text: parsed.quantity_text,
    printing_colors: parsed.printing_colors,
    artwork_status: parsed.artwork_status,
    destination_country: parsed.destination_country,
    destination_port: parsed.destination_port,
    destination_text: parsed.destination_text,
    trade_term: parsed.trade_term,
    requested_quote_terms: parsed.requested_quote_terms,
    technical_requirements: parsed.technical_requirements,
    missing_information: parsed.missing_information,
    risk_flags: parsed.risk_flags,
    ai_summary_cn: parsed.summary_cn,
    status_note: 'internal_pre_quote; dry-run only; must be reviewed by Chen Yongjie'
  };
  const result = db.prepare(`
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
    JSON.stringify([Number(message.id)]),
    JSON.stringify(attachmentIds),
    JSON.stringify(crmSpec),
    ts,
    ts
  );
  return Number(result.lastInsertRowid);
}

function evaluateParsed(parsed, attachments) {
  const scoreParts = [
    parsed.summary_cn,
    parsed.product_type || parsed.bag_type || parsed.material_structure,
    parsed.missing_information?.length ? 'missing' : '',
    parsed.risk_flags?.length ? 'risk' : ''
  ].filter(Boolean).length;
  return {
    ai_summary_rating: parsed.summary_cn && parsed.summary_cn.length > 20 ? '好' : '一般',
    father_question_rating: parsed.question_for_father_cn && parsed.question_for_father_cn.length > 10 ? '一般' : '不可用',
    inquiry_overview_rating: scoreParts >= 3 ? '好' : '一般',
    draft_input_rating: (parsed.product_type || parsed.bag_type || parsed.material_structure || parsed.quantity_text) ? '一般' : '不可用',
    no_url_attachment_count: attachments.filter((item) => !item.can_preview && !item.can_download).length
  };
}

function forbiddenOutputCheck(value) {
  const serialized = JSON.stringify(value);
  ['undefined', 'NaN', '[object Object]', '正式报价已确认', '已发送客户', '自动报价成功'].forEach((term) => {
    assert(!serialized.includes(term), `forbidden output term found: ${term}`);
  });
}

function runSample(candidate) {
  const source = candidate.source === 'email' ? sourceMessageFromEmail(candidate.id) : sourceMessageFromCrm(candidate.id);
  let message = source.message;
  const customerId = ensureCustomerForMessage(message, candidate.sample_name);
  message = db.prepare('SELECT * FROM crm_messages WHERE id = ?').get(message.id);
  const attachments = normalizeCrmAttachments(db, message).attachments;

  const beforeWorkbench = buildCrmWorkbench(db);
  const appearedInWorkbench = beforeWorkbench.items.some((item) => item.message_id === Number(message.id));

  const parsed = interpretCrmMessage(message, attachments);
  const ts = now();
  const interpretationId = Number(db.prepare(`
    INSERT INTO crm_ai_interpretations (message_id, customer_id, provider, parsed_json, changed_fields_json, status, created_by, created_at, updated_at)
    VALUES (?, ?, 'rule_based', ?, '[]', 'parsed', 'dry_run', ?, ?)
  `).run(message.id, customerId, JSON.stringify(parsed), ts, ts).lastInsertRowid);
  db.prepare("UPDATE crm_messages SET ai_status = 'parsed', updated_at = ? WHERE id = ?").run(ts, message.id);

  const { inquiryId, changedFields, skippedFields, originalInquiryId } = createOrUpdateInquiry(customerId, message.id, parsed, candidate.sample_name);
  const fatherTaskId = createFatherTask(customerId, inquiryId, message, interpretationId, parsed, attachments);
  const pendingShown = listFatherReviewTasks(db, { status: 'pending' }).rows.some((row) => Number(row.id) === fatherTaskId);
  replyFatherTask(fatherTaskId);
  const doneShown = buildCrmWorkbench(db).items.some((item) => item.type === 'father_done_pending_sales' && Number(item.father_task_id) === fatherTaskId);
  const costingDraftId = createCostingDraft(customerId, inquiryId, message, parsed, attachments);
  const draft = db.prepare('SELECT * FROM foreign_costing_drafts WHERE id = ?').get(costingDraftId);
  assert.strictEqual(Number(draft.customer_id), customerId);
  assert.strictEqual(Number(draft.crm_inquiry_id), Number(inquiryId));
  assert.deepStrictEqual(safeJson(draft.source_message_ids_json, []), [Number(message.id)]);
  assert.strictEqual(draft.status, 'internal_pre_quote');

  markFatherTaskSalesHandled(db, fatherTaskId, { sales_handled_by: 'dry_run', sales_note: 'dry-run marked handled after father reply visibility check' });
  const afterHandledShown = buildCrmWorkbench(db).items.some((item) => item.type === 'father_done_pending_sales' && Number(item.father_task_id) === fatherTaskId);
  assert.strictEqual(afterHandledShown, false, `${candidate.sample_name} should leave father done pending sales after handled`);

  const evaluation = evaluateParsed(parsed, attachments);
  const result = {
    sample_name: candidate.sample_name,
    reason: candidate.reason,
    source_type: message.source_type,
    original_message_id: candidate.source === 'crm' ? candidate.id : null,
    original_email_id: candidate.source === 'email' ? candidate.id : null,
    copied_test_message_id: Number(message.id),
    customer_id: customerId,
    customer_name: customerDisplay(customerId),
    inquiry_id: Number(inquiryId),
    had_existing_inquiry: Boolean(originalInquiryId),
    attachment_count: attachments.length,
    no_url_attachment_count: evaluation.no_url_attachment_count,
    attachment_types: attachments.map((item) => item.attachment_type),
    appeared_in_workbench_before_parse: appearedInWorkbench,
    interpretation_id: interpretationId,
    father_task_id: fatherTaskId,
    father_task_pending_visible: pendingShown,
    father_done_pending_sales_visible_before_handled: doneShown,
    costing_draft_id: costingDraftId,
    costing_draft_linked: Boolean(draft.customer_id && draft.crm_inquiry_id && draft.crm_spec_json),
    parsed_summary: {
      message_type: parsed.message_type,
      summary_cn: parsed.summary_cn,
      product_type: parsed.product_type,
      bag_type: parsed.bag_type,
      roll_or_bag: parsed.roll_or_bag,
      size_text: parsed.size_text,
      capacity_text: parsed.capacity_text,
      material_structure: parsed.material_structure,
      thickness_text: parsed.thickness_text,
      quantity_text: parsed.quantity_text,
      printing_colors: parsed.printing_colors,
      destination_country: parsed.destination_country,
      destination_port: parsed.destination_port,
      trade_term: parsed.trade_term,
      technical_requirements: parsed.technical_requirements,
      missing_information: parsed.missing_information,
      risk_flags: parsed.risk_flags,
      question_for_father_cn: parsed.question_for_father_cn
    },
    changed_fields: changedFields,
    skipped_fields: skippedFields,
    ratings: {
      ai_summary: evaluation.ai_summary_rating,
      father_question: evaluation.father_question_rating,
      inquiry_overview: evaluation.inquiry_overview_rating,
      costing_draft_input: evaluation.draft_input_rating
    }
  };
  assert.notStrictEqual(result.ratings.father_question, '不可用', `${candidate.sample_name} father question should be usable`);
  if (/OTR|WVTR|barrier/i.test(message.message_text || '')) {
    assert(
      result.parsed_summary.risk_flags.some((flag) => /barrier|technical|OTR|WVTR/i.test(flag)),
      `${candidate.sample_name} should keep barrier technical risk`
    );
  }
  if (/packaging materials|your technical questions/i.test(result.parsed_summary.material_structure || result.parsed_summary.product_type || '')) {
    throw new Error(`${candidate.sample_name} should not treat generic packaging-materials sentence as material structure`);
  }
  forbiddenOutputCheck(result);
  return result;
}

function main() {
  initDb();
  const candidates = candidateSamples();
  assert(candidates.length >= 3, `expected at least 3 production samples, found ${candidates.length}`);
  const results = candidates.map(runSample);
  const counts = buildCrmWorkbench(db).counts;
  const report = {
    dry_run: true,
    source_db_path: sourceDbPath,
    dry_run_db_path: dryRunDbPath,
    sample_count: results.length,
    samples: results,
    final_workbench_counts: counts,
    notes: [
      'All writes were made to a temporary copied database, not to production data/app.db.',
      'No customer-facing message was sent.',
      'No OCR, PDF extraction or image recognition was performed.'
    ]
  };
  forbiddenOutputCheck(report);
  console.log('CRM production sample dry-run PASS');
  console.log(JSON.stringify(report, null, 2));
}

main();

const { now } = require('../db');
const { normalizeCrmAttachments } = require('../lib/crmAttachments');

function text(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function idValue(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function safeJson(value, fallback = {}) {
  if (!text(value)) return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function parseArray(value) {
  const parsed = safeJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

function customerDisplay(row = {}) {
  return text(row.company_name || row.name || row.contact_person || row.display_name || '客户');
}

function hydrateDraft(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    risk_flags: parseArray(row.risk_flags_json),
    missing_info: parseArray(row.missing_info_json),
    referenced_attachment_ids: parseArray(row.referenced_attachment_ids_json),
    crm_context: safeJson(row.crm_context_json, {})
  };
}

function latestInterpretation(db, where, id) {
  return db.prepare(`
    SELECT *
    FROM crm_ai_interpretations
    WHERE ${where} = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get(id) || null;
}

function latestFatherTask(db, inquiryId, messageId) {
  if (inquiryId) {
    const byInquiry = db.prepare(`
      SELECT *
      FROM crm_father_review_tasks
      WHERE inquiry_id = ?
      ORDER BY CASE WHEN status = 'done' THEN 0 ELSE 1 END, updated_at DESC, id DESC
      LIMIT 1
    `).get(inquiryId);
    if (byInquiry) return byInquiry;
  }
  if (messageId) {
    return db.prepare(`
      SELECT *
      FROM crm_father_review_tasks
      WHERE source_message_id = ?
      ORDER BY CASE WHEN status = 'done' THEN 0 ELSE 1 END, updated_at DESC, id DESC
      LIMIT 1
    `).get(messageId) || null;
  }
  return null;
}

function latestCostingDraft(db, inquiryId, customerId) {
  if (inquiryId) {
    const byInquiry = db.prepare(`
      SELECT *
      FROM foreign_costing_drafts
      WHERE crm_inquiry_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `).get(inquiryId);
    if (byInquiry) return byInquiry;
  }
  if (customerId) {
    return db.prepare(`
      SELECT *
      FROM foreign_costing_drafts
      WHERE customer_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `).get(customerId) || null;
  }
  return null;
}

function normalizeContextFromMessage(db, message) {
  if (!message) throw new Error('message not found');
  const customer = message.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(message.customer_id) : null;
  const inquiry = message.inquiry_id ? db.prepare('SELECT * FROM inquiries WHERE id = ?').get(message.inquiry_id) : null;
  const interpretation = latestInterpretation(db, 'message_id', message.id);
  const fatherTask = latestFatherTask(db, message.inquiry_id, message.id);
  const costingDraft = latestCostingDraft(db, message.inquiry_id, message.customer_id);
  const attachments = normalizeCrmAttachments(db, message).attachments;
  return { customer, inquiry, message, interpretation, father_task: fatherTask, costing_draft: costingDraft, attachments };
}

function buildReplyDraftContext(db, params = {}) {
  const source = text(params.source || '');
  if (source === 'father_task') {
    const taskId = idValue(params.father_task_id);
    const task = db.prepare('SELECT * FROM crm_father_review_tasks WHERE id = ?').get(taskId);
    if (!task) throw new Error('father task not found');
    const message = task.source_message_id ? db.prepare('SELECT * FROM crm_messages WHERE id = ?').get(task.source_message_id) : null;
    const base = message
      ? normalizeContextFromMessage(db, message)
      : {
          customer: task.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(task.customer_id) : null,
          inquiry: task.inquiry_id ? db.prepare('SELECT * FROM inquiries WHERE id = ?').get(task.inquiry_id) : null,
          message: null,
          interpretation: task.interpretation_id ? db.prepare('SELECT * FROM crm_ai_interpretations WHERE id = ?').get(task.interpretation_id) : null,
          costing_draft: latestCostingDraft(db, task.inquiry_id, task.customer_id),
          attachments: []
        };
    return { ...base, father_task: task, source: 'father_task' };
  }
  if (source === 'inquiry') {
    const inquiryId = idValue(params.inquiry_id);
    const inquiry = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(inquiryId);
    if (!inquiry) throw new Error('inquiry not found');
    const message = db.prepare(`
      SELECT *
      FROM crm_messages
      WHERE inquiry_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `).get(inquiryId) || null;
    const customer = inquiry.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(inquiry.customer_id) : null;
    const interpretation = latestInterpretation(db, 'inquiry_id', inquiryId);
    const fatherTask = latestFatherTask(db, inquiryId, message?.id || 0);
    const costingDraft = latestCostingDraft(db, inquiryId, inquiry.customer_id);
    const attachments = message ? normalizeCrmAttachments(db, message).attachments : [];
    return { customer, inquiry, message, interpretation, father_task: fatherTask, costing_draft: costingDraft, attachments, source: 'inquiry' };
  }
  const messageId = idValue(params.message_id);
  return { ...normalizeContextFromMessage(db, db.prepare('SELECT * FROM crm_messages WHERE id = ?').get(messageId)), source: 'message' };
}

function parsedFromContext(context = {}) {
  return safeJson(context.interpretation?.parsed_json, {});
}

function inquiryMissingInfo(inquiry = {}) {
  return parseArray(inquiry?.missing_info);
}

function inquiryRiskFlags(inquiry = {}) {
  return parseArray(inquiry?.technical_risks).concat(parseArray(inquiry?.commercial_risks));
}

function collectMissingInfo(context = {}) {
  const parsed = parsedFromContext(context);
  const values = []
    .concat(Array.isArray(parsed.missing_information) ? parsed.missing_information : [])
    .concat(inquiryMissingInfo(context.inquiry))
    .concat(parseArray(context.father_task?.required_fields_json));
  return Array.from(new Set(values.map(text).filter(Boolean)));
}

function collectRiskFlags(context = {}) {
  const parsed = parsedFromContext(context);
  const values = []
    .concat(Array.isArray(parsed.risk_flags) ? parsed.risk_flags : [])
    .concat(inquiryRiskFlags(context.inquiry));
  if (context.costing_draft && ['blocked', 'internal_estimate', 'internal_pre_quote', 'draft', 'pending_review'].includes(text(context.costing_draft.status))) {
    values.push('Costing draft is not approved and must be reviewed before customer quotation.');
  }
  return Array.from(new Set(values.map(text).filter(Boolean)));
}

function isLogisticsFollowup(context = {}) {
  const parsed = parsedFromContext(context);
  const hasProduct = !!(text(parsed.product_type) || text(parsed.bag_type) || text(context.inquiry?.product_type) || text(context.inquiry?.packaging_type));
  const hasLogistics = parsed.message_type === 'logistics_question'
    || /\b(CIF|FOB|DDP|DAP|freight|customs|Ajman|Karachi|Oman|port)\b/i.test(text(context.message?.message_text));
  return hasLogistics && !hasProduct;
}

function templateLinesForContext(context = {}, options = {}) {
  const parsed = parsedFromContext(context);
  const missing = collectMissingInfo(context);
  const risks = collectRiskFlags(context);
  const fatherReply = text(context.father_task?.father_reply_cn);
  const costingStatus = text(context.costing_draft?.status);
  const messageText = text(context.message?.message_text);
  const logistics = isLogisticsFollowup(context);
  const hasPdf = (context.attachments || []).some((item) => item.attachment_type === 'pdf');
  const isNegotiation = /too high|target price|reduce price|discount|better price|价格/i.test(messageText);
  const technical = /OTR|WVTR|barrier|retort|121|compliance|FDA|EU|structure|material/i.test(messageText) || risks.some((item) => /OTR|WVTR|barrier|retort|compliance|technical/i.test(item));
  const customerName = customerDisplay(context.customer || {});

  const lines = [`Dear ${customerName === '客户' ? 'Customer' : customerName},`, '', 'Thank you for your message.'];

  if (hasPdf) {
    lines.push('We have received the attachment. Our team will review the technical and compliance requirements carefully before confirming feasibility or quotation.');
  }

  if (logistics) {
    lines.push('We can check the shipping options, including FOB and CIF if needed. Please confirm the final destination port and the estimated shipment quantity, carton details, gross weight and volume so we can check freight cost more accurately.');
  } else if (isNegotiation) {
    lines.push('We understand your target price. The final price depends on material structure, thickness, printing, quantity and accessories. We can review whether there is a more cost-effective structure, but we do not want to reduce quality without confirming the packaging requirement.');
  } else if (technical) {
    lines.push('Based on the information provided, we need to review the material structure and test requirements carefully. We do not want to confirm a barrier value, retort condition, compliance result or technical performance before checking the exact structure and testing method.');
  } else if (fatherReply) {
    lines.push('We have checked the basic requirements internally. This item should be reviewed further before final quotation, and we still need to confirm the details below.');
  } else {
    lines.push('To prepare an accurate quotation, could you please help confirm the key details below?');
  }

  if (['blocked', 'internal_estimate', 'internal_pre_quote'].includes(costingStatus)) {
    lines.push('We are reviewing the cost internally based on your specifications. Once the material structure, quantity and shipping terms are confirmed, we will send you a formal quotation.');
  }

  if (missing.length) {
    lines.push('', 'Please help confirm:', ...missing.slice(0, 8).map((item) => `- ${item}`));
  } else {
    lines.push('', 'Please let us know if any technical specification, artwork, quantity or delivery term has changed.');
  }

  if (risks.length) {
    lines.push('', 'For safety, we will confirm the technical and commercial details internally before making any final commitment.');
  }

  lines.push('', 'Best regards,', 'Huasheng Packaging');
  return lines;
}

function sanitizeReplyDraft(textValue) {
  let output = text(textValue);
  [
    /formal quotation is confirmed/gi,
    /final price is\s*[:：]?\s*[^.\n]+/gi,
    /guaranteed lead time[^.\n]*/gi,
    /FDA approved/gi,
    /we have sent[^.\n]*quotation/gi,
    /automatic quote/gi
  ].forEach((pattern) => {
    output = output.replace(pattern, '');
  });
  output = output.replace(/\bUSD\s*\d+(?:\.\d+)?\b/gi, 'the price');
  return output.replace(/\n{3,}/g, '\n\n').trim();
}

function validateReplyDraftSafety(draftText) {
  const lower = text(draftText).toLowerCase();
  const unsafe = [
    'formal quotation is confirmed',
    'automatic quote',
    'guaranteed lead time',
    'fda approved',
    'final price is'
  ].filter((phrase) => lower.includes(phrase));
  if (/\busd\s*\d+(?:\.\d+)?\b/i.test(draftText)) unsafe.push('invented price');
  if (unsafe.length) throw new Error(`unsafe reply draft: ${unsafe.join(', ')}`);
  return true;
}

function buildDraftSummaryCn(context = {}, missing = [], risks = []) {
  const parsed = parsedFromContext(context);
  const parts = [];
  if (parsed.summary_cn) parts.push(parsed.summary_cn);
  if (context.father_task?.father_reply_cn) parts.push(`父亲意见：${context.father_task.father_reply_cn}`);
  if (missing.length) parts.push(`需客户确认：${missing.slice(0, 5).join('、')}`);
  if (risks.length) parts.push(`风险：${risks.slice(0, 3).join('；')}`);
  return parts.join('\n') || '根据 CRM 上下文生成客户回复草稿。';
}

function contextSnapshot(context = {}, missing = [], risks = []) {
  const parsed = parsedFromContext(context);
  return {
    source: context.source || '',
    customer: context.customer ? { id: context.customer.id, name: customerDisplay(context.customer), country: context.customer.country || '' } : null,
    inquiry: context.inquiry ? {
      id: context.inquiry.id,
      title: context.inquiry.inquiry_title || '',
      product_type: context.inquiry.product_type || '',
      packaging_type: context.inquiry.packaging_type || '',
      quantity: context.inquiry.quantity || '',
      trade_term_requested: context.inquiry.trade_term_requested || ''
    } : null,
    message: context.message ? {
      id: context.message.id,
      source_type: context.message.source_type,
      direction: context.message.direction,
      subject: context.message.message_subject || '',
      text_preview: text(context.message.message_text).slice(0, 500)
    } : null,
    interpretation: parsed,
    father_task: context.father_task ? {
      id: context.father_task.id,
      status: context.father_task.status,
      question_cn: context.father_task.question_cn,
      father_reply_cn: context.father_task.father_reply_cn || ''
    } : null,
    costing_draft: context.costing_draft ? {
      id: context.costing_draft.id,
      status: context.costing_draft.status
    } : null,
    missing_information: missing,
    risk_flags: risks,
    attachments: (context.attachments || []).map((item) => ({
      id: item.id,
      type: item.attachment_type,
      name: item.original_file_name,
      can_preview: item.can_preview,
      can_download: item.can_download
    })),
    is_logistics_followup: isLogisticsFollowup(context)
  };
}

function insertDraft(db, context, draft, options = {}) {
  const missing = collectMissingInfo(context);
  const risks = collectRiskFlags(context);
  const snapshot = contextSnapshot(context, missing, risks);
  const ts = now();
  const channel = text(options.reply_channel || (context.message?.source_type === 'email' ? 'email' : 'whatsapp')) || 'whatsapp';
  const result = db.prepare(`
    INSERT INTO crm_reply_drafts (
      customer_id, inquiry_id, source_message_id, source_interpretation_id, father_task_id,
      costing_draft_id, source_type, reply_channel, recipient_contact, email_subject,
      draft_text_en, draft_text_cn, draft_summary_cn, generation_method, tone, status,
      risk_flags_json, missing_info_json, referenced_attachment_ids_json, crm_context_json,
      created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    context.customer?.id || null,
    context.inquiry?.id || null,
    context.message?.id || null,
    context.interpretation?.id || null,
    context.father_task?.id || null,
    context.costing_draft?.id || null,
    context.message?.source_type || channel || 'manual',
    channel,
    channel === 'email' ? text(context.message?.sender_contact) : text(context.message?.sender_contact || context.customer?.whatsapp || context.customer?.phone),
    channel === 'email' ? `Re: ${text(context.message?.message_subject || context.message?.raw_payload_json?.subject || context.inquiry?.inquiry_title || '')}`.trim() : '',
    draft.draft_text_en,
    draft.draft_text_cn || '',
    draft.draft_summary_cn,
    draft.generation_method || 'rule_based',
    text(options.tone || 'professional'),
    JSON.stringify(risks),
    JSON.stringify(missing),
    JSON.stringify((context.attachments || []).map((item) => item.id).filter(Boolean)),
    JSON.stringify(snapshot),
    text(options.created_by || 'system'),
    text(options.created_by || 'system'),
    ts,
    ts
  );
  return getReplyDraft(db, Number(result.lastInsertRowid));
}

function generateTemplateReplyDraft(context = {}, options = {}) {
  const missing = collectMissingInfo(context);
  const risks = collectRiskFlags(context);
  const draftText = sanitizeReplyDraft(templateLinesForContext(context, options).join('\n'));
  validateReplyDraftSafety(draftText);
  return {
    draft_text_en: draftText,
    draft_text_cn: buildDraftSummaryCn(context, missing, risks),
    draft_summary_cn: buildDraftSummaryCn(context, missing, risks),
    generation_method: 'rule_based'
  };
}

function generateReplyDraft(db, params = {}) {
  const context = buildReplyDraftContext(db, params);
  const draft = generateTemplateReplyDraft(context, params);
  return insertDraft(db, context, draft, params);
}

function getReplyDraft(db, id) {
  return hydrateDraft(db.prepare(`
    SELECT d.*
    FROM crm_reply_drafts d
    WHERE d.id = ?
  `).get(idValue(id)));
}

function listReplyDrafts(db, filters = {}) {
  const params = [];
  let where = 'WHERE 1 = 1';
  ['status', 'source_type', 'reply_channel'].forEach((field) => {
    if (!text(filters[field])) return;
    where += ` AND d.${field} = ?`;
    params.push(text(filters[field]));
  });
  ['customer_id', 'inquiry_id', 'source_message_id', 'father_task_id', 'costing_draft_id'].forEach((field) => {
    const id = idValue(filters[field]);
    if (!id) return;
    where += ` AND d.${field} = ?`;
    params.push(id);
  });
  const rows = db.prepare(`
    SELECT
      d.*,
      COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), NULLIF(c.contact_person, ''), '未匹配客户') AS customer_display_name,
      i.inquiry_title
    FROM crm_reply_drafts d
    LEFT JOIN customers c ON c.id = d.customer_id
    LEFT JOIN inquiries i ON i.id = d.inquiry_id
    ${where}
    ORDER BY d.updated_at DESC, d.id DESC
    LIMIT 300
  `).all(...params).map(hydrateDraft);
  return { rows };
}

function updateReplyDraft(db, id, payload = {}) {
  const draftId = idValue(id);
  const draft = getReplyDraft(db, draftId);
  if (!draft) throw new Error('reply draft not found');
  const allowed = ['draft_text_en', 'draft_text_cn', 'tone', 'status', 'updated_by'];
  const updates = {};
  allowed.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) updates[field] = payload[field];
  });
  if (updates.draft_text_en) {
    updates.draft_text_en = sanitizeReplyDraft(updates.draft_text_en);
    validateReplyDraftSafety(updates.draft_text_en);
  }
  if (!Object.keys(updates).length) return draft;
  const fields = Object.keys(updates);
  const sets = fields.map((field) => `${field} = ?`);
  sets.push('updated_at = ?');
  db.prepare(`UPDATE crm_reply_drafts SET ${sets.join(', ')} WHERE id = ?`)
    .run(...fields.map((field) => updates[field]), now(), draftId);
  return getReplyDraft(db, draftId);
}

function approveReplyDraft(db, id, payload = {}) {
  const draftId = idValue(id);
  const draft = getReplyDraft(db, draftId);
  if (!draft) throw new Error('reply draft not found');
  const ts = now();
  db.prepare(`
    UPDATE crm_reply_drafts
    SET status = 'approved', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?
    WHERE id = ?
  `).run(text(payload.approved_by || payload.updated_by || 'system'), ts, text(payload.updated_by || payload.approved_by || 'system'), ts, draftId);
  return getReplyDraft(db, draftId);
}

function markReplyDraftSentManually(db, id, payload = {}) {
  const draftId = idValue(id);
  const draft = getReplyDraft(db, draftId);
  if (!draft) throw new Error('reply draft not found');
  const ts = now();
  db.prepare(`
    UPDATE crm_reply_drafts
    SET status = 'sent_manually', updated_by = ?, updated_at = ?
    WHERE id = ?
  `).run(text(payload.updated_by || 'system'), ts, draftId);
  return getReplyDraft(db, draftId);
}

module.exports = {
  approveReplyDraft,
  buildReplyDraftContext,
  collectMissingInfo,
  collectRiskFlags,
  generateReplyDraft,
  generateTemplateReplyDraft,
  getReplyDraft,
  isLogisticsFollowup,
  listReplyDrafts,
  markReplyDraftSentManually,
  sanitizeReplyDraft,
  updateReplyDraft,
  validateReplyDraftSafety
};

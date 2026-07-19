'use strict';

const { enqueueInboxJob } = require('../lib/matrixInboxStore');
const { interpretCrmMessage } = require('./crmMessageInterpreter');

const BAG_LABELS = Object.freeze({
  stand_zipper_bag: '自立拉链袋',
  flat_bottom_pouch: '八边封/平底袋',
  three_side_seal: '三边封袋',
  spout_pouch: '吸嘴袋',
  retort_pouch: '蒸煮袋',
  auto_bag: '卷膜'
});
const NOTIFICATION_CUTOFF = Date.parse('2026-07-01T00:00:00+08:00');

function text(value) {
  return String(value == null ? '' : value).trim();
}

function messageIds(value) {
  const raw = text(value);
  if (!raw) return [];
  const bracketed = raw.match(/<[^>]+>/g) || [];
  return Array.from(new Set((bracketed.length ? bracketed : [raw]).map(text).filter(Boolean)));
}

function uniqueMatch(rows, state) {
  if (rows.length === 1) {
    return {
      state,
      customerId: rows[0].matched_customer_id ? Number(rows[0].matched_customer_id) : null,
      inquiryId: rows[0].matched_inquiry_id ? Number(rows[0].matched_inquiry_id) : null
    };
  }
  if (rows.length > 1) return { state: 'needs_review', customerId: null, inquiryId: null };
  return null;
}

function correlateInbound(db, message) {
  if (message.matched_customer_id || message.matched_inquiry_id) {
    return {
      state: 'prelinked',
      customerId: message.matched_customer_id ? Number(message.matched_customer_id) : null,
      inquiryId: message.matched_inquiry_id ? Number(message.matched_inquiry_id) : null
    };
  }

  const refs = messageIds(`${text(message.in_reply_to)} ${text(message.references_header)}`);
  if (refs.length) {
    const placeholders = refs.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT matched_customer_id, matched_inquiry_id
      FROM email_messages
      WHERE direction = 'outbound' AND message_id IN (${placeholders})
      ORDER BY id DESC
    `).all(...refs);
    const matched = uniqueMatch(rows, 'exact_header');
    if (matched) return matched;
  }

  if (text(message.conversation_key) && text(message.contact_email)) {
    const rows = db.prepare(`
      SELECT matched_customer_id, matched_inquiry_id
      FROM email_messages
      WHERE direction = 'outbound'
        AND conversation_key = ?
        AND LOWER(contact_email) = LOWER(?)
      ORDER BY id DESC
    `).all(message.conversation_key, message.contact_email);
    const matched = uniqueMatch(rows, 'conversation_contact');
    if (matched) return matched;
  }

  if (text(message.normalized_subject) && text(message.contact_email)) {
    const rows = db.prepare(`
      SELECT matched_customer_id, matched_inquiry_id
      FROM email_messages
      WHERE direction = 'outbound'
        AND normalized_subject = ?
        AND LOWER(contact_email) = LOWER(?)
        AND datetime(COALESCE(received_at, created_at)) >= datetime('now', '-120 day')
      ORDER BY id DESC
    `).all(message.normalized_subject, message.contact_email);
    const matched = uniqueMatch(rows, 'subject_contact');
    if (matched) return matched;
  }

  return { state: 'needs_review', customerId: null, inquiryId: null };
}

function suggestedReplyCn(analysis) {
  const missing = Array.isArray(analysis?.missing_information) ? analysis.missing_information.filter(Boolean) : [];
  if (missing.length) return `感谢您提供信息。为了继续处理，请确认：${missing.join('、')}。`;
  return '感谢您提供详细信息。我们会先在内部复核要求，并尽快回复您。';
}

function localizedAnalysis(value) {
  const analysis = { ...(value || {}) };
  const label = BAG_LABELS[analysis.bag_type];
  if (label && analysis.summary_cn) {
    analysis.summary_cn = String(analysis.summary_cn).split(analysis.bag_type).join(label);
  }
  if (label) analysis.bag_type_cn = label;
  return analysis;
}

function classifyMessage(message, analysis = {}) {
  const source = `${text(message?.subject)}\n${text(message?.cleaned_text || message?.text_body)}`.toLowerCase();
  if (/huasheng packaging weekly website report|packaging system database backup|smtp sender verification|^生产开单通知/im.test(source)) return 'internal_report';
  const advertisingSignals = [
    /\bseo\b.{0,80}\b(?:service|ranking|traffic|backlink)/s,
    /\bwebsite\b.{0,80}\b(?:design|development|redesign|optimization)\b/s,
    /\bwhatsapp\b.{0,80}\b(?:marketing|campaign|bulk|promotion|leads?)\b/s,
    /\b(?:digital marketing|lead generation|guest post|domain authority)\b/,
    /\b(?:book a call|schedule a call)\b.{0,120}\b(?:seo|marketing|website|leads?)\b/s
  ];
  if (advertisingSignals.some(pattern => pattern.test(source))) return 'advertising';
  if (/\b(?:delivery|shipment|tracking|awb|waybill|courier|fedex|dhl|ups)\b/.test(source)) return 'delivery_notice';
  if (/\b(?:invoice|payment receipt|automatic reply|out of office|mail delivery subsystem|undeliverable)\b/.test(source)) return 'system_notice';
  if (/\b(?:raw material|machine|equipment|service provider|supplier)\b/.test(source) && !/\b(?:quote|quotation|price|need|require)\b/.test(source)) return 'supplier_service';
  return text(analysis.message_type) || 'customer_reply';
}

function lineTranslations(source, analysis) {
  const lines = String(source || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean).slice(0, 80);
  return lines.map((line) => {
    const lower = line.toLowerCase();
    const parts = [];
    if (/\b(?:hello|hi|dear)\b/.test(lower)) parts.push('问候');
    if (/\b(?:need|require|looking for|interested in)\b/.test(lower)) parts.push('客户说明产品需求');
    if (/\b(?:quote|quotation|price|cost)\b/.test(lower)) parts.push('客户请求报价');
    if (/\b(?:fob|exw|cif|cfr|ddp|dap)\b/.test(lower)) parts.push(`贸易条款：${(line.match(/\b(?:FOB|EXW|CIF|CFR|DDP|DAP)\b/gi) || []).join('、').toUpperCase()}`);
    const quantity = line.match(/\b[0-9][0-9,]*\s*(?:pcs|pieces|bags|pouches|kg|mt|tons?)\b/i)?.[0];
    if (quantity) parts.push(`数量：${quantity}`);
    if (/stand[ -]?up|zipper\s*pouch/i.test(line)) parts.push('袋型：自立拉链袋');
    if (/flat\s*bottom/i.test(line)) parts.push('袋型：八边封/平底袋');
    if (/spout\s*pouch/i.test(line)) parts.push('袋型：吸嘴袋');
    if (/roll\s*(?:film|stock)/i.test(line)) parts.push('产品：卷膜');
    if (/attach|image|photo|drawing|artwork|file/i.test(line)) parts.push('提到附件、图片或设计稿');
    if (/thank/i.test(lower)) parts.push('致谢');
    if (!parts.length) parts.push('此行需由智能翻译补充完整中文');
    return `${parts.join('；')}｜原文：${line}`;
  });
}

function triageFor(message, analysis, messageClass, { translationComplete = false } = {}) {
  const received = Date.parse(text(message.received_at || message.created_at));
  if (Number.isFinite(received) && received < NOTIFICATION_CUTOFF) {
    return { workflowState: 'historical_cutoff', deliveryState: 'suppressed', actionType: '' };
  }
  if (messageClass === 'advertising') {
    return { workflowState: 'filtered_advertising', deliveryState: 'suppressed', actionType: '' };
  }
  if (messageClass === 'internal_report') {
    return { workflowState: 'filtered_internal_report', deliveryState: 'suppressed', actionType: '' };
  }
  if (messageClass === 'quote_request' || analysis.should_create_father_task && analysis.father_task_type === 'quote') {
    return { workflowState: 'quote_required', deliveryState: translationComplete ? 'pending' : 'triage_hold', actionType: 'quote_review' };
  }
  if (['delivery_notice', 'system_notice', 'supplier_service'].includes(messageClass)) {
    return { workflowState: 'ready_archive', deliveryState: translationComplete ? 'pending' : 'triage_hold', actionType: 'archive_review' };
  }
  if (Array.isArray(analysis.missing_information) && analysis.missing_information.length) {
    return { workflowState: 'information_required', deliveryState: translationComplete ? 'pending' : 'triage_hold', actionType: 'missing_information' };
  }
  return { workflowState: 'awaiting_reply', deliveryState: translationComplete ? 'pending' : 'triage_hold', actionType: 'reply_review' };
}

function upsertAction(db, jobId, actionType, analysis) {
  if (!actionType) return;
  const ts = new Date().toISOString();
  db.prepare(`
    INSERT INTO matrix_inbox_actions (job_id, action_type, state, payload_json, due_at, created_at, updated_at)
    VALUES (?, ?, 'pending', ?, ?, ?, ?)
    ON CONFLICT(job_id, action_type) DO UPDATE SET
      payload_json = excluded.payload_json, updated_at = excluded.updated_at
  `).run(jobId, actionType, JSON.stringify({
    summary_cn: text(analysis.summary_cn),
    missing_information: Array.isArray(analysis.missing_information) ? analysis.missing_information : [],
    quote_readiness: analysis.missing_information?.length ? 'needs_information' : 'ready_for_internal_review'
  }), ts, ts, ts);
}

function processInboundEmail(db, emailMessageId, { interpret = interpretCrmMessage } = {}) {
  const messageId = Number(emailMessageId);
  const message = db.prepare('SELECT * FROM email_messages WHERE id = ?').get(messageId);
  if (!message) throw new Error('email message not found');
  if (message.direction !== 'inbound') throw new Error('only inbound email may be processed');

  const queued = enqueueInboxJob(db, messageId);
  const correlation = correlateInbound(db, message);
  const existingJob = db.prepare('SELECT analysis_json, analysis_state FROM matrix_inbox_jobs WHERE id = ?').get(queued.id);
  let existingAnalysis = {};
  try { existingAnalysis = JSON.parse(existingJob?.analysis_json || '{}'); } catch (_) { existingAnalysis = {}; }
  let restoredBestAnalysis = false;
  const bestVersion = db.prepare(`
    SELECT analysis_json FROM matrix_inbox_analysis_versions
    WHERE job_id = ? ORDER BY quality_rank DESC, id DESC LIMIT 1
  `).get(queued.id);
  if (!queued.inserted && bestVersion?.analysis_json && bestVersion.analysis_json !== existingJob?.analysis_json) {
    let bestAnalysis = {};
    try { bestAnalysis = JSON.parse(bestVersion.analysis_json); } catch (_) { bestAnalysis = {}; }
    if (bestAnalysis.translation_state === 'complete') {
      const messageClass = text(bestAnalysis.message_class) || classifyMessage(message, bestAnalysis);
      const triage = triageFor(message, bestAnalysis, messageClass, { translationComplete: true });
      const ts = new Date().toISOString();
      db.transaction(() => {
        db.prepare(`
          UPDATE matrix_inbox_jobs
          SET analysis_json = ?, analysis_state = 'ready', message_class = ?, workflow_state = ?,
              last_error = NULL, updated_at = ?
          WHERE id = ?
        `).run(bestVersion.analysis_json, messageClass, triage.workflowState, ts, queued.id);
        db.prepare("DELETE FROM matrix_inbox_actions WHERE job_id = ? AND state = 'pending' AND action_type <> ?")
          .run(queued.id, triage.actionType || '');
        upsertAction(db, queued.id, triage.actionType, bestAnalysis);
      })();
      existingAnalysis = bestAnalysis;
      restoredBestAnalysis = true;
    }
  }
  if (!queued.inserted && existingJob?.analysis_state === 'ready' && existingAnalysis.translation_state === 'complete') {
    const ts = new Date().toISOString();
    db.transaction(() => {
      db.prepare(`
        UPDATE matrix_inbox_jobs
        SET correlation_state = ?, matched_customer_id = COALESCE(?, matched_customer_id),
            matched_inquiry_id = COALESCE(?, matched_inquiry_id), updated_at = ?
        WHERE id = ?
      `).run(correlation.state, correlation.customerId, correlation.inquiryId, ts, queued.id);
      if (correlation.customerId || correlation.inquiryId) {
        db.prepare(`
          UPDATE email_messages
          SET matched_customer_id = COALESCE(?, matched_customer_id),
              matched_inquiry_id = COALESCE(?, matched_inquiry_id), updated_at = ?
          WHERE id = ?
        `).run(correlation.customerId, correlation.inquiryId, ts, messageId);
      }
    })();
    return {
      job_id: queued.id, inserted: false, preserved_analysis: true, restored_best_analysis: restoredBestAnalysis,
      correlation_state: correlation.state,
      matched_customer_id: correlation.customerId,
      matched_inquiry_id: correlation.inquiryId
    };
  }
  const attachments = db.prepare(`
    SELECT id, original_file_name, detected_mime_type, file_size, availability_state
    FROM matrix_inbox_attachments
    WHERE email_message_id = ?
    ORDER BY media_order ASC
  `).all(messageId).map(row => ({
    ...row,
    attachment_type: String(row.detected_mime_type || '').startsWith('image/') ? 'image'
      : row.detected_mime_type === 'application/pdf' ? 'pdf' : 'other',
    mime_type: row.detected_mime_type
  }));

  try {
    const analysis = localizedAnalysis(interpret({
      id: message.id,
      message_text: message.cleaned_text || message.text_body || message.subject || '',
      direction: message.direction
    }, attachments));
    const safeAnalysis = {
      ...analysis,
      message_class: classifyMessage(message, analysis),
      line_translation_cn: [],
      translation_state: 'pending_ai',
      suggested_reply_cn: suggestedReplyCn(analysis)
    };
    const triage = triageFor(message, safeAnalysis, safeAnalysis.message_class);
    const ts = new Date().toISOString();
    db.transaction(() => {
      db.prepare(`
        UPDATE matrix_inbox_jobs
        SET correlation_state = ?, matched_customer_id = ?, matched_inquiry_id = ?,
            analysis_json = ?, analysis_state = 'ready', message_class = ?, workflow_state = ?,
            delivery_state = CASE WHEN delivery_state = 'delivered' THEN delivery_state ELSE ? END,
            last_error = NULL, updated_at = ?
        WHERE id = ?
      `).run(
        correlation.state, correlation.customerId, correlation.inquiryId,
        JSON.stringify(safeAnalysis), safeAnalysis.message_class, triage.workflowState,
        triage.deliveryState, ts, queued.id
      );
      db.prepare('DELETE FROM matrix_inbox_actions WHERE job_id = ? AND state = \'pending\' AND action_type <> ?').run(queued.id, triage.actionType || '');
      upsertAction(db, queued.id, triage.actionType, safeAnalysis);
      if (correlation.customerId || correlation.inquiryId) {
        db.prepare(`
          UPDATE email_messages
          SET matched_customer_id = COALESCE(?, matched_customer_id),
              matched_inquiry_id = COALESCE(?, matched_inquiry_id), updated_at = ?
          WHERE id = ?
        `).run(correlation.customerId, correlation.inquiryId, ts, messageId);
      }
    })();
  } catch (error) {
    db.prepare(`
      UPDATE matrix_inbox_jobs
      SET correlation_state = ?, matched_customer_id = ?, matched_inquiry_id = ?,
          analysis_state = 'failed', last_error = 'analysis_unavailable', updated_at = ?
      WHERE id = ?
    `).run(correlation.state, correlation.customerId, correlation.inquiryId, new Date().toISOString(), queued.id);
    throw error;
  }

  return {
    job_id: queued.id,
    inserted: queued.inserted,
    correlation_state: correlation.state,
    matched_customer_id: correlation.customerId,
    matched_inquiry_id: correlation.inquiryId
  };
}

module.exports = {
  correlateInbound, processInboundEmail, messageIds, suggestedReplyCn, localizedAnalysis,
  classifyMessage, lineTranslations, triageFor, upsertAction, NOTIFICATION_CUTOFF
};

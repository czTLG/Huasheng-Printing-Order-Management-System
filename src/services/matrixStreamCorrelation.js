'use strict';

const crypto = require('node:crypto');
const { createMatrixStreamText } = require('./matrixStreamText');
const { closeReplyCheck } = require('./matrixStreamFollowup');

const TERMINAL_KINDS = new Set(['reply', 'bounce', 'refusal', 'unsubscribe', 'manual_stop']);
const TRANSLATION_KEYS = [
  'translation_cn', 'requirements_cn', 'suggested_subject',
  'suggested_body_en', 'suggested_body_cn'
];

function cleanToken(value) {
  return String(value == null ? '' : value).normalize('NFKC').trim();
}

function normalizeMessageId(value) {
  const token = cleanToken(value).toLowerCase();
  if (!token) return '';
  const bracketed = token.match(/<[^<>\s]+>/)?.[0];
  return bracketed || (/^[^\s<>@]+@[^\s<>@]+$/.test(token) ? `<${token}>` : '');
}

function headerMessageIds(value) {
  const text = cleanToken(value).toLowerCase();
  const ids = text.match(/<[^<>\s]+>/g) || [];
  if (!ids.length) {
    const single = normalizeMessageId(text);
    if (single) ids.push(single);
  }
  return [...new Set(ids.map(normalizeMessageId).filter(Boolean))];
}

function emailAddresses(value) {
  const matches = cleanToken(value).toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+/g) || [];
  return [...new Set(matches)];
}

function normalizedSubject(value) {
  let result = cleanToken(value).toLowerCase();
  let prior;
  do {
    prior = result;
    result = result
      .replace(/^\s*(?:(?:re|fw|fwd)\s*:|(?:回复|答复|转发)\s*[:：])\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  } while (result !== prior);
  return result;
}

function clockIso(clock) {
  const value = typeof clock === 'function' ? clock() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('valid correlation clock required');
  return { ms: date.getTime(), iso: date.toISOString() };
}

function classifyKind(message) {
  const explicit = cleanToken(message.event_kind || message.kind).toLowerCase();
  if (explicit) {
    if (!TERMINAL_KINDS.has(explicit)) throw new Error('valid inbound event kind required');
    return explicit;
  }
  const subject = cleanToken(message.subject);
  const body = cleanToken(message.cleaned_text || message.text_body);
  const sender = emailAddresses(message.from_email)[0] || '';
  const source = `${subject}\n${body}`;
  if (/mailer-daemon|postmaster/i.test(sender)
      || /(?:delivery status notification|undeliverable|delivery failure|returned mail|mail delivery failed|投递失败|退信)/i.test(subject)) return 'bounce';
  if (/\b(?:unsubscribe me|please unsubscribe|remove me from (?:your|this) list|stop emailing me)\b|(?:请|烦请)?(?:取消订阅|退订|从名单中移除)/i.test(source)) return 'unsubscribe';
  if (/\b(?:not interested|no thank you|do not wish to proceed|we will pass)\b|(?:不感兴趣|暂不考虑|无需继续|不再推进)/i.test(source)) return 'refusal';
  return 'reply';
}

function safePreview(value, maximum = 800) {
  const redacted = cleanToken(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(?:password|passwd|secret|api[_ -]?key|access[_ -]?token|smtp[_ -]?(?:pass|password))\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/\b(?:internal[_ -]?(?:formula|cost)|private[_ -]?formula)\s*[:=]\s*\S+/gi, '$1=[redacted]');
  return [...redacted].slice(0, maximum).join('');
}

function linkResult(row) {
  if (!row) return null;
  if (row.status === 'matched') {
    return { status: 'matched', workItemId: row.work_item_id, jobId: row.job_id, kind: row.kind };
  }
  return { status: row.status };
}

function exactCandidates(db, message) {
  const ids = [...new Set([
    ...headerMessageIds(message.in_reply_to),
    ...headerMessageIds(message.references_header)
  ])];
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`
    SELECT j.*, v.recipient_email, v.subject
    FROM matrix_stream_jobs j
    JOIN matrix_stream_versions v ON v.id = j.version_id
    WHERE j.state = 'accepted' AND LOWER(j.message_id) IN (${placeholders})
    ORDER BY j.id DESC
  `).all(...ids);
}

function fallbackCandidates(db, message, context) {
  const from = emailAddresses(message.from_email);
  const to = new Set(emailAddresses([message.to_emails, message.cc_emails].filter(Boolean).join(',')));
  const subject = normalizedSubject(message.subject);
  if (from.length !== 1 || !to.size || !subject) return [];
  const earliest = new Date(context.ms - 120 * 86400000).toISOString();
  return db.prepare(`
    SELECT j.*, v.recipient_email, v.subject
    FROM matrix_stream_jobs j
    JOIN matrix_stream_versions v ON v.id = j.version_id
    WHERE j.state = 'accepted' AND j.updated_at >= ? AND j.updated_at <= ?
      AND LOWER(v.recipient_email) = ? AND LOWER(j.sender_email) IN (${[...to].map(() => '?').join(',')})
    ORDER BY j.updated_at DESC, j.id DESC
  `).all(earliest, context.iso, from[0], ...to)
    .filter(row => normalizedSubject(row.subject) === subject);
}

function eventKey(action, messageId) {
  return `inbound-${action}-${crypto.createHash('sha256').update(messageId).digest('hex')}`;
}

async function translationFor(message, options) {
  const translateInbound = options.translateInbound
    || createMatrixStreamText(options.textOptions || {}).translateInbound;
  try {
    const value = await translateInbound({
      inboundText: cleanToken(message.cleaned_text || message.text_body),
      publicEvidence: {}
    });
    if (value?.ok === false && value.reason === 'text_provider_unavailable') return { status: 'pending' };
    const keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : [];
    if (JSON.stringify(keys) !== JSON.stringify([...TRANSLATION_KEYS].sort())
        || TRANSLATION_KEYS.some(key => !cleanToken(value[key]))) return { status: 'pending' };
    return { status: 'ready', value };
  } catch (_) {
    return { status: 'pending' };
  }
}

function insertReviewEvent(db, messageId, candidates, context) {
  const first = candidates[0];
  db.prepare(`
    INSERT INTO matrix_stream_events (
      work_item_id, version_id, job_id, action, idempotency_key,
      before_json, after_json, diagnostic, created_at
    ) VALUES (?, ?, NULL, 'inbound_needs_review', ?, ?, ?, 'ambiguous_correlation', ?)
  `).run(first.work_item_id, first.version_id, eventKey('review', messageId),
    '{}', JSON.stringify({ candidate_job_ids: candidates.map(row => row.id) }), context.iso);
}

async function correlateInbound(db, emailMessage = {}, options = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('correlation database required');
  const messageId = normalizeMessageId(emailMessage.message_id);
  if (!messageId) throw new Error('valid inbound message id required');
  const prior = db.prepare('SELECT * FROM matrix_stream_inbound_links WHERE inbound_message_id = ?').get(messageId);
  if (prior) return linkResult(prior);

  const context = clockIso(options.clock);
  const exact = exactCandidates(db, emailMessage);
  const candidates = exact.length ? exact : fallbackCandidates(db, emailMessage, context);
  if (candidates.length !== 1) {
    const status = candidates.length > 1 ? 'needs_review' : 'unmatched';
    const transaction = db.transaction(() => {
      const replay = db.prepare('SELECT * FROM matrix_stream_inbound_links WHERE inbound_message_id = ?').get(messageId);
      if (replay) return linkResult(replay);
      if (status === 'needs_review') insertReviewEvent(db, messageId, candidates, context);
      db.prepare(`
        INSERT INTO matrix_stream_inbound_links (inbound_message_id, status, kind, work_item_id, job_id, created_at)
        VALUES (?, ?, '', NULL, NULL, ?)
      `).run(messageId, status, context.iso);
      return { status };
    });
    return transaction.immediate();
  }

  const job = candidates[0];
  const kind = classifyKind(emailMessage);
  const translation = ['reply', 'refusal'].includes(kind)
    ? await translationFor(emailMessage, options)
    : { status: 'pending' };
  const state = ({ reply: 'replied', bounce: 'bounced', refusal: 'refused', unsubscribe: 'suppressed', manual_stop: 'suppressed' })[kind];
  const transaction = db.transaction(() => {
    const replay = db.prepare('SELECT * FROM matrix_stream_inbound_links WHERE inbound_message_id = ?').get(messageId);
    if (replay) return linkResult(replay);
    const before = db.prepare('SELECT stream_state, version FROM matrix_work_items WHERE id = ?').get(job.work_item_id);
    if (!before) throw new Error('correlated work item missing');
    closeReplyCheck(db, { jobId: job.id, reason: kind === 'reply' ? 'reply' : kind, closedAt: context.iso });
    db.prepare(`
      UPDATE matrix_work_items SET stream_state = ?, version = version + 1, updated_at = ? WHERE id = ?
    `).run(state, context.iso, job.work_item_id);
    db.prepare(`
      INSERT INTO matrix_stream_inbound_links (inbound_message_id, status, kind, work_item_id, job_id, created_at)
      VALUES (?, 'matched', ?, ?, ?, ?)
    `).run(messageId, kind, job.work_item_id, job.id, context.iso);
    db.prepare(`
      INSERT INTO matrix_stream_events (
        work_item_id, version_id, job_id, action, idempotency_key,
        before_json, after_json, diagnostic, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?)
    `).run(job.work_item_id, job.version_id, job.id, `inbound_${kind}`,
      eventKey(kind, messageId), JSON.stringify({ stream_state: before.stream_state }),
      JSON.stringify({ stream_state: state, inbound_message_id: messageId }), context.iso);

    if (['reply', 'refusal'].includes(kind)) {
      const ready = translation.status === 'ready';
      const value = ready ? translation.value : {};
      db.prepare(`
        INSERT INTO matrix_stream_notification_spool (
          inbound_message_id, work_item_id, job_id, kind, original_preview,
          translation_status, translation_cn, requirements_cn, suggested_subject,
          suggested_body_en, suggested_body_cn, work_item_state, retry_available,
          delivery_state, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(messageId, job.work_item_id, job.id, kind,
        safePreview(emailMessage.cleaned_text || emailMessage.text_body, 800),
        ready ? 'ready' : 'pending',
        ready ? safePreview(value.translation_cn, 800) : '',
        ready ? safePreview(value.requirements_cn, 500) : '',
        ready ? safePreview(value.suggested_subject, 200) : '',
        ready ? safePreview(value.suggested_body_en, 1200) : '',
        ready ? safePreview(value.suggested_body_cn, 1200) : '',
        state, ready ? 0 : 1, context.iso);
    }
    return { status: 'matched', workItemId: job.work_item_id, jobId: job.id, kind };
  });
  return transaction.immediate();
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label} required`);
  return number;
}

function startReplyDraft(db, input = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('correlation database required');
  const actorUserId = positiveInteger(input.actorUserId, 'actor user id');
  const notificationId = positiveInteger(input.notificationId, 'notification id');
  const context = clockIso(input.clock);
  const transaction = db.transaction(() => {
    const row = db.prepare(`
      SELECT n.*, w.owner_user_id, w.stage, w.stream_state, j.version_id,
             v.recipient_email
      FROM matrix_stream_notification_spool n
      JOIN matrix_work_items w ON w.id = n.work_item_id
      JOIN matrix_stream_jobs j ON j.id = n.job_id
      JOIN matrix_stream_versions v ON v.id = j.version_id
      WHERE n.id = ?
    `).get(notificationId);
    if (!row) throw new Error('reply notification not found');
    const actor = db.prepare('SELECT id FROM users WHERE id = ? AND status = ?').get(actorUserId, 'active');
    if (!actor || row.owner_user_id !== actorUserId) throw new Error('reply draft not authorized');
    if (row.translation_status !== 'ready') throw new Error('reply draft translation pending');
    const result = { notification_id: notificationId, work_item_id: row.work_item_id, state: 'draft_pending' };
    if (row.reply_draft_id) {
      const existing = db.prepare('SELECT id, status FROM crm_reply_drafts WHERE id = ? AND matrix_work_item_id = ?').get(row.reply_draft_id, row.work_item_id);
      if (!existing || existing.status !== 'draft_pending') throw new Error('reply draft state conflict');
      return result;
    }
    const inserted = db.prepare(`
      INSERT INTO crm_reply_drafts (
        source_type, reply_channel, recipient_contact, email_subject,
        draft_text_en, draft_text_cn, draft_summary_cn, generation_method,
        status, missing_info_json, matrix_work_item_id, created_by, updated_by,
        created_at, updated_at
      ) VALUES ('matrix_stream_inbound', 'email', ?, ?, ?, ?, ?, ?, 'draft_pending', ?, ?, ?, ?, ?, ?)
    `).run(row.recipient_email, row.suggested_subject, row.suggested_body_en,
      row.suggested_body_cn, row.requirements_cn,
      'validated_provider', '[]',
      row.work_item_id, String(actorUserId), String(actorUserId), context.iso, context.iso);
    const replyDraftId = Number(inserted.lastInsertRowid);
    db.prepare('UPDATE matrix_stream_notification_spool SET reply_draft_id = ? WHERE id = ? AND reply_draft_id IS NULL')
      .run(replyDraftId, notificationId);
    db.prepare(`
      UPDATE matrix_work_items
      SET stage = 'draft_pending', next_action = 'review_reply_draft', version = version + 1, updated_at = ?
      WHERE id = ?
    `).run(context.iso, row.work_item_id);
    db.prepare(`
      INSERT INTO matrix_stream_events (
        work_item_id, version_id, job_id, actor_user_id, action, idempotency_key,
        before_json, after_json, diagnostic, created_at
      ) VALUES (?, ?, ?, ?, 'reply_draft_started', ?, ?, ?, '', ?)
    `).run(row.work_item_id, row.version_id, row.job_id, actorUserId,
      `reply-draft-notification-${notificationId}`,
      JSON.stringify({ stage: row.stage, stream_state: row.stream_state }),
      JSON.stringify({ stage: 'draft_pending', stream_state: row.stream_state, reply_draft_id: replyDraftId }),
      context.iso);
    return result;
  });
  return transaction.immediate();
}

async function retryInboundTranslation(db, input = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('correlation database required');
  const actorUserId = positiveInteger(input.actorUserId, 'actor user id');
  const notificationId = positiveInteger(input.notificationId, 'notification id');
  const context = clockIso(input.clock);
  const row = db.prepare(`
    SELECT n.*, w.owner_user_id
    FROM matrix_stream_notification_spool n
    JOIN matrix_work_items w ON w.id = n.work_item_id
    WHERE n.id = ?
  `).get(notificationId);
  const actor = db.prepare('SELECT id FROM users WHERE id = ? AND status = ?').get(actorUserId, 'active');
  if (!row) throw new Error('reply notification not found');
  if (!actor || row.owner_user_id !== actorUserId) throw new Error('translation retry not authorized');
  if (row.translation_status === 'ready') {
    return { notification_id: notificationId, translation_status: 'ready', retry_available: false };
  }
  const translation = await translationFor({ cleaned_text: row.original_preview }, input);
  if (translation.status !== 'ready') {
    return { notification_id: notificationId, translation_status: 'pending', retry_available: true };
  }
  const transaction = db.transaction(() => {
    const current = db.prepare(`
      SELECT n.*, w.owner_user_id
      FROM matrix_stream_notification_spool n
      JOIN matrix_work_items w ON w.id = n.work_item_id
      WHERE n.id = ?
    `).get(notificationId);
    if (!current || current.owner_user_id !== actorUserId) throw new Error('translation retry not authorized');
    if (current.translation_status === 'ready') {
      return { notification_id: notificationId, translation_status: 'ready', retry_available: false };
    }
    const value = translation.value;
    db.prepare(`
      UPDATE matrix_stream_notification_spool
      SET translation_status = 'ready', translation_cn = ?, requirements_cn = ?,
          suggested_subject = ?, suggested_body_en = ?, suggested_body_cn = ?, retry_available = 0
      WHERE id = ? AND translation_status = 'pending'
    `).run(safePreview(value.translation_cn, 800), safePreview(value.requirements_cn, 500),
      safePreview(value.suggested_subject, 200), safePreview(value.suggested_body_en, 1200),
      safePreview(value.suggested_body_cn, 1200), notificationId);
    db.prepare(`
      INSERT INTO matrix_stream_events (
        work_item_id, job_id, actor_user_id, action, idempotency_key,
        before_json, after_json, diagnostic, created_at
      ) VALUES (?, ?, ?, 'inbound_translation_ready', ?,
        '{"translation_status":"pending"}', '{"translation_status":"ready"}', '', ?)
    `).run(current.work_item_id, current.job_id, actorUserId,
      `inbound-translation-ready-${notificationId}`, context.iso);
    return { notification_id: notificationId, translation_status: 'ready', retry_available: false };
  });
  return transaction.immediate();
}

module.exports = {
  correlateInbound,
  startReplyDraft,
  retryInboundTranslation,
  classifyKind,
  normalizedSubject,
  normalizeMessageId,
  emailAddresses,
  safePreview
};

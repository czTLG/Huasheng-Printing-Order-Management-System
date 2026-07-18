'use strict';

const crypto = require('node:crypto');
const { createMatrixStreamText } = require('./matrixStreamText');
const { closeReplyCheck } = require('./matrixStreamFollowup');
const { redactSensitiveText } = require('../lib/safeText');

const TERMINAL_KINDS = new Set(['reply', 'bounce', 'refusal', 'unsubscribe', 'manual_stop']);
const TRANSLATION_KEYS = [
  'translation_cn', 'requirements_cn', 'suggested_subject',
  'suggested_body_en', 'suggested_body_cn'
];
const STATE_PRIORITY = new Map([
  ['selected', 0], ['sent', 0], ['replied', 10], ['refused', 20], ['bounced', 30], ['suppressed', 100]
]);

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

function authoredText(value) {
  const lines = String(value == null ? '' : value).replace(/\r\n?/g, '\n').split('\n');
  const kept = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(?:-{2,}\s*Original Message\s*-{2,}|_{5,}|On .+ wrote:|From:\s|Sent:\s|Subject:\s|发件人[:：]|发送时间[:：]|主题[:：])/i.test(trimmed)) break;
    if (/^--\s*$/.test(line) && kept.some(item => item.trim())) break;
    if (kept.some(item => item.trim()) && /^(?:best regards|kind regards|regards|sincerely)[,!]?$/i.test(trimmed)) break;
    if (kept.some(item => item.trim()) && /^(?:to unsubscribe|unsubscribe here|manage (?:email )?preferences|取消订阅|退订链接)/i.test(trimmed)) break;
    if (!/^\s*>/.test(line)) kept.push(line);
  }
  return kept.join('\n').trim();
}

function classifyKind(message) {
  const explicit = cleanToken(message.event_kind || message.kind).toLowerCase();
  if (explicit) {
    if (!TERMINAL_KINDS.has(explicit)) throw new Error('valid inbound event kind required');
    return explicit;
  }
  const subject = cleanToken(message.subject);
  const body = authoredText(message.cleaned_text || message.text_body);
  const sender = emailAddresses(message.from_email)[0] || '';
  const source = `${subject}\n${body}`;
  if (/mailer-daemon|postmaster/i.test(sender)
      || /(?:delivery status notification|undeliverable|delivery failure|returned mail|mail delivery failed|投递失败|退信)/i.test(subject)) return 'bounce';
  if (/\b(?:unsubscribe me|please unsubscribe|remove me from (?:your|this) list|stop emailing me)\b|(?:请|烦请)?(?:取消订阅|退订|从名单中移除)/i.test(source)) return 'unsubscribe';
  if (/\b(?:not interested|no thank you|do not wish to proceed|we will pass)\b|(?:不感兴趣|暂不考虑|无需继续|不再推进)/i.test(source)) return 'refusal';
  return 'reply';
}

function safePreview(value, maximum = 800) {
  const redacted = redactSensitiveText(value)
    .normalize('NFKC').trim()
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ');
  return [...redacted].slice(0, maximum).join('');
}

function linkResult(row) {
  if (!row) return null;
  if (row.status === 'matched') {
    return { status: 'matched', workItemId: row.work_item_id, jobId: row.job_id, kind: row.kind };
  }
  return { status: row.status };
}

function candidatesForMessageIds(db, ids) {
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

function exactCandidates(db, message) {
  const direct = candidatesForMessageIds(db, headerMessageIds(message.in_reply_to));
  if (direct.length) return direct;
  return candidatesForMessageIds(db, headerMessageIds(message.references_header));
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

function internalEventKey(db, logicalKey, createdAt) {
  const logical = String(logicalKey || '').trim();
  if (!logical) throw new Error('internal event logical key required');
  const existing = db.prepare('SELECT event_key FROM matrix_stream_internal_event_keys WHERE logical_key = ?').get(logical);
  if (existing) return existing.event_key;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const eventKey = `mx-internal-${crypto.randomUUID()}`;
    if (db.prepare('SELECT 1 FROM matrix_stream_events WHERE idempotency_key = ?').get(eventKey)) continue;
    try {
      db.prepare(`
        INSERT INTO matrix_stream_internal_event_keys (logical_key, event_key, created_at)
        VALUES (?, ?, ?)
      `).run(logical, eventKey, createdAt);
      return eventKey;
    } catch (error) {
      if (!/UNIQUE/.test(String(error?.message || ''))) throw error;
      const raced = db.prepare('SELECT event_key FROM matrix_stream_internal_event_keys WHERE logical_key = ?').get(logical);
      if (raced) return raced.event_key;
    }
  }
  throw new Error('internal event key reservation failed');
}

function activeOwnerBinding(db, actorUserId, bindingId, workItemId) {
  return db.prepare(`
    SELECT 1
    FROM matrix_actor_bindings b
    JOIN users u ON u.id = b.user_id
    JOIN matrix_work_items w ON w.id = ? AND w.owner_user_id = u.id
    WHERE b.id = ? AND b.user_id = ? AND b.status = 'active' AND u.status = 'active'
  `).get(workItemId, bindingId, actorUserId);
}

function requiredClaimInput(input) {
  return {
    actorUserId: positiveInteger(input.actorUserId, 'actor user id'),
    bindingId: positiveInteger(input.bindingId, 'actor binding id')
  };
}

function activeActorBinding(db, actorUserId, bindingId) {
  return db.prepare(`
    SELECT 1 FROM matrix_actor_bindings b
    JOIN users u ON u.id = b.user_id
    WHERE b.id = ? AND b.user_id = ? AND b.status = 'active' AND u.status = 'active'
  `).get(bindingId, actorUserId);
}

function claimProjection(row) {
  if (!row) return null;
  return {
    id: row.id,
    notification_key: row.notification_key,
    claim_token: row.owner_token,
    delivery_state: row.delivery_state,
    work_item_id: row.work_item_id,
    job_id: row.job_id,
    kind: row.kind,
    original_preview: row.original_preview,
    translation_status: row.translation_status,
    translation_cn: row.translation_cn,
    requirements_cn: row.requirements_cn,
    work_item_state: row.work_item_state,
    attempt_count: row.attempt_count
  };
}

function claimNotification(db, input = {}) {
  const identity = requiredClaimInput(input);
  if (!activeActorBinding(db, identity.actorUserId, identity.bindingId)) throw new Error('notification claim not authorized');
  const context = clockIso(input.clock);
  const leaseMs = Math.min(300000, Math.max(1000, Number(input.leaseMs || 30000)));
  const transaction = db.transaction(() => {
    const expired = db.prepare(`
      SELECT n.id FROM matrix_stream_notification_spool n
      JOIN matrix_work_items w ON w.id = n.work_item_id
      WHERE n.delivery_state = 'inflight' AND n.lease_expires_at <= ? AND w.owner_user_id = ?
    `).all(context.iso, identity.actorUserId);
    for (const row of expired) {
      db.prepare(`
        UPDATE matrix_stream_notification_spool
        SET delivery_state = 'manual_review', finalized_token = owner_token, finalized_state = 'manual_review',
            owner_token = '', lease_expires_at = '', last_error_class = 'claim_expired'
        WHERE id = ? AND delivery_state = 'inflight' AND lease_expires_at <= ?
      `).run(row.id, context.iso);
    }
    const row = db.prepare(`
      SELECT n.* FROM matrix_stream_notification_spool n
      JOIN matrix_work_items w ON w.id = n.work_item_id
      JOIN matrix_actor_bindings b ON b.user_id = w.owner_user_id
      JOIN users u ON u.id = w.owner_user_id
      WHERE n.delivery_state = 'pending' AND n.kind = 'reply' AND w.stream_state = 'replied'
        AND w.owner_user_id = ? AND b.id = ? AND b.status = 'active' AND u.status = 'active'
      ORDER BY n.id LIMIT 1
    `).get(identity.actorUserId, identity.bindingId);
    if (!row) return null;
    const token = crypto.randomUUID();
    const leaseExpiresAt = new Date(context.ms + leaseMs).toISOString();
    const changed = db.prepare(`
      UPDATE matrix_stream_notification_spool
      SET delivery_state = 'inflight', owner_token = ?, lease_expires_at = ?, attempt_count = attempt_count + 1,
          finalized_token = '', finalized_state = ''
      WHERE id = ? AND delivery_state = 'pending'
    `).run(token, leaseExpiresAt, row.id);
    if (changed.changes !== 1) return null;
    return claimProjection(db.prepare('SELECT * FROM matrix_stream_notification_spool WHERE id = ?').get(row.id));
  });
  return transaction.immediate();
}

function authorizedNotification(db, input) {
  const identity = requiredClaimInput(input);
  const notificationId = positiveInteger(input.notificationId, 'notification id');
  const claimToken = String(input.claimToken || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(claimToken)) throw new Error('valid notification claim token required');
  const row = db.prepare(`
    SELECT n.*, w.stream_state AS current_work_state
    FROM matrix_stream_notification_spool n
    JOIN matrix_work_items w ON w.id = n.work_item_id
    WHERE n.id = ?
  `).get(notificationId);
  if (!row || !activeOwnerBinding(db, identity.actorUserId, identity.bindingId, row.work_item_id)) throw new Error('notification claim not authorized');
  return { identity, row, notificationId, claimToken };
}

function expireOrCancelClaim(db, claim, context) {
  const expired = claim.row.delivery_state === 'inflight' && claim.row.lease_expires_at <= context.iso;
  const cancelled = claim.row.kind !== 'reply' || claim.row.current_work_state !== 'replied';
  if (claim.row.delivery_state === 'inflight' && claim.row.owner_token === claim.claimToken && (expired || cancelled)) {
    db.prepare(`
      UPDATE matrix_stream_notification_spool
      SET delivery_state = 'manual_review', finalized_token = ?, finalized_state = 'manual_review',
          owner_token = '', lease_expires_at = '', last_error_class = ?
      WHERE id = ? AND delivery_state = 'inflight' AND owner_token = ?
    `).run(claim.claimToken, expired ? 'claim_expired' : 'terminal_cancelled', claim.notificationId, claim.claimToken);
    return 'manual_review';
  }
  return null;
}

function replayedState(claim) {
  return claim.row.finalized_token === claim.claimToken && claim.row.finalized_state
    ? claim.row.finalized_state : '';
}

function notificationStatus(db, input = {}) {
  const context = clockIso(input.clock);
  const transaction = db.transaction(() => {
    const claim = authorizedNotification(db, input);
    const terminal = expireOrCancelClaim(db, claim, context) || replayedState(claim);
    if (terminal) return { notification_id: claim.notificationId, delivery_state: terminal, can_deliver: false };
    if (claim.row.delivery_state !== 'inflight' || claim.row.owner_token !== claim.claimToken) {
      throw new Error('notification claim mismatch');
    }
    return { notification_id: claim.notificationId, delivery_state: 'inflight', can_deliver: true };
  });
  return transaction.immediate();
}

function ackNotification(db, input = {}) {
  const context = clockIso(input.clock);
  const receiptId = String(input.receiptId || '').trim();
  if (!receiptId || receiptId.length > 256 || /[\r\n\0]/.test(receiptId)) throw new Error('valid notification receipt required');
  const transaction = db.transaction(() => {
    const claim = authorizedNotification(db, input);
    const terminal = expireOrCancelClaim(db, claim, context) || replayedState(claim);
    if (terminal) return { notification_id: claim.notificationId, delivery_state: terminal };
    if (claim.row.delivery_state !== 'inflight' || claim.row.owner_token !== claim.claimToken) throw new Error('notification claim mismatch');
    db.prepare(`
      UPDATE matrix_stream_notification_spool
      SET delivery_state = 'delivered', receipt_id = ?, delivered_at = ?,
          finalized_token = ?, finalized_state = 'delivered', owner_token = '', lease_expires_at = '', last_error_class = ''
      WHERE id = ? AND delivery_state = 'inflight' AND owner_token = ? AND lease_expires_at > ?
    `).run(receiptId, context.iso, claim.claimToken, claim.notificationId, claim.claimToken, context.iso);
    return { notification_id: claim.notificationId, delivery_state: 'delivered' };
  });
  return transaction.immediate();
}

function nackNotification(db, input = {}) {
  const outcome = String(input.outcome || '').trim();
  if (!['failed', 'ambiguous'].includes(outcome)) throw new Error('valid notification outcome required');
  const context = clockIso(input.clock);
  const transaction = db.transaction(() => {
    const claim = authorizedNotification(db, input);
    const terminal = expireOrCancelClaim(db, claim, context) || replayedState(claim);
    if (terminal) return { notification_id: claim.notificationId, delivery_state: terminal };
    if (claim.row.delivery_state !== 'inflight' || claim.row.owner_token !== claim.claimToken) throw new Error('notification claim mismatch');
    const nextState = outcome === 'failed' && claim.row.attempt_count < 3 ? 'pending' : 'manual_review';
    db.prepare(`
      UPDATE matrix_stream_notification_spool
      SET delivery_state = ?, finalized_token = ?, finalized_state = ?, owner_token = '', lease_expires_at = '', last_error_class = ?
      WHERE id = ? AND delivery_state = 'inflight' AND owner_token = ? AND lease_expires_at > ?
    `).run(nextState, claim.claimToken, nextState,
      outcome === 'failed' ? 'explicit_failure' : 'ambiguous_delivery', claim.notificationId, claim.claimToken, context.iso);
    return { notification_id: claim.notificationId, delivery_state: nextState };
  });
  return transaction.immediate();
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
  `).run(first.work_item_id, first.version_id, internalEventKey(db, `inbound-review:${messageId}`, context.iso),
    '{}', JSON.stringify({ candidate_job_ids: candidates.map(row => row.id) }), context.iso);
}

function durableEmailRowId(db, message, messageId) {
  const supplied = Number(message.email_row_id);
  if (Number.isInteger(supplied) && supplied > 0) {
    const row = db.prepare('SELECT id, message_id FROM email_messages WHERE id = ?').get(supplied);
    if (row && normalizeMessageId(row.message_id) === messageId) return row.id;
  }
  return db.prepare('SELECT id FROM email_messages WHERE LOWER(message_id) = ? LIMIT 1').get(messageId)?.id || null;
}

async function correlateInbound(db, emailMessage = {}, options = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('correlation database required');
  const messageId = normalizeMessageId(emailMessage.message_id);
  if (!messageId) throw new Error('valid inbound message id required');
  const prior = db.prepare('SELECT * FROM matrix_stream_inbound_links WHERE inbound_message_id = ?').get(messageId);
  if (prior) return linkResult(prior);

  const context = clockIso(options.clock);
  const emailMessageRowId = durableEmailRowId(db, emailMessage, messageId);
  const exact = exactCandidates(db, emailMessage);
  const candidates = exact.length ? exact : fallbackCandidates(db, emailMessage, context);
  if (candidates.length !== 1) {
    const status = candidates.length > 1 ? 'needs_review' : 'unmatched';
    const transaction = db.transaction(() => {
      const replay = db.prepare('SELECT * FROM matrix_stream_inbound_links WHERE inbound_message_id = ?').get(messageId);
      if (replay) return linkResult(replay);
      if (status === 'needs_review') insertReviewEvent(db, messageId, candidates, context);
      db.prepare(`
        INSERT INTO matrix_stream_inbound_links (inbound_message_id, email_message_row_id, status, kind, work_item_id, job_id, created_at)
        VALUES (?, ?, ?, '', NULL, NULL, ?)
      `).run(messageId, emailMessageRowId, status, context.iso);
      return { status };
    });
    return transaction.immediate();
  }

  const job = candidates[0];
  const kind = classifyKind(emailMessage);
  const preTranslationState = db.prepare('SELECT stream_state FROM matrix_work_items WHERE id = ?').get(job.work_item_id)?.stream_state;
  const translation = kind === 'reply' && (STATE_PRIORITY.get(preTranslationState) || 0) <= (STATE_PRIORITY.get('replied') || 0)
    ? await translationFor(emailMessage, options)
    : { status: 'pending' };
  const state = ({ reply: 'replied', bounce: 'bounced', refusal: 'refused', unsubscribe: 'suppressed', manual_stop: 'suppressed' })[kind];
  const transaction = db.transaction(() => {
    const replay = db.prepare('SELECT * FROM matrix_stream_inbound_links WHERE inbound_message_id = ?').get(messageId);
    if (replay) return linkResult(replay);
    const before = db.prepare('SELECT stream_state, version FROM matrix_work_items WHERE id = ?').get(job.work_item_id);
    if (!before) throw new Error('correlated work item missing');
    closeReplyCheck(db, { jobId: job.id, reason: kind === 'reply' ? 'reply' : kind, closedAt: context.iso });
    const nextState = (STATE_PRIORITY.get(state) || 0) >= (STATE_PRIORITY.get(before.stream_state) || 0) ? state : before.stream_state;
    db.prepare(`
      UPDATE matrix_work_items
      SET stream_state = ?, stage = CASE WHEN ? = 'suppressed' THEN 'suppressed' ELSE stage END,
          version = version + 1, updated_at = ? WHERE id = ?
    `).run(nextState, nextState, context.iso, job.work_item_id);
    if (nextState !== 'replied') {
      db.prepare(`
        UPDATE matrix_stream_notification_spool
        SET delivery_state = 'manual_review',
            finalized_token = CASE WHEN delivery_state = 'inflight' THEN owner_token ELSE finalized_token END,
            finalized_state = CASE WHEN delivery_state = 'inflight' THEN 'manual_review' ELSE finalized_state END,
            owner_token = '', lease_expires_at = '', last_error_class = 'terminal_cancelled'
        WHERE work_item_id = ? AND kind = 'reply' AND delivery_state IN ('pending','inflight')
      `).run(job.work_item_id);
    }
    db.prepare(`
      INSERT INTO matrix_stream_inbound_links (inbound_message_id, email_message_row_id, status, kind, work_item_id, job_id, created_at)
      VALUES (?, ?, 'matched', ?, ?, ?, ?)
    `).run(messageId, emailMessageRowId, kind, job.work_item_id, job.id, context.iso);
    db.prepare(`
      INSERT INTO matrix_stream_events (
        work_item_id, version_id, job_id, action, idempotency_key,
        before_json, after_json, diagnostic, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?)
    `).run(job.work_item_id, job.version_id, job.id, `inbound_${kind}`,
      internalEventKey(db, `inbound-${kind}:${messageId}`, context.iso), JSON.stringify({ stream_state: before.stream_state }),
      JSON.stringify({ stream_state: nextState, inbound_message_id: messageId, observed_kind: kind }), context.iso);

    if (kind === 'reply' && nextState === 'replied') {
      const ready = translation.status === 'ready';
      const value = ready ? translation.value : {};
      db.prepare(`
        INSERT INTO matrix_stream_notification_spool (
          inbound_message_id, work_item_id, job_id, kind, original_preview,
          translation_status, translation_cn, requirements_cn, suggested_subject,
          suggested_body_en, suggested_body_cn, work_item_state, retry_available,
          notification_key, delivery_state, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(messageId, job.work_item_id, job.id, kind,
        safePreview(emailMessage.cleaned_text || emailMessage.text_body, 800),
        ready ? 'ready' : 'pending',
        ready ? safePreview(value.translation_cn, 800) : '',
        ready ? safePreview(value.requirements_cn, 500) : '',
        ready ? safePreview(value.suggested_subject, 200) : '',
        ready ? safePreview(value.suggested_body_en, 1200) : '',
        ready ? safePreview(value.suggested_body_cn, 1200) : '',
        nextState, ready ? 0 : 1, crypto.randomUUID(), context.iso);
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
  const bindingId = positiveInteger(input.bindingId, 'actor binding id');
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
    if (!activeOwnerBinding(db, actorUserId, bindingId, row.work_item_id)) throw new Error('reply draft not authorized');
    if (row.kind !== 'reply' || row.stream_state !== 'replied') throw new Error('reply notification is not draft eligible');
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
      internalEventKey(db, `reply-draft:${notificationId}`, context.iso),
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
  const bindingId = positiveInteger(input.bindingId, 'actor binding id');
  const row = db.prepare(`
    SELECT n.*, w.owner_user_id, w.stream_state, l.email_message_row_id, e.cleaned_text, e.text_body
    FROM matrix_stream_notification_spool n
    JOIN matrix_work_items w ON w.id = n.work_item_id
    JOIN matrix_stream_inbound_links l ON l.inbound_message_id = n.inbound_message_id
    LEFT JOIN email_messages e ON e.id = l.email_message_row_id
    WHERE n.id = ?
  `).get(notificationId);
  if (!row) throw new Error('reply notification not found');
  if (!activeOwnerBinding(db, actorUserId, bindingId, row.work_item_id)) throw new Error('translation retry not authorized');
  if (row.kind !== 'reply' || row.stream_state !== 'replied') throw new Error('reply notification is not retry eligible');
  if (!['inflight', 'delivered', 'manual_review'].includes(row.delivery_state)) throw new Error('reply notification is not delivery eligible for retry');
  const existingReady = db.prepare(`
    SELECT id FROM matrix_stream_notification_spool
    WHERE inbound_message_id = ? AND generation > ? AND translation_status = 'ready'
    ORDER BY generation DESC LIMIT 1
  `).get(row.inbound_message_id, row.generation);
  if (existingReady) return { notification_id: notificationId, translation_status: 'ready', retry_available: false };
  if (row.translation_status === 'ready') {
    return { notification_id: notificationId, translation_status: 'ready', retry_available: false };
  }
  const authoritativeText = String(row.cleaned_text || row.text_body || '').trim();
  if (!row.email_message_row_id || !authoritativeText) {
    return { notification_id: notificationId, translation_status: 'pending', retry_available: true };
  }
  const translation = await translationFor({ cleaned_text: authoritativeText }, input);
  if (translation.status !== 'ready') {
    return { notification_id: notificationId, translation_status: 'pending', retry_available: true };
  }
  const transaction = db.transaction(() => {
    const current = db.prepare(`
      SELECT n.*, w.owner_user_id, w.stream_state
      FROM matrix_stream_notification_spool n
      JOIN matrix_work_items w ON w.id = n.work_item_id
      WHERE n.id = ?
    `).get(notificationId);
    if (!current || !activeOwnerBinding(db, actorUserId, bindingId, current.work_item_id)) throw new Error('translation retry not authorized');
    if (current.kind !== 'reply' || current.stream_state !== 'replied') throw new Error('reply notification is not retry eligible');
    if (!['inflight', 'delivered', 'manual_review'].includes(current.delivery_state)) throw new Error('reply notification is not delivery eligible for retry');
    const readyGeneration = db.prepare(`
      SELECT id FROM matrix_stream_notification_spool
      WHERE inbound_message_id = ? AND generation > ? AND translation_status = 'ready'
      ORDER BY generation DESC LIMIT 1
    `).get(current.inbound_message_id, current.generation);
    if (readyGeneration) {
      return { notification_id: notificationId, translation_status: 'ready', retry_available: false };
    }
    if (current.translation_status === 'ready') {
      return { notification_id: notificationId, translation_status: 'ready', retry_available: false };
    }
    const value = translation.value;
    const generation = Number(db.prepare(`
      SELECT COALESCE(MAX(generation), 0) + 1 AS generation
      FROM matrix_stream_notification_spool WHERE inbound_message_id = ?
    `).get(current.inbound_message_id).generation);
    db.prepare(`
      INSERT INTO matrix_stream_notification_spool (
        inbound_message_id, work_item_id, job_id, kind, original_preview,
        translation_status, translation_cn, requirements_cn, suggested_subject,
        suggested_body_en, suggested_body_cn, work_item_state, retry_available,
        notification_key, delivery_state, generation, supersedes_notification_id, created_at
      ) VALUES (?, ?, ?, 'reply', ?, 'ready', ?, ?, ?, ?, ?, 'replied', 0, ?, 'pending', ?, ?, ?)
    `).run(current.inbound_message_id, current.work_item_id, current.job_id, current.original_preview,
      safePreview(value.translation_cn, 800), safePreview(value.requirements_cn, 500),
      safePreview(value.suggested_subject, 200), safePreview(value.suggested_body_en, 1200),
      safePreview(value.suggested_body_cn, 1200), crypto.randomUUID(), generation, current.id, context.iso);
    db.prepare(`
      INSERT INTO matrix_stream_events (
        work_item_id, job_id, actor_user_id, action, idempotency_key,
        before_json, after_json, diagnostic, created_at
      ) VALUES (?, ?, ?, 'inbound_translation_ready', ?,
        '{"translation_status":"pending"}', '{"translation_status":"ready"}', '', ?)
    `).run(current.work_item_id, current.job_id, actorUserId,
      internalEventKey(db, `inbound-translation-ready:${current.inbound_message_id}`, context.iso), context.iso);
    return { notification_id: notificationId, translation_status: 'ready', retry_available: false };
  });
  return transaction.immediate();
}

module.exports = {
  correlateInbound,
  startReplyDraft,
  retryInboundTranslation,
  claimNotification,
  ackNotification,
  nackNotification,
  notificationStatus,
  classifyKind,
  normalizedSubject,
  normalizeMessageId,
  emailAddresses,
  safePreview
};

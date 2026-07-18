'use strict';
const crypto = require('node:crypto');
function canonicalJson(value) { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`; return JSON.stringify(value); }
function sha(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function token(value, label, max = 1000) { const v = String(value ?? '').trim(); if (!v) throw new Error(`${label} required`); if (v.length > max) throw new Error(`${label} too long`); return v; }
function safeText(value) {
  return String(value || '').slice(0, 20000)
    .replace(/\b(SMTP_PASS|SMTP_PASSWORD|API_KEY|OAUTH_TOKEN|ACCESS_TOKEN|COOKIE)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]');
}
function createMatrixConversationLedger({ db, clock = () => new Date() } = {}) {
  function conversationId(input) {
    const root = String(input.immutableRootThreadId || input.immutableRootMessageId || 'threadless');
    return sha(`${token(input.platformNamespace, 'platform namespace', 100)}\0${token(input.immutableChatId, 'immutable chat id', 300)}\0${root}`);
  }
  function result(row) { return { id: row.id, conversationId: row.conversation_id, eventKind: row.event_kind, direction: row.direction, channel: row.channel, editVersion: row.edit_version, normalizedText: row.normalized_text, attachmentRefs: JSON.parse(row.attachment_refs_json), bindings: JSON.parse(row.bindings_json), occurredAt: row.occurred_at, fingerprint: row.fingerprint }; }
  function append(input = {}) {
    const computed = conversationId(input);
    if (input.conversationId && input.conversationId !== computed) throw new Error('conversation id mismatch');
    const idempotencyKey = token(input.idempotencyKey, 'idempotency key', 200);
    const attachments = Array.isArray(input.attachmentRefs) ? input.attachmentRefs.map(ref => ({ idHash: sha(token(ref.id, 'attachment id')), sha256: token(ref.sha256, 'attachment sha256', 64) })) : [];
    const bindings = input.bindings && typeof input.bindings === 'object' && !Array.isArray(input.bindings) ? input.bindings : {};
    const payload = { conversationId: computed, eventKind: token(input.eventKind, 'event kind', 80), direction: token(input.direction, 'direction', 20), channel: token(input.channel, 'channel', 20), editVersion: Number(input.editVersion || 1), actorUserId: input.actorUserId ? Number(input.actorUserId) : null, bindingId: token(input.bindingId, 'binding id', 100), normalizedText: safeText(input.normalizedText), attachmentRefs: attachments, bindings, occurredAt: token(input.occurredAt, 'occurred at', 50), source: input.source || {} };
    const fingerprint = sha(canonicalJson(payload));
    return db.transaction(() => {
      const replay = db.prepare('SELECT * FROM matrix_conversation_events WHERE idempotency_key=?').get(idempotencyKey);
      if (replay) { if (replay.fingerprint !== fingerprint) throw new Error('conversation event idempotency conflict'); return { kind: 'replay', event: result(replay) }; }
      const createdAt = (clock() instanceof Date ? clock() : new Date(clock())).toISOString();
      const root = String(input.immutableRootThreadId || input.immutableRootMessageId || 'threadless');
      const info = db.prepare(`INSERT INTO matrix_conversation_events (conversation_id,platform_namespace,immutable_chat_id_hash,immutable_root_id_hash,event_kind,direction,channel,chat_id_hash,thread_id_hash,platform_message_id_hash,edit_version,card_event_id_hash,actor_user_id,binding_id,normalized_text,attachment_refs_json,bindings_json,occurred_at,source_json,fingerprint,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(computed, input.platformNamespace, sha(input.immutableChatId), sha(root), payload.eventKind, payload.direction, payload.channel, sha(input.chatId || input.immutableChatId), input.threadId ? sha(input.threadId) : '', input.platformMessageId ? sha(input.platformMessageId) : '', payload.editVersion, input.cardEventId ? sha(input.cardEventId) : '', payload.actorUserId, payload.bindingId, payload.normalizedText, canonicalJson(attachments), canonicalJson(bindings), payload.occurredAt, canonicalJson(payload.source), fingerprint, idempotencyKey, createdAt);
      return { kind: 'created', event: result(db.prepare('SELECT * FROM matrix_conversation_events WHERE id=?').get(info.lastInsertRowid)) };
    })();
  }
  function requireEvent(eventId, expectedFingerprint) { const row = db.prepare('SELECT * FROM matrix_conversation_events WHERE id=?').get(Number(eventId)); if (!row) throw new Error('conversation event not found'); if (row.fingerprint !== expectedFingerprint) throw new Error('conversation event fingerprint mismatch'); return result(row); }
  function timeline({ conversationId: cid, inquiryId, itemId, limit = 50 } = {}) { if (!cid && !inquiryId && !itemId) throw new Error('timeline identity required'); const where = [], params = []; if (cid) { where.push('conversation_id=?'); params.push(cid); } if (inquiryId) { where.push("json_extract(bindings_json,'$.inquiryId')=?"); params.push(Number(inquiryId)); } if (itemId) { where.push("json_extract(bindings_json,'$.itemId')=?"); params.push(Number(itemId)); } const bounded = Math.max(1, Math.min(100, Number(limit) || 50)); const rows = db.prepare(`SELECT * FROM matrix_conversation_events WHERE ${where.join(' AND ')} ORDER BY occurred_at,id LIMIT ?`).all(...params, bounded + 1); return { rows: rows.slice(0, bounded).map(result), nextCursor: rows.length > bounded ? rows[bounded - 1].id : null }; }
  return { append, requireEvent, timeline, conversationId };
}
module.exports = { createMatrixConversationLedger };

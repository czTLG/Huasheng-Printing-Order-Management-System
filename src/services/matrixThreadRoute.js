'use strict';

const crypto = require('node:crypto');
const { normalizePermissions } = require('../lib/permissions');
const defaultDraftService = require('./crmReplyDraftService');

const ADMIN_ROLES = new Set(['super_admin', 'foreign_trade_crm_admin']);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function text(value, label, max = 512) {
  const result = String(value || '').trim();
  if (!result || result.length > max || /[\0]/.test(result)) throw new Error(`${label} required`);
  return result;
}

function id(value, label) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) throw new Error(`${label} required`);
  return result;
}

function exact(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} required`);
  const unknown = Object.keys(value).find(key => !fields.has(key));
  if (unknown) throw new Error(`unknown ${label} field: ${unknown}`);
  return value;
}

function email(value) {
  const result = String(value || '').trim().toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(result)) throw new Error('valid recipient email required');
  return result;
}

function actor(db, actorUserId, bindingId) {
  const row = db.prepare(`
    SELECT b.status AS binding_status, u.role, u.status AS user_status, u.permissions_json
    FROM matrix_actor_bindings b JOIN users u ON u.id=b.user_id
    WHERE b.id=? AND b.user_id=?
  `).get(bindingId, actorUserId);
  if (!row || row.binding_status !== 'active' || row.user_status !== 'active') throw new Error('active actor binding required');
  if (!ADMIN_ROLES.has(row.role)) throw new Error('matrix administrator role required');
  let permissions;
  try { permissions = JSON.parse(row.permissions_json || 'null'); } catch (_) { permissions = null; }
  if (!normalizePermissions(row.role, permissions).capabilities.matrixSend) throw new Error('explicit matrixSend capability required');
}

function publicRoute(row) {
  return {
    id: Number(row.id), route: 'existing_relationship', revision: Number(row.revision), status: row.status,
    customer_id: Number(row.customer_id), inquiry_id: Number(row.inquiry_id), crm_draft_id: Number(row.crm_draft_id),
    recipient_email: row.recipient_email, subject: row.subject, body_en: row.body_en, body_cn: row.body_cn,
    attachment_manifest: JSON.parse(row.attachment_manifest_json || '[]'), content_hash: row.content_hash,
    thread_bound: Boolean(row.in_reply_to), approved_by: row.approved_by == null ? null : Number(row.approved_by),
    approved_at: row.approved_at || null
  };
}

function createMatrixThreadRoute({ db, clock = () => new Date(), draftService = defaultDraftService } = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof clock !== 'function') throw new Error('matrix thread route dependencies required');
  const now = () => {
    const value = clock();
    const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
    if (!Number.isFinite(ms)) throw new Error('matrix thread route clock invalid');
    return new Date(ms).toISOString();
  };
  const rowById = routeId => db.prepare('SELECT * FROM matrix_thread_routes WHERE id=?').get(routeId);

  function replay(key, requestHash) {
    const event = db.prepare('SELECT route_id,request_hash FROM matrix_thread_events WHERE idempotency_key=?').get(key);
    if (!event) return null;
    if (event.request_hash !== requestHash) throw new Error('thread route idempotency conflict');
    return publicRoute(rowById(event.route_id));
  }

  function prepare(raw) {
    const input = exact(raw, new Set(['actorUserId','bindingId','customerId','chatId','threadId','idempotencyKey']), 'thread prepare input');
    const actorUserId = id(input.actorUserId, 'actor user id');
    const bindingId = id(input.bindingId, 'binding id');
    const customerId = id(input.customerId, 'customer id');
    const chatId = text(input.chatId, 'chat id', 256);
    const threadId = String(input.threadId || '').trim();
    if (threadId.length > 256 || /[\r\n\0]/.test(threadId)) throw new Error('valid thread id required');
    const key = text(input.idempotencyKey, 'idempotency key', 200);
    const requestHash = digest({ action: 'prepared', actorUserId, bindingId, customerId, chatId, threadId });
    const old = replay(key, requestHash);
    if (old) return old;
    actor(db, actorUserId, bindingId);
    const customer = db.prepare("SELECT * FROM customers WHERE id=? AND COALESCE(active,1)=1 AND COALESCE(is_invalid,0)=0 AND lower(COALESCE(stage,'')) NOT IN ('blocked','suppressed','unsubscribed')").get(customerId);
    if (!customer) throw new Error('active customer required');
    const inquiries = db.prepare("SELECT * FROM inquiries WHERE customer_id=? AND COALESCE(status,'') NOT IN ('closed','cancelled','completed') ORDER BY updated_at DESC,id DESC").all(customerId);
    if (inquiries.length !== 1) throw new Error('one active inquiry required');
    const inquiry = inquiries[0];
    const messages = db.prepare("SELECT * FROM crm_messages WHERE customer_id=? AND inquiry_id=? AND source_type='email' AND direction='inbound' ORDER BY received_at DESC,id DESC").all(customerId, inquiry.id);
    if (messages.length < 1) throw new Error('one authoritative inbound email required');
    const message = messages[0];
    const sourceEmailId = Number(message.source_message_id);
    const source = Number.isInteger(sourceEmailId) ? db.prepare("SELECT * FROM email_messages WHERE id=? AND direction='inbound'").get(sourceEmailId) : null;
    if (!source) throw new Error('authoritative email source required');
    const recipient = email(message.sender_contact);
    if (recipient !== email(source.from_email)) throw new Error('thread recipient mismatch');
    let draft = db.prepare("SELECT * FROM crm_reply_drafts WHERE customer_id=? AND inquiry_id=? AND reply_channel='email' AND lower(recipient_contact)=? ORDER BY updated_at DESC,id DESC LIMIT 1").get(customerId, inquiry.id, recipient);
    if (!draft) {
      draft = draftService.generateReplyDraft(db, { source: 'message', message_id: message.id, reply_channel: 'email', created_by: String(actorUserId) });
    }
    if (!draft || email(draft.recipient_contact) !== recipient) throw new Error('draft recipient mismatch');
    const subject = text(draft.email_subject, 'subject', 300);
    const bodyEn = text(draft.draft_text_en, 'English body', 10000);
    const bodyCn = text(draft.draft_text_cn || draft.draft_summary_cn, 'Chinese body', 10000);
    const inReplyTo = text(source.message_id, 'source message id', 998);
    const references = String(source.references_header || source.in_reply_to || '').trim().slice(0, 4000);
    const attachmentManifest = [];
    const contentHash = digest({ recipient, subject, bodyEn, bodyCn, inReplyTo, references, attachmentManifest, sourceEmailId });
    const at = now();
    const transaction = db.transaction(() => {
      const revision = Number(db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS n FROM matrix_thread_routes WHERE customer_id=? AND inquiry_id=?').get(customerId, inquiry.id).n);
      const inserted = db.prepare(`INSERT INTO matrix_thread_routes (actor_user_id,customer_id,inquiry_id,crm_draft_id,source_crm_message_id,source_email_message_id,chat_id,thread_id,revision,recipient_email,subject,body_en,body_cn,in_reply_to,references_header,attachment_manifest_json,content_hash,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)`).run(actorUserId,customerId,inquiry.id,draft.id,message.id,sourceEmailId,chatId,threadId,revision,recipient,subject,bodyEn,bodyCn,inReplyTo,references,JSON.stringify(attachmentManifest),contentHash,at,at);
      const routeId = Number(inserted.lastInsertRowid);
      db.prepare("INSERT INTO matrix_thread_events (route_id,actor_user_id,action,idempotency_key,request_hash,content_hash,before_json,after_json,created_at) VALUES (?,?,'prepared',?,?,?,'{}',?,?)").run(routeId,actorUserId,key,requestHash,contentHash,JSON.stringify({ status: 'draft', revision }),at);
      return publicRoute(rowById(routeId));
    });
    return transaction.immediate();
  }

  function approve(raw) {
    const input = exact(raw, new Set(['actorUserId','bindingId','routeId','expectedContentHash','expectedRevision','idempotencyKey']), 'thread approval input');
    const actorUserId=id(input.actorUserId,'actor user id'), bindingId=id(input.bindingId,'binding id'), routeId=id(input.routeId,'route id');
    const revision=id(input.expectedRevision,'expected revision'), expectedHash=text(input.expectedContentHash,'expected content hash',64).toLowerCase(), key=text(input.idempotencyKey,'idempotency key',200);
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('valid expected content hash required');
    const requestHash=digest({ action:'approved',actorUserId,bindingId,routeId,revision,expectedHash });
    const old=replay(key,requestHash); if(old) return old;
    actor(db,actorUserId,bindingId);
    const transaction=db.transaction(()=>{
      const row=rowById(routeId);
      if(!row || row.actor_user_id!==actorUserId) throw new Error('thread route not authorized');
      if(row.status!=='draft' || row.revision!==revision || row.content_hash!==expectedHash) throw new Error('stale thread route approval');
      const at=now();
      db.prepare("UPDATE matrix_thread_routes SET status='approved',approved_by=?,approved_at=?,updated_at=? WHERE id=? AND status='draft'").run(actorUserId,at,at,routeId);
      db.prepare("INSERT INTO matrix_thread_events (route_id,actor_user_id,action,idempotency_key,request_hash,content_hash,before_json,after_json,created_at) VALUES (?,?,'approved',?,?,?,'{\"status\":\"draft\"}','{\"status\":\"approved\"}',?)").run(routeId,actorUserId,key,requestHash,expectedHash,at);
      return publicRoute(rowById(routeId));
    });
    return transaction.immediate();
  }

  function preview(raw) {
    const input=exact(raw,new Set(['actorUserId','bindingId','routeId']),'thread preview input');
    const actorUserId=id(input.actorUserId,'actor user id'),bindingId=id(input.bindingId,'binding id'),routeId=id(input.routeId,'route id');
    actor(db,actorUserId,bindingId);
    const row=rowById(routeId);
    if(!row || row.actor_user_id!==actorUserId) throw new Error('thread route not authorized');
    return publicRoute(row);
  }

  function resume(raw) {
    const input=exact(raw,new Set(['actorUserId','bindingId','chatId','threadId']),'thread resume input');
    const actorUserId=id(input.actorUserId,'actor user id'),bindingId=id(input.bindingId,'binding id');
    const chatId=text(input.chatId,'chat id',256),threadId=String(input.threadId||'').trim();
    if(threadId.length>256||/[\r\n\0]/.test(threadId))throw new Error('valid thread id required');
    actor(db,actorUserId,bindingId);
    const rows=db.prepare("SELECT * FROM matrix_thread_routes WHERE actor_user_id=? AND chat_id=? AND status IN ('draft','approved') ORDER BY updated_at DESC,id DESC LIMIT 2").all(actorUserId,chatId);
    const exactMatch=rows.find(row=>String(row.thread_id||'')===threadId);
    const row=exactMatch||(rows.length===1?rows[0]:null);
    return row?publicRoute(row):null;
  }

  return { prepare, approve, preview, resume, get: routeId => { const row=rowById(id(routeId,'route id')); return row ? publicRoute(row) : null; } };
}

module.exports = { createMatrixThreadRoute, contentHash: digest };

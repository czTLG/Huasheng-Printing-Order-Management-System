const crypto = require('crypto');
const { now } = require('../db');
const { attachmentsFromJson } = require('./crmAttachments');

function text(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function safeJson(value, fallback = {}) {
  if (!text(value)) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return fallback;
  }
}

function tableExists(db, name) {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);
}

function inferDirection(email = {}) {
  const direction = text(email.direction).toLowerCase();
  if (['inbound', 'outbound', 'internal', 'unknown'].includes(direction)) return direction;
  const folder = text(email.folder).toLowerCase();
  if (folder.includes('sent')) return 'outbound';
  return 'inbound';
}

function buildThreadId(email = {}) {
  return text(email.thread_id || email.conversation_key || email.message_id || email.subject || `email-${email.id}`);
}

function buildRawPayload(email = {}) {
  return {
    email_message_id: email.id ? Number(email.id) : null,
    mailbox: text(email.mailbox),
    folder: text(email.folder),
    message_uid: text(email.message_uid),
    message_id: text(email.message_id),
    thread_id: text(email.thread_id),
    conversation_key: text(email.conversation_key),
    in_reply_to: text(email.in_reply_to),
    references_header: text(email.references_header),
    from_email: text(email.from_email),
    from_name: text(email.from_name),
    to_emails: text(email.to_emails),
    cc_emails: text(email.cc_emails),
    bcc_emails: text(email.bcc_emails),
    subject: text(email.subject),
    html_body: text(email.html_body),
    sent_at: text(email.sent_at),
    received_at: text(email.received_at),
    direction: inferDirection(email),
    processing_status: text(email.processing_status),
    matched_customer_id: email.matched_customer_id ? Number(email.matched_customer_id) : null,
    matched_inquiry_id: email.matched_inquiry_id ? Number(email.matched_inquiry_id) : null,
    raw_headers_json: safeJson(email.raw_headers_json, {})
  };
}

function messageTextFromEmail(email = {}) {
  return text(email.cleaned_text || email.text_body || email.plain_text || email.subject || '[Email message]');
}

function buildDedupeHash(email = {}) {
  const providerMessageId = text(email.message_id);
  const source = providerMessageId || `id:${email.id}`;
  return `email:${crypto.createHash('sha1').update(source).digest('hex')}`;
}

function existingCrmMessage(db, email = {}) {
  const sourceId = text(email.id);
  if (sourceId) {
    const bySource = db.prepare(`
      SELECT id
      FROM crm_messages
      WHERE source_type = 'email' AND source_message_id = ?
      LIMIT 1
    `).get(sourceId);
    if (bySource) return bySource;
  }
  const byDedupe = db.prepare('SELECT id FROM crm_messages WHERE dedupe_hash = ? LIMIT 1').get(buildDedupeHash(email));
  return byDedupe || null;
}

function insertEmailAttachmentRecords(db, message, email) {
  if (!tableExists(db, 'crm_message_attachments')) return [];
  const parsed = attachmentsFromJson(email.attachments_json, {
    message_id: message.id,
    customer_id: message.customer_id || null,
    inquiry_id: message.inquiry_id || null,
    source_type: 'email',
    source_message_id: text(email.id)
  });
  if (!parsed.attachments.length) return [];

  const ts = now();
  const insert = db.prepare(`
    INSERT INTO crm_message_attachments (
      message_id, customer_id, inquiry_id, source_type, source_message_id, email_message_id,
      original_file_name, mime_type, file_ext, file_size, public_url, preview_url, thumbnail_url,
      attachment_type, media_order, caption_text, ai_status, ai_summary_cn, ai_summary_en,
      extracted_specs_json, risk_flags_json, raw_metadata_json, created_at, updated_at
    ) VALUES (
      ?, ?, ?, 'email', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  const ids = [];
  parsed.attachments.forEach((attachment, index) => {
    const result = insert.run(
      message.id,
      message.customer_id || null,
      message.inquiry_id || null,
      text(email.id),
      text(email.id),
      attachment.original_file_name || `attachment-${index + 1}`,
      attachment.mime_type || '',
      attachment.file_ext || '',
      Number(attachment.file_size || 0) || 0,
      attachment.public_url || '',
      attachment.preview_url || '',
      attachment.thumbnail_url || '',
      attachment.attachment_type || 'other',
      Number(attachment.media_order || index + 1) || index + 1,
      attachment.caption_text || '',
      attachment.ai_status || 'skipped',
      attachment.ai_summary_cn || '',
      attachment.ai_summary_en || '',
      attachment.extracted_specs_json || '',
      attachment.risk_flags_json || '',
      attachment.raw_metadata_json || '{}',
      ts,
      ts
    );
    ids.push(Number(result.lastInsertRowid));
  });
  return ids;
}

function importEmailToCrmMessage(db, emailMessageId) {
  const emailId = Number(emailMessageId);
  if (!Number.isInteger(emailId) || emailId <= 0) throw new Error('invalid email_message_id');

  const email = db.prepare('SELECT * FROM email_messages WHERE id = ?').get(emailId);
  if (!email) throw new Error('email message not found');

  const existing = existingCrmMessage(db, email);
  if (existing) return { ok: true, crm_message_id: Number(existing.id), already_exists: true };

  const ts = now();
  const customerId = email.matched_customer_id ? Number(email.matched_customer_id) : null;
  const inquiryId = email.matched_inquiry_id ? Number(email.matched_inquiry_id) : null;
  const rawPayload = buildRawPayload(email);

  const insertMessage = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO crm_messages (
        source_type, source_message_id, thread_id, customer_id, inquiry_id, direction, sender_name,
        sender_contact, receiver_contact, message_text, attachments_json, raw_payload_json, received_at,
        ai_status, workflow_status, dedupe_hash, created_at, updated_at
      ) VALUES (
        'email', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'new', ?, ?, ?
      )
    `).run(
      text(email.id),
      buildThreadId(email),
      customerId,
      inquiryId,
      inferDirection(email),
      text(email.from_name || email.contact_name),
      text(email.from_email || email.contact_email),
      text(email.to_emails),
      messageTextFromEmail(email),
      text(email.attachments_json || '[]'),
      JSON.stringify(rawPayload),
      text(email.received_at || email.sent_at || email.created_at || ts),
      buildDedupeHash(email),
      ts,
      ts
    );
    const crmMessage = {
      id: Number(result.lastInsertRowid),
      customer_id: customerId,
      inquiry_id: inquiryId
    };
    const attachment_ids = insertEmailAttachmentRecords(db, crmMessage, email);
    return { ok: true, crm_message_id: crmMessage.id, already_exists: false, attachment_ids };
  });

  return insertMessage();
}

function batchImportEmailsToCrmMessages(db, options = {}) {
  const ids = Array.isArray(options.email_message_ids)
    ? options.email_message_ids.map(Number).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  const limit = Math.max(1, Math.min(Number(options.limit || 50) || 50, 300));
  const onlyUnimported = options.only_unimported !== false;

  let emailIds = ids;
  if (!emailIds.length) {
    const where = onlyUnimported
      ? `WHERE NOT EXISTS (
          SELECT 1 FROM crm_messages cm
          WHERE cm.source_type = 'email' AND cm.source_message_id = CAST(email_messages.id AS TEXT)
        )`
      : '';
    emailIds = db.prepare(`
      SELECT id FROM email_messages
      ${where}
      ORDER BY COALESCE(received_at, created_at) DESC, id DESC
      LIMIT ?
    `).all(limit).map((row) => Number(row.id));
  }

  const ret = { imported: 0, skipped: 0, failed: 0, crm_message_ids: [], errors: [] };
  emailIds.slice(0, limit).forEach((id) => {
    try {
      const result = importEmailToCrmMessage(db, id);
      if (result.already_exists) ret.skipped += 1;
      else {
        ret.imported += 1;
        ret.crm_message_ids.push(result.crm_message_id);
      }
    } catch (err) {
      ret.failed += 1;
      ret.errors.push({ email_message_id: id, error: err.message || String(err) });
    }
  });
  return ret;
}

module.exports = {
  batchImportEmailsToCrmMessages,
  buildDedupeHash,
  importEmailToCrmMessage
};

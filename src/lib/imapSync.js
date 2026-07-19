const { db, now } = require('../db');
const { createAttachmentStore } = require('./matrixInboxStore');
const { processInboundEmail } = require('../services/matrixInbox');

function text(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function parseBool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function maskMailboxUser(value) {
  const raw = text(value);
  if (!raw) return '';
  const [local, domain] = raw.split('@');
  if (!domain) return raw ? `${raw[0]}***` : '';
  const prefix = local ? `${local[0]}***` : '***';
  return `${prefix}@${domain}`;
}

function getImapConfig() {
  const inboxEnabled = process.env.MATRIX_INBOX_ENABLED === '1';
  const host = text(process.env.ALIYUN_MAIL_IMAP_HOST || process.env.MATRIX_INBOX_IMAP_HOST);
  const port = Number(process.env.ALIYUN_MAIL_IMAP_PORT || process.env.MATRIX_INBOX_IMAP_PORT || 993);
  const secure = parseBool(process.env.ALIYUN_MAIL_IMAP_SECURE || process.env.MATRIX_INBOX_IMAP_SECURE, true);
  const user = text(process.env.ALIYUN_MAIL_USER || (inboxEnabled ? process.env.SMTP_USER : ''));
  const password = text(process.env.ALIYUN_MAIL_PASSWORD || (inboxEnabled ? process.env.SMTP_PASS : ''));
  const syncDays = Number(process.env.ALIYUN_MAIL_SYNC_DAYS || 90);
  const syncLimit = Number(process.env.ALIYUN_MAIL_SYNC_LIMIT || 200);
  return { host, port, secure, user, password, syncDays, syncLimit };
}

function sanitizeErrorMessage(message) {
  const raw = text(message);
  const secret = text(process.env.ALIYUN_MAIL_PASSWORD || (process.env.MATRIX_INBOX_ENABLED === '1' ? process.env.SMTP_PASS : ''));
  if (!raw) return '';
  if (!secret) return raw;
  return raw.split(secret).join('[redacted]');
}

function validateImapConfig(config = getImapConfig()) {
  const missing = [];
  if (!config.host) missing.push('ALIYUN_MAIL_IMAP_HOST');
  if (!config.port) missing.push('ALIYUN_MAIL_IMAP_PORT');
  if (!config.user) missing.push('ALIYUN_MAIL_USER');
  if (!config.password) missing.push('ALIYUN_MAIL_PASSWORD');
  return {
    ok: missing.length === 0,
    missing,
    config: {
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: config.user,
      userMasked: maskMailboxUser(config.user),
      passwordConfigured: !!config.password,
      syncDays: config.syncDays,
      syncLimit: config.syncLimit
    }
  };
}

function classifyImapError(err) {
  const code = text(err?.code).toUpperCase();
  const message = text(err?.message).toLowerCase();
  if (code === 'IMAP_FOLDER_NOT_FOUND' || message.includes('does not exist') || message.includes('mailbox folder not found')) {
    return 'IMAP folder not found. Please verify the folder name on the deployment server.';
  }
  if (code === 'ENOTFOUND') {
    return 'IMAP DNS lookup failed. Please verify IMAP host or run this on the deployment server with external DNS access.';
  }
  if (code === 'ECONNREFUSED') {
    return 'IMAP connection refused. Please verify host, port, and firewall.';
  }
  if (code === 'ETIMEDOUT') {
    return 'IMAP connection timed out. Please verify server network and outbound port 993.';
  }
  if (code.includes('AUTH') || code.includes('LOGIN') || message.includes('auth') || message.includes('login failed') || message.includes('invalid credentials')) {
    return 'IMAP authentication failed. Please verify mailbox user and third-party client password.';
  }
  return 'IMAP sync failed.';
}

function createSyncResult(overrides = {}) {
  return {
    id: null,
    mailbox: '',
    folder: 'INBOX',
    messages: [],
    inserted: [],
    skipped: [],
    errors: [],
    scanned_count: 0,
    inserted_count: 0,
    skipped_count: 0,
    error_count: 0,
    status: 'pending',
    ...overrides
  };
}

function deriveDirection(message, mailbox) {
  const from = text(message.from_email).toLowerCase();
  const mailboxLower = text(mailbox).toLowerCase();
  const recipients = `${text(message.to_emails)},${text(message.cc_emails)},${text(message.bcc_emails)}`.toLowerCase();
  if (from && mailboxLower && from.includes(mailboxLower)) return 'outbound';
  if (mailboxLower && recipients.includes(mailboxLower) && from && !from.includes(mailboxLower)) return 'inbound';
  if (from && mailboxLower && recipients.includes(mailboxLower)) return 'internal';
  return 'unknown';
}

function cleanMessageText(textBody = '') {
  return text(textBody)
    .replace(/^\s*>.*$/gm, '')
    .replace(/^on .+?wrote:.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractDomain(email) {
  const value = text(email).toLowerCase();
  const parts = value.split('@');
  return parts.length === 2 ? parts[1] : '';
}

function normalizeSubject(value) {
  return text(value)
    .replace(/^(re|fw|fwd)\s*:\s*/ig, '')
    .replace(/^(回复|答复|转发)\s*[:：]\s*/ig, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function firstContactEmail(message = {}, mailbox = '') {
  const mailboxLower = text(mailbox).toLowerCase();
  const candidates = []
    .concat(text(message.from_email).split(','))
    .concat(text(message.to_emails).split(','))
    .concat(text(message.cc_emails).split(','))
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return candidates.find((item) => item !== mailboxLower) || text(message.from_email).toLowerCase();
}

function computeConversationKey(message = {}) {
  const threadId = text(message.thread_id);
  if (threadId) return `thread:${threadId.slice(0, 255)}`;
  const ref = text(message.references_header || message.in_reply_to);
  if (ref) return `ref:${ref.slice(0, 255)}`;
  const normalizedSubject = normalizeSubject(message.subject);
  const contactEmail = firstContactEmail(message, message.mailbox || '');
  const domain = extractDomain(contactEmail);
  if (normalizedSubject && contactEmail) return `subject-contact:${normalizedSubject}::${contactEmail}`;
  if (normalizedSubject && domain) return `subject-domain:${normalizedSubject}::${domain}`;
  return normalizedSubject ? `subject:${normalizedSubject}` : '';
}

function buildThreadId(message) {
  const header = text(message.references_header || message.in_reply_to || message.message_id);
  return header ? header.slice(0, 255) : '';
}

function findMatchedCustomer(fromEmail) {
  const email = text(fromEmail).toLowerCase();
  if (!email) return null;
  return db.prepare(`
    SELECT id
    FROM customers
    WHERE LOWER(COALESCE(email, '')) = ?
    LIMIT 1
  `).get(email)?.id || null;
}

function findMatchedInquiry(customerId, subject, cleanedText) {
  const normalizedCustomerId = Number(customerId || 0);
  if (!normalizedCustomerId) return null;
  const source = `${text(subject)}\n${text(cleanedText)}`.toLowerCase();
  const inquiries = db.prepare(`
    SELECT id, inquiry_title, product_type, packaging_type, destination_country
    FROM inquiries
    WHERE customer_id = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT 50
  `).all(normalizedCustomerId);
  const matched = inquiries.find((row) => {
    return [row.inquiry_title, row.product_type, row.packaging_type, row.destination_country]
      .filter(Boolean)
      .some((part) => source.includes(String(part).toLowerCase()));
  });
  return matched?.id || null;
}

function deriveFlags(message = {}) {
  const source = `${text(message.subject)}\n${text(message.cleaned_text || message.text_body)}`.toLowerCase();
  return {
    quote_detected: /\b(usd|rmb|cny|eur|gbp|unit price|total amount|price|quotation|quote|报价|单价|总价|exw|fob|cif|cfr|ddp|dap)\b/i.test(source) ? 1 : 0,
    inquiry_detected: /\b(inquiry|spec|specification|size|thickness|material|qty|quantity|pcs|roll film|pouch|bag|询盘|规格|厚度|材料)\b/i.test(source) ? 1 : 0,
    customer_detected: /\b(company|website|whatsapp|phone|address|buyer|contact|联系人|公司|网站)\b/i.test(source) ? 1 : 0
  };
}

function upsertEmailMessage(mailbox, folder, rawMessage) {
  const ts = now();
  const normalized = {
    mailbox: text(mailbox),
    folder: text(folder || 'INBOX'),
    message_uid: text(rawMessage.message_uid),
    message_id: text(rawMessage.message_id),
    thread_id: text(rawMessage.thread_id || buildThreadId(rawMessage)),
    in_reply_to: text(rawMessage.in_reply_to),
    references_header: text(rawMessage.references_header),
    from_email: text(rawMessage.from_email).toLowerCase(),
    from_name: text(rawMessage.from_name),
    to_emails: text(rawMessage.to_emails),
    cc_emails: text(rawMessage.cc_emails),
    bcc_emails: text(rawMessage.bcc_emails),
    subject: text(rawMessage.subject),
    text_body: text(rawMessage.text_body),
    html_body: text(rawMessage.html_body),
    cleaned_text: cleanMessageText(rawMessage.cleaned_text || rawMessage.text_body),
    attachments_json: text(rawMessage.attachments_json || '[]'),
    sent_at: text(rawMessage.sent_at || rawMessage.received_at),
    received_at: text(rawMessage.received_at || rawMessage.sent_at || ts),
    direction: deriveDirection(rawMessage, mailbox),
    processing_status: text(rawMessage.processing_status || 'new'),
    normalized_subject: normalizeSubject(rawMessage.subject),
    email_domain: extractDomain(rawMessage.from_email),
    contact_email: firstContactEmail(rawMessage, mailbox),
    contact_name: text(rawMessage.contact_name || rawMessage.from_name),
    matched_customer_id: rawMessage.matched_customer_id || findMatchedCustomer(rawMessage.from_email),
    matched_inquiry_id: rawMessage.matched_inquiry_id || null,
    raw_headers_json: text(rawMessage.raw_headers_json || '{}'),
    conversation_key: text(rawMessage.conversation_key),
    quote_detected: Number(rawMessage.quote_detected || 0),
    inquiry_detected: Number(rawMessage.inquiry_detected || 0),
    customer_detected: Number(rawMessage.customer_detected || 0),
    parsed_at: text(rawMessage.parsed_at),
  };
  if (!normalized.conversation_key) normalized.conversation_key = computeConversationKey({ ...normalized, mailbox });
  if (!normalized.matched_inquiry_id && normalized.matched_customer_id) {
    normalized.matched_inquiry_id = findMatchedInquiry(normalized.matched_customer_id, normalized.subject, normalized.cleaned_text);
  }
  const derivedFlags = deriveFlags(normalized);
  normalized.quote_detected = normalized.quote_detected || derivedFlags.quote_detected;
  normalized.inquiry_detected = normalized.inquiry_detected || derivedFlags.inquiry_detected;
  normalized.customer_detected = normalized.customer_detected || derivedFlags.customer_detected;

  let existing = null;
  if (normalized.message_id) {
    existing = db.prepare('SELECT id FROM email_messages WHERE message_id = ? LIMIT 1').get(normalized.message_id);
  }
  if (!existing && normalized.mailbox && normalized.folder && normalized.message_uid) {
    existing = db.prepare('SELECT id FROM email_messages WHERE mailbox = ? AND folder = ? AND message_uid = ? LIMIT 1').get(
      normalized.mailbox,
      normalized.folder,
      normalized.message_uid
    );
  }

  if (existing) {
    db.prepare(`
      UPDATE email_messages
      SET thread_id = ?, in_reply_to = ?, references_header = ?, from_email = ?, from_name = ?,
          to_emails = ?, cc_emails = ?, bcc_emails = ?, subject = ?, text_body = ?, html_body = ?,
          cleaned_text = ?, attachments_json = ?, sent_at = ?, received_at = ?, direction = ?,
          processing_status = ?, normalized_subject = ?, conversation_key = ?, email_domain = ?, contact_email = ?, contact_name = ?,
          quote_detected = ?, inquiry_detected = ?, customer_detected = ?, parsed_at = ?,
          matched_customer_id = ?, matched_inquiry_id = ?, raw_headers_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      normalized.thread_id, normalized.in_reply_to, normalized.references_header, normalized.from_email,
      normalized.from_name, normalized.to_emails, normalized.cc_emails, normalized.bcc_emails,
      normalized.subject, normalized.text_body, normalized.html_body, normalized.cleaned_text,
      normalized.attachments_json, normalized.sent_at, normalized.received_at, normalized.direction,
      normalized.processing_status, normalized.normalized_subject, normalized.conversation_key, normalized.email_domain,
      normalized.contact_email, normalized.contact_name, normalized.quote_detected, normalized.inquiry_detected,
      normalized.customer_detected, normalized.parsed_at, normalized.matched_customer_id, normalized.matched_inquiry_id,
      normalized.raw_headers_json, ts, existing.id
    );
    return { id: existing.id, inserted: false, normalized };
  }

  const result = db.prepare(`
    INSERT INTO email_messages (
      mailbox, folder, message_uid, message_id, thread_id, in_reply_to, references_header,
      from_email, from_name, to_emails, cc_emails, bcc_emails, subject, text_body, html_body,
      cleaned_text, attachments_json, sent_at, received_at, direction, processing_status, normalized_subject,
      conversation_key, email_domain, contact_email, contact_name, quote_detected, inquiry_detected, customer_detected, parsed_at,
      matched_customer_id, matched_inquiry_id, raw_headers_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalized.mailbox, normalized.folder, normalized.message_uid, normalized.message_id, normalized.thread_id,
    normalized.in_reply_to, normalized.references_header, normalized.from_email, normalized.from_name,
    normalized.to_emails, normalized.cc_emails, normalized.bcc_emails, normalized.subject, normalized.text_body,
    normalized.html_body, normalized.cleaned_text, normalized.attachments_json, normalized.sent_at,
    normalized.received_at, normalized.direction, normalized.processing_status, normalized.normalized_subject,
    normalized.conversation_key, normalized.email_domain, normalized.contact_email, normalized.contact_name,
    normalized.quote_detected, normalized.inquiry_detected, normalized.customer_detected, normalized.parsed_at,
    normalized.matched_customer_id, normalized.matched_inquiry_id, normalized.raw_headers_json, ts, ts
  );
  return { id: result.lastInsertRowid, inserted: true, normalized };
}

function resolveFolderName(folder) {
  const value = text(folder || 'INBOX');
  const lowered = value.toLowerCase();
  if (lowered === 'sent' || lowered === 'sent messages' || lowered === 'sent mail' || lowered === '已发送' || lowered === '已发送邮件') {
    return ['Sent', 'Sent Messages', 'Sent Mail', '已发送', '已发送邮件'];
  }
  return [value];
}

async function openMailboxWithFallback(client, folder) {
  const candidates = resolveFolderName(folder);
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const mailboxInfo = await client.mailboxOpen(candidate);
      return { folder: candidate, mailboxInfo };
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) {
    lastError.code = lastError.code || 'IMAP_FOLDER_NOT_FOUND';
    lastError.message = text(lastError.message || `Mailbox folder not found: ${folder}`);
  }
  throw lastError || new Error(`Mailbox folder not found: ${folder}`);
}

function persistParsedAttachments(emailMessageId, attachments, { attachmentStore } = {}) {
  if (!attachmentStore) return [];
  const list = Array.isArray(attachments) ? attachments.slice(0, 20) : [];
  return list.map((item, index) => attachmentStore.save({
    emailMessageId,
    index,
    filename: item?.filename || `attachment-${index + 1}`,
    contentType: item?.contentType || 'application/octet-stream',
    content: Buffer.isBuffer(item?.content) ? item.content : Buffer.from(item?.content || '')
  }));
}

async function syncMailbox({
  folder = 'INBOX',
  days,
  limit,
  operator = 'system',
  syncType = 'manual',
  attachmentStore,
  afterImport = processInboundEmail
} = {}) {
  const rawConfig = getImapConfig();
  const cfgCheck = validateImapConfig(rawConfig);
  const ts = now();
  const result = createSyncResult({
    mailbox: cfgCheck.config.user,
    folder: text(folder || 'INBOX'),
    status: 'running'
  });
  const normalizedSyncType = ['manual', 'startup', 'scheduled', 'backfill'].includes(text(syncType)) ? text(syncType) : 'manual';
  const run = db.prepare(`
    INSERT INTO email_sync_runs (mailbox, folder, sync_type, status, started_at, created_by, created_at)
    VALUES (?, ?, ?, 'running', ?, ?, ?)
  `).run(cfgCheck.config.user || '', text(folder || 'INBOX'), normalizedSyncType, ts, operator, ts);
  const runId = run.lastInsertRowid;
  result.id = runId;

  if (!cfgCheck.ok) {
    const message = 'IMAP configuration is incomplete';
    db.prepare(`
      UPDATE email_sync_runs
      SET status = 'failed', finished_at = ?, error_count = 1, error_message = ?
      WHERE id = ?
    `).run(now(), message, runId);
    const error = new Error(message);
    error.code = 'IMAP_ENV_MISSING';
    error.runId = runId;
    error.summary = { ...result, status: 'failed', error_count: 1, errors: [{ code: error.code, message }] };
    throw error;
  }

  let ImapFlow;
  let simpleParser;
  try {
    ({ ImapFlow } = require('imapflow'));
    ({ simpleParser } = require('mailparser'));
  } catch (err) {
    const message = 'IMAP dependencies are not installed';
    db.prepare(`
      UPDATE email_sync_runs
      SET status = 'failed', finished_at = ?, error_count = 1, error_message = ?
      WHERE id = ?
    `).run(now(), message, runId);
    const error = new Error(message);
    error.code = 'IMAP_DEP_MISSING';
    error.runId = runId;
    error.summary = { ...result, status: 'failed', error_count: 1, errors: [{ code: error.code, message }] };
    throw error;
  }

  const client = new ImapFlow({
    host: cfgCheck.config.host,
    port: cfgCheck.config.port,
    secure: cfgCheck.config.secure,
    auth: {
      user: cfgCheck.config.user,
      pass: rawConfig.password
    },
    logger: false
  });

  let scannedCount = 0;
  let insertedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const mailbox = cfgCheck.config.user;
  const sinceDays = Number(days || cfgCheck.config.syncDays || 90);
  const maxItems = Number(limit || cfgCheck.config.syncLimit || 200);
  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const resolvedAttachmentStore = attachmentStore || (text(process.env.MATRIX_INBOX_ATTACHMENT_ROOT)
    ? createAttachmentStore({ root: process.env.MATRIX_INBOX_ATTACHMENT_ROOT, dbHandle: db })
    : null);

  try {
    await client.connect();
    const opened = await openMailboxWithFallback(client, folder);
    result.folder = opened.folder;
    const searchResultsRaw = await client.search({ since: sinceDate });
    const searchResults = Array.isArray(searchResultsRaw) ? searchResultsRaw : [];
    const uids = searchResults.slice(-maxItems).reverse();
    scannedCount = uids.length;
    result.scanned_count = scannedCount;
    if (!uids.length) {
      db.prepare(`
        UPDATE email_sync_runs
        SET status = 'completed', finished_at = ?, scanned_count = 0, inserted_count = 0, skipped_count = 0, error_count = 0
        WHERE id = ?
      `).run(now(), runId);
      return { ...result, status: 'completed', scanned_count: 0, inserted_count: 0, skipped_count: 0, error_count: 0 };
    }
    for await (const msg of client.fetch(uids, { uid: true, envelope: true, source: true, bodyStructure: true, internalDate: true, flags: true, headers: true })) {
      try {
        const parsed = await simpleParser(msg.source);
        const attachmentMeta = Array.isArray(parsed.attachments)
          ? parsed.attachments.map((item) => ({
              filename: item.filename || '',
              contentType: item.contentType || '',
              size: Number(item.size || 0)
            }))
          : [];
        const imported = upsertEmailMessage(mailbox, folder, {
          message_uid: String(msg.uid || ''),
          message_id: parsed.messageId || msg.envelope?.messageId || '',
          in_reply_to: parsed.inReplyTo || '',
          references_header: Array.isArray(parsed.references) ? parsed.references.join(' ') : text(parsed.references),
          from_email: parsed.from?.value?.[0]?.address || msg.envelope?.from?.[0]?.address || '',
          from_name: parsed.from?.value?.[0]?.name || msg.envelope?.from?.[0]?.name || '',
          to_emails: (parsed.to?.value || []).map((item) => item.address).filter(Boolean).join(','),
          cc_emails: (parsed.cc?.value || []).map((item) => item.address).filter(Boolean).join(','),
          bcc_emails: (parsed.bcc?.value || []).map((item) => item.address).filter(Boolean).join(','),
          subject: parsed.subject || msg.envelope?.subject || '',
          text_body: parsed.text || '',
          html_body: typeof parsed.html === 'string' ? parsed.html : '',
          cleaned_text: cleanMessageText(parsed.text || ''),
          attachments_json: JSON.stringify(attachmentMeta),
          sent_at: parsed.date ? parsed.date.toISOString() : '',
          received_at: msg.internalDate ? msg.internalDate.toISOString() : '',
          raw_headers_json: JSON.stringify({
            messageId: parsed.messageId || '',
            inReplyTo: parsed.inReplyTo || '',
            references: parsed.references || '',
          }),
          parsed_at: now()
        });
        persistParsedAttachments(imported.id, parsed.attachments, { attachmentStore: resolvedAttachmentStore });
        if (imported.normalized.direction === 'inbound' && typeof afterImport === 'function') {
          afterImport(db, imported.id);
        }
        result.messages.push({ id: imported.id, message_id: imported.normalized.message_id, subject: imported.normalized.subject });
        if (imported.inserted) {
          insertedCount += 1;
          result.inserted.push(imported.id);
        } else {
          skippedCount += 1;
          result.skipped.push(imported.id);
        }
      } catch (err) {
        errorCount += 1;
        result.errors.push({
          code: text(err?.code),
          message: sanitizeErrorMessage(err?.message || err)
        });
      }
    }
    db.prepare(`
      UPDATE email_sync_runs
      SET status = 'completed', finished_at = ?, scanned_count = ?, inserted_count = ?, skipped_count = ?, error_count = ?
      WHERE id = ?
    `).run(now(), scannedCount, insertedCount, skippedCount, errorCount, runId);
    return {
      ...result,
      status: 'completed',
      scanned_count: scannedCount,
      inserted_count: insertedCount,
      skipped_count: skippedCount,
      error_count: errorCount
    };
  } catch (err) {
    const message = sanitizeErrorMessage(classifyImapError(err));
    db.prepare(`
      UPDATE email_sync_runs
      SET status = 'failed', finished_at = ?, scanned_count = ?, inserted_count = ?, skipped_count = ?, error_count = ?, error_message = ?
      WHERE id = ?
    `).run(now(), scannedCount, insertedCount, skippedCount, errorCount + 1, message, runId);
    err.runId = runId;
    err.message = message;
    err.summary = {
      ...result,
      status: 'failed',
      scanned_count: scannedCount,
      inserted_count: insertedCount,
      skipped_count: skippedCount,
      error_count: errorCount + 1,
      errors: [...result.errors, { code: text(err?.code), message }]
    };
    throw err;
  } finally {
    try {
      await client.logout();
    } catch (_) {}
  }
}

module.exports = {
  getImapConfig,
  validateImapConfig,
  maskMailboxUser,
  classifyImapError,
  cleanMessageText,
  computeConversationKey,
  extractDomain,
  normalizeSubject,
  resolveFolderName,
  upsertEmailMessage,
  sanitizeErrorMessage,
  persistParsedAttachments,
  syncMailbox
};

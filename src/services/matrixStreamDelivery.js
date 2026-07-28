'use strict';

const crypto = require('node:crypto');
const { parse: parseDomain } = require('tldts');
const { normalizePermissions } = require('../lib/permissions');
const review = require('./matrixStreamReview');
const { renderMatrixMail } = require('./matrixMailRender');
const { scoreDraft, evaluateInitialContact } = require('./matrixStreamGate');
const { scheduleReplyCheck } = require('./matrixStreamFollowup');
const { validateSnapshotRecipientProvenance } = require('./matrixRecipientProvenance');

const INPUT_FIELDS = new Set([
  'actorUserId', 'bindingId', 'workItemId', 'versionId', 'expectedWorkVersion',
  'expectedContentHash', 'chatId', 'cardEventId', 'idempotencyKey', 'canonicalCustomerId'
]);
const ALLOWED_ROLES = new Set(['super_admin', 'foreign_trade_crm_admin']);

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} required`);
  return number;
}

function exactInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('delivery confirmation input required');
  const unknown = Object.keys(value).find(key => !INPUT_FIELDS.has(key));
  if (unknown) throw new Error(`unknown delivery confirmation field: ${unknown}`);
  const token = (field, maximum = 256) => {
    const result = String(value[field] || '').trim();
    if (!result || result.length > maximum || /[\r\n\0]/.test(result)) throw new Error(`${field} required`);
    return result;
  };
  const expectedContentHash = token('expectedContentHash', 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedContentHash)) throw new Error('valid expectedContentHash required');
  const canonicalCustomerId = value.canonicalCustomerId === undefined ? null : positiveInteger(value.canonicalCustomerId, 'canonical customer id');
  return {
    actorUserId: positiveInteger(value.actorUserId, 'actor user id'),
    bindingId: positiveInteger(value.bindingId, 'binding id'),
    workItemId: positiveInteger(value.workItemId, 'work item id'),
    versionId: positiveInteger(value.versionId, 'version id'),
    expectedWorkVersion: positiveInteger(value.expectedWorkVersion, 'expected work version'),
    expectedContentHash,
    chatId: token('chatId'),
    cardEventId: token('cardEventId'),
    idempotencyKey: token('idempotencyKey', 200),
    canonicalCustomerId
  };
}

function clockIso(clock) {
  const value = clock();
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value));
  if (!Number.isFinite(timestamp)) throw new Error('delivery clock invalid');
  return { iso: new Date(timestamp).toISOString(), ms: timestamp };
}

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function domainIdentity(value) {
  const parsed = parseDomain(String(value || '').trim().toLowerCase().replace(/\.$/, ''), {
    allowPrivateDomains: true,
    validateHostname: true
  });
  const supported = parsed.isIcann || parsed.isPrivate || parsed.publicSuffix === 'test';
  return supported && !parsed.isIp && parsed.hostname && parsed.domain ? parsed.domain : null;
}

function plainAddress(value, label) {
  const address = normalizedEmail(value);
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) || /[\r\n]/.test(String(value || ''))) {
    throw new Error(`valid ${label} required`);
  }
  return address;
}

function validHostname(value, label) {
  const hostname = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)) {
    throw new Error(`valid ${label} required`);
  }
  return hostname;
}

function validSelector(value) {
  const selector = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,61}[a-z0-9])?$/.test(selector)) throw new Error('valid DKIM selector required');
  return selector;
}

function jsonObject(value, label) {
  try {
    const parsed = JSON.parse(String(value || ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(label);
    return parsed;
  } catch (_) {
    throw new Error(`${label} invalid`);
  }
}

function httpsSources(value) {
  let sources;
  try { sources = JSON.parse(String(value || '')); } catch (_) { return false; }
  return Array.isArray(sources) && sources.length > 0 && sources.every(source => {
    try {
      const url = new URL(String(source || ''));
      return url.protocol === 'https:' && Boolean(domainIdentity(url.hostname));
    } catch (_) { return false; }
  });
}

function requestFingerprint(input) {
  return crypto.createHash('sha256').update(review.canonicalJson(input)).digest('hex');
}

function shanghaiDay(timestamp) {
  return new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10);
}

function internalEventKey(kind, jobId, fingerprint, ownerToken) {
  const digest = crypto.createHash('sha256').update(`${kind}:${jobId}:${fingerprint}:${ownerToken}`).digest('hex');
  return `mx.delivery.${kind}.${jobId}.${digest}`;
}

function resultFor(db, job) {
  const workItem = db.prepare('SELECT version FROM matrix_work_items WHERE id = ?').get(job.work_item_id);
  return {
    state: job.state,
    error_class: String(job.error_class || ''),
    work_item_version: workItem?.version || null
  };
}

function currentApprovalEvent(db, version) {
  return db.prepare(`
    SELECT id FROM matrix_stream_events
    WHERE work_item_id = ? AND version_id = ? AND actor_user_id = ?
      AND action = 'approved' AND content_hash = ?
    ORDER BY id DESC LIMIT 1
  `).get(version.work_item_id, version.id, version.approved_by, version.content_hash);
}

function canonicalContactAuthorized(db, input, version, workItem) {
  if (!input.canonicalCustomerId) return false;
  const customer = db.prepare('SELECT id, active FROM customers WHERE id = ?').get(input.canonicalCustomerId);
  if (!customer || !Number(customer.active)) throw new Error('canonical customer is inactive');
  const candidate = db.prepare(`
    SELECT 1 FROM matrix_customer_links
    WHERE canonical_customer_id = ? AND source_kind = 'candidate' AND source_id = ?
  `).get(customer.id, String(workItem.candidate_id));
  if (!candidate) throw new Error('canonical customer does not own delivery');
  const contact = db.prepare(`
    SELECT status FROM matrix_contacts
    WHERE canonical_customer_id = ? AND channel = 'email' AND lower(address) = lower(?)
    ORDER BY id ASC LIMIT 1
  `).get(customer.id, version.recipient_email);
  if (!contact || contact.status !== 'active') throw new Error('canonical contact is inactive');
  return true;
}

function freshReplayAuthorization(db, input) {
  const row = db.prepare(`
    SELECT b.status AS binding_status, u.role, u.status AS actor_status, u.permissions_json,
           w.id AS work_item_id, w.owner_user_id
    FROM matrix_actor_bindings b
    JOIN users u ON u.id = b.user_id
    LEFT JOIN matrix_work_items w ON w.id = ?
    WHERE b.id = ? AND b.user_id = ?
  `).get(input.workItemId, input.bindingId, input.actorUserId);
  if (!row || row.binding_status !== 'active' || row.actor_status !== 'active') throw new Error('active actor binding required');
  if (!ALLOWED_ROLES.has(row.role)) throw new Error('matrix administrator role required');
  let permissions;
  try { permissions = JSON.parse(row.permissions_json || 'null'); } catch (_) { permissions = null; }
  const capabilities = normalizePermissions(row.role, permissions).capabilities;
  if (!capabilities.matrixSend) throw new Error('explicit matrixSend capability required');
  if (!row.work_item_id || row.owner_user_id !== input.actorUserId) throw new Error('delivery not authorized');
}

function freshDeliveryGate(db, input, context) {
  const row = db.prepare(`
    SELECT b.id AS binding_id, b.status AS binding_status,
           u.id AS actor_user_id, u.role, u.status AS actor_status, u.permissions_json,
           w.id AS work_item_id, w.candidate_id, w.owner_user_id, w.stage, w.stream_state,
           w.current_stream_version_id, w.version AS work_item_version
    FROM matrix_actor_bindings b
    JOIN users u ON u.id = b.user_id
    LEFT JOIN matrix_work_items w ON w.id = ?
    WHERE b.id = ? AND b.user_id = ?
  `).get(input.workItemId, input.bindingId, input.actorUserId);
  if (!row || row.binding_status !== 'active' || row.actor_status !== 'active') throw new Error('active actor binding required');
  if (!ALLOWED_ROLES.has(row.role)) throw new Error('matrix administrator role required');
  let permissions;
  try { permissions = JSON.parse(row.permissions_json || 'null'); } catch (_) { permissions = null; }
  const capabilities = normalizePermissions(row.role, permissions).capabilities;
  if (!capabilities.matrixSend) throw new Error('explicit matrixSend capability required');
  if (!row.work_item_id || row.owner_user_id !== input.actorUserId) throw new Error('delivery not authorized');
  if (row.stage === 'suppressed' || row.stream_state === 'suppressed') throw new Error('work item is suppressed');
  if (row.work_item_version !== input.expectedWorkVersion) throw new Error('stale work version');
  if (row.current_stream_version_id !== input.versionId) throw new Error('approved version is not current');

  const version = db.prepare('SELECT * FROM matrix_stream_versions WHERE id = ? AND work_item_id = ?').get(input.versionId, input.workItemId);
  if (!version || version.status !== 'approved' || !version.approved_by || !version.approved_at) throw new Error('persisted approved version required');
  if (version.content_hash !== input.expectedContentHash) throw new Error('content hash mismatch');
  const canonicalHash = review.contentHash({
    recipientEmail: version.recipient_email,
    recipientSourceUrl: version.recipient_source_url,
    subject: version.subject,
    bodyEn: version.body_en,
    bodyCn: version.body_cn
  });
  if (canonicalHash !== version.content_hash || canonicalHash !== input.expectedContentHash) throw new Error('content hash mismatch');
  if (!currentApprovalEvent(db, version)) throw new Error('persisted approval evidence required');

  const recipient = review.validateRecipient({
    email: version.recipient_email,
    sourceUrl: version.recipient_source_url,
    verifiedAt: version.recipient_verified_at,
    kind: 'public_company'
  }, new Date(context.ms));
  const evidence = db.prepare(`
    SELECT * FROM matrix_stream_recipient_evidence
    WHERE id = ? AND work_item_id = ? AND status = 'active'
  `).get(version.recipient_evidence_id, input.workItemId);
  if (!evidence || normalizedEmail(evidence.recipient_email) !== recipient.email
      || String(evidence.source_url) !== recipient.sourceUrl
      || new Date(Date.parse(evidence.verified_at)).toISOString() !== recipient.verifiedAt) {
    throw new Error('active recipient provenance required');
  }
  const evidenceSnapshot = jsonObject(evidence.snapshot_json, 'recipient evidence snapshot');
  const versionSnapshot = jsonObject(version.source_snapshot_json, 'version source snapshot');
  if (review.canonicalJson(evidenceSnapshot) !== review.canonicalJson(versionSnapshot)) throw new Error('recipient provenance snapshot mismatch');
  let sourceHost;
  try { sourceHost = new URL(recipient.sourceUrl).hostname; } catch (_) { throw new Error('recipient provenance source invalid'); }
  const organizationDomain = domainIdentity(evidence.organization_domain);
  if (!organizationDomain || domainIdentity(sourceHost) !== organizationDomain) throw new Error('recipient provenance domain mismatch');
  try {
    validateSnapshotRecipientProvenance({
      email: recipient.email,
      sourceUrl: recipient.sourceUrl,
      verifiedAt: recipient.verifiedAt,
      organizationDomain,
      organizationName: versionSnapshot.company,
      snapshot: versionSnapshot,
      now: context.iso
    });
  } catch (_) {
    throw new Error('recipient provenance domain mismatch');
  }

  const storedQuality = jsonObject(version.quality_json, 'stored quality');
  const quality = scoreDraft({
    subject: version.subject,
    bodyEn: version.body_en,
    bodyCn: version.body_cn,
    recipient,
    evidence: versionSnapshot,
    now: context.iso
  });
  if (!quality.passed || quality.score < 80 || quality.score !== version.quality_score
      || review.canonicalJson(quality) !== review.canonicalJson(storedQuality)) throw new Error('quality final gate blocked');

  canonicalContactAuthorized(db, input, version, row);
  const identity = evaluateInitialContact(db, {
    email: recipient.email,
    domain: organizationDomain,
    companyName: versionSnapshot.company,
    aliases: versionSnapshot.aliases,
    excludeCustomerIds: input.canonicalCustomerId ? [input.canonicalCustomerId] : [],
    now: context.iso
  });
  if (!identity.allowed || identity.route !== 'initial_contact') throw new Error(`initial contact gate blocked: ${identity.reasons.join(',')}`);

  const senderChecks = db.prepare(`
    SELECT * FROM matrix_stream_sender_checks
    WHERE sender_domain = ? AND checked_at <= ? AND expires_at > ?
    ORDER BY checked_at DESC
  `).all(context.messageIdDomain, context.iso, context.iso);
  const senderCheck = senderChecks.find(check => {
    try { return jsonObject(check.detail_json, 'sender readiness detail').selector === context.dkimSelector; } catch (_) { return false; }
  });
  if (!senderCheck || !senderCheck.spf_ok || !senderCheck.dkim_ok || !senderCheck.dmarc_ok
      || !senderCheck.tls_ok || !senderCheck.smtp_ok) throw new Error('sender readiness blocked');
  const countryCode = String(versionSnapshot.country_code || '').trim().toUpperCase();
  const policy = db.prepare(`
    SELECT * FROM matrix_stream_country_policies WHERE country_code = ? AND channel = 'email'
  `).get(countryCode);
  const reviewedAt = Date.parse(String(policy?.reviewed_at || ''));
  const expiresAt = Date.parse(String(policy?.expires_at || ''));
  if (!/^[A-Z]{2}$/.test(countryCode) || !policy || policy.status !== 'approved'
      || policy.sender_identity_required !== 1 || policy.opt_out_required !== 1
      || !Number.isFinite(reviewedAt) || reviewedAt > context.ms
      || !Number.isFinite(expiresAt) || expiresAt <= context.ms
      || !httpsSources(policy.source_urls_json)) throw new Error('country channel policy blocked');

  return { row, version, organizationDomain };
}

function createMatrixStreamDelivery({
  db, transport, clock = () => new Date(), fromAddress, replyToAddress = fromAddress, messageIdDomain, dkimSelector,
  leaseMs = 30000, waitMs = 20000, pollMs = 25,
  requireCanonicalCutover = process.env.NODE_ENV === 'production'
} = {}) {
  if (!db || typeof db.prepare !== 'function' || !transport || typeof transport.sendMail !== 'function' || typeof clock !== 'function') {
    throw new Error('delivery dependencies required');
  }
  const from = plainAddress(fromAddress, 'from address');
  const replyTo = plainAddress(replyToAddress, 'reply-to address');
  if (replyTo !== from) throw new Error('sender and reply-to mismatch');
  const domain = validHostname(messageIdDomain, 'message id domain');
  const selector = validSelector(dkimSelector);
  if (from.split('@')[1] !== domain) throw new Error('sender and message id domain mismatch');
  const bounded = (value, fallback, minimum, maximum) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.trunc(number))) : fallback;
  };
  const timing = {
    leaseMs: bounded(leaseMs, 30000, 100, 300000),
    waitMs: bounded(waitMs, 20000, 25, 60000),
    pollMs: bounded(pollMs, 25, 5, 1000)
  };
  const inFlight = new Map();

  function reserveCapacity(recipientDomain, context) {
    const rows = db.prepare(`
      SELECT j.state, j.reservation_day, j.updated_at, j.recipient_domain, v.recipient_email
      FROM matrix_stream_jobs j
      LEFT JOIN matrix_stream_versions v ON v.id = j.version_id
      WHERE j.state IN ('pending','sending','accepted','ambiguous')
    `).all();
    const daily = rows.filter(row => {
      const day = String(row.reservation_day || '').trim();
      if (day) return day === shanghaiDay(context.ms);
      const at = Date.parse(String(row.updated_at || ''));
      return Number.isFinite(at) && shanghaiDay(at) === shanghaiDay(context.ms);
    }).length;
    if (daily >= 5) throw new Error('daily delivery reservation limit 5');
    const coolingStart = context.ms - 90 * 86400000;
    const blockedDomain = rows.some(row => {
      const storedDomain = String(row.recipient_domain || '').trim().toLowerCase()
        || normalizedEmail(row.recipient_email).split('@')[1] || '';
      if (domainIdentity(storedDomain) !== recipientDomain) return false;
      if (row.state !== 'accepted') return true;
      const at = Date.parse(String(row.updated_at || ''));
      return Number.isFinite(at) && at >= coolingStart && at <= context.ms;
    });
    if (blockedDomain) throw new Error('recipient domain reservation or cooling active');
  }

  function reserveEventKeys(jobId, fingerprint, ownerToken, context) {
    const keys = {
      start: internalEventKey('start', jobId, fingerprint, ownerToken),
      result: internalEventKey('result', jobId, fingerprint, ownerToken)
    };
    for (const [kind, eventKey] of Object.entries(keys)) {
      if (db.prepare('SELECT 1 FROM matrix_stream_events WHERE idempotency_key = ?').get(eventKey)) {
        throw new Error('delivery event key collision');
      }
      db.prepare(`
        INSERT INTO matrix_stream_delivery_event_keys (event_key, job_id, event_kind, request_hash, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(eventKey, jobId, kind, fingerprint, context.iso);
    }
    return keys;
  }

  function prepare(input) {
    const context = { ...clockIso(clock), messageIdDomain: domain, dkimSelector: selector };
    const fingerprint = requestFingerprint(input);
    const transaction = db.transaction(() => {
      const existing = db.prepare('SELECT * FROM matrix_stream_jobs WHERE idempotency_key = ?').get(input.idempotencyKey);
      if (existing) {
        const event = db.prepare(`
          SELECT request_fingerprint FROM matrix_stream_events
          WHERE job_id = ? AND action = 'delivery_started' ORDER BY id ASC LIMIT 1
        `).get(existing.id);
        if (!event || event.request_fingerprint !== fingerprint
            || existing.work_item_id !== input.workItemId || existing.version_id !== input.versionId) {
          throw new Error('delivery idempotency conflict');
        }
        freshReplayAuthorization(db, input);
        if (existing.state === 'sending') {
          const leaseExpiresAt = Date.parse(String(existing.lease_expires_at || ''));
          return { kind: Number.isFinite(leaseExpiresAt) && leaseExpiresAt > context.ms ? 'wait' : 'expired', job: existing };
        }
        return { kind: 'replay', job: existing };
      }
      const gated = freshDeliveryGate(db, input, context);
      const blocking = db.prepare(`
        SELECT state FROM matrix_stream_jobs
        WHERE version_id = ? AND content_hash = ? AND state IN ('pending','sending','accepted','ambiguous')
        ORDER BY id DESC LIMIT 1
      `).get(input.versionId, input.expectedContentHash);
      if (blocking) throw new Error(`delivery ${blocking.state} blocks resend`);
      const recipientDomain = gated.organizationDomain;
      if (!recipientDomain) throw new Error('valid recipient reservation domain required');
      reserveCapacity(recipientDomain, context);
      const ownerToken = crypto.randomUUID();
      const leaseExpiresAt = new Date(context.ms + timing.leaseMs).toISOString();
      const placeholder = `<pending-${crypto.createHash('sha256').update(`${input.idempotencyKey}:${fingerprint}`).digest('hex')}@invalid>`;
      const inserted = db.prepare(`
        INSERT INTO matrix_stream_jobs (
          work_item_id, version_id, idempotency_key, content_hash, message_id, state,
          attempt_count, error_class, redacted_diagnostic, created_by, owner_token,
          lease_expires_at, recipient_domain, sender_email, reservation_day, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', 0, '', '', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(input.workItemId, input.versionId, input.idempotencyKey, input.expectedContentHash,
        placeholder, input.actorUserId, ownerToken, leaseExpiresAt, recipientDomain, from,
        shanghaiDay(context.ms), context.iso, context.iso);
      const jobId = Number(inserted.lastInsertRowid);
      const messageId = `<matrix-stream-${jobId}-${input.expectedContentHash.slice(0, 20)}@${domain}>`;
      db.prepare(`
        UPDATE matrix_stream_jobs SET message_id = ?, state = 'sending', attempt_count = 1, updated_at = ?
        WHERE id = ? AND state = 'pending'
      `).run(messageId, context.iso, jobId);
      const eventKeys = reserveEventKeys(jobId, fingerprint, ownerToken, context);
      db.prepare(`
        INSERT INTO matrix_stream_events (
          work_item_id, version_id, job_id, actor_user_id, matrix_binding_id,
          chat_id, card_event_id, action, idempotency_key, request_fingerprint,
          content_hash, before_json, after_json, diagnostic, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'delivery_started', ?, ?, ?, ?, ?, '', ?)
      `).run(input.workItemId, input.versionId, jobId, input.actorUserId, input.bindingId,
        input.chatId, input.cardEventId, eventKeys.start, fingerprint, input.expectedContentHash,
        JSON.stringify({ version_status: gated.version.status, approval_event: true }),
        JSON.stringify({ state: 'sending', version_id: input.versionId }), context.iso);
      return { kind: 'new', job: db.prepare('SELECT * FROM matrix_stream_jobs WHERE id = ?').get(jobId), version: gated.version };
    });
    return transaction.immediate();
  }

  function persistResult(job, input, state, errorClass) {
    if (!['accepted', 'failed', 'ambiguous'].includes(state)) throw new Error('valid delivery result required');
    const context = clockIso(clock);
    const transaction = db.transaction(() => {
      let current = db.prepare('SELECT * FROM matrix_stream_jobs WHERE id = ?').get(job.id);
      if (!current) throw new Error('delivery job not found');
      if (current.state !== 'sending') return resultFor(db, current);
      const currentLeaseMs = Date.parse(String(current.lease_expires_at || ''));
      const ownsActiveLease = current.owner_token === job.owner_token
        && current.lease_expires_at === job.lease_expires_at
        && Number.isFinite(currentLeaseMs) && currentLeaseMs > context.ms;
      if (!ownsActiveLease && Number.isFinite(currentLeaseMs) && currentLeaseMs > context.ms) {
        throw new Error('delivery ownership lost');
      }
      const finalState = ownsActiveLease ? state : 'ambiguous';
      const finalErrorClass = ownsActiveLease ? errorClass : 'expired_send_lease';
      const changed = ownsActiveLease
        ? db.prepare(`
          UPDATE matrix_stream_jobs
          SET state = ?, error_class = ?, redacted_diagnostic = ?, updated_at = ?
          WHERE id = ? AND state = 'sending' AND owner_token = ? AND lease_expires_at = ?
        `).run(finalState, finalErrorClass, finalErrorClass, context.iso, job.id, current.owner_token, current.lease_expires_at)
        : db.prepare(`
          UPDATE matrix_stream_jobs
          SET state = 'ambiguous', error_class = ?, redacted_diagnostic = ?, updated_at = ?
          WHERE id = ? AND state = 'sending' AND owner_token = ? AND lease_expires_at = ?
        `).run(finalErrorClass, finalErrorClass, context.iso, job.id, current.owner_token, current.lease_expires_at);
      if (changed.changes !== 1) {
        current = db.prepare('SELECT * FROM matrix_stream_jobs WHERE id = ?').get(job.id);
        if (current && current.state !== 'sending') return resultFor(db, current);
        throw new Error('delivery result conflict');
      }
      if (finalState === 'accepted') {
        scheduleReplyCheck(db, { jobId: job.id, channel: 'email', priority: 'normal' });
        db.prepare(`
          UPDATE matrix_work_items
          SET stream_state = 'sent', version = version + 1, updated_at = ?
          WHERE id = ? AND current_stream_version_id = ?
        `).run(context.iso, job.work_item_id, job.version_id);
      } else if (finalState === 'ambiguous') {
        db.prepare(`
          UPDATE matrix_work_items SET stream_state = 'delivery_ambiguous', updated_at = ?
          WHERE id = ? AND current_stream_version_id = ?
        `).run(context.iso, job.work_item_id, job.version_id);
      }
      const eventKey = db.prepare(`
        SELECT event_key FROM matrix_stream_delivery_event_keys
        WHERE job_id = ? AND event_kind = 'result' AND request_hash = ?
      `).get(job.id, requestFingerprint(input))?.event_key;
      if (!eventKey) throw new Error('reserved delivery result event key required');
      db.prepare(`
        INSERT INTO matrix_stream_events (
          work_item_id, version_id, job_id, actor_user_id, matrix_binding_id,
          chat_id, card_event_id, action, idempotency_key, request_fingerprint, content_hash,
          before_json, after_json, diagnostic, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, '{"state":"sending"}', ?, ?, ?)
      `).run(job.work_item_id, job.version_id, job.id, input.actorUserId, input.bindingId,
        input.chatId, input.cardEventId, `delivery_${finalState}`, eventKey, job.content_hash,
        JSON.stringify({ state: finalState, followup: finalState === 'accepted' ? 'scheduled' : 'not_scheduled' }), finalErrorClass, context.iso);
      return resultFor(db, db.prepare('SELECT * FROM matrix_stream_jobs WHERE id = ?').get(job.id));
    });
    return transaction.immediate();
  }

  function classifyError(error) {
    const responseCode = Number(error?.responseCode || error?.statusCode || 0);
    if (responseCode >= 500 && responseCode <= 599) return { state: 'failed', errorClass: 'recipient_rejected' };
    return { state: 'ambiguous', errorClass: 'transport_outcome_unknown' };
  }

  async function deliver(prepared, input) {
    const { job, version } = prepared;
    const rendered = renderMatrixMail({ bodyEn: version.body_en });
    let response;
    try {
      response = await transport.sendMail({
        from,
        replyTo,
        to: version.recipient_email,
        subject: version.subject,
        text: rendered.text,
        html: rendered.html,
        messageId: job.message_id,
        headers: { 'X-Matrix-Stream-Version': String(version.id) }
      });
    } catch (error) {
      const classified = classifyError(error);
      return persistResult(job, input, classified.state, classified.errorClass);
    }
    const target = normalizedEmail(version.recipient_email);
    const accepted = Array.isArray(response?.accepted) ? response.accepted.map(normalizedEmail) : [];
    const rejected = Array.isArray(response?.rejected) ? response.rejected.map(normalizedEmail) : [];
    const targetAccepted = accepted.includes(target);
    const targetRejected = rejected.includes(target);
    if (targetAccepted && !targetRejected) return persistResult(job, input, 'accepted', '');
    if (targetRejected && !targetAccepted) return persistResult(job, input, 'failed', 'recipient_rejected');
    return persistResult(job, input, 'ambiguous', 'transport_outcome_unknown');
  }

  async function waitForTerminal(job, input) {
    const deadline = Date.now() + timing.waitMs;
    while (true) {
      const current = db.prepare('SELECT * FROM matrix_stream_jobs WHERE id = ?').get(job.id);
      if (!current) throw new Error('delivery job not found');
      if (current.state !== 'sending') return resultFor(db, current);
      const now = clockIso(clock);
      const leaseExpiresAt = Date.parse(String(current.lease_expires_at || ''));
      if (!Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= now.ms) {
        return persistResult(current, input, 'ambiguous', 'expired_send_lease');
      }
      if (Date.now() >= deadline) throw new Error('delivery in progress timeout');
      await new Promise(resolve => setTimeout(resolve, timing.pollMs));
    }
  }

  return {
    async confirm(rawInput) {
      if (requireCanonicalCutover) {
        require('./matrixLedgerCutover').assertCanonicalDeliveryOnly({ db });
      }
      const input = exactInput(rawInput);
      const prepared = prepare(input);
      if (prepared.kind === 'wait') {
        if (inFlight.has(prepared.job.id)) return inFlight.get(prepared.job.id);
        return waitForTerminal(prepared.job, input);
      }
      if (prepared.kind === 'expired') return persistResult(prepared.job, input, 'ambiguous', 'expired_send_lease');
      if (prepared.kind === 'replay') {
        return resultFor(db, prepared.job);
      }
      const pending = deliver(prepared, input);
      inFlight.set(prepared.job.id, pending);
      try { return await pending; } finally { inFlight.delete(prepared.job.id); }
    }
  };
}

module.exports = { createMatrixStreamDelivery };

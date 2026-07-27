'use strict';

const crypto = require('crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { defaultPermissionsByRole, normalizePermissions } = require('../lib/permissions');
const { createCacheIndexView } = require('../lib/cacheIndexView');
const { createPacketGate } = require('../lib/packetGate');
const { buildMatrixOverview } = require('../services/matrixOverview');
const { searchMatrixContext, resolveMatrixContext, contextByRecordId } = require('../services/matrixContextSearch');
const { createMatrixStreamText } = require('../services/matrixStreamText');
const { scoreSignalMatch } = require('../services/matrixSignalMatch');
const { createMatrixLedgerCommand } = require('../services/matrixLedgerCommand');

const ALLOWED_ROLES = new Set(['super_admin', 'foreign_trade_crm_admin']);
const REGIONS = new Set(['africa', 'americas', 'asia', 'europe', 'oceania']);
const PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3']);
const STATUSES = new Set(['valid', 'needs_review']);
const STAGES = new Set(['selected', 'draft_pending', 'review_pending', 'suppressed']);
const LIST_FIELDS = new Set(['region', 'country', 'category', 'priority', 'status', 'page', 'page_size']);
const VERSION_FIELDS = new Set(['expected_work_version', 'base_version_id', 'revision_instruction', 'idempotency_key']);
const APPROVAL_FIELDS = new Set(['expected_work_version', 'expected_content_hash', 'idempotency_key']);
const SEND_FIELDS = new Set(['expected_work_version', 'expected_content_hash', 'chat_id', 'card_event_id', 'idempotency_key']);
const LEDGER_CONFIRM_FIELDS = new Set(['expected_content_hash', 'confirmation_text', 'chat_id', 'card_event_id', 'idempotency_key']);

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function rejectUnknown(value, allowed, label) {
  const object = plainObject(value, label);
  const unknown = Object.keys(object).find(key => !allowed.has(key));
  if (unknown) throw new Error(`unknown ${label} field: ${unknown}`);
  return object;
}

function positiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label} must be a positive integer`);
  return Math.min(number, maximum);
}

function normalizedListFilters(query, { recommendation = false } = {}) {
  const input = rejectUnknown(query, LIST_FIELDS, 'query');
  const filters = {};
  if (input.region !== undefined) {
    const region = String(input.region).trim();
    if (!REGIONS.has(region)) throw new Error('invalid region');
    filters.region = region;
  }
  if (input.country !== undefined) {
    const country = String(input.country).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw new Error('invalid country');
    if (country === 'CN' || country === 'IN') throw new Error('country is excluded');
    filters.country = country;
  }
  if (input.category !== undefined) {
    const category = String(input.category).trim();
    if (!/^\p{L}[\p{L}\p{N} &+/_-]{0,63}$/u.test(category)) throw new Error('invalid category');
    filters.category = category;
  }
  if (input.priority !== undefined) {
    const priority = String(input.priority).trim();
    if (!PRIORITIES.has(priority)) throw new Error('invalid priority');
    filters.priority = priority;
  }
  if (input.status !== undefined) {
    const status = String(input.status).trim();
    if (!STATUSES.has(status)) throw new Error('invalid status');
    filters.status = status;
  }
  filters.page = input.page === undefined ? 1 : positiveInteger(input.page, 'page', 1000000);
  const requestedSize = input.page_size === undefined ? (recommendation ? 5 : 10) : positiveInteger(input.page_size, 'page_size', 20);
  filters.page_size = recommendation ? Math.min(5, requestedSize) : requestedSize;
  return filters;
}

function safeEqual(left, right) {
  const a = crypto.createHash('sha256').update(String(left || ''), 'utf8').digest();
  const b = crypto.createHash('sha256').update(String(right || ''), 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

function createMatrixBridgeAuth({ db, bridgeToken = process.env.MATRIX_BRIDGE_TOKEN } = {}) {
  const configuredToken = String(bridgeToken || '');
  if (process.env.NODE_ENV === 'production' && configuredToken.length < 32) {
    throw new Error('MATRIX_BRIDGE_TOKEN must contain at least 32 characters in production');
  }
  return (req, res, next) => {
    const suppliedToken = req.get('x-matrix-bridge-token');
    const openIdHeader = req.get('x-feishu-open-id');
    if (suppliedToken === undefined && openIdHeader === undefined) return next();
    const openId = String(openIdHeader || '').trim();
    const tokenMatches = safeEqual(suppliedToken, configuredToken);
    if (!configuredToken || !tokenMatches || !openId || openId.length > 128) {
      return res.status(401).json({ error: 'invalid matrix bridge credentials' });
    }
    const row = db.prepare(`
      SELECT u.id, u.username, u.full_name, u.role, u.permissions_json, b.id AS binding_id
      FROM matrix_actor_bindings b
      JOIN users u ON u.id = b.user_id
      WHERE b.feishu_open_id = ? AND b.status = 'active' AND u.status = 'active'
    `).get(openId);
    if (!row) return res.status(403).json({ error: 'active actor binding required' });
    let permissions;
    try { permissions = row.permissions_json ? JSON.parse(row.permissions_json) : defaultPermissionsByRole(row.role); } catch (_) { permissions = defaultPermissionsByRole(row.role); }
    req.user = { id: row.id, role: row.role, userName: row.username, fullName: row.full_name || '', permissions };
    req.authMode = 'matrix_bridge';
    req.matrixBinding = { id: row.binding_id, feishuOpenId: openId };
    next();
  };
}

function requireMatrixRole(req, res, next) {
  if (!req.user || !ALLOWED_ROLES.has(req.user.role)) return res.status(403).json({ error: 'matrix administrator role required' });
  next();
}

function errorStatus(error) {
  const message = String(error?.message || 'request failed');
  if (/stale (?:work )?version|session rehydration incomplete|idempotency request conflict/.test(message)) return 409;
  if (/not authorized|actor binding|required binding|service binding|inactive|revoked|matrixSend capability/.test(message)) return 403;
  if (/text_provider_unavailable/.test(message)) return 503;
  if (/not found/.test(message)) return 404;
  return 400;
}

function inboxClock(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) throw new Error('invalid inbox relay clock');
  return date;
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) { return {}; }
}

function hydrateInboxJob(db, id) {
  const row = db.prepare(`
    SELECT j.*, em.from_email, em.from_name, em.subject, em.cleaned_text, em.received_at,
           COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), '') AS customer_name,
           c.country AS customer_country, i.inquiry_title
    FROM matrix_inbox_jobs j
    JOIN email_messages em ON em.id = j.email_message_id
    LEFT JOIN customers c ON c.id = j.matched_customer_id
    LEFT JOIN inquiries i ON i.id = j.matched_inquiry_id
    WHERE j.id = ?
  `).get(id);
  if (!row) return null;
  const attachments = db.prepare(`
    SELECT id, storage_key, original_file_name, detected_mime_type, file_size, sha256,
           availability_state, quarantine_reason, media_order
    FROM matrix_inbox_attachments
    WHERE email_message_id = ?
    ORDER BY media_order ASC
  `).all(row.email_message_id).map(item => ({
    attachment_id: Number(item.id),
    storage_key: item.storage_key || '',
    original_file_name: item.original_file_name || '',
    detected_mime_type: item.detected_mime_type || '',
    file_size: Number(item.file_size || 0),
    sha256: item.sha256 || '',
    availability_state: item.availability_state,
    quarantine_reason: item.quarantine_reason || ''
  }));
  return {
    id: Number(row.id),
    email_message_id: Number(row.email_message_id),
    notification_uuid: row.notification_uuid,
    lease_token: row.lease_token,
    lease_expires_at: row.lease_expires_at,
    correlation_state: row.correlation_state,
    matched_customer_id: row.matched_customer_id ? Number(row.matched_customer_id) : null,
    matched_inquiry_id: row.matched_inquiry_id ? Number(row.matched_inquiry_id) : null,
    customer_name: row.customer_name || '',
    customer_country: row.customer_country || '',
    inquiry_title: row.inquiry_title || '',
    sender_name: row.from_name || '',
    sender_email: row.from_email || '',
    subject: row.subject || '',
    received_at: row.received_at || '',
    original_preview: String(row.cleaned_text || '').slice(0, 800),
    analysis: parseJsonObject(row.analysis_json),
    analysis_state: row.analysis_state,
    delivery_attempts: Number(row.delivery_attempts || 0),
    attachments
  };
}

function claimInboxJob(db, { clock = () => new Date() } = {}) {
  const nowDate = inboxClock(clock());
  const nowIso = nowDate.toISOString();
  const leaseToken = crypto.randomUUID();
  const leaseExpires = new Date(nowDate.getTime() + 10 * 60 * 1000).toISOString();
  const id = db.transaction(() => {
    const row = db.prepare(`
      SELECT id FROM matrix_inbox_jobs
      WHERE delivery_state IN ('pending', 'retry')
        AND delivery_attempts < 5
        AND (lease_token IS NULL OR lease_expires_at <= ?)
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `).get(nowIso);
    if (!row) return 0;
    const updated = db.prepare(`
      UPDATE matrix_inbox_jobs
      SET lease_token = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND (lease_token IS NULL OR lease_expires_at <= ?)
    `).run(leaseToken, leaseExpires, nowIso, row.id, nowIso);
    return updated.changes === 1 ? Number(row.id) : 0;
  }).immediate();
  return id ? hydrateInboxJob(db, id) : null;
}

function ackInboxJob(db, jobId, input, { clock = () => new Date() } = {}) {
  const id = positiveInteger(jobId, 'inbox job id');
  const body = rejectUnknown(input, new Set(['lease_token', 'notification_uuid', 'status']), 'inbox acknowledgment');
  const leaseToken = String(body.lease_token || '');
  const notificationUuid = String(body.notification_uuid || '');
  if (body.status !== 'delivered' || !leaseToken || !notificationUuid) throw new Error('valid delivery acknowledgment required');
  const row = db.prepare('SELECT * FROM matrix_inbox_jobs WHERE id = ?').get(id);
  if (!row) throw new Error('inbox job not found');
  if (row.notification_uuid !== notificationUuid) throw new Error('notification binding mismatch');
  if (row.delivery_state === 'delivered') return { id, delivery_state: 'delivered', repeated: true };
  if (row.lease_token !== leaseToken) throw new Error('inbox job lease mismatch');
  const deliveredAt = inboxClock(clock()).toISOString();
  db.prepare(`
    UPDATE matrix_inbox_jobs
    SET delivery_state = 'delivered', lease_token = NULL, lease_expires_at = NULL,
        receipt_json = ?, last_error = NULL, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify({ status: 'delivered', delivered_at: deliveredAt }), deliveredAt, id);
  return { id, delivery_state: 'delivered', repeated: false };
}

function failInboxJob(db, jobId, input, { clock = () => new Date() } = {}) {
  const id = positiveInteger(jobId, 'inbox job id');
  const body = rejectUnknown(input, new Set(['lease_token', 'error_code']), 'inbox failure');
  const leaseToken = String(body.lease_token || '');
  const errorCode = String(body.error_code || '');
  const allowedErrors = new Set(['feishu_rate_limited', 'feishu_unavailable', 'attachment_unavailable', 'attachment_integrity', 'delivery_failed']);
  if (!leaseToken || !allowedErrors.has(errorCode)) throw new Error('valid inbox failure required');
  const row = db.prepare('SELECT lease_token, delivery_attempts FROM matrix_inbox_jobs WHERE id = ?').get(id);
  if (!row) throw new Error('inbox job not found');
  if (row.lease_token !== leaseToken) throw new Error('inbox job lease mismatch');
  const attempts = Number(row.delivery_attempts || 0) + 1;
  const state = attempts >= 5 ? 'manual_review' : 'retry';
  const ts = inboxClock(clock()).toISOString();
  db.prepare(`
    UPDATE matrix_inbox_jobs
    SET delivery_state = ?, delivery_attempts = ?, lease_token = NULL,
        lease_expires_at = NULL, last_error = ?, updated_at = ?
    WHERE id = ?
  `).run(state, attempts, errorCode, ts, id);
  return { id, delivery_state: state, delivery_attempts: attempts };
}

function inboxWorkbench(db, { backlogItems = [] } = {}) {
  const overview = buildMatrixOverview(db, { backlogItems });
  const counts = {
    reply_review: Number(overview.counts.awaiting_our_reply || 0) + Number(overview.counts.first_contact_unanswered || 0),
    quote_review: Number(overview.counts.quote_required || 0) + Number(overview.counts.quote_in_progress || 0),
    waiting_customer: Number(overview.counts.waiting_customer || 0),
    outreach_waiting: Number(overview.counts.outreach_waiting || 0),
    archive_review: Number(overview.counts.archive_review || 0),
    active_supervisor: backlogItems.length
  };
  const actionable = overview.threads.filter(row => ['awaiting_our_reply', 'first_contact_unanswered', 'quote_required', 'quote_in_progress'].includes(row.state));
  const incomplete = actionable.filter(row => row.translation_state !== 'complete' || row.background_state === 'research_required');
  return { counts, items: overview.items.slice(0, 50), overall_ready: incomplete.length === 0, incomplete_count: incomplete.length, generated_at: overview.generated_at };
}

function productionBacklogItems() {
  const target = path.resolve(__dirname, '../../.runtime/vm_debug_ci/workspace/outputs/matrix-supervisor-backlog.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch (_) { return []; }
}

function reviewFailure(code, details = null) {
  const error = new Error(code);
  error.matrixReviewCode = code;
  error.matrixReviewDetails = details;
  return error;
}

function reviewErrorDescriptor(error) {
  const message = String(error?.message || '');
  const explicit = error?.matrixReviewCode;
  if (explicit === 'text_provider_unavailable' || /text_provider_unavailable/.test(message)) {
    return { status: 503, code: 'text_provider_unavailable', message: 'Text revision service is unavailable.' };
  }
  if (explicit === 'text_provider_failure') {
    return { status: 503, code: 'text_provider_failure', message: 'Text revision service is temporarily unavailable.' };
  }
  if (explicit === 'claim_wait_timeout') {
    return { status: 503, code: 'review_in_progress', message: 'Review request is still in progress.' };
  }
  if (explicit === 'claim_lost') {
    return { status: 409, code: 'review_claim_lost', message: 'Review request lease was lost.' };
  }
  if (explicit === 'strategy_match_blocked') {
    return { status: 422, code: 'strategy_match_blocked', message: 'Strategy match research is incomplete.', details: error.matrixReviewDetails || null };
  }
  if (/idempotency request conflict/.test(message)) {
    return { status: 409, code: 'idempotency_conflict', message: 'Idempotency key conflicts with another request.' };
  }
  if (/stale (?:work )?version|stale research|official evidence changed|session rehydration incomplete/.test(message)) {
    return { status: 409, code: 'stale_review_state', message: 'Review state is stale.' };
  }
  if (/not authorized|actor binding|required binding|service binding|inactive|revoked|matrixSend capability|administrator role/.test(message)) {
    return { status: 403, code: 'review_forbidden', message: 'Review action is not authorized.' };
  }
  if (/not found/.test(message)) {
    return { status: 404, code: 'review_not_found', message: 'Review resource was not found.' };
  }
  if (/must|required|invalid|unknown|cannot|suppressed|mismatch|conflict|eligible|unsupported|contact form|quality gate|canonical customer|canonical contact/.test(message)) {
    return { status: 400, code: 'invalid_review_request', message: 'Invalid review request.' };
  }
  return { status: 500, code: 'internal_error', message: 'Review request could not be completed.' };
}

function sendReviewError(res, error) {
  const descriptor = reviewErrorDescriptor(error);
  if (descriptor.status >= 500) console.warn(`[matrix-review] ${descriptor.code}`);
  return res.status(descriptor.status).json({ error: { code: descriptor.code, message: descriptor.message, ...(descriptor.details ? { details: descriptor.details } : {}) } });
}

function deliveryErrorDescriptor(error) {
  const message = String(error?.message || '');
  if (/delivery service unavailable/.test(message)) {
    return { status: 503, code: 'delivery_unavailable', message: 'Delivery confirmation is unavailable.' };
  }
  if (/delivery in progress timeout/.test(message)) {
    return { status: 503, code: 'delivery_in_progress', message: 'Delivery confirmation is still in progress.' };
  }
  if (/active actor binding|administrator role|matrixSend capability|not authorized/.test(message)) {
    return { status: 403, code: 'delivery_forbidden', message: 'Delivery confirmation is not authorized.' };
  }
  if (/expired|stale work version|stale research or route readiness|idempotency(?: request)? conflict|blocks resend|not current|result conflict/.test(message)) {
    return { status: 409, code: 'delivery_conflict', message: 'Delivery confirmation conflicts with current state.' };
  }
  if (/not found|delivery confirmation (?:version|customer|contact|resource) missing/.test(message)) {
    return { status: 404, code: 'delivery_not_found', message: 'Delivery confirmation resource was not found.' };
  }
  if (/required|invalid|unknown|mismatch|blocked|suppressed|approved|provenance|quality|readiness|policy|official evidence|canonical customer|canonical contact/.test(message)) {
    return { status: 400, code: 'invalid_delivery_confirmation', message: 'Invalid delivery confirmation.' };
  }
  return { status: 500, code: 'delivery_internal_error', message: 'Delivery confirmation could not be completed.' };
}

function sendDeliveryError(res, error) {
  const descriptor = deliveryErrorDescriptor(error);
  if (descriptor.status >= 500) console.warn(`[matrix-delivery] ${descriptor.code}`);
  return res.status(descriptor.status).json({ error: { code: descriptor.code, message: descriptor.message } });
}

function createMatrixRouter({
  db,
  audit,
  candidateDbPath = process.env.MATRIX_STREAM_DB_PATH,
  clock,
  reviewService = require('../services/matrixStreamReview'),
  deliveryService,
  previewService,
  ledgerCommand,
  threadRouteService,
  threadPreviewService,
  threadDeliveryService,
  correlationService = require('../services/matrixStreamCorrelation'),
  textService = createMatrixStreamText(),
  claimOptions = {}
} = {}) {
  const router = express.Router();
  const view = createCacheIndexView({ dbPath: candidateDbPath });
  const gate = createPacketGate({ db, now: clock, candidateValidator: candidateId => Boolean(view.recommendationById(candidateId)) });
  const command = ledgerCommand || (previewService && deliveryService
    ? createMatrixLedgerCommand({
      db, reviewService, previewService, deliveryService, clock,
      currentEvidence: async ({ workItem, version }) => assertVersionStrategyCurrent(workItem, version)
    }) : null);

  router.use(requireMatrixRole);

  router.get('/ready', (req, res) => {
    try {
      if (req.authMode !== 'matrix_bridge' || !req.matrixBinding) throw new Error('active service binding required');
      rejectUnknown(req.query, new Set(), 'query');
      view.ready();
      res.json({ ok: true, service: 'matrix' });
    } catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
  });

  router.post('/inbox/jobs/claim', (req, res) => {
    try {
      if (req.authMode !== 'matrix_bridge' || !req.matrixBinding) throw new Error('active service binding required');
      rejectUnknown(req.query, new Set(), 'query');
      rejectUnknown(req.body || {}, new Set(), 'inbox claim');
      const job = claimInboxJob(db, { clock });
      res.json({ ok: true, job });
    } catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
  });

  router.get('/inbox/workbench', (req, res) => {
    try {
      if (req.authMode !== 'matrix_bridge' || !req.matrixBinding) throw new Error('active service binding required');
      rejectUnknown(req.query, new Set(), 'query');
      res.json({ ok: true, ...inboxWorkbench(db, { backlogItems: productionBacklogItems() }) });
    } catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
  });

  router.get('/context/search', (req, res) => {
    try {
      if (req.authMode !== 'matrix_bridge' || !req.matrixBinding) throw new Error('active service binding required');
      const query = rejectUnknown(req.query, new Set(['query']), 'query');
      const result = searchMatrixContext(db, query.query);
      audit({
        role: req.user.role,
        userName: req.user.userName,
        action: 'matrix_context_search',
        resourceType: 'matrix_context',
        resourceId: null,
        detail: JSON.stringify({ matchCount: result.matches.length })
      });
      res.json({ ok: true, ...result });
    } catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
  });

  router.get('/context/resolve', (req, res) => {
    try {
      if (req.authMode !== 'matrix_bridge' || !req.matrixBinding) throw new Error('active service binding required');
      const query = rejectUnknown(req.query, new Set(['text']), 'query');
      const result = resolveMatrixContext(db, query.text);
      audit({
        role: req.user.role,
        userName: req.user.userName,
        action: 'matrix_context_resolve',
        resourceType: 'matrix_context',
        resourceId: null,
        detail: JSON.stringify({ matchCount: result.matches.length })
      });
      res.json({ ok: true, ...result });
    } catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
  });

  router.get('/context/records/:id', (req, res) => {
    try {
      if (req.authMode !== 'matrix_bridge' || !req.matrixBinding) throw new Error('active service binding required');
      rejectUnknown(req.query, new Set(), 'query');
      const recordId = positiveInteger(req.params.id, 'context record id');
      const result = contextByRecordId(db, recordId);
      audit({
        role: req.user.role,
        userName: req.user.userName,
        action: 'matrix_context_record',
        resourceType: 'matrix_context',
        resourceId: recordId,
        detail: JSON.stringify({ matchCount: result.matches.length })
      });
      res.json({ ok: true, ...result });
    } catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
  });

  router.post('/inbox/jobs/:id/ack', (req, res) => {
    try {
      if (req.authMode !== 'matrix_bridge' || !req.matrixBinding) throw new Error('active service binding required');
      rejectUnknown(req.query, new Set(), 'query');
      const result = ackInboxJob(db, req.params.id, req.body || {}, { clock });
      audit({ role: req.user.role, userName: req.user.userName, action: 'matrix_inbox_delivered', resourceType: 'matrix_inbox_job', resourceId: result.id, detail: '{}' });
      res.json({ ok: true, ...result });
    } catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
  });

  router.post('/inbox/jobs/:id/fail', (req, res) => {
    try {
      if (req.authMode !== 'matrix_bridge' || !req.matrixBinding) throw new Error('active service binding required');
      rejectUnknown(req.query, new Set(), 'query');
      const result = failInboxJob(db, req.params.id, req.body || {}, { clock });
      audit({ role: req.user.role, userName: req.user.userName, action: 'matrix_inbox_failed', resourceType: 'matrix_inbox_job', resourceId: result.id, detail: JSON.stringify({ state: result.delivery_state }) });
      res.json({ ok: true, ...result });
    } catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
  });

  router.get('/facets', (req, res) => {
    try {
      rejectUnknown(req.query, new Set(), 'query');
      res.json(view.facets());
    } catch (error) { res.status(400).json({ error: error.message }); }
  });

  router.get('/candidates', (req, res) => {
    try { res.json(view.list(normalizedListFilters(req.query))); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });

  router.get('/candidates/:id', (req, res) => {
    try {
      rejectUnknown(req.query, new Set(['session_id', 'chat_id', 'thread_id']), 'query');
      const id = positiveInteger(req.params.id, 'candidate id');
      if (req.authMode === 'matrix_bridge') {
        const session = gate.getSession({ sessionId: req.query.session_id, actorUserId: req.user.id, chatId: req.query.chat_id, threadId: req.query.thread_id });
        if (!session.candidate_ids.includes(id)) throw new Error('candidate not in session mapping');
      }
      const detail = view.detail(id, { revealContacts: true });
      if (!detail) return res.status(404).json({ error: 'candidate not found' });
      audit({
        role: req.user.role,
        userName: req.user.userName,
        action: 'matrix_candidate_detail',
        resourceType: 'matrix_candidate',
        resourceId: id,
        detail: JSON.stringify({ authMode: req.authMode || 'jwt' })
      });
      res.json({ ...detail, strategy_match: scoreSignalMatch(detail, { localizedRouteStatus: 'not_checked' }) });
    } catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
  });

  router.get('/recommendations/today', (req, res) => {
    try {
      const filters = normalizedListFilters(req.query, { recommendation: true });
      res.json(view.recommendPage(filters));
    }
    catch (error) { res.status(400).json({ error: error.message }); }
  });

  function bindingForRequest(req) {
    if (req.matrixBinding) return req.matrixBinding;
    const binding = db.prepare(`
      SELECT b.id, b.feishu_open_id AS feishuOpenId
      FROM matrix_actor_bindings b JOIN users u ON u.id = b.user_id
      WHERE b.user_id = ? AND b.status = 'active' AND u.status = 'active'
      ORDER BY b.id ASC LIMIT 1
    `).get(req.user.id);
    if (!binding) throw new Error('active actor binding required');
    return binding;
  }

  function requireReviewAccess(req) {
    if (req.authMode !== 'matrix_bridge' || !req.matrixBinding) throw new Error('active service binding required');
    const active = db.prepare(`
      SELECT b.id FROM matrix_actor_bindings b
      JOIN users u ON u.id = b.user_id
      WHERE b.id = ? AND b.user_id = ? AND b.status = 'active' AND u.status = 'active'
    `).get(req.matrixBinding.id, req.user.id);
    if (!active) throw new Error('active actor binding required');
    const permissions = normalizePermissions(req.user.role, req.user.permissions);
    if (!permissions.capabilities?.matrixSend) throw new Error('explicit matrixSend capability required');
  }

  function reviewIdentity(req) {
    if (req.authMode !== 'matrix_bridge' || !req.matrixBinding) throw new Error('active service binding required');
    return {
      actorUserId: positiveInteger(req.user?.id, 'actor user id'),
      bindingId: positiveInteger(req.matrixBinding.id, 'binding id'),
      openId: String(req.matrixBinding.feishuOpenId || '').trim()
    };
  }

  function freshReviewAuthorization(identity, workItemId, expectedVersion) {
    const row = db.prepare(`
      SELECT b.id AS binding_id, b.feishu_open_id, b.status AS binding_status,
             u.id AS actor_user_id, u.role, u.status AS actor_status, u.permissions_json,
             w.id AS work_item_id, w.candidate_id, w.owner_user_id, w.stage, w.stream_state, w.version
      FROM matrix_actor_bindings b
      JOIN users u ON u.id = b.user_id
      LEFT JOIN matrix_work_items w ON w.id = ?
      WHERE b.id = ? AND b.user_id = ? AND b.feishu_open_id = ?
    `).get(workItemId, identity.bindingId, identity.actorUserId, identity.openId);
    if (!row || row.binding_status !== 'active' || row.actor_status !== 'active') throw new Error('active actor binding required');
    if (!ALLOWED_ROLES.has(row.role)) throw new Error('matrix administrator role required');
    let storedPermissions;
    try { storedPermissions = JSON.parse(row.permissions_json || 'null'); } catch (_) { storedPermissions = null; }
    if (!normalizePermissions(row.role, storedPermissions).capabilities?.matrixSend) throw new Error('explicit matrixSend capability required');
    if (!row.work_item_id) throw new Error('work item not found');
    if (row.owner_user_id !== identity.actorUserId) throw new Error('not authorized');
    if (row.stage === 'suppressed' || row.stream_state === 'suppressed') throw new Error('work item is suppressed');
    if (expectedVersion !== undefined && row.version !== expectedVersion) throw new Error('stale work version');
    return row;
  }

  function apiRequestFingerprint(value) {
    return crypto.createHash('sha256').update(reviewService.canonicalJson(value)).digest('hex');
  }

  function claimTiming() {
    const bounded = (value, fallback, minimum, maximum) => {
      const number = Number(value);
      return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.trunc(number))) : fallback;
    };
    return {
      leaseMs: bounded(claimOptions.leaseMs, 30000, 100, 60000),
      waitMs: bounded(claimOptions.waitMs, 20000, 25, 60000),
      pollMs: bounded(claimOptions.pollMs, 25, 5, 1000)
    };
  }

  function claimNowMs() {
    const value = typeof claimOptions.now === 'function' ? claimOptions.now() : Date.now();
    const timestamp = value instanceof Date ? value.getTime() : Number(value);
    if (!Number.isFinite(timestamp)) throw new Error('claim clock invalid');
    return timestamp;
  }

  function claimScopeMatches(row, { identity, workItemId, action, fingerprint }) {
    return row.actor_user_id === identity.actorUserId && row.work_item_id === workItemId
      && row.action === action && row.request_fingerprint === fingerprint;
  }

  function recordedApiResponse(row, { identity, workItemId, action, fingerprint }) {
    const authorization = freshReviewAuthorization(identity, workItemId);
    if (!claimScopeMatches(row, { identity, workItemId, action, fingerprint })) throw new Error('idempotency request conflict');
    let response;
    try { response = JSON.parse(row.response_json); } catch (_) { throw new Error('stored API response invalid'); }
    const version = db.prepare('SELECT status FROM matrix_stream_versions WHERE id = ? AND work_item_id = ?').get(row.version_id, workItemId);
    if (!version) throw new Error('recorded version not found');
    return { ...response, current_status: version.status, current_work_item_version: authorization.version };
  }

  function attemptApiClaim({ identity, workItemId, action, idempotencyKey, fingerprint, expectedWorkVersion, ownerToken }) {
    const attempt = db.transaction(() => {
      const recorded = db.prepare('SELECT * FROM matrix_stream_api_requests WHERE idempotency_key = ?').get(idempotencyKey);
      if (recorded) return { kind: 'replay', response: recordedApiResponse(recorded, { identity, workItemId, action, fingerprint }) };
      const nowMs = claimNowMs();
      const now = new Date(nowMs).toISOString();
      const { leaseMs } = claimTiming();
      const leaseExpiresAt = new Date(nowMs + leaseMs).toISOString();
      const claim = db.prepare('SELECT * FROM matrix_stream_api_claims WHERE idempotency_key = ?').get(idempotencyKey);
      if (!claim) {
        freshReviewAuthorization(identity, workItemId, expectedWorkVersion);
        db.prepare(`
          INSERT INTO matrix_stream_api_claims (
            idempotency_key, actor_user_id, work_item_id, action, request_fingerprint,
            owner_token, lease_expires_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(idempotencyKey, identity.actorUserId, workItemId, action, fingerprint, ownerToken, leaseExpiresAt, now, now);
        return { kind: 'owner', ownerToken };
      }
      if (!claimScopeMatches(claim, { identity, workItemId, action, fingerprint })) throw new Error('idempotency request conflict');
      freshReviewAuthorization(identity, workItemId);
      const expiresMs = Date.parse(String(claim.lease_expires_at || ''));
      if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
        freshReviewAuthorization(identity, workItemId, expectedWorkVersion);
        const changed = db.prepare(`
          UPDATE matrix_stream_api_claims
          SET owner_token = ?, lease_expires_at = ?, updated_at = ?
          WHERE id = ? AND owner_token = ? AND lease_expires_at = ?
        `).run(ownerToken, leaseExpiresAt, now, claim.id, claim.owner_token, claim.lease_expires_at);
        if (changed.changes === 1) return { kind: 'owner', ownerToken };
      }
      return { kind: 'wait' };
    });
    return attempt.immediate();
  }

  async function acquireApiClaim(input) {
    const ownerToken = crypto.randomUUID();
    const deadline = Date.now() + claimTiming().waitMs;
    while (true) {
      const result = attemptApiClaim({ ...input, ownerToken });
      if (result.kind !== 'wait') return result;
      if (Date.now() >= deadline) throw reviewFailure('claim_wait_timeout');
      await new Promise(resolve => setTimeout(resolve, claimTiming().pollMs));
    }
  }

  function requireOwnedClaim({ identity, workItemId, action, idempotencyKey, fingerprint, expectedWorkVersion, ownerToken }) {
    const recorded = db.prepare('SELECT * FROM matrix_stream_api_requests WHERE idempotency_key = ?').get(idempotencyKey);
    if (recorded) return { replay: recordedApiResponse(recorded, { identity, workItemId, action, fingerprint }) };
    const claim = db.prepare('SELECT * FROM matrix_stream_api_claims WHERE idempotency_key = ?').get(idempotencyKey);
    const nowMs = claimNowMs();
    const expiresMs = Date.parse(String(claim?.lease_expires_at || ''));
    if (!claim || !claimScopeMatches(claim, { identity, workItemId, action, fingerprint })
        || claim.owner_token !== ownerToken || !Number.isFinite(expiresMs) || expiresMs <= nowMs) {
      throw reviewFailure('claim_lost');
    }
    freshReviewAuthorization(identity, workItemId, expectedWorkVersion);
    return { claim };
  }

  function deleteOwnedClaim(idempotencyKey, ownerToken) {
    const deleted = db.prepare('DELETE FROM matrix_stream_api_claims WHERE idempotency_key = ? AND owner_token = ?').run(idempotencyKey, ownerToken);
    if (deleted.changes !== 1) throw reviewFailure('claim_lost');
  }

  function releaseOwnedClaim(idempotencyKey, ownerToken) {
    if (!ownerToken) return;
    try {
      db.transaction(() => {
        db.prepare('DELETE FROM matrix_stream_api_claims WHERE idempotency_key = ? AND owner_token = ?').run(idempotencyKey, ownerToken);
      }).immediate();
    } catch (_) {
      console.warn('[matrix-review] claim_release_failed');
    }
  }

  function recordApiRequest({ identity, workItemId, action, idempotencyKey, fingerprint, versionId, response }) {
    db.prepare(`
      INSERT INTO matrix_stream_api_requests (
        actor_user_id, work_item_id, action, idempotency_key, request_fingerprint,
        version_id, response_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      identity.actorUserId, workItemId, action, idempotencyKey, fingerprint,
      versionId, JSON.stringify(response), new Date().toISOString()
    );
  }

  function ownedReviewItem(workItemId, actorUserId, expectedVersion) {
    const item = db.prepare('SELECT * FROM matrix_work_items WHERE id = ?').get(workItemId);
    if (!item) throw new Error('work item not found');
    if (item.owner_user_id !== actorUserId) throw new Error('not authorized');
    if (item.stage === 'suppressed' || item.stream_state === 'suppressed') throw new Error('work item is suppressed');
    if (expectedVersion !== undefined && item.version !== expectedVersion) throw new Error('stale work version');
    return item;
  }

  function httpsUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' && url.hostname.includes('.') ? url.toString() : '';
    } catch (_) { return ''; }
  }

  const LIQUID_ROUTE_SETS = Object.freeze({
    TH: {
      language: 'th',
      home: '/th',
      about: '/th/about',
      market: '/th/markets/thailand-food-packaging',
      application: '/th/applications/daily-chemical-packaging',
      product: '/th/products/spout-pouches',
      courtesy: 'ขอบคุณที่สละเวลาอ่านอีเมลฉบับนี้ เราหวังว่าจะได้พูดคุยกับทีมจัดซื้อบรรจุภัณฑ์ของคุณ'
    },
    ID: {
      language: 'id',
      home: '/id',
      about: '/id/about',
      market: '/id/markets/indonesia',
      application: '/id/applications/daily-chemical-packaging',
      product: '/id/products/spout-pouches',
      courtesy: 'Terima kasih atas waktu Anda. Kami berharap dapat berdiskusi dengan tim pengadaan kemasan CSE.'
    }
  });

  async function verifyLiquidRouteSet(countryCode) {
    const routeSet = LIQUID_ROUTE_SETS[countryCode];
    if (!routeSet) return null;
    if (process.env.NODE_ENV === 'test') return routeSet;
    const routes = [routeSet.home, routeSet.about, routeSet.market, routeSet.application, routeSet.product];
    const origin = String(process.env.MATRIX_PUBLIC_SITE_ORIGIN || 'https://gdhspack.com').replace(/\/$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const responses = await Promise.all(routes.map(async route => {
        const response = await fetch(`${origin}${route}`, { signal: controller.signal, redirect: 'follow' });
        if (!response.ok) throw new Error(`localized website route unavailable: ${route}`);
        return { route, html: await response.text() };
      }));
      const application = responses.find(row => row.route === routeSet.application);
      if (!application?.html.includes(`lang="${routeSet.language}"`) || !application.html.includes(routeSet.application)) {
        throw new Error('localized website route set did not return the expected canonical page');
      }
      return routeSet;
    } finally {
      clearTimeout(timer);
    }
  }

  async function candidateDraft(detail) {
    const evidence = Array.isArray(detail.official_evidence) ? detail.official_evidence : [];
    const organizationDomain = String(detail.official_domain || '').trim().toLowerCase();
    if (!organizationDomain) throw new Error('official organization domain required');
    const official = evidence.find(row => {
      const source = httpsUrl(row.source_url);
      if (!source) return false;
      const hostname = new URL(source).hostname.toLowerCase();
      return hostname === organizationDomain || hostname.endsWith(`.${organizationDomain}`);
    });
    if (!official) throw new Error('official recipient source evidence required');
    const email = String(detail.contacts?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('public company email required; contact form is not eligible');
    const sourceUrl = httpsUrl(detail.contacts?.contact_page) || httpsUrl(official.source_url);
    if (!sourceUrl) throw new Error('official recipient source evidence required');
    const verifiedValue = detail.updated_at || official.observed_at;
    const verifiedMs = Date.parse(String(verifiedValue || ''));
    if (!Number.isFinite(verifiedMs)) throw new Error('recipient evidence verification timestamp required');

    const categories = (detail.categories || []).map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
    const category = categories[0] || '';
    const categoryCnMap = { coffee: '咖啡', tea: '茶', snacks: '零食', shampoo: '洗发产品', 'body wash': '沐浴产品', 'personal care': '个护产品', 'home care': '家清产品', 'baby care': '婴童护理产品', 'oral care': '口腔护理产品' };
    const categoryCn = categoryCnMap[category];
    if (!category || !categoryCn) throw new Error('deterministic draft category is unsupported');
    const formats = (detail.format_signals || []).map(value => String(value || '').trim()).filter(Boolean);
    const products = [...evidence.map(row => String(row.excerpt || row.page_title || '').trim()).filter(Boolean), ...formats];
    const specs = [...new Set(products.join(' ').match(/\b\d+(?:\.\d+)?\s*(?:kg|g)\b/gi) || [])];
    const company = String(detail.company_name || '').trim();
    const researchedEntryProduct = String(detail.strategy_signal?.entry_product || '').trim();
    const preferredFormat = formats.find(value => /refill\s+pouch/i.test(value)) || formats.find(value => /pouch/i.test(value));
    const entryProduct = researchedEntryProduct || preferredFormat || `${category} pouch`;
    const entryProductCn = /refill\s+pouch/i.test(entryProduct) ? '补充袋' : `${categoryCn}袋`;
    const categoryText = categories.join(', ');
    const categoryTextCn = categories.map(value => categoryCnMap[value] || value).join('、');
    const specPrefix = specs.length ? `${specs.join(' and ')} ` : '';
    const specPrefixCn = specs.length ? specs.join('和') : '';
    const liquidCare = categories.some(value => ['shampoo', 'body wash', 'personal care', 'home care', 'baby care', 'oral care'].includes(value));
    const countryCode = String(detail.country_code || '').trim().toUpperCase();
    const localizedRoutes = liquidCare ? await verifyLiquidRouteSet(countryCode) : null;
    const strategyMatch = scoreSignalMatch(detail, {
      localizedRouteStatus: localizedRoutes ? 'ready' : 'not_required'
    });
    if (!strategyMatch.passed) {
      throw reviewFailure('strategy_match_blocked', {
        score: strategyMatch.score,
        threshold: strategyMatch.threshold,
        blockers: strategyMatch.blockers,
        components: strategyMatch.components,
        next_action: 'Complete official-site research and localized content-gap review before drafting.'
      });
    }
    const subject = liquidCare
      ? `Flexible packaging options for ${company}'s shampoo and body wash lines`
      : `${specPrefix}${category} ${entryProduct} options for ${company}`;
    const localizedLinks = localizedRoutes
      ? `\n\nPersonal-care packaging reference:\nhttps://gdhspack.com${localizedRoutes.application}\n\nSpout pouch reference:\nhttps://gdhspack.com${localizedRoutes.product}\n\nAbout Huasheng:\nhttps://gdhspack.com${localizedRoutes.about}\n\n${localizedRoutes.courtesy}`
      : '';
    const bodyEn = liquidCare
      ? `Dear ${company} Sourcing Team,\n\nI reviewed ${company}'s public shampoo and body wash capabilities, including its packaging sourcing and compatibility-testing process.\n\nWe are Huasheng Printing Co., Ltd. in China. For a suitable liquid product, we can assess printed refill formats or spout pouches, focusing on compatibility, leak resistance, filling-line fit, and repeat-print consistency.\n\nCould you share one current shampoo or body-wash pack photo, package size, and estimated quantity for an initial refill format or spout pouch assessment, or forward this message to your packaging sourcing or procurement team?${localizedLinks}\n\nBest regards,\nGavin\nHuasheng Printing Co., Ltd.`
      : `Dear ${company} team,\nWe reviewed your publicly available ${specPrefix}${categoryText} product range. We would like to discuss ${entryProduct} options. Could you share your current material structure and expected annual volume?\nBest regards`;
    const bodyCn = liquidCare
      ? `您好，\n\n我们查看了贵司公开的洗发水和沐浴露能力，以及包装采购和相容性测试流程。\n\n我们是中国的华胜印刷有限公司。对于适合采用软包装的液体产品，我们可以评估印刷补充装或吸嘴袋，重点关注相容性、防漏、灌装线适配和重复印刷的一致性。\n\n能否提供一个现有洗发水或沐浴露包装图片、包装尺寸和预计数量，以便初步评估补充装或吸嘴袋，或者将这封邮件转交包装采购负责人？${localizedRoutes ? `\n\n当地语言参考页面：\nhttps://gdhspack.com${localizedRoutes.application}\nhttps://gdhspack.com${localizedRoutes.product}\nhttps://gdhspack.com${localizedRoutes.about}` : ''}\n\n此致敬礼\nGavin\n华胜印刷有限公司`
      : `您好，\n我们查看了贵司公开展示的${specPrefixCn}${categoryTextCn}产品，希望沟通${entryProductCn}方案。请问能否提供当前材料结构和预计年用量？\n此致敬礼`;
    const snapshot = {
      organization_domain: organizationDomain,
      recipient_email: email,
      source_url: sourceUrl,
      country_code: countryCode,
      company,
      categories,
      products,
      entryProduct,
      localizedRouteSet: localizedRoutes ? {
        status: 'verified_at_draft_time',
        primary: `https://gdhspack.com${localizedRoutes.application}`,
        about: `https://gdhspack.com${localizedRoutes.about}`,
        market: `https://gdhspack.com${localizedRoutes.market}`,
        product: `https://gdhspack.com${localizedRoutes.product}`
      } : null,
      supportedClaims: [],
      strategy_match: strategyMatch,
      evidenceIds: evidence.map(row => row.source_url).filter(Boolean),
      official_evidence: evidence.map(row => ({
        source_url: row.source_url,
        observed_at: row.observed_at,
        excerpt: row.excerpt
      }))
    };
    return {
      recipient: { email, sourceUrl, verifiedAt: new Date(verifiedMs).toISOString(), kind: 'public_company' },
      subject,
      bodyEn,
      bodyCn,
      strategySummary: `Official evidence reviewed for ${company}`,
      sourceSnapshot: snapshot,
      organizationDomain
    };
  }

  async function assertVersionStrategyCurrent(item, version) {
    const detail = view.detail(item.candidate_id, { revealContacts: true });
    if (!detail) throw new Error('candidate not found');
    const currentDraft = await candidateDraft(detail);
    let snapshot;
    try { snapshot = JSON.parse(version.source_snapshot_json); } catch (_) { snapshot = null; }
    const prior = snapshot?.strategy_match;
    const current = currentDraft.sourceSnapshot.strategy_match;
    const oldEvidence = [...new Set((snapshot?.evidenceIds || []).map(String))].sort();
    const currentEvidence = [...new Set((currentDraft.sourceSnapshot.evidenceIds || []).map(String))].sort();
    const staleReasons = [];
    if (!prior || prior.passed !== true) staleReasons.push('legacy_strategy_assessment_missing');
    if (JSON.stringify(oldEvidence) !== JSON.stringify(currentEvidence)) staleReasons.push('official_evidence_changed');
    const comparable = value => ({
      organization_domain: value?.organization_domain, recipient_email: value?.recipient_email, source_url: value?.source_url,
      country_code: value?.country_code, company: value?.company, categories: value?.categories, products: value?.products,
      entryProduct: value?.entryProduct, localizedRouteSet: value?.localizedRouteSet,
      evidenceIds: value?.evidenceIds, official_evidence: value?.official_evidence
    });
    if (!snapshot || reviewService.canonicalJson(comparable(snapshot)) !== reviewService.canonicalJson(comparable(currentDraft.sourceSnapshot))) {
      staleReasons.push('authoritative_research_changed');
    }
    if (staleReasons.length) {
      throw reviewFailure('strategy_match_blocked', {
        score: current.score,
        threshold: current.threshold,
        blockers: staleReasons,
        components: current.components,
        next_action: 'Refresh the draft from the current verified candidate record before review.'
      });
    }
    return currentDraft;
  }

  function withWorkVersion(version) {
    const item = db.prepare('SELECT version FROM matrix_work_items WHERE id = ?').get(version.work_item_id);
    return { ...version, work_item_version: item?.version || null };
  }

  router.post('/sessions', (req, res) => {
    try {
      const body = rejectUnknown(req.body, new Set(['chat_id', 'thread_id', 'filters', 'snapshot_key', 'candidate_ids', 'expires_at']), 'body');
      const binding = bindingForRequest(req);
      const session = gate.createSession({
        actorUserId: req.user.id,
        feishuOpenId: binding.feishuOpenId,
        chatId: body.chat_id,
        threadId: body.thread_id,
        filters: body.filters,
        snapshotKey: body.snapshot_key,
        candidateIds: body.candidate_ids,
        expiresAt: body.expires_at
      });
      res.status(201).json(session);
    } catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
  });

  function hydratedSession(session) {
    const candidates = session.candidate_ids.map(id => {
      const row = view.detail(id);
      if (!row || Number(row.id) !== Number(id)) throw new Error('session rehydration incomplete');
      return {
        id: row.id, company_name: row.company_name, country_code: row.country_code,
        region: row.region, city: row.city, official_domain: row.official_domain,
        official_url: row.official_url, categories: row.categories,
        product_url: row.product_url,
        format_signals: row.format_signals, size_signals: row.size_signals,
        scale_tier: row.scale_tier, priority: row.priority, fit_score: row.fit_score,
        demand_fit_score: row.demand_fit_score, access_score: row.access_score,
        confidence: row.confidence, status: row.status, stage_code: row.stage_code,
        audit_state: row.audit_state, assessment_cn: row.assessment_cn,
        next_action_cn: row.next_action_cn, updated_at: row.updated_at
      };
    });
    if (candidates.length !== session.candidate_ids.length) throw new Error('session rehydration incomplete');
    return { ...session, candidates };
  }

  router.get('/sessions/current', (req, res) => {
    try {
      rejectUnknown(req.query, new Set(['chat_id', 'thread_id']), 'query');
      res.json(hydratedSession(gate.getCurrentSession({ actorUserId: req.user.id, chatId: req.query.chat_id, threadId: req.query.thread_id })));
    } catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
  });

  router.get('/sessions/:id', (req, res) => {
    try {
      rejectUnknown(req.query, new Set(['chat_id', 'thread_id']), 'query');
      res.json(hydratedSession(gate.getSession({ sessionId: req.params.id, actorUserId: req.user.id, chatId: req.query.chat_id, threadId: req.query.thread_id })));
    } catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
  });

  router.patch('/sessions/:id', (req, res) => {
    try {
      const body = rejectUnknown(req.body, new Set(['expected_version', 'page', 'filters', 'snapshot_key', 'candidate_ids', 'expires_at']), 'body');
      const patch = {};
      if (Object.prototype.hasOwnProperty.call(body, 'page')) patch.page = body.page;
      if (Object.prototype.hasOwnProperty.call(body, 'filters')) patch.filters = body.filters;
      if (Object.prototype.hasOwnProperty.call(body, 'snapshot_key')) patch.snapshotKey = body.snapshot_key;
      if (Object.prototype.hasOwnProperty.call(body, 'candidate_ids')) patch.candidateIds = body.candidate_ids;
      if (Object.prototype.hasOwnProperty.call(body, 'expires_at')) patch.expiresAt = body.expires_at;
      const session = gate.updateSession({
        sessionId: positiveInteger(req.params.id, 'session id'),
        actorUserId: req.user.id,
        expectedVersion: body.expected_version,
        patch
      });
      res.json(session);
    } catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
  });

  router.post('/selections', (req, res) => {
    try {
      const body = rejectUnknown(req.body, new Set(['candidate_id', 'session_id', 'expected_version', 'idempotency_key', 'next_action']), 'body');
      const candidateId = positiveInteger(body.candidate_id, 'candidate id');
      const key = String(body.idempotency_key || '').trim();
      const replay = gate.replaySelection({ idempotencyKey: key, actorUserId: req.user.id });
      if (replay) return res.status(200).json(replay);
      const result = gate.selectCandidate({
        candidateId,
        actorUserId: req.user.id,
        sessionId: body.session_id,
        expectedVersion: body.expected_version,
        idempotencyKey: key,
        nextAction: body.next_action
      });
      res.status(201).json(result);
    } catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
  });

  router.get('/work-items', (req, res) => {
    try {
      const query = rejectUnknown(req.query, new Set(['stage', 'limit']), 'query');
      if (query.stage !== undefined && !STAGES.has(String(query.stage))) throw new Error('invalid stage');
      const limit = query.limit === undefined ? 100 : positiveInteger(query.limit, 'limit', 100);
      res.json({ rows: gate.listWorkItems({ actorUserId: req.user.id, stage: query.stage, limit }) });
    } catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
  });

  router.get('/work-items/:id', (req, res) => {
    try {
      rejectUnknown(req.query, new Set(), 'query');
      const item = gate.getWorkItem({ workItemId: positiveInteger(req.params.id, 'work item id'), actorUserId: req.user.id });
      if (!item) return res.status(404).json({ error: 'work item not found' });
      res.json(item);
    } catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
  });

  router.get('/work-items/:id/versions/:versionId', async (req, res) => {
    try {
      requireReviewAccess(req);
      rejectUnknown(req.query, new Set(), 'query');
      const workItemId = positiveInteger(req.params.id, 'work item id');
      const versionId = positiveInteger(req.params.versionId, 'version id');
      const item = ownedReviewItem(workItemId, req.user.id);
      const version = reviewService.getVersion(db, { actorUserId: req.user.id, versionId });
      if (!version || version.work_item_id !== item.id) return res.status(404).json({ error: 'version not found' });
      await assertVersionStrategyCurrent(item, version);
      res.json({ ...version, work_item_version: item.version });
    } catch (error) { sendReviewError(res, error); }
  });

  router.post('/notifications/:id/reply-draft', (req, res) => {
    try {
      rejectUnknown(req.body, new Set(), 'body');
      const identity = reviewIdentity(req);
      if (!correlationService || typeof correlationService.startReplyDraft !== 'function') {
        throw new Error('reply draft service unavailable');
      }
      const result = correlationService.startReplyDraft(db, {
        actorUserId: identity.actorUserId,
        bindingId: identity.bindingId,
        notificationId: positiveInteger(req.params.id, 'notification id'),
        clock
      });
      if (!result || result.state !== 'draft_pending') throw new Error('invalid reply draft result');
      res.json({
        notification_id: positiveInteger(result.notification_id, 'notification id'),
        work_item_id: positiveInteger(result.work_item_id, 'work item id'),
        state: 'draft_pending'
      });
    } catch (error) { sendReviewError(res, error); }
  });

  router.post('/thread-routes/prepare', (req, res) => {
    try {
      if (!threadRouteService || typeof threadRouteService.prepare !== 'function') throw new Error('thread route service unavailable');
      const body = rejectUnknown(req.body, new Set(['customer_id','chat_id','thread_id','idempotency_key']), 'body');
      const identity = reviewIdentity(req);
      res.json(threadRouteService.prepare({
        actorUserId: identity.actorUserId, bindingId: identity.bindingId,
        customerId: positiveInteger(body.customer_id, 'customer id'), chatId: String(body.chat_id || '').trim(),
        threadId: String(body.thread_id || '').trim(), idempotencyKey: String(body.idempotency_key || '').trim()
      }));
    } catch (error) { sendReviewError(res, error); }
  });

  router.post('/thread-routes/resume', (req, res) => {
    try {
      if (!threadRouteService || typeof threadRouteService.resume !== 'function') throw new Error('thread route service unavailable');
      const body = rejectUnknown(req.body, new Set(['chat_id','thread_id']), 'body');
      const identity = reviewIdentity(req);
      const route = threadRouteService.resume({
        actorUserId: identity.actorUserId,
        bindingId: identity.bindingId,
        chatId: String(body.chat_id || '').trim(),
        threadId: String(body.thread_id || '').trim()
      });
      if (!route) return res.status(404).json({ error: 'resumable thread route not found' });
      res.json(route);
    } catch (error) { sendReviewError(res, error); }
  });

  router.post('/thread-routes/:id/approve', (req, res) => {
    try {
      if (!threadRouteService || typeof threadRouteService.approve !== 'function') throw new Error('thread route service unavailable');
      const body = rejectUnknown(req.body, new Set(['expected_revision','expected_content_hash','idempotency_key']), 'body');
      const identity = reviewIdentity(req);
      res.json(threadRouteService.approve({actorUserId:identity.actorUserId,bindingId:identity.bindingId,routeId:positiveInteger(req.params.id,'route id'),expectedRevision:positiveInteger(body.expected_revision,'expected revision'),expectedContentHash:String(body.expected_content_hash||''),idempotencyKey:String(body.idempotency_key||'')}));
    } catch (error) { sendReviewError(res, error); }
  });

  router.get('/thread-routes/:id/preview', async (req, res) => {
    try {
      rejectUnknown(req.query, new Set(), 'query');
      if (!threadRouteService || !threadPreviewService) throw new Error('thread preview service unavailable');
      const identity = reviewIdentity(req);
      const route = threadRouteService.preview({actorUserId:identity.actorUserId,bindingId:identity.bindingId,routeId:positiveInteger(req.params.id,'route id')});
      res.json(await threadPreviewService.project(route));
    } catch (error) { sendReviewError(res, error); }
  });

  router.post('/thread-routes/:id/send', async (req, res) => {
    try {
      if (!threadDeliveryService || typeof threadDeliveryService.confirm !== 'function') throw new Error('delivery service unavailable');
      const body=rejectUnknown(req.body,new Set(['expected_revision','expected_content_hash','chat_id','thread_id','card_event_id','idempotency_key']),'body');
      const identity=reviewIdentity(req);
      res.json(await threadDeliveryService.confirm({actorUserId:identity.actorUserId,bindingId:identity.bindingId,routeId:positiveInteger(req.params.id,'route id'),expectedRevision:positiveInteger(body.expected_revision,'expected revision'),expectedContentHash:String(body.expected_content_hash||''),chatId:String(body.chat_id||''),threadId:String(body.thread_id||''),cardEventId:String(body.card_event_id||''),idempotencyKey:String(body.idempotency_key||'')}));
    } catch (error) { sendDeliveryError(res, error); }
  });

  router.post('/notifications/:id/retry-translation', async (req, res) => {
    try {
      rejectUnknown(req.body, new Set(), 'body');
      const identity = reviewIdentity(req);
      if (!correlationService || typeof correlationService.retryInboundTranslation !== 'function') {
        throw new Error('translation retry service unavailable');
      }
      const result = await correlationService.retryInboundTranslation(db, {
        actorUserId: identity.actorUserId,
        bindingId: identity.bindingId,
        notificationId: positiveInteger(req.params.id, 'notification id'),
        clock
      });
      if (!result || !['ready', 'pending'].includes(result.translation_status)) throw new Error('invalid translation retry result');
      res.json({
        notification_id: positiveInteger(result.notification_id, 'notification id'),
        translation_status: result.translation_status,
        retry_available: result.translation_status === 'pending'
      });
    } catch (error) { sendReviewError(res, error); }
  });

  router.post('/notifications/claim', (req, res) => {
    try {
      rejectUnknown(req.body, new Set(), 'body');
      const identity = reviewIdentity(req);
      if (!correlationService || typeof correlationService.claimNotification !== 'function') throw new Error('notification claim service unavailable');
      const notification = correlationService.claimNotification(db, {
        actorUserId: identity.actorUserId, bindingId: identity.bindingId, clock
      });
      res.json({ notification });
    } catch (error) { sendReviewError(res, error); }
  });

  router.post('/notifications/:id/ack', (req, res) => {
    try {
      const body = rejectUnknown(req.body, new Set(['claim_token', 'receipt_id']), 'body');
      const identity = reviewIdentity(req);
      if (!correlationService || typeof correlationService.ackNotification !== 'function') throw new Error('notification acknowledgement service unavailable');
      res.json(correlationService.ackNotification(db, {
        actorUserId: identity.actorUserId, bindingId: identity.bindingId,
        notificationId: positiveInteger(req.params.id, 'notification id'),
        claimToken: body.claim_token, receiptId: body.receipt_id, clock
      }));
    } catch (error) { sendReviewError(res, error); }
  });

  router.post('/notifications/:id/nack', (req, res) => {
    try {
      const body = rejectUnknown(req.body, new Set(['claim_token', 'outcome']), 'body');
      const identity = reviewIdentity(req);
      if (!correlationService || typeof correlationService.nackNotification !== 'function') throw new Error('notification rejection service unavailable');
      res.json(correlationService.nackNotification(db, {
        actorUserId: identity.actorUserId, bindingId: identity.bindingId,
        notificationId: positiveInteger(req.params.id, 'notification id'),
        claimToken: body.claim_token, outcome: body.outcome, clock
      }));
    } catch (error) { sendReviewError(res, error); }
  });

  router.post('/notifications/:id/status', (req, res) => {
    try {
      const body = rejectUnknown(req.body, new Set(['claim_token']), 'body');
      const identity = reviewIdentity(req);
      if (!correlationService || typeof correlationService.notificationStatus !== 'function') throw new Error('notification status service unavailable');
      res.json(correlationService.notificationStatus(db, {
        actorUserId: identity.actorUserId, bindingId: identity.bindingId,
        notificationId: positiveInteger(req.params.id, 'notification id'),
        claimToken: body.claim_token, clock
      }));
    } catch (error) { sendReviewError(res, error); }
  });

  router.post('/work-items/:id/versions', async (req, res) => {
    let heldClaimToken = null;
    let heldClaimKey = '';
    try {
      const body = rejectUnknown(req.body, VERSION_FIELDS, 'body');
      const identity = reviewIdentity(req);
      const workItemId = positiveInteger(req.params.id, 'work item id');
      const expectedWorkVersion = positiveInteger(body.expected_work_version, 'expected work version');
      const idempotencyKey = String(body.idempotency_key || '').trim();
      if (!idempotencyKey) throw new Error('idempotency key required');
      const hasBase = body.base_version_id !== undefined;
      const hasInstruction = body.revision_instruction !== undefined;
      if (hasBase !== hasInstruction) throw new Error('base version and revision instruction must be supplied together');
      const action = hasBase ? 'revise' : 'create';
      const baseVersionId = hasBase ? positiveInteger(body.base_version_id, 'base version id') : null;
      const instruction = hasInstruction ? String(body.revision_instruction || '').trim() : '';
      if (hasInstruction && !instruction) throw new Error('revision instruction required');
      const fingerprint = apiRequestFingerprint({
        action,
        actorUserId: identity.actorUserId,
        workItemId,
        expectedWorkVersion,
        ...(hasBase ? { baseVersionId, instruction } : {})
      });
      const claim = await acquireApiClaim({
        identity, workItemId, action, idempotencyKey, fingerprint, expectedWorkVersion
      });
      if (claim.kind === 'replay') return res.status(200).json(claim.response);
      heldClaimToken = claim.ownerToken;
      heldClaimKey = idempotencyKey;

      if (hasBase) {
        const current = reviewService.getVersion(db, { actorUserId: identity.actorUserId, versionId: baseVersionId });
        if (!current || current.work_item_id !== workItemId) throw new Error('base version not found');
        const currentItem = ownedReviewItem(workItemId, identity.actorUserId, expectedWorkVersion);
        await assertVersionStrategyCurrent(currentItem, current);
        let sourceSnapshot;
        try { sourceSnapshot = JSON.parse(current.source_snapshot_json); } catch (_) { throw new Error('stored source snapshot invalid'); }
        let generated;
        try {
          generated = await textService.revise({ current, instruction, sourceSnapshot });
        } catch (_) {
          throw reviewFailure('text_provider_failure');
        }
        if (generated?.ok === false) {
          throw reviewFailure(generated.reason === 'text_provider_unavailable' ? 'text_provider_unavailable' : 'text_provider_failure');
        }
        const revise = db.transaction(() => {
          const ownership = requireOwnedClaim({
            identity, workItemId, action, idempotencyKey, fingerprint, expectedWorkVersion, ownerToken: heldClaimToken
          });
          if (ownership.replay) return { replay: true, response: ownership.replay };
          const revised = reviewService.reviseVersion(db, {
            actorUserId: identity.actorUserId,
            workItemId,
            baseVersionId,
            expectedWorkVersion,
            subject: generated.subject,
            bodyEn: generated.body_en,
            bodyCn: generated.body_cn,
            idempotencyKey
          });
          const response = withWorkVersion(revised);
          recordApiRequest({ identity, workItemId, action, idempotencyKey, fingerprint, versionId: revised.id, response });
          deleteOwnedClaim(idempotencyKey, heldClaimToken);
          return { replay: false, response };
        });
        const outcome = revise.immediate();
        heldClaimToken = null;
        return res.status(outcome.replay ? 200 : 201).json(outcome.response);
      }

      const item = db.transaction(() => freshReviewAuthorization(identity, workItemId, expectedWorkVersion)).immediate();
      const detail = view.detail(item.candidate_id, { revealContacts: true });
      if (!detail) throw new Error('candidate not found');
      const draft = await candidateDraft(detail);
      const create = db.transaction(() => {
        const ownership = requireOwnedClaim({
          identity, workItemId, action, idempotencyKey, fingerprint, expectedWorkVersion, ownerToken: heldClaimToken
        });
        if (ownership.replay) return { replay: true, response: ownership.replay };
        db.prepare(`
          INSERT OR IGNORE INTO matrix_stream_recipient_evidence (
            work_item_id, organization_domain, recipient_email, source_url, verified_at,
            snapshot_json, status, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
        `).run(
          workItemId, draft.organizationDomain, draft.recipient.email, draft.recipient.sourceUrl,
          draft.recipient.verifiedAt, JSON.stringify(draft.sourceSnapshot), identity.actorUserId,
          typeof clock === 'function' ? new Date(clock()).toISOString() : new Date().toISOString()
        );
        const version = reviewService.createInitialVersion(db, {
          actorUserId: identity.actorUserId,
          workItemId,
          expectedWorkVersion,
          recipient: draft.recipient,
          subject: draft.subject,
          bodyEn: draft.bodyEn,
          bodyCn: draft.bodyCn,
          strategySummary: draft.strategySummary,
          sourceSnapshot: draft.sourceSnapshot,
          idempotencyKey
        });
        let quality;
        try { quality = JSON.parse(version.quality_json); } catch (_) { quality = null; }
        if (!quality?.passed) throw new Error('initial draft quality gate blocked');
        const response = withWorkVersion(version);
        recordApiRequest({ identity, workItemId, action, idempotencyKey, fingerprint, versionId: version.id, response });
        deleteOwnedClaim(idempotencyKey, heldClaimToken);
        return { replay: false, response };
      });
      const outcome = create.immediate();
      heldClaimToken = null;
      return res.status(outcome.replay ? 200 : 201).json(outcome.response);
    } catch (error) {
      releaseOwnedClaim(heldClaimKey, heldClaimToken);
      sendReviewError(res, error);
    }
  });

  router.post('/work-items/:id/versions/:versionId/approve', async (req, res) => {
    let heldClaimToken = null;
    let heldClaimKey = '';
    try {
      const body = rejectUnknown(req.body, APPROVAL_FIELDS, 'body');
      const identity = reviewIdentity(req);
      const workItemId = positiveInteger(req.params.id, 'work item id');
      const versionId = positiveInteger(req.params.versionId, 'version id');
      const expectedWorkVersion = positiveInteger(body.expected_work_version, 'expected work version');
      const expectedContentHash = String(body.expected_content_hash || '').trim();
      const idempotencyKey = String(body.idempotency_key || '').trim();
      if (!idempotencyKey) throw new Error('idempotency key required');
      const fingerprint = apiRequestFingerprint({
        action: 'approve', actorUserId: identity.actorUserId, workItemId, versionId,
        expectedWorkVersion, expectedContentHash
      });
      const claim = await acquireApiClaim({
        identity, workItemId, action: 'approve', idempotencyKey, fingerprint, expectedWorkVersion
      });
      if (claim.kind === 'replay') return res.json(claim.response);
      heldClaimToken = claim.ownerToken;
      heldClaimKey = idempotencyKey;
      const approvalItem = ownedReviewItem(workItemId, identity.actorUserId, expectedWorkVersion);
      const approvalVersion = reviewService.getVersion(db, { actorUserId: identity.actorUserId, versionId });
      if (!approvalVersion || approvalVersion.work_item_id !== workItemId) throw new Error('version not found');
      await assertVersionStrategyCurrent(approvalItem, approvalVersion);
      const approve = db.transaction(() => {
        const ownership = requireOwnedClaim({
          identity, workItemId, action: 'approve', idempotencyKey, fingerprint,
          expectedWorkVersion, ownerToken: heldClaimToken
        });
        if (ownership.replay) return { replay: true, response: ownership.replay };
        const approved = reviewService.approveVersion(db, {
          actorUserId: identity.actorUserId,
          workItemId,
          versionId,
          expectedWorkVersion,
          expectedContentHash,
          idempotencyKey
        });
        const response = withWorkVersion(approved);
        recordApiRequest({ identity, workItemId, action: 'approve', idempotencyKey, fingerprint, versionId: approved.id, response });
        deleteOwnedClaim(idempotencyKey, heldClaimToken);
        return { replay: false, response };
      });
      const outcome = approve.immediate();
      heldClaimToken = null;
      res.json(outcome.response);
    } catch (error) {
      releaseOwnedClaim(heldClaimKey, heldClaimToken);
      sendReviewError(res, error);
    }
  });

  router.get('/work-items/:id/versions/:versionId/preview', async (req, res) => {
    try {
      requireReviewAccess(req);
      rejectUnknown(req.query, new Set(), 'query');
      const workItemId = positiveInteger(req.params.id, 'work item id');
      const versionId = positiveInteger(req.params.versionId, 'version id');
      const item = ownedReviewItem(workItemId, req.user.id);
      const basePreview = reviewService.finalPreview(db, { actorUserId: req.user.id, versionId });
      if (!basePreview || basePreview.version.work_item_id !== item.id) throw new Error('version not found');
      await assertVersionStrategyCurrent(item, basePreview.version);
      const unavailable = { ok: false, reasons: ['preview_gate_unavailable'] };
      const preview = previewService && typeof previewService.project === 'function'
        ? await previewService.project(basePreview)
        : { ...basePreview, allowed: false, duplicate: unavailable, cooling: unavailable, quota: unavailable, readiness: unavailable, policy: unavailable };
      res.json({ ...preview, work_item_version: item.version });
    } catch (error) { sendReviewError(res, error); }
  });

  router.post('/work-items/:id/versions/:versionId/send', async (req, res) => {
    try {
      const body = rejectUnknown(req.body, SEND_FIELDS, 'body');
      if (!deliveryService || typeof deliveryService.confirm !== 'function') throw new Error('delivery service unavailable');
      const identity = reviewIdentity(req);
      const sendWorkItemId = positiveInteger(req.params.id, 'work item id');
      const sendVersionId = positiveInteger(req.params.versionId, 'version id');
      const sendItem = ownedReviewItem(sendWorkItemId, identity.actorUserId, positiveInteger(body.expected_work_version, 'expected work version'));
      const sendVersion = reviewService.getVersion(db, { actorUserId: identity.actorUserId, versionId: sendVersionId });
      if (!sendVersion || sendVersion.work_item_id !== sendWorkItemId) throw new Error('version not found');
      await assertVersionStrategyCurrent(sendItem, sendVersion);
      const requiredToken = (value, label, maximum = 256) => {
        const token = String(value || '').trim();
        if (!token || token.length > maximum || /[\r\n\0]/.test(token)) throw new Error(`${label} required`);
        return token;
      };
      const result = await deliveryService.confirm({
        actorUserId: identity.actorUserId,
        bindingId: identity.bindingId,
        workItemId: sendWorkItemId,
        versionId: sendVersionId,
        expectedWorkVersion: positiveInteger(body.expected_work_version, 'expected work version'),
        expectedContentHash: requiredToken(body.expected_content_hash, 'expected content hash', 64),
        chatId: requiredToken(body.chat_id, 'chat id'),
        cardEventId: requiredToken(body.card_event_id, 'card event id'),
        idempotencyKey: requiredToken(body.idempotency_key, 'idempotency key', 200)
      });
      const state = String(result?.state || '');
      if (!new Set(['accepted', 'failed', 'ambiguous']).has(state)) throw new Error('invalid delivery result');
      res.json({
        state,
        error_class: String(result?.error_class || ''),
        work_item_version: positiveInteger(result?.work_item_version, 'delivery work item version')
      });
    } catch (error) {
      sendDeliveryError(res, error);
    }
  });

  router.get('/customers/:customerId', (req, res) => {
    try {
      requireReviewAccess(req);
      rejectUnknown(req.query, new Set(), 'query');
      if (!command) throw new Error('ledger command unavailable');
      const identity = reviewIdentity(req);
      const customerId = positiveInteger(req.params.customerId, 'customer id');
      res.json(command.customerSnapshot({ actorUserId: identity.actorUserId, customerId }));
    } catch (error) { sendReviewError(res, error); }
  });

  router.get('/customers/:customerId/threads', (req, res) => {
    try {
      requireReviewAccess(req);
      rejectUnknown(req.query, new Set(), 'query');
      if (!command) throw new Error('ledger command unavailable');
      const identity = reviewIdentity(req);
      const customerId = positiveInteger(req.params.customerId, 'customer id');
      res.json(command.threadList({ actorUserId: identity.actorUserId, customerId }));
    } catch (error) { sendReviewError(res, error); }
  });

  router.get('/customers/:customerId/tasks', (req, res) => {
    try {
      requireReviewAccess(req);
      rejectUnknown(req.query, new Set(), 'query');
      if (!command) throw new Error('ledger command unavailable');
      const identity = reviewIdentity(req);
      const customerId = positiveInteger(req.params.customerId, 'customer id');
      res.json(command.taskList({ actorUserId: identity.actorUserId, customerId }));
    } catch (error) { sendReviewError(res, error); }
  });

  router.get('/customers/:customerId/final-preview', async (req, res) => {
    try {
      requireReviewAccess(req);
      rejectUnknown(req.query, new Set(['version_id']), 'query');
      if (!command) throw new Error('ledger command unavailable');
      const identity = reviewIdentity(req);
      const customerId = positiveInteger(req.params.customerId, 'customer id');
      const versionId = req.query.version_id === undefined
        ? undefined
        : positiveInteger(req.query.version_id, 'version id');
      res.json(await command.finalPreview({ actorUserId: identity.actorUserId, customerId, versionId }));
    } catch (error) { sendReviewError(res, error); }
  });

  router.post('/customers/:customerId/final-preview/:versionId/confirm', async (req, res) => {
    let heldClaimToken = null;
    let heldClaimKey = '';
    try {
      const body = rejectUnknown(req.body, LEDGER_CONFIRM_FIELDS, 'body');
      requireReviewAccess(req);
      if (!command) throw new Error('ledger command unavailable');
      const identity = reviewIdentity(req);
      const customerId = positiveInteger(req.params.customerId, 'customer id');
      const versionId = positiveInteger(req.params.versionId, 'version id');
      const expectedContentHash = String(body.expected_content_hash || '').trim();
      const idempotencyKey = String(body.idempotency_key || '').trim();
      if (!idempotencyKey) throw new Error('idempotency key required');
      const version = reviewService.getVersion(db, { actorUserId: identity.actorUserId, versionId });
      if (!version) throw new Error('version not found');
      const workItemId = positiveInteger(version.work_item_id, 'work item id');
      const claimAction = 'approve';
      const fingerprint = apiRequestFingerprint({
        action: 'ledger_confirm', actorUserId: identity.actorUserId, customerId, versionId,
        expectedContentHash, confirmationText: String(body.confirmation_text == null ? '' : body.confirmation_text),
        chatId: String(body.chat_id || '').trim(), cardEventId: String(body.card_event_id || '').trim()
      });
      const claim = await acquireApiClaim({ identity, workItemId, action: claimAction, idempotencyKey, fingerprint });
      const deliveryResponse = result => {
        const state = String(result?.state || '');
        if (!new Set(['accepted', 'failed', 'ambiguous']).has(state)) throw new Error('invalid delivery result');
        return { state, error_class: String(result?.error_class || ''), work_item_version: positiveInteger(result?.work_item_version, 'delivery work item version') };
      };
      if (claim.kind === 'replay') return res.json(deliveryResponse(claim.response));
      heldClaimToken = claim.ownerToken;
      heldClaimKey = idempotencyKey;
      const result = await command.confirmDelivery({
        actorUserId: identity.actorUserId,
        bindingId: identity.bindingId,
        customerId,
        versionId,
        expectedContentHash,
        confirmationText: String(body.confirmation_text == null ? '' : body.confirmation_text),
        chatId: String(body.chat_id || '').trim(),
        cardEventId: String(body.card_event_id || '').trim(),
        idempotencyKey
      });
      const response = deliveryResponse(result);
      const commit = db.transaction(() => {
        const ownership = requireOwnedClaim({ identity, workItemId, action: claimAction, idempotencyKey, fingerprint, ownerToken: heldClaimToken });
        if (ownership.replay) return ownership.replay;
        recordApiRequest({ identity, workItemId, action: claimAction, idempotencyKey, fingerprint, versionId, response });
        deleteOwnedClaim(idempotencyKey, heldClaimToken);
        return response;
      }).immediate();
      heldClaimToken = null;
      res.json(commit);
    } catch (error) {
      releaseOwnedClaim(heldClaimKey, heldClaimToken);
      sendDeliveryError(res, error);
    }
  });

  return router;
}

module.exports = {
  createMatrixBridgeAuth,
  createMatrixRouter,
  claimInboxJob,
  ackInboxJob,
  failInboxJob,
  hydrateInboxJob,
  inboxWorkbench
};

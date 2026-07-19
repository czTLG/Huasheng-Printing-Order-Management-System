'use strict';

const crypto = require('crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { defaultPermissionsByRole } = require('../lib/permissions');
const { createCacheIndexView } = require('../lib/cacheIndexView');
const { createPacketGate } = require('../lib/packetGate');
const { buildMatrixOverview } = require('../services/matrixOverview');
const { searchMatrixContext, resolveMatrixContext, contextByRecordId } = require('../services/matrixContextSearch');

const ALLOWED_ROLES = new Set(['super_admin', 'foreign_trade_crm_admin']);
const REGIONS = new Set(['africa', 'americas', 'asia', 'europe', 'oceania']);
const PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3']);
const STATUSES = new Set(['valid', 'needs_review']);
const STAGES = new Set(['selected', 'draft_pending', 'review_pending', 'suppressed']);
const LIST_FIELDS = new Set(['region', 'country', 'category', 'priority', 'status', 'page', 'page_size']);

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
  if (/stale version|session rehydration incomplete/.test(message)) return 409;
  if (/not authorized|actor binding|required binding|service binding|inactive|revoked/.test(message)) return 403;
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

function createMatrixRouter({ db, audit, candidateDbPath = process.env.MATRIX_STREAM_DB_PATH, clock } = {}) {
  const router = express.Router();
  const view = createCacheIndexView({ dbPath: candidateDbPath });
  const gate = createPacketGate({ db, now: clock, candidateValidator: candidateId => Boolean(view.recommendationById(candidateId)) });

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
      res.json(detail);
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

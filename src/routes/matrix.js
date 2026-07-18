'use strict';

const crypto = require('crypto');
const express = require('express');
const { defaultPermissionsByRole, normalizePermissions } = require('../lib/permissions');
const { createCacheIndexView } = require('../lib/cacheIndexView');
const { createPacketGate } = require('../lib/packetGate');
const { createMatrixStreamText } = require('../services/matrixStreamText');
const { createMatrixInquiryItems } = require('../services/matrixInquiryItems');
const { createMatrixTaskSupervisor } = require('../services/matrixTaskSupervisor');
const { createMatrixTaskSchedule } = require('../services/matrixTaskSchedule');
const { createMatrixChannelPolicy } = require('../services/matrixChannelPolicy');
const { createMatrixCoreRouter } = require('./matrixCore');
const { createMatrixConversationLedger } = require('../services/matrixConversationLedger');
const { createMatrixLedgerRouter } = require('./matrixLedger');
const { createMatrixKnowledgeLedger } = require('../services/matrixKnowledgeLedger');
const { createMatrixItemVersionOutbox } = require('../services/matrixItemVersionOutbox');
const { createMatrixFreightBasis } = require('../services/matrixFreightBasis');
const { createMatrixFreightRouter } = require('./matrixFreight');
const { createMatrixQuote } = require('../services/matrixQuote');
const { createMatrixQuoteRouter } = require('./matrixQuote');
const { createMatrixCopyOutbox } = require('../services/matrixCopyOutbox');
const { createMatrixCopyRouter } = require('./matrixCopy');

const ALLOWED_ROLES = new Set(['super_admin', 'foreign_trade_crm_admin']);
const REGIONS = new Set(['africa', 'americas', 'asia', 'europe', 'oceania']);
const PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3']);
const STATUSES = new Set(['valid', 'needs_review']);
const STAGES = new Set(['selected', 'draft_pending', 'review_pending', 'suppressed']);
const LIST_FIELDS = new Set(['region', 'country', 'category', 'priority', 'status', 'page', 'page_size']);
const VERSION_FIELDS = new Set(['expected_work_version', 'base_version_id', 'revision_instruction', 'idempotency_key']);
const APPROVAL_FIELDS = new Set(['expected_work_version', 'expected_content_hash', 'idempotency_key']);
const SEND_FIELDS = new Set(['expected_work_version', 'expected_content_hash', 'chat_id', 'card_event_id', 'idempotency_key']);

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

function reviewFailure(code) {
  const error = new Error(code);
  error.matrixReviewCode = code;
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
  if (/idempotency request conflict/.test(message)) {
    return { status: 409, code: 'idempotency_conflict', message: 'Idempotency key conflicts with another request.' };
  }
  if (/stale (?:work )?version|session rehydration incomplete/.test(message)) {
    return { status: 409, code: 'stale_review_state', message: 'Review state is stale.' };
  }
  if (/not authorized|actor binding|required binding|service binding|inactive|revoked|matrixSend capability|administrator role/.test(message)) {
    return { status: 403, code: 'review_forbidden', message: 'Review action is not authorized.' };
  }
  if (/not found/.test(message)) {
    return { status: 404, code: 'review_not_found', message: 'Review resource was not found.' };
  }
  if (/must|required|invalid|unknown|cannot|suppressed|mismatch|conflict|eligible|unsupported|contact form|quality gate/.test(message)) {
    return { status: 400, code: 'invalid_review_request', message: 'Invalid review request.' };
  }
  return { status: 500, code: 'internal_error', message: 'Review request could not be completed.' };
}

function sendReviewError(res, error) {
  const descriptor = reviewErrorDescriptor(error);
  if (descriptor.status >= 500) console.warn(`[matrix-review] ${descriptor.code}`);
  return res.status(descriptor.status).json({ error: { code: descriptor.code, message: descriptor.message } });
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
  if (/stale work version|idempotency conflict|blocks resend|not current|result conflict/.test(message)) {
    return { status: 409, code: 'delivery_conflict', message: 'Delivery confirmation conflicts with current state.' };
  }
  if (/required|invalid|unknown|mismatch|blocked|suppressed|approved|provenance|quality|readiness|policy/.test(message)) {
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
  correlationService = require('../services/matrixStreamCorrelation'),
  textService = createMatrixStreamText(),
  claimOptions = {}
} = {}) {
  const router = express.Router();
  const view = createCacheIndexView({ dbPath: candidateDbPath });
  const gate = createPacketGate({ db, now: clock, candidateValidator: candidateId => Boolean(view.recommendationById(candidateId)) });

  router.use(requireMatrixRole);

  if (process.env.MATRIX_SUPERVISOR_ENABLED === '1') {
    const coreClock = clock || (() => new Date());
    const versionOutbox = createMatrixItemVersionOutbox({ db, clock: coreClock });
    const items = createMatrixInquiryItems({ db, clock: coreClock, versionOutbox });
    const tasks = createMatrixTaskSupervisor({ db, clock: coreClock });
    const schedule = createMatrixTaskSchedule({ db, clock: coreClock });
    const channelPolicy = createMatrixChannelPolicy({
      billChatId: process.env.MATRIX_BILL_CHAT_ID,
      vmciChatId: process.env.MATRIX_VMCI_CHAT_ID
    });
    router.use('/core', createMatrixCoreRouter({ db, items, tasks, schedule, channelPolicy }));
    const conversationLedger = createMatrixConversationLedger({ db, clock: coreClock });
    const knowledgeLedger = createMatrixKnowledgeLedger({ db, clock: coreClock, taskSupervisor: tasks });
    router.use('/ledger', createMatrixLedgerRouter({ db, conversationLedger, knowledgeLedger }));
    const freight = createMatrixFreightBasis({ db, clock: coreClock });
    router.use('/freight', createMatrixFreightRouter({ freight }));
    const quote = createMatrixQuote({ db, clock: coreClock });
    router.use('/quotes', createMatrixQuoteRouter({ quote }));
    const copy = createMatrixCopyOutbox({ db, clock: coreClock, quoteService: quote });
    router.use('/copy', createMatrixCopyRouter({ copy }));
  } else {
    router.use('/core', (_req, res) => res.status(503).json({ error: { code: 'supervisor_disabled', message: 'Matrix supervisor is disabled.' } }));
  }

  router.get('/ready', (req, res) => {
    try {
      if (req.authMode !== 'matrix_bridge' || !req.matrixBinding) throw new Error('active service binding required');
      rejectUnknown(req.query, new Set(), 'query');
      view.ready();
      res.json({ ok: true, service: 'matrix' });
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

  function candidateDraft(detail) {
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

    const category = String((detail.categories || [])[0] || '').trim().toLowerCase();
    const categoryCn = ({ coffee: '咖啡', tea: '茶', snacks: '零食' })[category];
    if (!category || !categoryCn) throw new Error('deterministic draft category is unsupported');
    const products = evidence.map(row => String(row.excerpt || row.page_title || '').trim()).filter(Boolean);
    const specs = [...new Set(products.join(' ').match(/\b\d+(?:\.\d+)?\s*(?:kg|g)\b/gi) || [])];
    if (!specs.length) throw new Error('official product specifications required for deterministic draft');
    const specText = specs.join(' and ');
    const specTextCn = specs.join('和');
    const company = String(detail.company_name || '').trim();
    const entryProduct = `${category} pouch`;
    const subject = `${specText} ${entryProduct} options for ${company}`;
    const bodyEn = `Dear ${company} team,\nWe reviewed your ${specText} ${category} range. We would like to discuss ${category} pouches. Could you share your current material structure and annual volume?\nBest regards`;
    const bodyCn = `您好，\n我们查看了贵司${specTextCn}${categoryCn}产品，希望沟通${categoryCn}袋。请问能否提供当前材料结构和年用量？\n此致敬礼`;
    const snapshot = {
      organization_domain: organizationDomain,
      recipient_email: email,
      source_url: sourceUrl,
      country_code: String(detail.country_code || '').trim().toUpperCase(),
      company,
      categories: detail.categories || [],
      products,
      entryProduct,
      supportedClaims: [],
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
      const draft = candidateDraft(detail);
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

  router.get('/work-items/:id/versions/:versionId/preview', (req, res) => {
    try {
      requireReviewAccess(req);
      rejectUnknown(req.query, new Set(), 'query');
      const workItemId = positiveInteger(req.params.id, 'work item id');
      const versionId = positiveInteger(req.params.versionId, 'version id');
      const item = ownedReviewItem(workItemId, req.user.id);
      const preview = reviewService.finalPreview(db, { actorUserId: req.user.id, versionId });
      if (!preview || preview.version.work_item_id !== item.id) throw new Error('version not found');
      res.json({ ...preview, work_item_version: item.version });
    } catch (error) { sendReviewError(res, error); }
  });

  router.post('/work-items/:id/versions/:versionId/send', async (req, res) => {
    try {
      const body = rejectUnknown(req.body, SEND_FIELDS, 'body');
      if (!deliveryService || typeof deliveryService.confirm !== 'function') throw new Error('delivery service unavailable');
      const identity = reviewIdentity(req);
      const requiredToken = (value, label, maximum = 256) => {
        const token = String(value || '').trim();
        if (!token || token.length > maximum || /[\r\n\0]/.test(token)) throw new Error(`${label} required`);
        return token;
      };
      const result = await deliveryService.confirm({
        actorUserId: identity.actorUserId,
        bindingId: identity.bindingId,
        workItemId: positiveInteger(req.params.id, 'work item id'),
        versionId: positiveInteger(req.params.versionId, 'version id'),
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

  return router;
}

module.exports = { createMatrixBridgeAuth, createMatrixRouter };

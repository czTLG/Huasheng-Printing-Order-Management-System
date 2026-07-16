'use strict';

const crypto = require('crypto');
const express = require('express');
const { defaultPermissionsByRole } = require('../lib/permissions');
const { createCacheIndexView } = require('../lib/cacheIndexView');
const { createPacketGate } = require('../lib/packetGate');

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
  filters.page = recommendation ? 1 : (input.page === undefined ? 1 : positiveInteger(input.page, 'page', 1000000));
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
  if (/not authorized|actor binding|required binding|inactive|revoked/.test(message)) return 403;
  if (/not found/.test(message)) return 404;
  return 400;
}

function createMatrixRouter({ db, audit, candidateDbPath = process.env.MATRIX_STREAM_DB_PATH, clock } = {}) {
  const router = express.Router();
  const view = createCacheIndexView({ dbPath: candidateDbPath });
  const gate = createPacketGate({ db, now: clock });

  router.use(requireMatrixRole);

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
      const { page: _page, page_size: pageSize, ...recommendationFilters } = filters;
      const rows = view.recommend({ limit: pageSize, excludeIds: [], filters: recommendationFilters });
      const snapshotKey = crypto.createHash('sha256').update(JSON.stringify(rows.map(row => [row.id, row.updated_at]))).digest('hex');
      res.json({ rows, page: 1, page_size: pageSize, total: rows.length, total_pages: rows.length ? 1 : 0, snapshot_key: snapshotKey });
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
      const { contacts, discovery, evidence, supporting, ...summary } = row;
      return summary;
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
      if (!view.detail(candidateId)) return res.status(404).json({ error: 'candidate not found' });
      const key = String(body.idempotency_key || '').trim();
      const replay = key ? db.prepare('SELECT actor_user_id FROM matrix_selection_events WHERE idempotency_key = ?').get(key) : null;
      const result = gate.selectCandidate({
        candidateId,
        actorUserId: req.user.id,
        sessionId: body.session_id,
        expectedVersion: body.expected_version,
        idempotencyKey: key,
        nextAction: body.next_action
      });
      res.status(replay && replay.actor_user_id === req.user.id ? 200 : 201).json(result);
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

module.exports = { createMatrixBridgeAuth, createMatrixRouter };

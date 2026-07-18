'use strict';

const crypto = require('crypto');
const express = require('express');
const { defaultPermissionsByRole, normalizePermissions } = require('../lib/permissions');
const { createCacheIndexView } = require('../lib/cacheIndexView');
const { createPacketGate } = require('../lib/packetGate');
const { createMatrixStreamText } = require('../services/matrixStreamText');

const ALLOWED_ROLES = new Set(['super_admin', 'foreign_trade_crm_admin']);
const REGIONS = new Set(['africa', 'americas', 'asia', 'europe', 'oceania']);
const PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3']);
const STATUSES = new Set(['valid', 'needs_review']);
const STAGES = new Set(['selected', 'draft_pending', 'review_pending', 'suppressed']);
const LIST_FIELDS = new Set(['region', 'country', 'category', 'priority', 'status', 'page', 'page_size']);
const VERSION_FIELDS = new Set(['expected_work_version', 'base_version_id', 'revision_instruction', 'idempotency_key']);
const APPROVAL_FIELDS = new Set(['expected_work_version', 'expected_content_hash', 'idempotency_key']);

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
  if (/stale (?:work )?version|session rehydration incomplete/.test(message)) return 409;
  if (/not authorized|actor binding|required binding|service binding|inactive|revoked|matrixSend capability/.test(message)) return 403;
  if (/text_provider_unavailable/.test(message)) return 503;
  if (/not found/.test(message)) return 404;
  return 400;
}

function createMatrixRouter({
  db,
  audit,
  candidateDbPath = process.env.MATRIX_STREAM_DB_PATH,
  clock,
  reviewService = require('../services/matrixStreamReview'),
  deliveryService
} = {}) {
  const router = express.Router();
  const view = createCacheIndexView({ dbPath: candidateDbPath });
  const gate = createPacketGate({ db, now: clock, candidateValidator: candidateId => Boolean(view.recommendationById(candidateId)) });
  const textService = createMatrixStreamText();
  void deliveryService;

  router.use(requireMatrixRole);

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

  router.post('/work-items/:id/versions', async (req, res) => {
    try {
      requireReviewAccess(req);
      const body = rejectUnknown(req.body, VERSION_FIELDS, 'body');
      const workItemId = positiveInteger(req.params.id, 'work item id');
      const expectedWorkVersion = positiveInteger(body.expected_work_version, 'expected work version');
      const idempotencyKey = String(body.idempotency_key || '').trim();
      if (!idempotencyKey) throw new Error('idempotency key required');
      const hasBase = body.base_version_id !== undefined;
      const hasInstruction = body.revision_instruction !== undefined;
      if (hasBase !== hasInstruction) throw new Error('base version and revision instruction must be supplied together');
      ownedReviewItem(workItemId, req.user.id);

      if (hasBase) {
        ownedReviewItem(workItemId, req.user.id, expectedWorkVersion);
        const baseVersionId = positiveInteger(body.base_version_id, 'base version id');
        const instruction = String(body.revision_instruction || '').trim();
        if (!instruction) throw new Error('revision instruction required');
        const current = reviewService.getVersion(db, { actorUserId: req.user.id, versionId: baseVersionId });
        if (!current || current.work_item_id !== workItemId) throw new Error('base version not found');
        let sourceSnapshot;
        try { sourceSnapshot = JSON.parse(current.source_snapshot_json); } catch (_) { throw new Error('stored source snapshot invalid'); }
        const generated = await textService.revise({ current, instruction, sourceSnapshot });
        if (generated?.ok === false) throw new Error(generated.reason || 'text provider failed');
        const revised = reviewService.reviseVersion(db, {
          actorUserId: req.user.id,
          workItemId,
          baseVersionId,
          expectedWorkVersion,
          subject: generated.subject,
          bodyEn: generated.body_en,
          bodyCn: generated.body_cn,
          idempotencyKey
        });
        return res.status(201).json(withWorkVersion(revised));
      }

      const item = ownedReviewItem(workItemId, req.user.id);
      const detail = view.detail(item.candidate_id, { revealContacts: true });
      if (!detail) throw new Error('candidate not found');
      const draft = candidateDraft(detail);
      const create = db.transaction(() => {
        db.prepare(`
          INSERT OR IGNORE INTO matrix_stream_recipient_evidence (
            work_item_id, organization_domain, recipient_email, source_url, verified_at,
            snapshot_json, status, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
        `).run(
          workItemId, draft.organizationDomain, draft.recipient.email, draft.recipient.sourceUrl,
          draft.recipient.verifiedAt, JSON.stringify(draft.sourceSnapshot), req.user.id,
          typeof clock === 'function' ? new Date(clock()).toISOString() : new Date().toISOString()
        );
        const version = reviewService.createInitialVersion(db, {
          actorUserId: req.user.id,
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
        return version;
      });
      const created = create.immediate();
      return res.status(created.current_status ? 200 : 201).json(withWorkVersion(created));
    } catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
  });

  router.post('/work-items/:id/versions/:versionId/approve', (req, res) => {
    try {
      requireReviewAccess(req);
      const body = rejectUnknown(req.body, APPROVAL_FIELDS, 'body');
      const workItemId = positiveInteger(req.params.id, 'work item id');
      const versionId = positiveInteger(req.params.versionId, 'version id');
      const expectedWorkVersion = positiveInteger(body.expected_work_version, 'expected work version');
      ownedReviewItem(workItemId, req.user.id);
      const approved = reviewService.approveVersion(db, {
        actorUserId: req.user.id,
        workItemId,
        versionId,
        expectedWorkVersion,
        expectedContentHash: String(body.expected_content_hash || '').trim(),
        idempotencyKey: String(body.idempotency_key || '').trim()
      });
      res.json(withWorkVersion(approved));
    } catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
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
    } catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
  });

  return router;
}

module.exports = { createMatrixBridgeAuth, createMatrixRouter };

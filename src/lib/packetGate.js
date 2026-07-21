'use strict';

const FILTER_KEYS = new Set(['region', 'country', 'category', 'priority', 'status', 'page_size']);
const REGIONS = new Set(['africa', 'americas', 'asia', 'europe', 'oceania']);
const PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3']);
const STATUSES = new Set(['valid', 'needs_review']);
const CURRENT_SESSION_PAGE_SIZE = 100;

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label} must be a positive integer`);
  return number;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function activeUntil(expiresAt, at) {
  const expiryMillis = Date.parse(String(expiresAt || ''));
  const currentMillis = Date.parse(String(at || ''));
  return Number.isFinite(expiryMillis) && Number.isFinite(currentMillis) && expiryMillis > currentMillis;
}

function sessionResult(row) {
  return {
    id: row.id,
    actor_user_id: row.actor_user_id,
    chat_id: row.chat_id,
    thread_id: row.thread_id,
    filters: parseJson(row.filters_json, {}),
    snapshot_key: String(row.snapshot_key || ''),
    candidate_ids: parseJson(row.candidate_ids_json, []),
    page: row.page,
    version: row.version,
    expires_at: row.expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function normalizeMapping(snapshotKey, candidateIds) {
  const snapshot = String(snapshotKey || '').trim();
  if (!Array.isArray(candidateIds)) throw new Error('candidate ids must be an array');
  const ids = candidateIds.map(value => positiveInteger(value, 'candidate id'));
  if (ids.length > 5) throw new Error('candidate ids exceed five');
  if (new Set(ids).size !== ids.length) throw new Error('candidate ids must be unique');
  if (!snapshot && ids.length === 0) return { snapshotKey: '', candidateIds: [] };
  if (!/^[a-f0-9]{64}$/.test(snapshot)) throw new Error('snapshot key invalid');
  if (!ids.length) throw new Error('candidate ids required for snapshot');
  return { snapshotKey: snapshot, candidateIds: ids };
}

function workItemResult(row) {
  return {
    id: row.id,
    candidate_id: row.candidate_id,
    stage: row.stage,
    owner_user_id: row.owner_user_id,
    current_summary: row.current_summary,
    next_action: row.next_action,
    next_followup_at: row.next_followup_at,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function normalizeFilters(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error('filters must be a plain object');
  }
  const filters = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!FILTER_KEYS.has(key)) throw new Error(`unknown filter: ${key}`);
    if (key === 'page_size') {
      if (!Number.isInteger(raw) || raw < 1 || raw > 20) throw new Error('page_size filter out of range');
      filters[key] = raw;
      continue;
    }
    if (typeof raw !== 'string') throw new Error(`${key} filter must be a string`);
    const text = raw.trim();
    if (key === 'region') {
      if (!REGIONS.has(text)) throw new Error('region filter invalid');
    } else if (key === 'country') {
      if (!/^[A-Z]{2}$/.test(text)) throw new Error('country filter invalid');
      if (text === 'CN' || text === 'IN') throw new Error('country filter excluded');
    } else if (key === 'category') {
      if (!/^\p{L}[\p{L}\p{N} &+/_-]{0,63}$/u.test(text)) throw new Error('category filter invalid');
    } else if (key === 'priority') {
      if (!PRIORITIES.has(text)) throw new Error('priority filter invalid');
    } else if (key === 'status') {
      if (!STATUSES.has(text)) throw new Error('status filter invalid');
    }
    filters[key] = text;
  }
  return filters;
}

function createPacketGate({ db, now = () => new Date().toISOString(), candidateValidator } = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw new Error('application db required');
  }
  if (typeof candidateValidator !== 'function') throw new Error('candidate validator required');

  function timestamp() {
    const value = String(now());
    if (!Number.isFinite(Date.parse(value))) throw new Error('invalid clock value');
    return value;
  }

  function userExists(userId) {
    return Boolean(db.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").get(userId));
  }

  function activeBindingForUser(userId) {
    if (!userExists(userId)) throw new Error('application user inactive');
    const active = db.prepare(`
      SELECT * FROM matrix_actor_bindings
      WHERE user_id = ? AND status = 'active'
      ORDER BY id ASC LIMIT 1
    `).get(userId);
    if (active) return active;
    const revoked = db.prepare(`
      SELECT id FROM matrix_actor_bindings
      WHERE user_id = ? AND status = 'revoked'
      LIMIT 1
    `).get(userId);
    if (revoked) throw new Error('actor binding revoked');
    throw new Error('actor binding required');
  }

  const bindActorTransaction = db.transaction(input => {
    const feishuOpenId = String(input.feishuOpenId || '').trim();
    if (!feishuOpenId) throw new Error('feishu open id required');
    const userId = positiveInteger(input.userId, 'user id');
    const boundByUserId = positiveInteger(input.boundByUserId, 'bound by user id');
    if (!userExists(userId) || !userExists(boundByUserId)) throw new Error('active user required');
    const existing = db.prepare('SELECT * FROM matrix_actor_bindings WHERE feishu_open_id = ?').get(feishuOpenId);
    if (existing) {
      if (existing.user_id === userId && existing.status === 'active') return existing;
      throw new Error('feishu actor already bound');
    }
    const at = timestamp();
    const result = db.prepare(`
      INSERT INTO matrix_actor_bindings (feishu_open_id, user_id, status, bound_by, bound_at)
      VALUES (?, ?, 'active', ?, ?)
    `).run(feishuOpenId, userId, boundByUserId, at);
    return db.prepare('SELECT * FROM matrix_actor_bindings WHERE id = ?').get(result.lastInsertRowid);
  });

  function bindActor(input) {
    return bindActorTransaction.immediate(input || {});
  }

  function resolveActor({ feishuOpenId } = {}) {
    const openId = String(feishuOpenId || '').trim();
    if (!openId) return null;
    return db.prepare(`
      SELECT b.* FROM matrix_actor_bindings b
      JOIN users u ON u.id = b.user_id
      WHERE b.feishu_open_id = ? AND b.status = 'active' AND u.status = 'active'
    `).get(openId) || null;
  }

  const createSessionTransaction = db.transaction(input => {
    const actorUserId = positiveInteger(input.actorUserId, 'actor user id');
    const openId = String(input.feishuOpenId || '').trim();
    const binding = db.prepare('SELECT * FROM matrix_actor_bindings WHERE feishu_open_id = ?').get(openId);
    if (!binding || binding.user_id !== actorUserId) throw new Error('not authorized');
    if (binding.status !== 'active') throw new Error('actor binding revoked');
    if (!userExists(actorUserId)) throw new Error('not authorized');
    const chatId = String(input.chatId || '').trim();
    if (!chatId) throw new Error('chat id required');
    const threadId = String(input.threadId || '').trim();
    const filters = normalizeFilters(input.filters);
    const mapping = normalizeMapping(input.snapshotKey, input.candidateIds || []);
    const at = timestamp();
    const expiresAt = String(input.expiresAt || '').trim();
    if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(at)) {
      throw new Error('session expired');
    }
    const result = db.prepare(`
      INSERT INTO matrix_sessions (
        actor_user_id, chat_id, thread_id, filters_json, snapshot_key, candidate_ids_json, page, version,
        expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)
    `).run(actorUserId, chatId, threadId, JSON.stringify(filters), mapping.snapshotKey, JSON.stringify(mapping.candidateIds), expiresAt, at, at);
    return sessionResult(db.prepare('SELECT * FROM matrix_sessions WHERE id = ?').get(result.lastInsertRowid));
  });

  function createSession(input) {
    return createSessionTransaction.immediate(input || {});
  }

  function checkedSession({ sessionId, actorUserId, expectedVersion, at }) {
    const session = db.prepare('SELECT * FROM matrix_sessions WHERE id = ?').get(sessionId);
    if (!session) throw new Error('session not found');
    if (session.actor_user_id !== actorUserId) throw new Error('not authorized');
    if (!activeUntil(session.expires_at, at)) throw new Error('session expired');
    if (session.version !== expectedVersion) throw new Error('stale version');
    return session;
  }

  function getSession({ sessionId, actorUserId, chatId, threadId } = {}) {
    const id = positiveInteger(sessionId, 'session id');
    const owner = positiveInteger(actorUserId, 'actor user id');
    activeBindingForUser(owner);
    const session = db.prepare('SELECT * FROM matrix_sessions WHERE id = ?').get(id);
    if (!session) throw new Error('session not found');
    if (session.actor_user_id !== owner) throw new Error('not authorized');
    if (!activeUntil(session.expires_at, timestamp())) throw new Error('session expired');
    if (String(session.chat_id) !== String(chatId || '') || String(session.thread_id || '') !== String(threadId || '')) throw new Error('session context mismatch');
    return sessionResult(session);
  }

  function getCurrentSession({ actorUserId, chatId, threadId } = {}) {
    const owner = positiveInteger(actorUserId, 'actor user id');
    activeBindingForUser(owner);
    const chat = String(chatId || '').trim();
    if (!chat) throw new Error('chat id required');
    const thread = String(threadId || '').trim();
    const at = timestamp();
    const firstPage = db.prepare(`
      SELECT * FROM matrix_sessions
      WHERE actor_user_id = ? AND chat_id = ? AND thread_id = ?
      ORDER BY updated_at DESC, id DESC LIMIT ?
    `);
    const nextPage = db.prepare(`
      SELECT * FROM matrix_sessions
      WHERE actor_user_id = ? AND chat_id = ? AND thread_id = ?
        AND (updated_at < ? OR (updated_at = ? AND id < ?))
      ORDER BY updated_at DESC, id DESC LIMIT ?
    `);
    let sessions = firstPage.all(owner, chat, thread, CURRENT_SESSION_PAGE_SIZE);
    let session = sessions.find(row => activeUntil(row.expires_at, at));
    while (!session && sessions.length === CURRENT_SESSION_PAGE_SIZE) {
      const cursor = sessions[sessions.length - 1];
      sessions = nextPage.all(owner, chat, thread, cursor.updated_at, cursor.updated_at, cursor.id, CURRENT_SESSION_PAGE_SIZE);
      session = sessions.find(row => activeUntil(row.expires_at, at));
    }
    if (!session) throw new Error('session not found');
    return sessionResult(session);
  }

  const updateSessionTransaction = db.transaction(input => {
    const sessionId = positiveInteger(input.sessionId, 'session id');
    const actorUserId = positiveInteger(input.actorUserId, 'actor user id');
    const expectedVersion = positiveInteger(input.expectedVersion, 'expected version');
    activeBindingForUser(actorUserId);
    const at = timestamp();
    const session = checkedSession({ sessionId, actorUserId, expectedVersion, at });
    const patch = input.patch && typeof input.patch === 'object' && !Array.isArray(input.patch) ? input.patch : {};
    let page = session.page;
    let filtersJson = session.filters_json;
    let snapshotKey = String(session.snapshot_key || '');
    let candidateIdsJson = String(session.candidate_ids_json || '[]');
    let expiresAt = session.expires_at;
    if (Object.prototype.hasOwnProperty.call(patch, 'page')) page = positiveInteger(patch.page, 'page');
    if (Object.prototype.hasOwnProperty.call(patch, 'filters')) {
      filtersJson = JSON.stringify(normalizeFilters(patch.filters));
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'expiresAt')) {
      expiresAt = String(patch.expiresAt || '').trim();
      if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(at)) throw new Error('session expired');
    }
    const mappingPatch = Object.prototype.hasOwnProperty.call(patch, 'snapshotKey') || Object.prototype.hasOwnProperty.call(patch, 'candidateIds');
    if (mappingPatch) {
      if (!Object.prototype.hasOwnProperty.call(patch, 'snapshotKey') || !Object.prototype.hasOwnProperty.call(patch, 'candidateIds')) throw new Error('snapshot and candidate ids must be updated together');
      const mapping = normalizeMapping(patch.snapshotKey, patch.candidateIds);
      snapshotKey = mapping.snapshotKey;
      candidateIdsJson = JSON.stringify(mapping.candidateIds);
    }
    const result = db.prepare(`
      UPDATE matrix_sessions
      SET filters_json = ?, snapshot_key = ?, candidate_ids_json = ?, page = ?, expires_at = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND actor_user_id = ? AND version = ?
    `).run(filtersJson, snapshotKey, candidateIdsJson, page, expiresAt, at, sessionId, actorUserId, expectedVersion);
    if (result.changes !== 1) throw new Error('stale version');
    return sessionResult(db.prepare('SELECT * FROM matrix_sessions WHERE id = ?').get(sessionId));
  });

  function updateSession(input) {
    return updateSessionTransaction.immediate(input || {});
  }

  function idempotentSelection(event, actorUserId) {
    if (event.actor_user_id !== actorUserId) throw new Error('not authorized');
    activeBindingForUser(actorUserId);
    const after = parseJson(event.after_json, {});
    const item = db.prepare('SELECT version FROM matrix_work_items WHERE id = ?').get(event.work_item_id);
    return {
      work_item_id: event.work_item_id,
      work_item_version: Number(after.work_item_version || item?.version || 0) || null,
      candidate_id: event.candidate_id,
      session_id: after.session_id,
      session_version: after.session_version,
      event_id: event.id,
      stage: after.stage || 'selected',
      next_action: after.next_action || ''
    };
  }

  function replaySelection({ idempotencyKey, actorUserId } = {}) {
    const key = String(idempotencyKey || '').trim();
    if (!key) throw new Error('idempotency key required');
    const owner = positiveInteger(actorUserId, 'actor user id');
    const event = db.prepare('SELECT * FROM matrix_selection_events WHERE idempotency_key = ?').get(key);
    return event ? idempotentSelection(event, owner) : null;
  }

  const selectCandidateTransaction = db.transaction(input => {
    const candidateId = positiveInteger(input.candidateId, 'candidate id');
    const actorUserId = positiveInteger(input.actorUserId, 'actor user id');
    const sessionId = positiveInteger(input.sessionId, 'session id');
    const expectedVersion = positiveInteger(input.expectedVersion, 'expected version');
    const idempotencyKey = String(input.idempotencyKey || '').trim();
    if (!idempotencyKey) throw new Error('idempotency key required');
    const nextAction = String(input.nextAction || '');
    if (nextAction.length > 500) throw new Error('next action too long');

    const existingEvent = db.prepare('SELECT * FROM matrix_selection_events WHERE idempotency_key = ?').get(idempotencyKey);
    if (existingEvent) return idempotentSelection(existingEvent, actorUserId);

    activeBindingForUser(actorUserId);
    const at = timestamp();
    const session = checkedSession({ sessionId, actorUserId, expectedVersion, at });
    const mappedCandidateIds = parseJson(session.candidate_ids_json, []);
    if (!mappedCandidateIds.includes(candidateId)) throw new Error('candidate not in session mapping');
    if (!candidateValidator(candidateId)) throw new Error('candidate not strictly eligible');

    let item = db.prepare('SELECT * FROM matrix_work_items WHERE candidate_id = ?').get(candidateId);
    let before = {};
    if (item) {
      if (item.owner_user_id !== actorUserId) throw new Error('not authorized');
      before = workItemResult(item);
      db.prepare(`
        UPDATE matrix_work_items
        SET next_action = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND owner_user_id = ?
      `).run(nextAction, at, item.id, actorUserId);
      item = db.prepare('SELECT * FROM matrix_work_items WHERE id = ?').get(item.id);
    } else {
      const inserted = db.prepare(`
        INSERT INTO matrix_work_items (
          candidate_id, stage, owner_user_id, current_summary, next_action,
          version, created_at, updated_at
        ) VALUES (?, 'selected', ?, '', ?, 1, ?, ?)
      `).run(candidateId, actorUserId, nextAction, at, at);
      item = db.prepare('SELECT * FROM matrix_work_items WHERE id = ?').get(inserted.lastInsertRowid);
    }

    const sessionUpdate = db.prepare(`
      UPDATE matrix_sessions SET version = version + 1, updated_at = ?
      WHERE id = ? AND actor_user_id = ? AND version = ?
    `).run(at, sessionId, actorUserId, expectedVersion);
    if (sessionUpdate.changes !== 1) throw new Error('stale version');

    const after = {
      work_item_id: item.id,
      work_item_version: item.version,
      candidate_id: item.candidate_id,
      stage: item.stage,
      next_action: item.next_action,
      session_id: sessionId,
      session_version: expectedVersion + 1
    };
    const eventResult = db.prepare(`
      INSERT INTO matrix_selection_events (
        work_item_id, candidate_id, actor_user_id, action,
        before_json, after_json, reason, idempotency_key, created_at
      ) VALUES (?, ?, ?, 'select', ?, ?, '', ?, ?)
    `).run(item.id, candidateId, actorUserId, JSON.stringify(before), JSON.stringify(after), idempotencyKey, at);
    return { ...after, event_id: Number(eventResult.lastInsertRowid) };
  });

  function selectCandidate(input) {
    return selectCandidateTransaction.immediate(input || {});
  }

  function listWorkItems({ actorUserId, stage, limit = 100 } = {}) {
    const ownerUserId = positiveInteger(actorUserId, 'actor user id');
    activeBindingForUser(ownerUserId);
    const size = Math.min(100, Math.max(1, Math.trunc(Number(limit)) || 100));
    if (stage) {
      return db.prepare(`
        SELECT * FROM matrix_work_items
        WHERE owner_user_id = ? AND stage = ?
        ORDER BY updated_at DESC, id DESC LIMIT ?
      `).all(ownerUserId, String(stage), size).map(workItemResult);
    }
    return db.prepare(`
      SELECT * FROM matrix_work_items
      WHERE owner_user_id = ?
      ORDER BY updated_at DESC, id DESC LIMIT ?
    `).all(ownerUserId, size).map(workItemResult);
  }

  function getWorkItem({ workItemId, actorUserId } = {}) {
    const id = positiveInteger(workItemId, 'work item id');
    const ownerUserId = positiveInteger(actorUserId, 'actor user id');
    activeBindingForUser(ownerUserId);
    const item = db.prepare('SELECT * FROM matrix_work_items WHERE id = ?').get(id);
    if (!item) return null;
    if (item.owner_user_id !== ownerUserId) throw new Error('not authorized');
    return workItemResult(item);
  }

  return {
    bindActor,
    resolveActor,
    createSession,
    getSession,
    getCurrentSession,
    updateSession,
    selectCandidate,
    replaySelection,
    listWorkItems,
    getWorkItem
  };
}

module.exports = { createPacketGate };

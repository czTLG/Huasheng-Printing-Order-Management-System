'use strict';

const crypto = require('node:crypto');

const REQUIREMENT_STATES = new Set(['incomplete', 'complete', 'waiting_factory', 'waiting_customer']);
const COSTING_STATES = new Set(['pending', 'in_progress', 'completed', 'blocked', 'not_required']);
const QUOTE_STATES = new Set(['pending', 'ready', 'approved', 'sent', 'blocked', 'not_required']);
const DISPOSITIONS = new Set(['active', 'completed', 'cancelled']);

function token(value, label, maximum = 300) {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(`${label} required`);
  if (result.length > maximum) throw new Error(`${label} too long`);
  return result;
}

function positiveInteger(value, label) {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0) throw new Error(`${label} required`);
  return result;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function clockIso(clock) {
  const date = typeof clock === 'function' ? clock() : new Date();
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) throw new Error('clock returned invalid time');
  return parsed.toISOString();
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function itemResult(row) {
  return {
    id: row.id,
    inquiryId: row.inquiry_id,
    itemKey: row.item_key,
    title: row.title,
    required: Boolean(row.required),
    version: row.version,
    specificationId: row.specification_id,
    requirementState: row.requirement_state,
    costingState: row.costing_state,
    quoteState: row.quote_state,
    disposition: row.disposition,
    blockerCode: row.blocker_code,
    nextAction: row.next_action,
    evidenceIds: parseJson(row.evidence_json, []),
    actorUserId: row.actor_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function sourceEventResult(row) {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceVersion: row.source_version,
    sourceContentHash: row.source_content_hash,
    actorUserId: row.actor_user_id,
    createdAt: row.created_at
  };
}

function sourceLinkResult(row) {
  return {
    id: row.id,
    itemId: row.item_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    actorUserId: row.actor_user_id,
    createdAt: row.created_at
  };
}

function bindingResult(row) {
  return {
    id: row.id,
    itemSourceLinkId: row.item_source_link_id,
    sourceVersionEventId: row.source_version_event_id,
    sourceVersion: row.source_version,
    sourceContentHash: row.source_content_hash,
    boundItemVersion: row.bound_item_version,
    specificationId: row.specification_id,
    specificationVersion: row.specification_version,
    status: row.status,
    supersedesBindingId: row.supersedes_binding_id,
    actorUserId: row.actor_user_id,
    createdAt: row.created_at
  };
}

function createMatrixInquiryItems({ db, clock = () => new Date(), versionOutbox = null } = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('db required');

  function command(idempotencyKey, request, operation) {
    const key = token(idempotencyKey, 'idempotency key', 200);
    const requestFingerprint = fingerprint(request);
    return db.transaction(() => {
      const replay = db.prepare('SELECT * FROM matrix_inquiry_item_commands WHERE idempotency_key = ?').get(key);
      if (replay) {
        if (replay.request_fingerprint !== requestFingerprint) throw new Error('matrix inquiry item idempotency conflict');
        return parseJson(replay.result_json, null);
      }
      const result = operation(key, requestFingerprint);
      db.prepare(`INSERT INTO matrix_inquiry_item_commands (idempotency_key,request_fingerprint,result_json,created_at) VALUES (?,?,?,?)`)
        .run(key, requestFingerprint, canonicalJson(result), clockIso(clock));
      return result;
    })();
  }

  function getItem(itemId) {
    return db.prepare('SELECT * FROM matrix_inquiry_items WHERE id = ?').get(positiveInteger(itemId, 'item id'));
  }

  function appendEvent(row, eventType, payload, actorUserId, idempotencyKey, requestFingerprint) {
    db.prepare(`
      INSERT INTO matrix_inquiry_item_events (
        item_id,item_version,event_type,payload_json,actor_user_id,idempotency_key,request_fingerprint,created_at
      ) VALUES (?,?,?,?,?,?,?,?)
    `).run(row.id, row.version, eventType, canonicalJson(payload), actorUserId, idempotencyKey, requestFingerprint, clockIso(clock));
  }

  function createItem(input = {}) {
    const request = {
      operation: 'create_item',
      inquiryId: positiveInteger(input.inquiryId, 'inquiry id'),
      itemKey: token(input.itemKey, 'item key', 120),
      title: token(input.title, 'title', 300),
      required: input.required !== false,
      actorUserId: positiveInteger(input.actorUserId, 'actor user id')
    };
    return command(input.idempotencyKey, request, (key, requestFingerprint) => {
      if (!db.prepare('SELECT id FROM inquiries WHERE id = ?').get(request.inquiryId)) throw new Error('inquiry not found');
      const duplicate = db.prepare('SELECT id FROM matrix_inquiry_items WHERE inquiry_id = ? AND item_key = ?').get(request.inquiryId, request.itemKey);
      if (duplicate) throw new Error('duplicate item key');
      const createdAt = clockIso(clock);
      const info = db.prepare(`
        INSERT INTO matrix_inquiry_items (
          inquiry_id,item_key,title,required,actor_user_id,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?)
      `).run(request.inquiryId, request.itemKey, request.title, request.required ? 1 : 0, request.actorUserId, createdAt, createdAt);
      const row = getItem(info.lastInsertRowid);
      appendEvent(row, 'created', request, request.actorUserId, key, requestFingerprint);
      if (versionOutbox) versionOutbox.appendInTransaction({ entityType: 'inquiry_item', entityId: row.id, entityVersion: row.version, itemId: row.id, specificationId: null, actorUserId: request.actorUserId, idempotencyKey: `${key}:version` });
      return itemResult(row);
    });
  }

  function bindSpecification(input = {}) {
    const request = {
      operation: 'bind_specification',
      itemId: positiveInteger(input.itemId, 'item id'),
      specificationId: positiveInteger(input.specificationId, 'specification id'),
      expectedItemVersion: positiveInteger(input.expectedItemVersion, 'expected item version'),
      actorUserId: positiveInteger(input.actorUserId, 'actor user id')
    };
    return command(input.idempotencyKey, request, (key, requestFingerprint) => {
      const row = getItem(request.itemId);
      if (!row) throw new Error('item not found');
      if (row.version !== request.expectedItemVersion) throw new Error('stale item version');
      const specification = db.prepare('SELECT id,inquiry_id FROM inquiry_specifications WHERE id = ?').get(request.specificationId);
      if (!specification) throw new Error('specification not found');
      if (specification.inquiry_id !== row.inquiry_id) throw new Error('specification belongs to another inquiry');
      const nextVersion = row.version + 1;
      db.prepare('UPDATE matrix_inquiry_items SET specification_id=?,version=?,actor_user_id=?,updated_at=? WHERE id=? AND version=?')
        .run(request.specificationId, nextVersion, request.actorUserId, clockIso(clock), row.id, row.version);
      const updated = getItem(row.id);
      appendEvent(updated, 'specification_bound', request, request.actorUserId, key, requestFingerprint);
      if (versionOutbox) versionOutbox.appendInTransaction({ entityType: 'inquiry_item', entityId: updated.id, entityVersion: updated.version, itemId: updated.id, specificationId: updated.specification_id, actorUserId: request.actorUserId, idempotencyKey: `${key}:version` });
      return itemResult(updated);
    });
  }

  function applyState(input = {}) {
    const evidenceIds = Array.isArray(input.evidenceIds)
      ? [...new Set(input.evidenceIds.map(value => token(value, 'evidence id', 300)))].sort()
      : [];
    const request = {
      operation: 'apply_state',
      itemId: positiveInteger(input.itemId, 'item id'),
      expectedItemVersion: positiveInteger(input.expectedItemVersion, 'expected item version'),
      requirementState: input.requirementState === undefined ? undefined : token(input.requirementState, 'requirement state', 50),
      costingState: input.costingState === undefined ? undefined : token(input.costingState, 'costing state', 50),
      quoteState: input.quoteState === undefined ? undefined : token(input.quoteState, 'quote state', 50),
      disposition: input.disposition === undefined ? undefined : token(input.disposition, 'disposition', 50),
      blockerCode: input.blockerCode === undefined ? undefined : String(input.blockerCode ?? '').trim().slice(0, 120),
      nextAction: input.nextAction === undefined ? undefined : String(input.nextAction ?? '').trim().slice(0, 500),
      evidenceIds,
      actorUserId: positiveInteger(input.actorUserId, 'actor user id')
    };
    if (request.requirementState && !REQUIREMENT_STATES.has(request.requirementState)) throw new Error('invalid requirement state');
    if (request.costingState && !COSTING_STATES.has(request.costingState)) throw new Error('invalid costing state');
    if (request.quoteState && !QUOTE_STATES.has(request.quoteState)) throw new Error('invalid quote state');
    if (request.disposition && !DISPOSITIONS.has(request.disposition)) throw new Error('invalid disposition');
    if (request.disposition && request.disposition !== 'active' && evidenceIds.length === 0) {
      throw new Error('terminal disposition requires evidence');
    }
    return command(input.idempotencyKey, request, (key, requestFingerprint) => {
      const row = getItem(request.itemId);
      if (!row) throw new Error('item not found');
      if (row.version !== request.expectedItemVersion) throw new Error('stale item version');
      const next = {
        requirementState: request.requirementState ?? row.requirement_state,
        costingState: request.costingState ?? row.costing_state,
        quoteState: request.quoteState ?? row.quote_state,
        disposition: request.disposition ?? row.disposition,
        blockerCode: request.blockerCode ?? row.blocker_code,
        nextAction: request.nextAction ?? row.next_action,
        evidenceIds: request.evidenceIds.length ? request.evidenceIds : parseJson(row.evidence_json, [])
      };
      if (next.disposition !== 'active' && next.evidenceIds.length === 0) throw new Error('terminal disposition requires evidence');
      const nextVersion = row.version + 1;
      const info = db.prepare(`
        UPDATE matrix_inquiry_items SET
          requirement_state=?,costing_state=?,quote_state=?,disposition=?,blocker_code=?,next_action=?,evidence_json=?,
          version=?,actor_user_id=?,updated_at=? WHERE id=? AND version=?
      `).run(next.requirementState, next.costingState, next.quoteState, next.disposition, next.blockerCode, next.nextAction,
        canonicalJson(next.evidenceIds), nextVersion, request.actorUserId, clockIso(clock), row.id, row.version);
      if (info.changes !== 1) throw new Error('stale item version');
      const updated = getItem(row.id);
      appendEvent(updated, 'state_applied', request, request.actorUserId, key, requestFingerprint);
      if (versionOutbox) versionOutbox.appendInTransaction({ entityType: 'inquiry_item', entityId: updated.id, entityVersion: updated.version, itemId: updated.id, specificationId: updated.specification_id, actorUserId: request.actorUserId, idempotencyKey: `${key}:version` });
      return itemResult(updated);
    });
  }

  function aggregateInquiry(inquiryId) {
    const id = positiveInteger(inquiryId, 'inquiry id');
    const rows = db.prepare('SELECT * FROM matrix_inquiry_items WHERE inquiry_id=? ORDER BY id').all(id);
    const requiredRows = rows.filter(row => Boolean(row.required));
    const completedCount = requiredRows.filter(row => row.disposition === 'completed').length;
    const waitingFactoryCount = requiredRows.filter(row => row.requirement_state === 'waiting_factory' || row.blocker_code === 'factory_cost').length;
    const waitingCustomerCount = requiredRows.filter(row => row.requirement_state === 'waiting_customer' || row.blocker_code === 'customer_spec').length;
    const status = requiredRows.length === 0
      ? 'empty'
      : completedCount === requiredRows.length
        ? 'complete'
        : rows.some(row => row.version > 1 || row.disposition !== 'active' || row.requirement_state !== 'incomplete')
          ? 'partial'
          : 'pending';
    return {
      inquiryId: id,
      status,
      itemCount: rows.length,
      requiredCount: requiredRows.length,
      completedCount,
      waitingFactoryCount,
      waitingCustomerCount,
      readyQuoteCount: requiredRows.filter(row => ['ready', 'approved', 'sent'].includes(row.quote_state)).length,
      blockedCount: requiredRows.filter(row => row.blocker_code || row.costing_state === 'blocked' || row.quote_state === 'blocked').length,
      items: rows.map(itemResult)
    };
  }

  function recordSourceVersion(input = {}) {
    const request = {
      operation: 'record_source_version',
      sourceType: token(input.sourceType, 'source type', 80),
      sourceId: token(input.sourceId, 'source id', 200),
      sourceVersion: positiveInteger(input.sourceVersion, 'source version'),
      sourceContentHash: token(input.sourceContentHash, 'source content hash', 64).toLowerCase(),
      actorUserId: positiveInteger(input.actorUserId, 'actor user id')
    };
    if (!/^[a-f0-9]{64}$/.test(request.sourceContentHash)) throw new Error('source content hash invalid');
    return command(input.idempotencyKey, request, (key, requestFingerprint) => {
      const existing = db.prepare('SELECT * FROM matrix_source_version_events WHERE source_type=? AND source_id=? AND source_version=?')
        .get(request.sourceType, request.sourceId, request.sourceVersion);
      if (existing) {
        if (existing.source_content_hash !== request.sourceContentHash) throw new Error('source version conflict');
        return sourceEventResult(existing);
      }
      const info = db.prepare(`INSERT INTO matrix_source_version_events (source_type,source_id,source_version,source_content_hash,actor_user_id,idempotency_key,request_fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(request.sourceType, request.sourceId, request.sourceVersion, request.sourceContentHash, request.actorUserId, key, requestFingerprint, clockIso(clock));
      return sourceEventResult(db.prepare('SELECT * FROM matrix_source_version_events WHERE id=?').get(info.lastInsertRowid));
    });
  }

  function linkSource(input = {}) {
    const request = {
      operation: 'link_source',
      itemId: positiveInteger(input.itemId, 'item id'),
      sourceType: token(input.sourceType, 'source type', 80),
      sourceId: token(input.sourceId, 'source id', 200),
      actorUserId: positiveInteger(input.actorUserId, 'actor user id')
    };
    return command(input.idempotencyKey, request, (key, requestFingerprint) => {
      if (!getItem(request.itemId)) throw new Error('item not found');
      const existing = db.prepare('SELECT * FROM matrix_item_source_links WHERE item_id=? AND source_type=? AND source_id=?')
        .get(request.itemId, request.sourceType, request.sourceId);
      if (existing) return sourceLinkResult(existing);
      const info = db.prepare(`INSERT INTO matrix_item_source_links (item_id,source_type,source_id,actor_user_id,idempotency_key,request_fingerprint,created_at) VALUES (?,?,?,?,?,?,?)`)
        .run(request.itemId, request.sourceType, request.sourceId, request.actorUserId, key, requestFingerprint, clockIso(clock));
      return sourceLinkResult(db.prepare('SELECT * FROM matrix_item_source_links WHERE id=?').get(info.lastInsertRowid));
    });
  }

  function bindSourceVersion(input = {}) {
    const request = {
      operation: 'bind_source_version',
      itemSourceLinkId: positiveInteger(input.itemSourceLinkId, 'item source link id'),
      sourceVersionEventId: positiveInteger(input.sourceVersionEventId, 'source version event id'),
      sourceVersion: positiveInteger(input.sourceVersion, 'source version'),
      sourceContentHash: token(input.sourceContentHash, 'source content hash', 64).toLowerCase(),
      boundItemVersion: positiveInteger(input.boundItemVersion, 'bound item version'),
      specificationId: input.specificationId ? positiveInteger(input.specificationId, 'specification id') : null,
      specificationVersion: input.specificationVersion ? positiveInteger(input.specificationVersion, 'specification version') : null,
      actorUserId: positiveInteger(input.actorUserId, 'actor user id')
    };
    return command(input.idempotencyKey, request, (key, requestFingerprint) => {
      const link = db.prepare('SELECT * FROM matrix_item_source_links WHERE id=?').get(request.itemSourceLinkId);
      if (!link) throw new Error('item source link not found');
      const item = getItem(link.item_id);
      if (!item || item.version !== request.boundItemVersion) throw new Error('stale item version');
      const sourceEvent = db.prepare('SELECT * FROM matrix_source_version_events WHERE id=?').get(request.sourceVersionEventId);
      if (!sourceEvent || sourceEvent.source_type !== link.source_type || sourceEvent.source_id !== link.source_id
        || sourceEvent.source_version !== request.sourceVersion || sourceEvent.source_content_hash !== request.sourceContentHash) {
        throw new Error('source version identity mismatch');
      }
      if (request.specificationId) {
        const specification = db.prepare('SELECT * FROM inquiry_specifications WHERE id=?').get(request.specificationId);
        if (!specification || specification.inquiry_id !== item.inquiry_id) throw new Error('specification belongs to another inquiry');
        if (Number(specification.version_no) !== request.specificationVersion) throw new Error('stale specification version');
      } else if (request.specificationVersion) {
        throw new Error('specification id required for version');
      }
      const prior = db.prepare("SELECT * FROM matrix_item_source_version_bindings WHERE item_source_link_id=? AND status='active' ORDER BY id DESC LIMIT 1")
        .get(link.id);
      const info = db.prepare(`
        INSERT INTO matrix_item_source_version_bindings (
          item_source_link_id,source_version_event_id,source_version,source_content_hash,bound_item_version,
          specification_id,specification_version,status,supersedes_binding_id,actor_user_id,idempotency_key,request_fingerprint,created_at
        ) VALUES (?,?,?,?,?,?,?,'active',?,?,?,?,?)
      `).run(link.id, sourceEvent.id, request.sourceVersion, request.sourceContentHash, request.boundItemVersion,
        request.specificationId, request.specificationVersion, prior?.id || null, request.actorUserId, key, requestFingerprint, clockIso(clock));
      if (prior) db.prepare("UPDATE matrix_item_source_version_bindings SET status='superseded' WHERE id=? AND status='active'").run(prior.id);
      return bindingResult(db.prepare('SELECT * FROM matrix_item_source_version_bindings WHERE id=?').get(info.lastInsertRowid));
    });
  }

  function resolveSourceVersionBinding(input = {}) {
    const bindingId = positiveInteger(input.sourceVersionBindingId, 'source version binding id');
    const itemId = positiveInteger(input.itemId, 'item id');
    const expectedItemVersion = positiveInteger(input.expectedItemVersion, 'expected item version');
    const binding = db.prepare(`
      SELECT b.*,l.item_id FROM matrix_item_source_version_bindings b
      JOIN matrix_item_source_links l ON l.id=b.item_source_link_id WHERE b.id=?
    `).get(bindingId);
    if (!binding || binding.item_id !== itemId) return { status: 'needs_migration_review', reason: 'binding_not_exact' };
    const item = getItem(itemId);
    if (!item || item.version !== expectedItemVersion) return { status: 'needs_migration_review', reason: 'stale_item_version' };
    return { status: 'bound', binding: bindingResult(binding), item: itemResult(item) };
  }

  return {
    createItem,
    bindSpecification,
    applyState,
    aggregateInquiry,
    recordSourceVersion,
    linkSource,
    bindSourceVersion,
    resolveSourceVersionBinding
  };
}

module.exports = { createMatrixInquiryItems };

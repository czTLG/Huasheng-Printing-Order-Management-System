'use strict';

const crypto = require('node:crypto');

const EXACT_METHODS = new Set([
  'exact_domain',
  'verified_email_domain',
  'legal_id',
  'lei',
  'confirmed_alias'
]);

function requiredToken(value, label, maximum = 200) {
  const token = String(value ?? '').trim();
  if (!token) throw new Error(`${label} required`);
  if (token.length > maximum) throw new Error(`${label} too long`);
  return token;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizedNamespace(value) {
  return requiredToken(value, 'namespace', 100).toLowerCase();
}

function normalizedExternalKey(value) {
  return requiredToken(value, 'external key', 1000).toLowerCase();
}

function externalKeyHash(namespace, externalKey) {
  return sha256(`${namespace}\0${externalKey}`);
}

function redactExternalKey(value, externalKey, hash) {
  if (Array.isArray(value)) return value.map(item => redactExternalKey(item, externalKey, hash));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactExternalKey(item, externalKey, hash)]));
  }
  if (typeof value !== 'string') return value;
  const escaped = externalKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.replace(new RegExp(escaped, 'gi'), `[external-key-sha256:${hash}]`);
}

function evidenceObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('evidence object required');
  return value;
}

function nowIso(clock) {
  const value = typeof clock === 'function' ? clock() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('clock returned invalid time');
  return date.toISOString();
}

function rowResult(row) {
  return {
    id: row.id,
    status: 'linked',
    entityType: row.entity_type,
    entityId: row.entity_id,
    namespace: row.namespace,
    externalKeyHash: row.external_key_hash,
    matchMethod: row.match_method,
    evidence: JSON.parse(row.evidence_json),
    actorUserId: row.actor_user_id,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at
  };
}

function createMatrixIdentity({ db, clock = () => new Date(), taskSupervisor } = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('db required');

  function proposeAmbiguous(input = {}) {
    if (!taskSupervisor || typeof taskSupervisor.createReviewTask !== 'function') {
      throw new Error('taskSupervisor.createReviewTask required');
    }
    const candidates = Array.isArray(input.candidates) ? input.candidates : [];
    if (!candidates.length) throw new Error('candidates required');
    const sourceEventId = requiredToken(input.sourceEventId, 'source event id');
    const idempotencyKey = requiredToken(input.idempotencyKey, 'idempotency key');
    const actorUserId = Number(input.actorUserId);
    if (!Number.isInteger(actorUserId) || actorUserId <= 0) throw new Error('actor user id required');
    return taskSupervisor.createReviewTask({
      kind: 'matrix_identity_review',
      candidates: structuredClone(candidates),
      sourceEventId,
      actorUserId,
      idempotencyKey,
      createdAt: nowIso(clock)
    });
  }

  function reviewExact(input, namespace, keyHash, reason) {
    return proposeAmbiguous({
      candidates: [{
        entityType: String(input.entityType ?? ''),
        entityId: String(input.entityId ?? ''),
        namespace,
        externalKeyHash: keyHash,
        proposedMethod: String(input.matchMethod ?? ''),
        reason
      }],
      sourceEventId: input.idempotencyKey,
      actorUserId: input.actorUserId,
      idempotencyKey: input.idempotencyKey
    });
  }

  function linkExact(input = {}) {
    const entityType = requiredToken(input.entityType, 'entity type', 100);
    const entityId = requiredToken(input.entityId, 'entity id');
    const namespace = normalizedNamespace(input.namespace);
    const externalKey = normalizedExternalKey(input.externalKey);
    const keyHash = externalKeyHash(namespace, externalKey);
    const matchMethod = requiredToken(input.matchMethod, 'match method', 100);
    const actorUserId = Number(input.actorUserId);
    const idempotencyKey = requiredToken(input.idempotencyKey, 'idempotency key');
    if (!Number.isInteger(actorUserId) || actorUserId <= 0) throw new Error('actor user id required');

    if (!EXACT_METHODS.has(matchMethod)) {
      return reviewExact(input, namespace, keyHash, 'method_not_allowlisted');
    }
    const evidence = evidenceObject(input.evidence);
    if (matchMethod === 'verified_email_domain' && evidence.verified !== true && evidence.emailVerified !== true) {
      return reviewExact(input, namespace, keyHash, 'email_domain_not_verified');
    }

    const safeEvidence = redactExternalKey(structuredClone(evidence), externalKey, keyHash);
    const evidenceJson = canonicalJson(safeEvidence);
    const fingerprint = sha256(canonicalJson({
      entityType, entityId, namespace, externalKeyHash: keyHash, matchMethod,
      evidence: safeEvidence, actorUserId
    }));

    return db.transaction(() => {
      const replay = db.prepare('SELECT * FROM matrix_entity_links WHERE idempotency_key = ?').get(idempotencyKey);
      if (replay) {
        if (replay.request_fingerprint !== fingerprint) throw new Error('matrix identity idempotency conflict');
        return rowResult(replay);
      }
      const existing = db.prepare(`
        SELECT * FROM matrix_entity_links
        WHERE entity_type = ? AND entity_id = ? AND namespace = ? AND external_key_hash = ?
      `).get(entityType, entityId, namespace, keyHash);
      if (existing) {
        if (existing.match_method !== matchMethod || existing.evidence_json !== evidenceJson || existing.actor_user_id !== actorUserId) {
          throw new Error('matrix identity link conflict');
        }
        return rowResult(existing);
      }
      const createdAt = nowIso(clock);
      const info = db.prepare(`
        INSERT INTO matrix_entity_links (
          entity_type, entity_id, namespace, external_key_hash, match_method,
          evidence_json, actor_user_id, idempotency_key, request_fingerprint, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(entityType, entityId, namespace, keyHash, matchMethod, evidenceJson,
        actorUserId, idempotencyKey, fingerprint, createdAt);
      return rowResult(db.prepare('SELECT * FROM matrix_entity_links WHERE id = ?').get(info.lastInsertRowid));
    })();
  }

  function resolve(input = {}) {
    const namespace = normalizedNamespace(input.namespace);
    const key = normalizedExternalKey(input.externalKey);
    return db.prepare(`
      SELECT * FROM matrix_entity_links
      WHERE namespace = ? AND external_key_hash = ?
      ORDER BY id
    `).all(namespace, externalKeyHash(namespace, key)).map(rowResult);
  }

  return { linkExact, resolve, proposeAmbiguous };
}

module.exports = { createMatrixIdentity };

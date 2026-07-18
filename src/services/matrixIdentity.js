'use strict';

const crypto = require('node:crypto');
const { domainToASCII } = require('node:url');

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
  const namespace = requiredToken(value, 'namespace', 100).toLowerCase();
  if (!/^[a-z][a-z0-9_:-]*$/.test(namespace)) throw new Error('namespace must use canonical ASCII');
  return namespace;
}

function keyRedactionForms(rawKey, canonicalKey) {
  const forms = new Set([rawKey, canonicalKey]);
  for (let pass = 0; pass < 2; pass += 1) {
    for (const value of [...forms]) {
      for (const form of ['NFC', 'NFD', 'NFKC', 'NFKD']) forms.add(value.normalize(form));
      forms.add(value.toLowerCase());
      forms.add(value.toUpperCase());
    }
  }
  forms.delete('');
  return [...forms].sort((left, right) => right.length - left.length || left.localeCompare(right));
}

function canonicalExternalKey(namespace, value) {
  const rawKey = requiredToken(value, 'external key', 1000);
  let canonicalKey;
  if (namespace.endsWith('_domain')) {
    const unicodeDomain = rawKey.normalize('NFC').replace(/\.$/, '');
    canonicalKey = domainToASCII(unicodeDomain).toLowerCase();
    const labels = canonicalKey.split('.');
    if (!canonicalKey || canonicalKey.length > 253 || labels.some(label => (
      label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    ))) {
      throw new Error('external key must be a canonical domain');
    }
  } else {
    canonicalKey = rawKey.normalize('NFKC').toLowerCase();
    if (!/^[\x21-\x7e]+$/.test(canonicalKey)) {
      throw new Error('external key must use canonical visible ASCII');
    }
  }
  return {
    canonicalKey,
    redactionForms: keyRedactionForms(rawKey, canonicalKey)
  };
}

function externalKeyHash(namespace, externalKey) {
  return sha256(`${namespace}\0${externalKey}`);
}

function redactExternalKey(value, redactionForms, hash) {
  if (Array.isArray(value)) return value.map(item => redactExternalKey(item, redactionForms, hash));
  if (value && typeof value === 'object') {
    const redacted = Object.create(null);
    for (const [key, item] of Object.entries(value)) {
      const safeKey = redactExternalKey(key, redactionForms, hash);
      if (Object.hasOwn(redacted, safeKey)) {
        throw new Error('evidence key collision after external key redaction');
      }
      redacted[safeKey] = redactExternalKey(item, redactionForms, hash);
    }
    return redacted;
  }
  if (typeof value !== 'string') return value;
  const marker = `[external-key-sha256:${hash}]`;
  return redactionForms.reduce((result, form) => {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return result.replace(new RegExp(escaped, /^[\x00-\x7f]+$/.test(form) ? 'gi' : 'g'), marker);
  }, value);
}

function reviewCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('candidate object required');
  const allowedFields = new Set([
    'entityType', 'entityId', 'method', 'namespace', 'proposedMethod', 'reason', 'externalKeyHash'
  ]);
  const unknownFields = Reflect.ownKeys(value)
    .filter(key => typeof key !== 'string' || !allowedFields.has(key))
    .map(key => typeof key === 'string' ? key : key.toString())
    .sort();
  if (unknownFields.length) throw new Error(`candidate unknown fields: ${unknownFields.join(', ')}`);
  const candidate = {
    entityType: requiredToken(value.entityType, 'candidate entity type', 100),
    entityId: requiredToken(value.entityId, 'candidate entity id')
  };
  for (const [key, maximum] of [
    ['method', 100],
    ['namespace', 100],
    ['proposedMethod', 100],
    ['reason', 100]
  ]) {
    if (value[key] !== undefined && value[key] !== null && value[key] !== '') {
      candidate[key] = requiredToken(value[key], `candidate ${key}`, maximum);
    }
  }
  if (value.externalKeyHash !== undefined && value.externalKeyHash !== null && value.externalKeyHash !== '') {
    const hash = requiredToken(value.externalKeyHash, 'candidate external key hash', 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('candidate external key hash invalid');
    candidate.externalKeyHash = hash;
  }
  return candidate;
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

  function createReview({ candidates, sourceEventId, actorUserId, idempotencyKey, fingerprintPayload }) {
    if (!taskSupervisor || typeof taskSupervisor.createReviewTask !== 'function') {
      throw new Error('taskSupervisor.createReviewTask required');
    }
    if (!candidates.length) throw new Error('candidates required');
    const fingerprint = sha256(canonicalJson(fingerprintPayload));
    return db.transaction(() => {
      const replay = db.prepare('SELECT * FROM matrix_identity_commands WHERE idempotency_key = ?').get(idempotencyKey);
      if (replay) {
        if (replay.request_fingerprint !== fingerprint || replay.outcome_kind !== 'review') {
          throw new Error('matrix identity idempotency conflict');
        }
        if (!replay.result_json) throw new Error('matrix identity review result incomplete');
        return JSON.parse(replay.result_json);
      }
      const createdAt = nowIso(clock);
      db.prepare(`
        INSERT INTO matrix_identity_commands (
          idempotency_key, request_fingerprint, outcome_kind, link_id, result_json, created_at
        ) VALUES (?, ?, 'review', NULL, NULL, ?)
      `).run(idempotencyKey, fingerprint, createdAt);
      const result = taskSupervisor.createReviewTask({
        kind: 'matrix_identity_review',
        candidates,
        sourceEventId,
        actorUserId,
        idempotencyKey,
        createdAt
      });
      const resultJson = JSON.stringify(result);
      if (resultJson === undefined) throw new Error('taskSupervisor.createReviewTask must return JSON data');
      db.prepare('UPDATE matrix_identity_commands SET result_json = ? WHERE idempotency_key = ?')
        .run(resultJson, idempotencyKey);
      return JSON.parse(resultJson);
    })();
  }

  function proposeAmbiguous(input = {}) {
    const candidates = Array.isArray(input.candidates) ? input.candidates.map(reviewCandidate) : [];
    const sourceEventId = requiredToken(input.sourceEventId, 'source event id');
    const idempotencyKey = requiredToken(input.idempotencyKey, 'idempotency key');
    const actorUserId = Number(input.actorUserId);
    if (!Number.isInteger(actorUserId) || actorUserId <= 0) throw new Error('actor user id required');
    return createReview({
      candidates,
      sourceEventId,
      actorUserId,
      idempotencyKey,
      fingerprintPayload: { command: 'ambiguous_review', candidates, sourceEventId, actorUserId }
    });
  }

  function reviewExact(input, namespace, keyHash, safeEvidence, reason) {
    const candidates = [reviewCandidate({
        entityType: String(input.entityType ?? ''),
        entityId: String(input.entityId ?? ''),
        namespace,
        externalKeyHash: keyHash,
        proposedMethod: String(input.matchMethod ?? ''),
        reason
    })];
    const sourceEventId = requiredToken(input.idempotencyKey, 'source event id');
    const idempotencyKey = requiredToken(input.idempotencyKey, 'idempotency key');
    const actorUserId = Number(input.actorUserId);
    return createReview({
      candidates,
      sourceEventId,
      actorUserId,
      idempotencyKey,
      fingerprintPayload: {
        command: 'exact_link_review',
        candidates,
        evidence: safeEvidence,
        sourceEventId,
        actorUserId
      }
    });
  }

  function linkExact(input = {}) {
    const entityType = requiredToken(input.entityType, 'entity type', 100);
    const entityId = requiredToken(input.entityId, 'entity id');
    const namespace = normalizedNamespace(input.namespace);
    const { canonicalKey: externalKey, redactionForms } = canonicalExternalKey(namespace, input.externalKey);
    const keyHash = externalKeyHash(namespace, externalKey);
    const matchMethod = requiredToken(input.matchMethod, 'match method', 100);
    const actorUserId = Number(input.actorUserId);
    const idempotencyKey = requiredToken(input.idempotencyKey, 'idempotency key');
    if (!Number.isInteger(actorUserId) || actorUserId <= 0) throw new Error('actor user id required');
    const evidence = evidenceObject(input.evidence);
    const safeEvidence = redactExternalKey(structuredClone(evidence), redactionForms, keyHash);

    if (!EXACT_METHODS.has(matchMethod)) {
      return reviewExact(input, namespace, keyHash, safeEvidence, 'method_not_allowlisted');
    }
    if (matchMethod === 'verified_email_domain' && evidence.verified !== true && evidence.emailVerified !== true) {
      return reviewExact(input, namespace, keyHash, safeEvidence, 'email_domain_not_verified');
    }

    const evidenceJson = canonicalJson(safeEvidence);
    const fingerprint = sha256(canonicalJson({
      entityType, entityId, namespace, externalKeyHash: keyHash, matchMethod,
      evidence: safeEvidence, actorUserId
    }));

    return db.transaction(() => {
      const replay = db.prepare('SELECT * FROM matrix_identity_commands WHERE idempotency_key = ?').get(idempotencyKey);
      if (replay) {
        if (replay.request_fingerprint !== fingerprint || replay.outcome_kind !== 'linked') {
          throw new Error('matrix identity idempotency conflict');
        }
        const linked = db.prepare('SELECT * FROM matrix_entity_links WHERE id = ?').get(replay.link_id);
        if (!linked) throw new Error('matrix identity replay link missing');
        return rowResult(linked);
      }
      const existing = db.prepare(`
        SELECT * FROM matrix_entity_links
        WHERE entity_type = ? AND entity_id = ? AND namespace = ? AND external_key_hash = ?
      `).get(entityType, entityId, namespace, keyHash);
      if (existing) {
        if (existing.match_method !== matchMethod || existing.evidence_json !== evidenceJson || existing.actor_user_id !== actorUserId) {
          throw new Error('matrix identity link conflict');
        }
        db.prepare(`
          INSERT INTO matrix_identity_commands (
            idempotency_key, request_fingerprint, outcome_kind, link_id, result_json, created_at
          ) VALUES (?, ?, 'linked', ?, NULL, ?)
        `).run(idempotencyKey, fingerprint, existing.id, nowIso(clock));
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
      db.prepare(`
        INSERT INTO matrix_identity_commands (
          idempotency_key, request_fingerprint, outcome_kind, link_id, result_json, created_at
        ) VALUES (?, ?, 'linked', ?, NULL, ?)
      `).run(idempotencyKey, fingerprint, info.lastInsertRowid, createdAt);
      return rowResult(db.prepare('SELECT * FROM matrix_entity_links WHERE id = ?').get(info.lastInsertRowid));
    })();
  }

  function resolve(input = {}) {
    const namespace = normalizedNamespace(input.namespace);
    const { canonicalKey: key } = canonicalExternalKey(namespace, input.externalKey);
    return db.prepare(`
      SELECT * FROM matrix_entity_links
      WHERE namespace = ? AND external_key_hash = ?
      ORDER BY id
    `).all(namespace, externalKeyHash(namespace, key)).map(rowResult);
  }

  return { linkExact, resolve, proposeAmbiguous };
}

module.exports = { createMatrixIdentity };

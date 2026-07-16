'use strict';

const crypto = require('crypto');
const { RULESET_VERSION } = require('./schemaRank');

function timestamp() {
  return new Date().toISOString();
}

function normalizeDomain(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('official domain is required');
  }

  let parsed;
  try {
    parsed = new URL(input.includes('://') ? input : `https://${input}`);
  } catch {
    throw new Error('official domain is invalid');
  }

  const domain = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!domain) throw new Error('official domain is required');
  return domain;
}

function sanitizePublicContacts(contacts) {
  if (!contacts || typeof contacts !== 'object' || Array.isArray(contacts)) return {};
  return Object.fromEntries(
    Object.entries(contacts).filter(([key]) => !/html/i.test(key))
  );
}

function createRun(db, campaign = {}) {
  const createdAt = timestamp();
  const insert = db.transaction(() => db.prepare(`
    INSERT INTO matrix_runs (
      campaign_json, ruleset_version, status, counters_json, actor, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    JSON.stringify(campaign),
    RULESET_VERSION,
    campaign.status || 'running',
    JSON.stringify(campaign.counters || {}),
    campaign.actor || null,
    createdAt,
    createdAt
  ));
  const result = insert();
  return db.prepare('SELECT * FROM matrix_runs WHERE id = ?').get(result.lastInsertRowid);
}

function upsertEntity(db, input = {}) {
  const normalizedDomain = normalizeDomain(input.official_domain);
  const changedAt = timestamp();
  const publicContacts = input.public_contacts === undefined
    ? null
    : JSON.stringify(sanitizePublicContacts(input.public_contacts));
  const upsert = db.transaction(() => {
    db.prepare(`
      INSERT INTO matrix_entities (
        normalized_domain, display_name, country, public_contacts_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, COALESCE(?, '{}'), ?, ?, ?)
      ON CONFLICT(normalized_domain) DO UPDATE SET
        display_name = COALESCE(excluded.display_name, matrix_entities.display_name),
        country = COALESCE(excluded.country, matrix_entities.country),
        public_contacts_json = COALESCE(?, matrix_entities.public_contacts_json),
        status = COALESCE(excluded.status, matrix_entities.status),
        updated_at = excluded.updated_at
    `).run(
      normalizedDomain,
      input.display_name || null,
      input.country || null,
      publicContacts,
      input.status || 'active',
      changedAt,
      changedAt,
      publicContacts
    );
    return db.prepare('SELECT * FROM matrix_entities WHERE normalized_domain = ?').get(normalizedDomain);
  });
  return upsert();
}

function evidenceFingerprint(evidence) {
  if (evidence.content_fingerprint) return String(evidence.content_fingerprint);
  return crypto.createHash('sha256')
    .update(JSON.stringify([evidence.field, evidence.value, evidence.source_url]))
    .digest('hex');
}

function appendEvidence(db, entityId, evidence = {}) {
  if (typeof evidence.source_url !== 'string' || !evidence.source_url.trim()) {
    throw new Error('source URL is required');
  }
  if (typeof evidence.retrieved_at !== 'string' || !evidence.retrieved_at.trim()) {
    throw new Error('retrieval time is required');
  }
  if (typeof evidence.field !== 'string' || !evidence.field.trim()) {
    throw new Error('evidence field is required');
  }

  const sourceUrl = evidence.source_url.trim();
  const fingerprint = evidenceFingerprint({ ...evidence, source_url: sourceUrl });
  const append = db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO matrix_evidence (
        entity_id, field, value, source_url, page_title, retrieved_at,
        content_fingerprint, confidence, extraction_method, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entityId,
      evidence.field.trim(),
      evidence.value === undefined ? null : String(evidence.value),
      sourceUrl,
      evidence.page_title || null,
      evidence.retrieved_at.trim(),
      fingerprint,
      evidence.confidence || null,
      evidence.extraction_method || null,
      timestamp()
    );
    return db.prepare(`
      SELECT * FROM matrix_evidence
      WHERE entity_id = ? AND field = ? AND source_url = ? AND content_fingerprint = ?
    `).get(entityId, evidence.field.trim(), sourceUrl, fingerprint);
  });
  return append();
}

function saveClassification(db, entityId, result = {}, runId) {
  if (!result.classification) throw new Error('classification is required');
  const changedAt = timestamp();
  const save = db.transaction(() => {
    const inserted = db.prepare(`
      INSERT INTO matrix_classifications (
        entity_id, run_id, classification, priority, reason_json, confidence,
        human_override_classification, human_override_reason, human_override_actor,
        human_override_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entityId,
      runId,
      result.classification,
      result.priority || null,
      JSON.stringify(result.reason_codes || []),
      result.confidence === undefined ? null : result.confidence,
      result.human_override_classification || null,
      result.human_override_reason || null,
      result.human_override_actor || null,
      result.human_override_at || null,
      changedAt,
      changedAt
    );
    return db.prepare('SELECT * FROM matrix_classifications WHERE id = ?').get(inserted.lastInsertRowid);
  });
  return save();
}

function listCandidates(db, filters = {}) {
  const clauses = [];
  const params = [];
  const mappings = [
    ['classification', 'c.classification'],
    ['priority', 'c.priority'],
    ['country', 'e.country'],
    ['status', 'e.status'],
    ['run_id', 'c.run_id']
  ];
  for (const [key, column] of mappings) {
    if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') {
      clauses.push(`${column} = ?`);
      params.push(filters[key]);
    }
  }

  return db.prepare(`
    SELECT
      e.*,
      c.id AS classification_id,
      c.run_id,
      c.classification,
      c.priority,
      c.reason_json,
      c.confidence AS classification_confidence
    FROM matrix_entities e
    JOIN matrix_classifications c ON c.id = (
      SELECT latest.id FROM matrix_classifications latest
      WHERE latest.entity_id = e.id
      ORDER BY latest.id DESC LIMIT 1
    )
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY e.id
  `).all(...params);
}

module.exports = {
  createRun,
  upsertEntity,
  appendEvidence,
  saveClassification,
  listCandidates
};

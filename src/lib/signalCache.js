'use strict';

const crypto = require('crypto');
const { RULESET_VERSION } = require('./schemaRank');

const RUN_FIELDS = new Set(['name', 'countries', 'status', 'counters', 'actor']);
const COUNTER_FIELDS = new Set([
  'discovered', 'entities', 'evidence', 'classified', 'valid',
  'needs_review', 'noise', 'test', 'errors'
]);
const ENTITY_FIELDS = new Set([
  'official_domain', 'display_name', 'country', 'public_contacts', 'status'
]);
const CONTACT_FIELDS = new Set([
  'email', 'phone', 'whatsapp', 'linkedin_url', 'contact_page_url'
]);
const EVIDENCE_FIELDS = new Set([
  'field', 'value', 'source_url', 'page_title', 'retrieved_at',
  'content_fingerprint', 'confidence', 'extraction_method'
]);
const CLASSIFICATION_FIELDS = new Set([
  'classification', 'priority', 'reason_codes', 'confidence',
  'human_override_classification', 'human_override_reason',
  'human_override_actor', 'human_override_at'
]);
const FILTER_FIELDS = new Set(['classification', 'priority', 'country', 'status', 'run_id']);

function timestamp() {
  return new Date().toISOString();
}

function assertPlainObject(value, label) {
  const prototype = value && typeof value === 'object' ? Object.getPrototypeOf(value) : null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (prototype !== Object.prototype && prototype !== null)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertAllowedFields(value, allowed, label) {
  assertPlainObject(value, label);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`unknown ${label} field: ${key}`);
  }
}

function assertSafeText(value, label, maxLength = 2000) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  if (value.length > maxLength) throw new Error(`${label} exceeds storage limit`);
  if (/<\s*\/?\s*[a-z][^>]*>/i.test(value)
    || /\b(?:javascript|vbscript|data)\s*:/i.test(value)
    || /\bon[a-z]+\s*=/i.test(value)
    || /\b(?:eval|function|alert|require)\s*\(/i.test(value)
    || /\b(?:document|window|process)\s*\./i.test(value)) {
    throw new Error(`${label} contains executable or page content`);
  }
}

function validateCampaign(campaign) {
  assertAllowedFields(campaign, RUN_FIELDS, 'campaign');
  assertSafeText(campaign.name, 'campaign name', 500);
  assertSafeText(campaign.status, 'campaign status', 100);
  assertSafeText(campaign.actor, 'campaign actor', 500);
  if (campaign.countries !== undefined) {
    if (!Array.isArray(campaign.countries)) throw new Error('campaign countries must be an array');
    campaign.countries.forEach(country => assertSafeText(country, 'campaign country', 200));
  }
  if (campaign.counters !== undefined) {
    assertAllowedFields(campaign.counters, COUNTER_FIELDS, 'counter');
    for (const value of Object.values(campaign.counters)) {
      if (!Number.isFinite(value) || value < 0) throw new Error('counter values must be non-negative numbers');
    }
  }
}

function validateContacts(contacts) {
  assertAllowedFields(contacts, CONTACT_FIELDS, 'public contact');
  for (const [key, value] of Object.entries(contacts)) {
    assertSafeText(value, `public contact ${key}`, 2000);
  }
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

  const domain = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.+$/, '');
  if (!domain) throw new Error('official domain is required');
  return domain;
}

function createRun(db, campaign = {}) {
  validateCampaign(campaign);
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
  assertAllowedFields(input, ENTITY_FIELDS, 'entity');
  assertSafeText(input.display_name, 'display name', 500);
  assertSafeText(input.country, 'country', 200);
  assertSafeText(input.status, 'entity status', 100);
  if (input.public_contacts !== undefined) validateContacts(input.public_contacts);
  const normalizedDomain = normalizeDomain(input.official_domain);
  const changedAt = timestamp();
  const publicContacts = input.public_contacts === undefined
    ? null
    : JSON.stringify(input.public_contacts);
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
  assertAllowedFields(evidence, EVIDENCE_FIELDS, 'evidence');
  if (typeof evidence.source_url !== 'string' || !evidence.source_url.trim()) {
    throw new Error('source URL is required');
  }
  if (typeof evidence.retrieved_at !== 'string' || !evidence.retrieved_at.trim()) {
    throw new Error('retrieval time is required');
  }
  if (typeof evidence.field !== 'string' || !evidence.field.trim()) {
    throw new Error('evidence field is required');
  }
  assertSafeText(evidence.field, 'evidence field', 200);
  assertSafeText(evidence.value, 'evidence value', 2000);
  assertSafeText(evidence.source_url, 'source URL', 2000);
  assertSafeText(evidence.page_title, 'page title', 500);
  assertSafeText(evidence.retrieved_at, 'retrieval time', 100);
  assertSafeText(evidence.content_fingerprint, 'content fingerprint', 200);
  if (evidence.content_fingerprint !== undefined
    && !/^[a-f\d]{32,128}$/i.test(evidence.content_fingerprint)) {
    throw new Error('content fingerprint must be a hexadecimal digest');
  }
  assertSafeText(evidence.confidence, 'evidence confidence', 100);
  assertSafeText(evidence.extraction_method, 'extraction method', 200);

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
  assertAllowedFields(result, CLASSIFICATION_FIELDS, 'classification');
  if (!result.classification) throw new Error('classification is required');
  assertSafeText(result.classification, 'classification', 100);
  assertSafeText(result.priority, 'priority', 100);
  assertSafeText(result.human_override_classification, 'human override classification', 100);
  assertSafeText(result.human_override_reason, 'human override reason', 2000);
  assertSafeText(result.human_override_actor, 'human override actor', 500);
  assertSafeText(result.human_override_at, 'human override time', 100);
  if (result.reason_codes !== undefined) {
    if (!Array.isArray(result.reason_codes)) throw new Error('reason codes must be an array');
    result.reason_codes.forEach(code => assertSafeText(code, 'reason code', 200));
  }
  if (result.confidence !== undefined && !Number.isFinite(result.confidence)) {
    throw new Error('classification confidence must be a number');
  }
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
  assertAllowedFields(filters, FILTER_FIELDS, 'candidate filter');
  const clauses = [];
  const params = [];
  const mappings = [
    ['classification', 'c.classification'],
    ['priority', 'c.priority'],
    ['country', 'e.country'],
    ['status', 'e.status']
  ];
  for (const [key, column] of mappings) {
    if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') {
      clauses.push(`${column} = ?`);
      params.push(filters[key]);
    }
  }

  const runClause = filters.run_id !== undefined && filters.run_id !== null && filters.run_id !== ''
    ? 'AND latest.run_id = ?'
    : '';
  const queryParams = runClause ? [filters.run_id, ...params] : params;

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
      ${runClause}
      ORDER BY latest.id DESC LIMIT 1
    )
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY e.id
  `).all(...queryParams);
}

module.exports = {
  createRun,
  upsertEntity,
  appendEvidence,
  saveClassification,
  listCandidates
};

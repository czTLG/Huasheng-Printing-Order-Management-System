'use strict';

const crypto = require('crypto');
const {
  RULESET_VERSION, APPROVED_COUNTRIES, PUBLIC_REASON_CODES
} = require('./schemaRank');

const RUN_FIELDS = new Set([
  'name', 'countries', 'categories', 'languages', 'max_companies_per_country',
  'max_pages_per_company', 'max_probes', 'run_deadline_ms', 'allowed_source_types',
  'official_hosts', 'third_party_sources', 'exclusion_terms',
  'existing_domain_suppression', 'status', 'counters', 'actor'
]);
const ENTITY_FIELDS = new Set([
  'official_domain', 'display_name', 'country', 'public_contacts', 'status'
]);
const CONTACT_FIELDS = new Set([
  'email', 'phone', 'whatsapp', 'linkedin_url', 'contact_page_url'
]);
const EVIDENCE_FIELDS = new Set([
  'source_type', 'field', 'value', 'source_url', 'page_title', 'retrieved_at',
  'content_fingerprint', 'confidence', 'extraction_method'
]);
const CLASSIFICATION_FIELDS = new Set([
  'classification', 'priority', 'reason_codes', 'confidence',
  'evidence_ids',
  'human_override_classification', 'human_override_reason',
  'human_override_priority',
  'human_override_actor', 'human_override_at'
]);
const FILTER_FIELDS = new Set(['classification', 'priority', 'country', 'status', 'run_id', 'id', 'limit', 'offset', 'safe_only']);
const FACT_FIELDS = new Set([
  'display_name', 'official_domain', 'country', 'address', 'product', 'application',
  'public_email', 'public_phone', 'public_whatsapp', 'contact_page'
]);
const CLASSIFICATIONS = new Set(['test', 'noise', 'needs_review', 'valid']);
const PRIORITIES = new Set(['A', 'B', 'C']);
const REASON_CODE_SET = new Set(PUBLIC_REASON_CODES);
const APPROVED_COUNTRY_SET = new Set(APPROVED_COUNTRIES);
const SENSITIVE_QUERY_KEYS = /^(?:token|signature|sig|key|api[_-]?key|access[_-]?token|password|auth|authorization)$/i;
const CAMPAIGN_CATEGORIES = new Set(['dry_food', 'household_personal_care']);
const CAMPAIGN_SOURCE_TYPES = new Set(['official_website', 'public_directory', 'public_social', 'public_search_locator']);

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
    throw new Error('campaign counters are runner-controlled');
  }
  const requiredArrays = ['countries', 'categories', 'languages', 'allowed_source_types', 'official_hosts', 'third_party_sources', 'exclusion_terms'];
  for (const key of requiredArrays) {
    if (!Array.isArray(campaign[key])) throw new Error(`campaign ${key} is required`);
    if (key !== 'third_party_sources') campaign[key].forEach(value => assertSafeText(value, `campaign ${key}`, 500));
  }
  for (const source of campaign.third_party_sources) {
    assertAllowedFields(source, new Set(['host', 'source_type', 'terms_url', 'approved_at']), 'third party source');
    for (const [key, value] of Object.entries(source)) assertSafeText(value, `third party source ${key}`, 1000);
    if (!source.host || !source.source_type || !source.terms_url
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(source.approved_at)
      || Number.isNaN(Date.parse(source.approved_at))) {
      throw new Error('third party source requires host, source type, terms URL and approval time');
    }
    if (!CAMPAIGN_SOURCE_TYPES.has(source.source_type)) throw new Error('third party source type is not approved');
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(source.host)) {
      throw new Error('third party source host is invalid');
    }
    let terms;
    try { terms = new URL(source.terms_url); } catch { throw new Error('third party terms URL is invalid'); }
    const termsHost = terms.hostname.toLowerCase().replace(/^www\./, '').replace(/\.+$/, '');
    const sourceHost = source.host.toLowerCase().replace(/^www\./, '').replace(/\.+$/, '');
    if (!['http:', 'https:'].includes(terms.protocol) || terms.username || terms.password
      || !(termsHost === sourceHost || termsHost.endsWith(`.${sourceHost}`))
      || [...terms.searchParams.keys()].some(key => SENSITIVE_QUERY_KEYS.test(key))) {
      throw new Error('third party terms URL is not associated with the approved host');
    }
  }
  if (!campaign.name || !campaign.actor) throw new Error('campaign name and actor are required');
  if (campaign.status !== undefined && campaign.status !== 'running') throw new Error('campaign status must start as running');
  if (!campaign.countries.length || campaign.countries.some(country => !APPROVED_COUNTRY_SET.has(country))) {
    throw new Error('campaign countries must be a non-empty subset of approved countries');
  }
  if (!campaign.categories.length || !campaign.languages.length || !campaign.allowed_source_types.length
    || !campaign.official_hosts.length || !campaign.exclusion_terms.length) {
    throw new Error('campaign approved scope fields are required');
  }
  if (campaign.categories.some(value => !CAMPAIGN_CATEGORIES.has(value))) throw new Error('campaign category is not approved');
  if (campaign.allowed_source_types.some(value => !CAMPAIGN_SOURCE_TYPES.has(value))) throw new Error('campaign source type is not approved');
  if (campaign.languages.some(value => !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value))) throw new Error('campaign language is invalid');
  if (!campaign.exclusion_terms.some(value => value.trim().toLowerCase() === 'india')) throw new Error('campaign exclusions must include India');
  if (campaign.official_hosts.some(value => !/^(?:\*\.)?(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)$/i.test(value))) {
    throw new Error('campaign official host is invalid');
  }
  for (const [key, ceiling] of [['max_companies_per_country', 20], ['max_pages_per_company', 20], ['max_probes', 240], ['run_deadline_ms', 3600000]]) {
    if (!Number.isSafeInteger(campaign[key]) || campaign[key] < 1 || campaign[key] > ceiling) {
      throw new Error(`campaign ${key} is required and out of bounds`);
    }
  }
  if (campaign.existing_domain_suppression !== true) throw new Error('campaign existing domain suppression is required');
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
    .update(JSON.stringify([evidence.source_type, evidence.field, evidence.value, evidence.source_url]))
    .digest('hex');
}

function canonicalEvidenceUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('source URL is invalid'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('source URL must use HTTP(S)');
  for (const key of parsed.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEYS.test(key)) throw new Error('source URL contains sensitive query key');
  }
  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  return parsed.toString();
}

function appendEvidence(db, entityId, evidence = {}, runId) {
  assertAllowedFields(evidence, EVIDENCE_FIELDS, 'evidence');
  if (!Number.isSafeInteger(Number(runId)) || !db.prepare('SELECT 1 FROM matrix_runs WHERE id = ?').get(runId)) {
    throw new Error('run is required for evidence');
  }
  if (typeof evidence.source_url !== 'string' || !evidence.source_url.trim()) {
    throw new Error('source URL is required');
  }
  if (typeof evidence.retrieved_at !== 'string' || !evidence.retrieved_at.trim()) {
    throw new Error('retrieval time is required');
  }
  if (typeof evidence.field !== 'string' || !evidence.field.trim()) {
    throw new Error('evidence field is required');
  }
  if (!CAMPAIGN_SOURCE_TYPES.has(evidence.source_type)) throw new Error('invalid evidence source type');
  if (!FACT_FIELDS.has(evidence.field.trim())) throw new Error('invalid evidence field');
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
  if (!Number.isFinite(evidence.confidence) || evidence.confidence < 0 || evidence.confidence > 1) {
    throw new Error('evidence confidence must be between 0 and 1');
  }
  if (Number.isNaN(Date.parse(evidence.retrieved_at)) || !/[zZ]|[+-]\d\d:\d\d$/.test(evidence.retrieved_at)) {
    throw new Error('retrieval time must be an ISO timestamp');
  }
  assertSafeText(evidence.extraction_method, 'extraction method', 200);

  const sourceUrl = canonicalEvidenceUrl(evidence.source_url.trim());
  const fingerprint = evidenceFingerprint({ ...evidence, source_url: sourceUrl });
  const append = db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO matrix_evidence (
        entity_id, run_id, source_type, field, value, source_url, page_title, retrieved_at,
        content_fingerprint, confidence, extraction_method, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entityId,
      runId,
      evidence.source_type,
      evidence.field.trim(),
      evidence.value === undefined ? null : String(evidence.value),
      sourceUrl,
      evidence.page_title || null,
      evidence.retrieved_at.trim(),
      fingerprint,
      evidence.confidence,
      evidence.extraction_method || null,
      timestamp()
    );
    return db.prepare(`
      SELECT * FROM matrix_evidence
      WHERE run_id = ? AND entity_id = ? AND field = ? AND source_url = ? AND content_fingerprint = ?
    `).get(runId, entityId, evidence.field.trim(), sourceUrl, fingerprint);
  });
  return append();
}

function saveClassification(db, entityId, result = {}, runId) {
  assertAllowedFields(result, CLASSIFICATION_FIELDS, 'classification');
  if (!result.classification) throw new Error('classification is required');
  if (!CLASSIFICATIONS.has(result.classification)) throw new Error('invalid classification');
  if (result.classification === 'valid' ? !PRIORITIES.has(result.priority) : result.priority != null) {
    throw new Error('classification priority combination is invalid');
  }
  assertSafeText(result.classification, 'classification', 100);
  assertSafeText(result.priority, 'priority', 100);
  assertSafeText(result.human_override_classification, 'human override classification', 100);
  assertSafeText(result.human_override_priority, 'human override priority', 100);
  assertSafeText(result.human_override_reason, 'human override reason', 2000);
  assertSafeText(result.human_override_actor, 'human override actor', 500);
  assertSafeText(result.human_override_at, 'human override time', 100);
  if (result.reason_codes !== undefined) {
    if (!Array.isArray(result.reason_codes)) throw new Error('reason codes must be an array');
    result.reason_codes.forEach(code => assertSafeText(code, 'reason code', 200));
    if (result.reason_codes.some(code => !REASON_CODE_SET.has(code))) throw new Error('invalid reason code');
  }
  if (result.confidence !== undefined && (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1)) {
    throw new Error('classification confidence must be between 0 and 1');
  }
  if (!Array.isArray(result.evidence_ids) || !result.evidence_ids.length
    || result.evidence_ids.some(id => !Number.isSafeInteger(Number(id)))) throw new Error('exact evidence IDs are required');
  if (result.human_override_classification != null) {
    if (!CLASSIFICATIONS.has(result.human_override_classification)
      || !result.human_override_reason || !result.human_override_actor || !result.human_override_at) {
      throw new Error('human override requires class, reason, actor and time');
    }
    if (result.human_override_classification === 'valid'
      ? !PRIORITIES.has(result.human_override_priority)
      : result.human_override_priority != null) throw new Error('human override priority combination is invalid');
  }
  const changedAt = timestamp();
  const save = db.transaction(() => {
    const entity = db.prepare('SELECT * FROM matrix_entities WHERE id = ?').get(entityId);
    if (!entity) throw new Error('entity not found');
    const evidenceRows = db.prepare(`
      SELECT id FROM matrix_evidence
      WHERE run_id = ? AND entity_id = ? AND id IN (${result.evidence_ids.map(() => '?').join(',')})
    `).all(runId, entityId, ...result.evidence_ids);
    if (evidenceRows.length !== new Set(result.evidence_ids.map(Number)).size) throw new Error('evidence IDs must belong to this run and entity');
    db.prepare(`
      INSERT OR IGNORE INTO matrix_entity_snapshots (
        entity_id, run_id, normalized_domain, display_name, country,
        public_contacts_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(entity.id, runId, entity.normalized_domain, entity.display_name, entity.country,
      entity.public_contacts_json, entity.status, changedAt);
    const snapshot = db.prepare('SELECT id FROM matrix_entity_snapshots WHERE entity_id = ? AND run_id = ?').get(entityId, runId);
    const inserted = db.prepare(`
      INSERT INTO matrix_classifications (
        entity_id, run_id, snapshot_id, classification, priority, reason_json, confidence,
        human_override_classification, human_override_priority, human_override_reason, human_override_actor,
        human_override_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entityId,
      runId,
      snapshot.id,
      result.classification,
      result.priority || null,
      JSON.stringify(result.reason_codes || []),
      result.confidence === undefined ? null : result.confidence,
      result.human_override_classification || null,
      result.human_override_priority || null,
      result.human_override_reason || null,
      result.human_override_actor || null,
      result.human_override_at || null,
      changedAt,
      changedAt
    );
    const classificationId = Number(inserted.lastInsertRowid);
    const link = db.prepare('INSERT INTO matrix_classification_evidence (classification_id, evidence_id) VALUES (?, ?)');
    for (const id of new Set(result.evidence_ids.map(Number))) link.run(classificationId, id);
    return db.prepare('SELECT * FROM matrix_classifications WHERE id = ?').get(classificationId);
  });
  return save();
}

function listCandidates(db, filters = {}) {
  assertAllowedFields(filters, FILTER_FIELDS, 'candidate filter');
  const clauses = [];
  const params = [];
  const mappings = [
    ['classification', 'COALESCE(c.human_override_classification, c.classification)'],
    ['priority', 'CASE WHEN c.human_override_classification IS NOT NULL THEN c.human_override_priority ELSE c.priority END'],
    ['country', 's.country'],
    ['status', 's.status'],
    ['id', 's.entity_id']
  ];
  for (const [key, column] of mappings) {
    if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') {
      clauses.push(`${column} = ?`);
      params.push(filters[key]);
    }
  }
  if (filters.safe_only !== false) {
    clauses.push("COALESCE(c.human_override_classification, c.classification) IN ('valid','needs_review')");
    clauses.push(`s.country IN (${APPROVED_COUNTRIES.map(() => '?').join(',')})`);
    params.push(...APPROVED_COUNTRIES);
  }

  const runClause = filters.run_id !== undefined && filters.run_id !== null && filters.run_id !== ''
    ? 'AND latest.run_id = ?'
    : '';
  const limitClause = Number.isSafeInteger(filters.limit) ? 'LIMIT ? OFFSET ?' : '';
  if (limitClause) params.push(filters.limit, Number.isSafeInteger(filters.offset) ? filters.offset : 0);
  const queryParams = runClause ? [filters.run_id, ...params] : params;
  return db.prepare(`
    SELECT
      s.entity_id AS id,
      s.normalized_domain,
      s.display_name,
      s.country,
      s.public_contacts_json,
      s.status,
      s.created_at,
      s.created_at AS updated_at,
      c.id AS classification_id,
      c.run_id,
      COALESCE(c.human_override_classification, c.classification) AS classification,
      CASE WHEN c.human_override_classification IS NOT NULL THEN c.human_override_priority ELSE c.priority END AS priority,
      c.reason_json,
      c.confidence AS classification_confidence
    FROM matrix_entity_snapshots s
    JOIN matrix_classifications c ON c.snapshot_id = s.id AND c.id = (
      SELECT latest.id FROM matrix_classifications latest
      WHERE latest.entity_id = s.entity_id
      ${runClause}
      ORDER BY latest.id DESC LIMIT 1
    )
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY s.entity_id
    ${limitClause}
  `).all(...queryParams);
}

function countCandidates(db, filters = {}) {
  assertAllowedFields(filters, FILTER_FIELDS, 'candidate filter');
  const clauses = [];
  const params = [];
  for (const [key, column] of [
    ['classification', 'COALESCE(c.human_override_classification, c.classification)'],
    ['priority', 'CASE WHEN c.human_override_classification IS NOT NULL THEN c.human_override_priority ELSE c.priority END'], ['country', 's.country'], ['status', 's.status'], ['id', 's.entity_id']
  ]) {
    if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') {
      clauses.push(`${column} = ?`);
      params.push(filters[key]);
    }
  }
  if (filters.safe_only !== false) {
    clauses.push("COALESCE(c.human_override_classification, c.classification) IN ('valid','needs_review')");
    clauses.push(`s.country IN (${APPROVED_COUNTRIES.map(() => '?').join(',')})`);
    params.push(...APPROVED_COUNTRIES);
  }
  const runClause = filters.run_id !== undefined && filters.run_id !== null && filters.run_id !== ''
    ? 'AND latest.run_id = ?' : '';
  const queryParams = runClause ? [filters.run_id, ...params] : params;
  return db.prepare(`
    SELECT COUNT(*) AS count
    FROM matrix_entity_snapshots s
    JOIN matrix_classifications c ON c.snapshot_id = s.id AND c.id = (
      SELECT latest.id FROM matrix_classifications latest
      WHERE latest.entity_id = s.entity_id ${runClause}
      ORDER BY latest.id DESC LIMIT 1
    )
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
  `).get(...queryParams).count;
}

function deleteRun(db, runId) {
  return db.transaction(() => {
    const affectedEntityIds = db.prepare('SELECT DISTINCT entity_id FROM matrix_entity_snapshots WHERE run_id = ?')
      .all(runId).map(row => Number(row.entity_id));
    db.prepare('DELETE FROM matrix_classifications WHERE run_id = ?').run(runId);
    db.prepare('DELETE FROM matrix_evidence WHERE run_id = ?').run(runId);
    db.prepare('DELETE FROM matrix_entity_snapshots WHERE run_id = ?').run(runId);
    const deleted = db.prepare('DELETE FROM matrix_runs WHERE id = ?').run(runId);
    const restore = db.prepare(`
      SELECT * FROM matrix_entity_snapshots WHERE entity_id = ? ORDER BY id DESC LIMIT 1
    `);
    const update = db.prepare(`
      UPDATE matrix_entities SET normalized_domain = ?, display_name = ?, country = ?,
        public_contacts_json = ?, status = ?, updated_at = ? WHERE id = ?
    `);
    for (const entityId of affectedEntityIds) {
      const snapshot = restore.get(entityId);
      if (snapshot) {
        update.run(snapshot.normalized_domain, snapshot.display_name, snapshot.country,
          snapshot.public_contacts_json, snapshot.status, timestamp(), entityId);
      } else {
        db.prepare('DELETE FROM matrix_entities WHERE id = ?').run(entityId);
      }
    }
    return deleted.changes;
  })();
}

module.exports = {
  createRun,
  upsertEntity,
  appendEvidence,
  saveClassification,
  listCandidates,
  countCandidates,
  deleteRun,
  CAMPAIGN_SOURCE_TYPES
};

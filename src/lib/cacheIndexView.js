'use strict';

const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');
const regionByCountry = require('./matrixRegions.json');

const BASE_WHERE = `
  r.country_code NOT IN ('CN','IN')
  AND r.stage_code <> 'suppressed'
  AND r.status IN ('valid','needs_review')
`;

const STABLE_ORDER = `
  CASE r.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
  CASE r.audit_state WHEN 'audited' THEN 0 ELSE 1 END,
  COALESCE(r.demand_fit_score, r.fit_score) DESC,
  COALESCE(r.access_score, 0) DESC,
  r.id ASC
`;

function jsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function maskedEmail(value) {
  if (!value || !value.includes('@')) return '';
  const [local, domain] = value.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

function maskedPhone(value) {
  if (!value) return '';
  const digits = String(value).replace(/\D/g, '');
  return digits ? `***${digits.slice(-4)}` : '';
}

function contacts(row, reveal = false) {
  if (reveal) {
    return {
      email: row.public_email || '',
      phone: row.public_phone || '',
      whatsapp: row.public_whatsapp || '',
      contact_page: row.contact_url || ''
    };
  }
  return {
    email: maskedEmail(row.public_email),
    phone: maskedPhone(row.public_phone),
    whatsapp: maskedPhone(row.public_whatsapp),
    contact_page: row.contact_url ? '[available]' : ''
  };
}

function summary(row, revealContacts = false) {
  return {
    id: row.id,
    company_name: row.company_name,
    country_code: row.country_code,
    region: regionByCountry[row.country_code] || null,
    city: row.city || '',
    official_domain: row.normalized_domain,
    official_url: row.official_url,
    categories: jsonArray(row.product_categories_json),
    format_signals: jsonArray(row.format_signals_json),
    size_signals: jsonArray(row.size_signals_json),
    scale_tier: row.scale_tier || '',
    priority: row.priority,
    fit_score: row.fit_score,
    demand_fit_score: row.demand_fit_score,
    access_score: row.access_score,
    confidence: row.confidence,
    status: row.status,
    audit_state: row.audit_state,
    assessment_cn: row.assessment_cn || '',
    next_action_cn: row.next_action_cn || '',
    updated_at: row.updated_at,
    contacts: contacts(row, revealContacts)
  };
}

function filterSql(filters = {}) {
  const clauses = [BASE_WHERE];
  const params = [];
  if (filters.region) {
    const codes = Object.entries(regionByCountry).filter(([, region]) => region === filters.region).map(([code]) => code);
    if (!codes.length) clauses.push('0');
    else {
      clauses.push(`r.country_code IN (${codes.map(() => '?').join(',')})`);
      params.push(...codes);
    }
  }
  if (filters.country) {
    clauses.push('r.country_code = ?');
    params.push(String(filters.country).toUpperCase());
  }
  if (filters.category) {
    clauses.push(`EXISTS (
      SELECT 1 FROM json_each(r.product_categories_json) category
      WHERE lower(CAST(category.value AS TEXT)) = lower(?)
    )`);
    params.push(String(filters.category));
  }
  if (filters.priority) {
    clauses.push('r.priority = ?');
    params.push(String(filters.priority));
  }
  if (filters.status) {
    clauses.push('r.status = ?');
    params.push(String(filters.status));
  }
  return { where: clauses.map(clause => `(${clause})`).join(' AND '), params };
}

function facets(db) {
  const countryRows = db.prepare(`
    SELECT r.country_code AS value, COUNT(*) AS count
    FROM cache_records r WHERE ${BASE_WHERE}
    GROUP BY r.country_code ORDER BY r.country_code
  `).all();
  const regionCounts = new Map();
  for (const row of countryRows) {
    const region = regionByCountry[row.value];
    if (region) regionCounts.set(region, (regionCounts.get(region) || 0) + row.count);
  }
  const categories = db.prepare(`
    SELECT CAST(category.value AS TEXT) AS value, COUNT(DISTINCT r.id) AS count
    FROM cache_records r, json_each(r.product_categories_json) category
    WHERE ${BASE_WHERE}
    GROUP BY CAST(category.value AS TEXT)
    ORDER BY lower(CAST(category.value AS TEXT)), CAST(category.value AS TEXT)
  `).all();
  return {
    regions: [...regionCounts].sort(([a], [b]) => a.localeCompare(b)).map(([value, count]) => ({ value, count })),
    countries: countryRows,
    categories
  };
}

function list(db, filters = {}) {
  const page = Math.max(1, Number.parseInt(filters.page, 10) || 1);
  const requestedSize = Number.parseInt(filters.pageSize ?? filters.page_size, 10) || 10;
  const pageSize = Math.min(50, Math.max(1, requestedSize));
  const { where, params } = filterSql(filters);
  const total = db.prepare(`SELECT COUNT(*) AS count FROM cache_records r WHERE ${where}`).get(...params).count;
  const rawRows = db.prepare(`
    SELECT r.* FROM cache_records r
    WHERE ${where}
    ORDER BY ${STABLE_ORDER}
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize);
  const rows = rawRows.map(row => summary(row));
  const snapshotKey = crypto.createHash('sha256').update(JSON.stringify({
    filters: {
      region: filters.region || '',
      country: filters.country || '',
      category: filters.category || '',
      priority: filters.priority || '',
      status: filters.status || ''
    },
    page,
    page_size: pageSize,
    total,
    rows: rawRows.map(row => [row.id, row.updated_at])
  })).digest('hex');
  return {
    rows,
    page,
    page_size: pageSize,
    total,
    total_pages: total ? Math.ceil(total / pageSize) : 0,
    snapshot_key: snapshotKey
  };
}

function detail(db, id, { revealContacts = false } = {}) {
  const row = db.prepare(`
    SELECT r.* FROM cache_records r
    WHERE r.id = ? AND ${BASE_WHERE}
  `).get(id);
  if (!row) return null;
  const officialEvidence = db.prepare(`
    SELECT source_url, source_type, page_title, observed_at, excerpt
    FROM cache_evidence
    WHERE record_id = ? AND source_type = 'official_website'
    ORDER BY observed_at DESC, id ASC
  `).all(id);
  const supportingEvidence = db.prepare(`
    SELECT source_url, source_type, page_title, observed_at, excerpt
    FROM cache_evidence
    WHERE record_id = ? AND (source_type IS NULL OR source_type <> 'official_website')
    ORDER BY observed_at DESC, id ASC
  `).all(id);
  const discovery = db.prepare(`
    SELECT discovered_via, discovery_url, official_url, source_type, verified_at
    FROM cache_discovery WHERE record_id = ? ORDER BY verified_at DESC, id ASC LIMIT 1
  `).get(id) || null;
  return {
    ...summary(row, revealContacts),
    discovery,
    official_evidence: officialEvidence,
    supporting_evidence: supportingEvidence,
    evidence: officialEvidence
  };
}

function recommend(db, limit, excludeIds) {
  if (limit <= 0) return [];
  const ids = [...new Set((excludeIds || []).map(Number).filter(Number.isInteger))];
  const exclusion = ids.length ? `AND r.id NOT IN (${ids.map(() => '?').join(',')})` : '';
  return db.prepare(`
    SELECT r.* FROM cache_records r
    WHERE ${BASE_WHERE} ${exclusion}
    ORDER BY ${STABLE_ORDER}
    LIMIT ?
  `).all(...ids, limit).map(row => summary(row));
}

function recommendationLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(5, Math.max(0, Math.trunc(numeric)));
}

function createCacheIndexView({ dbPath } = {}) {
  const selectedPath = dbPath || process.env.MATRIX_STREAM_DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'matrix-stream.db');
  const db = new Database(selectedPath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  return {
    facets: () => facets(db),
    list: filters => list(db, filters),
    detail: (id, options) => detail(db, id, options),
    recommend: ({ limit = 5, excludeIds = [] } = {}) => recommend(db, recommendationLimit(limit), excludeIds),
    close: () => db.close()
  };
}

module.exports = { createCacheIndexView };

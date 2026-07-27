'use strict';

const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');
const regionByCountry = require('./matrixRegions.json');

const NEARBY_COUNTRY_CODES = Object.freeze(new Set([
  'JP', 'KR', 'VN', 'TH', 'MY', 'ID', 'PH', 'MN',
  'RU', 'KZ', 'UZ', 'KG', 'PK', 'BD', 'NP', 'LK'
]));
const NEARBY_SQL = `r.country_code IN (${[...NEARBY_COUNTRY_CODES].map(code => `'${code}'`).join(',')})`;

const BASE_WHERE = `
  r.country_code NOT IN ('CN','IN')
  AND r.stage_code <> 'suppressed'
  AND r.status IN ('valid','needs_review')
`;

// A review is current only when an explicit audit timestamp exists and the
// record has not been updated after that audit. Missing/unparseable timestamps
// never imply freshness.
const CURRENT_REVIEW_WHERE = `
  r.audit_state = 'audited'
  AND julianday(r.audited_at) IS NOT NULL
  AND julianday(r.updated_at) IS NOT NULL
  AND julianday(r.audited_at) >= julianday(r.updated_at)
`;

const RECOMMENDATION_WHERE = `
  ${BASE_WHERE}
  AND ${NEARBY_SQL}
  AND r.status = 'valid'
  AND r.stage_code IN ('observed', 'recommendation_ready')
  AND ${CURRENT_REVIEW_WHERE}
  AND EXISTS (
    SELECT 1 FROM cache_evidence recommendation_evidence
    WHERE recommendation_evidence.record_id = r.id
      AND recommendation_evidence.source_type = 'official_website'
      AND trim(COALESCE(recommendation_evidence.source_url, '')) <> ''
  )
  AND EXISTS (SELECT 1 FROM cache_discovery recommendation_discovery WHERE recommendation_discovery.record_id = r.id)
  AND (
    trim(COALESCE(r.public_email, '')) <> ''
    OR trim(COALESCE(r.public_phone, '')) <> ''
    OR trim(COALESCE(r.public_whatsapp, '')) <> ''
    OR trim(COALESCE(r.contact_url, '')) <> ''
  )
`;

const STABLE_ORDER = `
  CASE r.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
  CASE r.audit_state WHEN 'audited' THEN 0 ELSE 1 END,
  COALESCE(r.demand_fit_score, r.fit_score) DESC,
  COALESCE(r.access_score, 0) DESC,
  r.id ASC
`;

const REQUIRED_COLUMNS = Object.freeze({
  cache_records: ['id', 'company_name', 'country_code', 'city', 'normalized_domain', 'official_url', 'product_categories_json', 'format_signals_json', 'size_signals_json', 'scale_tier', 'public_email', 'public_phone', 'public_whatsapp', 'contact_url', 'priority', 'fit_score', 'demand_fit_score', 'access_score', 'confidence', 'status', 'assessment_cn', 'next_action_cn', 'stage_code', 'audit_state', 'audited_at', 'updated_at'],
  cache_evidence: ['id', 'record_id', 'source_url', 'source_type', 'page_title', 'observed_at', 'excerpt'],
  cache_discovery: ['id', 'record_id', 'discovered_via', 'discovery_url', 'official_url', 'source_type', 'verified_at']
});

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
    stage_code: row.stage_code,
    audit_state: row.audit_state,
    assessment_cn: row.assessment_cn || '',
    next_action_cn: row.next_action_cn || '',
    updated_at: row.updated_at,
    contacts: contacts(row, revealContacts)
  };
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function signalsForRecord(db, id) {
  let supplierSignal = null;
  let strategySignal = null;
  if (tableExists(db, 'cache_relationships')) {
    supplierSignal = db.prepare(`
      SELECT supplier_name, supplier_country_code, supplied_category, confidence,
             source_url, source_type, observed_at, excerpt
      FROM cache_relationships
      WHERE record_id = ? AND confidence IN ('confirmed', 'public_lead')
      ORDER BY observed_at DESC, id DESC LIMIT 1
    `).get(id) || null;
  }
  if (tableExists(db, 'cache_strategy_signals')) {
    const row = db.prepare(`
      SELECT entry_product, differentiation_angle, first_contact_goal,
             questions_json, risks_json, source_url, observed_at
      FROM cache_strategy_signals
      WHERE record_id = ?
      ORDER BY observed_at DESC, id DESC LIMIT 1
    `).get(id);
    if (row) {
      strategySignal = {
        entry_product: row.entry_product,
        differentiation_angle: row.differentiation_angle,
        first_contact_goal: row.first_contact_goal,
        questions: jsonArray(row.questions_json),
        risks: jsonArray(row.risks_json),
        source_url: row.source_url,
        observed_at: row.observed_at
      };
    }
  }
  return { supplier_signal: supplierSignal, strategy_signal: strategySignal };
}

function productUrlForRecord(db, id) {
  const row = db.prepare(`
    SELECT source_url
    FROM cache_evidence
    WHERE record_id = ? AND source_type = 'official_website'
      AND trim(COALESCE(source_url, '')) <> ''
    ORDER BY CASE WHEN lower(source_url) LIKE '%product%' THEN 0 ELSE 1 END,
             observed_at DESC, id ASC
    LIMIT 1
  `).get(id);
  return row?.source_url || '';
}

function enrichRecommendation(db, row) {
  return { ...summary(row), product_url: productUrlForRecord(db, row.id), ...signalsForRecord(db, row.id) };
}

function filterSql(filters = {}, baseWhere = BASE_WHERE) {
  const clauses = [baseWhere];
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

function paginated(db, filters = {}, baseWhere = BASE_WHERE, maximumPageSize = 50) {
  const page = Math.max(1, Number.parseInt(filters.page, 10) || 1);
  const requestedSize = Number.parseInt(filters.pageSize ?? filters.page_size, 10) || 10;
  const pageSize = Math.min(maximumPageSize, Math.max(1, requestedSize));
  const { where, params } = filterSql(filters, baseWhere);
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

function list(db, filters = {}) { return paginated(db, filters, BASE_WHERE, 50); }
function recommendPage(db, filters = {}, afterMembership) {
  const page = Math.max(1, Number.parseInt(filters.page, 10) || 1);
  const pageSize = Math.min(5, Math.max(1, Number.parseInt(filters.pageSize ?? filters.page_size, 10) || 5));
  const { where, params } = filterSql(filters, RECOMMENDATION_WHERE);
  const readSnapshot = db.transaction(() => {
    const membership = db.prepare(`SELECT r.id, r.updated_at FROM cache_records r WHERE ${where} ORDER BY ${STABLE_ORDER}`).all(...params);
    if (afterMembership) afterMembership();
    const rawRows = db.prepare(`SELECT r.* FROM cache_records r WHERE ${where} ORDER BY ${STABLE_ORDER} LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
    const snapshotKey = crypto.createHash('sha256').update(JSON.stringify({
      filters: { region: filters.region || '', country: filters.country || '', category: filters.category || '', priority: filters.priority || '', status: filters.status || '' },
      membership: membership.map(row => [row.id, row.updated_at])
    })).digest('hex');
    return { rows: rawRows.map(row => enrichRecommendation(db, row)), page, page_size: pageSize, total: membership.length, total_pages: membership.length ? Math.ceil(membership.length / pageSize) : 0, snapshot_key: snapshotKey };
  });
  return readSnapshot.deferred();
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
    WHERE record_id = ? AND source_type LIKE 'official_%'
    ORDER BY observed_at DESC, id ASC
  `).all(id);
  const supportingEvidence = db.prepare(`
    SELECT source_url, source_type, page_title, observed_at, excerpt
    FROM cache_evidence
    WHERE record_id = ? AND (source_type IS NULL OR source_type NOT LIKE 'official_%')
    ORDER BY observed_at DESC, id ASC
  `).all(id);
  const discovery = db.prepare(`
    SELECT discovered_via, discovery_url, official_url, source_type, verified_at
    FROM cache_discovery WHERE record_id = ? ORDER BY verified_at DESC, id ASC LIMIT 1
  `).get(id) || null;
  return {
    ...summary(row, revealContacts),
    product_url: productUrlForRecord(db, id),
    ...signalsForRecord(db, id),
    discovery,
    official_evidence: officialEvidence,
    supporting_evidence: supportingEvidence,
    evidence: officialEvidence
  };
}

function recommend(db, limit, excludeIds, filters = {}) {
  if (limit <= 0) return [];
  const ids = [...new Set((excludeIds || []).map(Number).filter(Number.isInteger))];
  const exclusion = ids.length ? `AND r.id NOT IN (${ids.map(() => '?').join(',')})` : '';
  const { where, params } = filterSql(filters, RECOMMENDATION_WHERE);
  return db.prepare(`
    SELECT r.* FROM cache_records r
    WHERE ${where} ${exclusion}
    ORDER BY ${STABLE_ORDER}
    LIMIT ?
  `).all(...params, ...ids, limit).map(row => enrichRecommendation(db, row));
}

function recommendationById(db, id) {
  const row = db.prepare(`SELECT r.* FROM cache_records r WHERE r.id = ? AND ${RECOMMENDATION_WHERE}`).get(id);
  return row ? enrichRecommendation(db, row) : null;
}

function recommendationLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(5, Math.max(0, Math.trunc(numeric)));
}

function createCacheIndexView({ dbPath, afterRecommendationMembership } = {}) {
  const selectedPath = dbPath || process.env.MATRIX_STREAM_DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'matrix-stream.db');
  const db = new Database(selectedPath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  function ready() {
    if (db.pragma('query_only', { simple: true }) !== 1) throw new Error('candidate database is not query-only');
    for (const table of ['cache_records', 'cache_evidence', 'cache_discovery']) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) throw new Error('candidate database schema incomplete');
    }
    for (const [table, requiredColumns] of Object.entries(REQUIRED_COLUMNS)) {
      const actualColumns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
      for (const column of requiredColumns) if (!actualColumns.has(column)) throw new Error('candidate database schema incomplete');
    }
    recommendPage(db, { page: 1, page_size: 1 });
    return true;
  }
  return {
    facets: () => facets(db),
    list: filters => list(db, filters),
    recommendPage: filters => recommendPage(db, filters, afterRecommendationMembership),
    recommendationById: id => recommendationById(db, id),
    detail: (id, options) => detail(db, id, options),
    recommend: ({ limit = 5, excludeIds = [], filters = {} } = {}) => recommend(db, recommendationLimit(limit), excludeIds, filters),
    ready,
    close: () => db.close()
  };
}

module.exports = { createCacheIndexView, BASE_WHERE, CURRENT_REVIEW_WHERE, RECOMMENDATION_WHERE, NEARBY_COUNTRY_CODES, REQUIRED_COLUMNS };

'use strict';

const crypto = require('node:crypto');

const SOURCE_ROLES = new Set(['home', 'profile', 'products', 'process', 'quality', 'sustainability', 'contact']);
const SOURCE_TYPES = new Set(['official_website', 'government', 'association', 'exhibition', 'certification_body', 'official_corporate']);
const CONFIDENCE = new Set(['confirmed', 'inferred', 'unknown', 'not_relevant']);
const ROUTE_STATUS = new Set(['draft', 'verified-local', 'deployed-unverified', 'ready', 'blocked', 'stale']);
const REQUIRED_ROLES = ['profile', 'products', 'process', 'contact'];

function ensureResearchSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS matrix_research_dossiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER NOT NULL UNIQUE,
      reviewer TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('complete','insufficient')),
      blockers_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS matrix_research_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dossier_id INTEGER NOT NULL,
      candidate_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_type TEXT NOT NULL,
      page_title TEXT NOT NULL DEFAULT '',
      checked_at TEXT NOT NULL,
      excerpt TEXT NOT NULL DEFAULT '',
      fingerprint TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL,
      UNIQUE(candidate_id, source_url, fingerprint),
      FOREIGN KEY(dossier_id) REFERENCES matrix_research_dossiers(id)
    );
    CREATE TABLE IF NOT EXISTS matrix_research_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dossier_id INTEGER NOT NULL,
      candidate_id INTEGER NOT NULL,
      field TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence TEXT NOT NULL CHECK(confidence IN ('confirmed','inferred','unknown','not_relevant')),
      source_url TEXT NOT NULL DEFAULT '',
      public_copy INTEGER NOT NULL DEFAULT 0 CHECK(public_copy IN (0,1)),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL,
      UNIQUE(candidate_id, field, value, confidence, source_url),
      FOREIGN KEY(dossier_id) REFERENCES matrix_research_dossiers(id)
    );
    CREATE TABLE IF NOT EXISTS matrix_route_assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER NOT NULL,
      route_set_id TEXT NOT NULL,
      locale TEXT NOT NULL,
      category TEXT NOT NULL,
      canonical_urls_json TEXT NOT NULL,
      source_commit TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft','verified-local','deployed-unverified','ready','blocked','stale')),
      checks_json TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      verifier TEXT NOT NULL,
      blocking_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE(candidate_id, route_set_id, checked_at)
    );
    CREATE INDEX IF NOT EXISTS idx_matrix_research_sources_candidate ON matrix_research_sources(candidate_id, role);
    CREATE INDEX IF NOT EXISTS idx_matrix_research_facts_candidate ON matrix_research_facts(candidate_id, confidence);
    CREATE INDEX IF NOT EXISTS idx_matrix_route_assessments_candidate ON matrix_route_assessments(candidate_id, route_set_id, checked_at DESC);
  `);
}

function positiveId(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label} must be a positive integer`);
  return number;
}

function requiredText(value, label, maximum = 2000) {
  const text = String(value || '').trim();
  if (!text || text.length > maximum || /\0/.test(text)) throw new Error(`${label} required`);
  return text;
}

function isoTimestamp(value, label) {
  const text = String(value || '').trim();
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} must be an ISO timestamp`);
  return new Date(text).toISOString();
}

function httpsUrl(value, label, optional = false) {
  const text = String(value || '').trim();
  if (!text && optional) return '';
  let url;
  try { url = new URL(text); } catch (_) { throw new Error(`${label} must be a valid HTTPS URL`); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) {
    throw new Error(`${label} must be a valid HTTPS URL`);
  }
  return url.toString();
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeSource(raw) {
  const source = object(raw, 'source');
  const role = requiredText(source.role, 'source role', 40);
  const sourceType = requiredText(source.source_type, 'source type', 40);
  if (!SOURCE_ROLES.has(role)) throw new Error('invalid source role');
  if (!SOURCE_TYPES.has(sourceType)) throw new Error('invalid source type');
  const normalized = {
    role,
    source_url: httpsUrl(source.source_url, 'source URL'),
    source_type: sourceType,
    page_title: String(source.page_title || '').trim().slice(0, 300),
    checked_at: isoTimestamp(source.checked_at, 'source checked_at'),
    excerpt: String(source.excerpt || '').trim().slice(0, 4000)
  };
  normalized.fingerprint = String(source.fingerprint || '').trim() || fingerprint(normalized);
  if (normalized.fingerprint.length > 128 || /[\r\n\0]/.test(normalized.fingerprint)) throw new Error('invalid source fingerprint');
  return normalized;
}

function normalizeFact(raw) {
  const fact = object(raw, 'fact');
  const confidence = requiredText(fact.confidence, 'fact confidence', 30);
  if (!CONFIDENCE.has(confidence)) throw new Error('invalid fact confidence');
  const normalized = {
    field: requiredText(fact.field, 'fact field', 120),
    value: requiredText(fact.value, 'fact value', 4000),
    confidence,
    source_url: httpsUrl(fact.source_url, 'fact source URL', true),
    public_copy: fact.public_copy === true
  };
  if (normalized.public_copy && (confidence !== 'confirmed' || !normalized.source_url)) {
    throw new Error('public copy requires confirmed sourced fact');
  }
  return normalized;
}

function dossierStatus(sources) {
  const urls = new Set(sources.map(source => source.source_url));
  const roles = new Set(sources.map(source => source.role));
  const blockers = [];
  if (urls.size < 3) blockers.push('official_source_coverage_below_3');
  for (const role of REQUIRED_ROLES) if (!roles.has(role)) blockers.push(`${role}_source_missing`);
  return { status: blockers.length ? 'insufficient' : 'complete', blockers, covered_roles: [...roles].sort() };
}

function saveDossier(db, input = {}) {
  ensureResearchSchema(db);
  const candidateId = positiveId(input.candidate_id, 'candidate id');
  const reviewer = requiredText(input.reviewer, 'reviewer', 128);
  const checkedAt = isoTimestamp(input.checked_at, 'checked_at');
  const sources = Array.isArray(input.sources) ? input.sources.map(normalizeSource) : [];
  const facts = Array.isArray(input.facts) ? input.facts.map(normalizeFact) : [];
  if (!sources.length) throw new Error('at least one source required');
  const assessment = dossierStatus(sources);
  const now = new Date().toISOString();
  return db.transaction(() => {
    db.prepare(`
      INSERT INTO matrix_research_dossiers (candidate_id, reviewer, checked_at, status, blockers_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(candidate_id) DO UPDATE SET reviewer=excluded.reviewer, checked_at=excluded.checked_at,
        status=excluded.status, blockers_json=excluded.blockers_json, updated_at=excluded.updated_at
    `).run(candidateId, reviewer, checkedAt, assessment.status, JSON.stringify(assessment.blockers), now, now);
    const dossier = db.prepare('SELECT * FROM matrix_research_dossiers WHERE candidate_id = ?').get(candidateId);
    db.prepare('UPDATE matrix_research_sources SET active = 0 WHERE candidate_id = ?').run(candidateId);
    db.prepare('UPDATE matrix_research_facts SET active = 0 WHERE candidate_id = ?').run(candidateId);
    const insertSource = db.prepare(`
      INSERT OR IGNORE INTO matrix_research_sources
        (dossier_id,candidate_id,role,source_url,source_type,page_title,checked_at,excerpt,fingerprint,active,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,1,?)
    `);
    for (const source of sources) insertSource.run(
      dossier.id, candidateId, source.role, source.source_url, source.source_type,
      source.page_title, source.checked_at, source.excerpt, source.fingerprint, now
    );
    const reactivateSource = db.prepare(`
      UPDATE matrix_research_sources SET dossier_id=?, role=?, source_type=?, page_title=?, checked_at=?, excerpt=?, active=1
      WHERE candidate_id=? AND source_url=? AND fingerprint=?
    `);
    for (const source of sources) reactivateSource.run(
      dossier.id, source.role, source.source_type, source.page_title, source.checked_at, source.excerpt,
      candidateId, source.source_url, source.fingerprint
    );
    const insertFact = db.prepare(`
      INSERT OR IGNORE INTO matrix_research_facts
        (dossier_id,candidate_id,field,value,confidence,source_url,public_copy,active,created_at)
      VALUES (?,?,?,?,?,?,?,1,?)
    `);
    for (const fact of facts) insertFact.run(
      dossier.id, candidateId, fact.field, fact.value, fact.confidence,
      fact.source_url, fact.public_copy ? 1 : 0, now
    );
    const reactivateFact = db.prepare(`
      UPDATE matrix_research_facts SET dossier_id=?, public_copy=?, active=1
      WHERE candidate_id=? AND field=? AND value=? AND confidence=? AND source_url=?
    `);
    for (const fact of facts) reactivateFact.run(
      dossier.id, fact.public_copy ? 1 : 0, candidateId, fact.field, fact.value, fact.confidence, fact.source_url
    );
    return { id: dossier.id, candidate_id: candidateId, ...assessment };
  }).immediate();
}

function getDossier(db, candidateIdValue) {
  ensureResearchSchema(db);
  const candidateId = positiveId(candidateIdValue, 'candidate id');
  const dossier = db.prepare('SELECT * FROM matrix_research_dossiers WHERE candidate_id = ?').get(candidateId);
  if (!dossier) return null;
  const sources = db.prepare('SELECT role,source_url,source_type,page_title,checked_at,excerpt,fingerprint FROM matrix_research_sources WHERE candidate_id = ? AND active = 1 ORDER BY id').all(candidateId);
  const facts = db.prepare('SELECT field,value,confidence,source_url,public_copy FROM matrix_research_facts WHERE candidate_id = ? AND active = 1 ORDER BY id').all(candidateId)
    .map(fact => ({ ...fact, public_copy: fact.public_copy === 1 }));
  return {
    ...dossier,
    blockers: JSON.parse(dossier.blockers_json),
    covered_roles: [...new Set(sources.map(source => source.role))],
    sources,
    facts
  };
}

function saveRouteAssessment(db, input = {}) {
  ensureResearchSchema(db);
  const candidateId = positiveId(input.candidate_id, 'candidate id');
  const routeSetId = requiredText(input.route_set_id, 'route set id', 120);
  const locale = requiredText(input.locale, 'locale', 20);
  const category = requiredText(input.category, 'category', 120);
  const urls = Array.isArray(input.canonical_urls) ? input.canonical_urls.map((url, index) => httpsUrl(url, `canonical URL ${index + 1}`)) : [];
  if (!urls.length) throw new Error('canonical URLs required');
  const sourceCommit = requiredText(input.source_commit, 'source commit', 128);
  const status = requiredText(input.status, 'route status', 40);
  if (!ROUTE_STATUS.has(status)) throw new Error('invalid route status');
  const checks = object(input.checks, 'route checks');
  const checkedAt = isoTimestamp(input.checked_at, 'route checked_at');
  const verifier = requiredText(input.verifier, 'verifier', 128);
  const blockingReason = String(input.blocking_reason || '').trim().slice(0, 1000);
  const createdAt = new Date().toISOString();
  const inserted = db.prepare(`
    INSERT INTO matrix_route_assessments
      (candidate_id,route_set_id,locale,category,canonical_urls_json,source_commit,status,checks_json,checked_at,verifier,blocking_reason,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(candidate_id,route_set_id,checked_at) DO UPDATE SET
      locale=excluded.locale, category=excluded.category, canonical_urls_json=excluded.canonical_urls_json,
      source_commit=excluded.source_commit, status=excluded.status, checks_json=excluded.checks_json,
      verifier=excluded.verifier, blocking_reason=excluded.blocking_reason
  `).run(candidateId, routeSetId, locale, category, JSON.stringify(urls), sourceCommit, status, JSON.stringify(checks), checkedAt, verifier, blockingReason, createdAt);
  const id = inserted.lastInsertRowid || db.prepare('SELECT id FROM matrix_route_assessments WHERE candidate_id=? AND route_set_id=? AND checked_at=?').get(candidateId, routeSetId, checkedAt).id;
  return { id: Number(id), candidate_id: candidateId, route_set_id: routeSetId, locale, category, canonical_urls: urls, source_commit: sourceCommit, status, checks, checked_at: checkedAt, verifier, blocking_reason: blockingReason };
}

module.exports = { ensureResearchSchema, saveDossier, getDossier, saveRouteAssessment };

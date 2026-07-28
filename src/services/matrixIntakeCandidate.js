'use strict';

const crypto = require('node:crypto');

const TOP_KEYS = ['candidate_key', 'categories', 'company_name', 'confidence', 'country_code', 'discovery', 'fit_score', 'formats', 'normalized_domain', 'official_url', 'priority', 'recipient', 'route_readiness', 'scale_tier', 'size_signals', 'sources'];
const REQUIRED_SOURCE_ROLES = new Set(['home', 'profile', 'products', 'process', 'contact']);

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const expected = new Set(keys);
  for (const key of Object.keys(value)) if (!expected.has(key)) throw new Error(`${label} has unknown field: ${key}`);
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`${label} missing field: ${key}`);
}

function cleanText(value, label, maximum = 500) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text`);
  const result = value.trim();
  if ([...result].length > maximum) throw new Error(`${label} is too long`);
  return result;
}

function cleanDomain(value) {
  const result = String(value || '').trim().toLowerCase().replace(/^www\./, '');
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(result)) throw new Error('normalized_domain is invalid');
  return result;
}

function httpsUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be a public HTTPS URL`); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !host.includes('.') || /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(host)) {
    throw new Error(`${label} must be a public HTTPS URL`);
  }
  return url.toString();
}

function onDomain(url, domain) {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  return host === domain || host.endsWith(`.${domain}`);
}

function iso(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
  return new Date(value).toISOString();
}

function recent(value, now, label, maximumDays = 180) {
  const parsed = iso(value, label);
  const age = Date.parse(now) - Date.parse(parsed);
  if (age < 0 || age > maximumDays * 86400000) throw new Error(`${label} evidence is stale`);
  return parsed;
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.length > 20) throw new Error(`${label} must be an array`);
  return value.map((item, index) => cleanText(item, `${label}[${index}]`, 120));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function parseInput(input, now) {
  exactKeys(input, TOP_KEYS, 'candidate');
  const domain = cleanDomain(input.normalized_domain);
  const officialUrl = httpsUrl(input.official_url, 'official_url');
  if (!onDomain(officialUrl, domain)) throw new Error('official URL domain mismatch');
  exactKeys(input.recipient, ['email', 'role', 'source_url', 'verified_at'], 'recipient');
  const email = cleanText(input.recipient.email, 'recipient.email', 254).toLowerCase();
  const emailParts = email.split('@');
  if (emailParts.length !== 2 || cleanDomain(emailParts[1]) !== domain) throw new Error('recipient domain mismatch');
  const recipientSource = httpsUrl(input.recipient.source_url, 'recipient.source_url');
  if (!onDomain(recipientSource, domain)) throw new Error('recipient source domain mismatch');

  if (!Array.isArray(input.sources)) throw new Error('sources must be an array');
  const roles = new Set();
  const sources = input.sources.map((row, index) => {
    exactKeys(row, ['excerpt', 'observed_at', 'page_title', 'role', 'source_url'], `sources[${index}]`);
    const role = cleanText(row.role, `sources[${index}].role`, 40);
    const sourceUrl = httpsUrl(row.source_url, `sources[${index}].source_url`);
    if (!onDomain(sourceUrl, domain)) throw new Error('official source domain mismatch');
    roles.add(role);
    return {
      role,
      source_url: sourceUrl,
      page_title: cleanText(row.page_title, `sources[${index}].page_title`, 160),
      observed_at: recent(row.observed_at, now, `sources[${index}].observed_at`),
      excerpt: cleanText(row.excerpt, `sources[${index}].excerpt`)
    };
  });
  for (const role of REQUIRED_SOURCE_ROLES) if (!roles.has(role)) throw new Error(`required official source role missing: ${role}`);
  if (new Set(sources.map(row => row.source_url)).size < 3) throw new Error('at least three distinct official source URLs required');

  exactKeys(input.discovery, ['collected_at', 'source_adapter', 'source_query', 'source_url'], 'discovery');
  const discoveryUrl = httpsUrl(input.discovery.source_url, 'discovery.source_url');
  exactKeys(input.route_readiness, ['commit', 'expected_language', 'id', 'status', 'urls', 'verified_at'], 'route_readiness');
  if (input.route_readiness.status !== 'ready') throw new Error('route readiness must be ready');
  exactKeys(input.route_readiness.urls, ['about', 'application', 'home', 'market', 'product'], 'route_readiness.urls');
  const routeUrls = Object.fromEntries(Object.entries(input.route_readiness.urls).map(([key, value]) => [key, httpsUrl(value, `route_readiness.urls.${key}`)]));

  const priority = cleanText(input.priority, 'priority', 2);
  if (!['P0', 'P1', 'P2', 'P3'].includes(priority)) throw new Error('priority is invalid');
  if (!Number.isFinite(input.fit_score) || input.fit_score < 0 || input.fit_score > 100) throw new Error('fit_score is invalid');
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new Error('confidence is invalid');

  return {
    candidate_key: cleanText(input.candidate_key, 'candidate_key', 160),
    company_name: cleanText(input.company_name, 'company_name', 160),
    country_code: cleanText(input.country_code, 'country_code', 2).toUpperCase(),
    normalized_domain: domain,
    official_url: officialUrl,
    recipient: {
      email,
      role: cleanText(input.recipient.role, 'recipient.role', 120),
      source_url: recipientSource,
      verified_at: recent(input.recipient.verified_at, now, 'recipient.verified_at')
    },
    categories: stringArray(input.categories, 'categories'),
    formats: stringArray(input.formats, 'formats'),
    size_signals: stringArray(input.size_signals, 'size_signals'),
    scale_tier: cleanText(input.scale_tier, 'scale_tier', 40),
    priority,
    fit_score: input.fit_score,
    confidence: input.confidence,
    sources,
    discovery: {
      source_adapter: cleanText(input.discovery.source_adapter, 'discovery.source_adapter', 120),
      source_url: discoveryUrl,
      source_query: cleanText(input.discovery.source_query, 'discovery.source_query', 300),
      collected_at: recent(input.discovery.collected_at, now, 'discovery.collected_at')
    },
    route_readiness: {
      id: cleanText(input.route_readiness.id, 'route_readiness.id', 120),
      status: 'ready',
      expected_language: cleanText(input.route_readiness.expected_language, 'route_readiness.expected_language', 12).toLowerCase(),
      commit: cleanText(input.route_readiness.commit, 'route_readiness.commit', 80),
      verified_at: recent(input.route_readiness.verified_at, now, 'route_readiness.verified_at'),
      urls: routeUrls
    }
  };
}

function admitReviewedCandidate(db, input, { clock = () => new Date().toISOString() } = {}) {
  const now = iso(clock(), 'clock');
  const candidate = parseInput(input, now);
  const fingerprint = digest(candidate);
  db.exec(`
    CREATE TABLE IF NOT EXISTS cache_reviewed_intakes (
      candidate_key TEXT PRIMARY KEY,
      record_id INTEGER NOT NULL UNIQUE,
      request_fingerprint TEXT NOT NULL,
      route_readiness_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(record_id) REFERENCES cache_records(id) ON DELETE CASCADE
    )
  `);
  const execute = db.transaction(() => {
    const prior = db.prepare('SELECT record_id, request_fingerprint FROM cache_reviewed_intakes WHERE candidate_key = ?').get(candidate.candidate_key);
    if (prior) {
      if (prior.request_fingerprint !== fingerprint) throw new Error('candidate identity conflict');
      return { candidate_id: prior.record_id, resolution: 'replayed', fingerprint };
    }
    if (db.prepare('SELECT id FROM cache_records WHERE lower(normalized_domain) = lower(?)').get(candidate.normalized_domain)) {
      throw new Error('candidate identity conflict');
    }
    const result = db.prepare(`
      INSERT INTO cache_records (
        company_name,country_code,city,normalized_domain,official_url,product_categories_json,
        format_signals_json,size_signals_json,scale_tier,public_email,public_phone,public_whatsapp,
        contact_url,priority,fit_score,confidence,status,assessment_cn,next_action_cn,stage_code,
        first_seen_at,updated_at,demand_fit_score,access_score,contact_role,audit_state,audit_note,audited_at
      ) VALUES (
        @company_name,@country_code,'',@normalized_domain,@official_url,@categories,@formats,@sizes,
        @scale_tier,@email,'','',@contact_url,@priority,@fit_score,@confidence,'valid','','','observed',
        @now,@now,@fit_score,100,@contact_role,'audited',@audit_note,@now
      )
    `).run({
      company_name: candidate.company_name,
      country_code: candidate.country_code,
      normalized_domain: candidate.normalized_domain,
      official_url: candidate.official_url,
      categories: JSON.stringify(candidate.categories),
      formats: JSON.stringify(candidate.formats),
      sizes: JSON.stringify(candidate.size_signals),
      scale_tier: candidate.scale_tier,
      email: candidate.recipient.email,
      contact_url: candidate.recipient.source_url,
      priority: candidate.priority,
      fit_score: candidate.fit_score,
      confidence: candidate.confidence,
      now,
      contact_role: candidate.recipient.role,
      audit_note: `Reviewed public-source intake ${candidate.candidate_key}`
    });
    const recordId = Number(result.lastInsertRowid);
    const evidence = db.prepare(`
      INSERT INTO cache_evidence (record_id,source_url,source_type,page_title,observed_at,excerpt,fingerprint,created_at)
      VALUES (?,?,?,?,?,?,?,?)
    `);
    for (const row of candidate.sources) evidence.run(recordId, row.source_url, `official_${row.role}`, row.page_title, row.observed_at, row.excerpt, digest(row), now);
    db.prepare(`
      INSERT INTO cache_discovery (record_id,normalized_domain,discovered_via,discovery_url,official_url,source_type,verified_at,fingerprint,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(recordId, candidate.normalized_domain, candidate.discovery.source_adapter, candidate.discovery.source_url,
      candidate.official_url, 'reviewed_public_source', candidate.discovery.collected_at, digest(candidate.discovery), now);
    db.prepare('INSERT INTO cache_reviewed_intakes VALUES (?,?,?,?,?)').run(
      candidate.candidate_key, recordId, fingerprint, JSON.stringify(candidate.route_readiness), now
    );
    return { candidate_id: recordId, resolution: 'inserted', fingerprint };
  });
  return execute.immediate();
}

module.exports = { admitReviewedCandidate, parseReviewedCandidate: parseInput };

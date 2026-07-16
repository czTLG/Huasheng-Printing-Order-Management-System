'use strict';

const express = require('express');
const { db, audit } = require('../db');
const { allowRoles } = require('../middleware/auth');
const { listCandidates } = require('../lib/signalCache');
const { APPROVED_COUNTRIES, EXCLUDED_COUNTRIES } = require('../lib/schemaRank');

const router = express.Router();
const CRM_ROLES = ['super_admin', 'foreign_trade_crm_admin'];
const CLASSIFICATIONS = new Set(['valid', 'needs_review', 'noise', 'test']);
const PRIORITIES = new Set(['A', 'B', 'C']);
const COUNTRIES = new Set([...APPROVED_COUNTRIES, ...EXCLUDED_COUNTRIES]);
const PUBLIC_REASON_CODES = new Set([
  'fixture_marker', 'security_notice', 'excluded_country', 'unapproved_country',
  'missing_identity', 'ambiguous_contact', 'unknown_whatsapp_sender',
  'malformed_source_time', 'conflicting_domains', 'approved_country',
  'official_domain', 'product_evidence', 'valid_source_time',
  'confirmed_international_whatsapp', 'business_evidence',
  'duplicated_message_segments', 'malformed_json_payload',
  'uncertain_direction', 'missing_business_evidence', 'classification_error'
]);

router.use(allowRoles(...CRM_ROLES));

function parseObject(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function publicReasonCodes(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter(item => PUBLIC_REASON_CODES.has(item)) : [];
  } catch (_) {
    return [];
  }
}

function pagination(query) {
  const rawPage = query.page === undefined ? '1' : String(query.page);
  const rawPageSize = query.page_size === undefined ? '20' : String(query.page_size);
  const page = Number(rawPage);
  const pageSize = Number(rawPageSize);
  if (!/^\d+$/.test(rawPage) || !Number.isSafeInteger(page) || page < 1) throw new Error('page must be a positive safe integer');
  if (!/^\d+$/.test(rawPageSize) || !Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error('page_size must be a positive safe integer');
  return { page, pageSize: Math.min(pageSize, 100) };
}

function assertQueryFields(query, allowed) {
  for (const key of Object.keys(query)) {
    if (!allowed.has(key)) throw new Error(`unknown query field: ${key}`);
  }
}

function candidateFilters(query) {
  assertQueryFields(query, new Set(['classification', 'priority', 'country', 'page', 'page_size']));
  const filters = {};
  if (query.classification !== undefined) {
    if (!CLASSIFICATIONS.has(query.classification)) throw new Error('invalid classification');
    filters.classification = query.classification;
  }
  if (query.priority !== undefined) {
    if (!PRIORITIES.has(query.priority)) throw new Error('invalid priority');
    filters.priority = query.priority;
  }
  if (query.country !== undefined) {
    if (!COUNTRIES.has(query.country)) throw new Error('invalid country');
    filters.country = query.country;
  }
  return filters;
}

function maskContact(key, value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  if (key === 'email') {
    const match = text.match(/^([^@])[^@]*(@.+)$/);
    return match ? `${match[1]}***${match[2]}` : '[redacted]';
  }
  if (key === 'phone' || key === 'whatsapp') {
    const digits = text.replace(/\D/g, '');
    return digits ? `***${digits.slice(-4)}` : '[redacted]';
  }
  if (key === 'linkedin_url' || key === 'contact_page_url') return '[available]';
  return '[redacted]';
}

function maskedContacts(value) {
  const contacts = parseObject(value);
  return Object.fromEntries(Object.entries(contacts).map(([key, item]) => [key, maskContact(key, item)]));
}

function safeCandidate(row, evidenceUrls = []) {
  return {
    id: Number(row.id),
    domain: row.normalized_domain,
    display_name: row.display_name || null,
    country: row.country || null,
    status: row.status,
    classification: row.classification,
    priority: row.priority || null,
    reason_codes: publicReasonCodes(row.reason_json),
    confidence: row.classification_confidence,
    contacts: maskedContacts(row.public_contacts_json),
    evidence_urls: [...new Set(evidenceUrls)],
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function evidenceUrlsByEntity(rows) {
  if (!rows.length) return new Map();
  const ids = rows.map(row => Number(row.id));
  const placeholders = ids.map(() => '?').join(', ');
  const evidence = db.prepare(`
    SELECT entity_id, source_url
    FROM matrix_evidence
    WHERE entity_id IN (${placeholders})
    ORDER BY id
  `).all(...ids);
  const grouped = new Map();
  for (const item of evidence) {
    const urls = grouped.get(Number(item.entity_id)) || [];
    urls.push(item.source_url);
    grouped.set(Number(item.entity_id), urls);
  }
  return grouped;
}

function pagedResponse(rows, page, pageSize) {
  const total = rows.length;
  const start = (page - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    page,
    page_size: pageSize,
    total,
    total_pages: total ? Math.ceil(total / pageSize) : 0
  };
}

router.get('/runs', (req, res) => {
  try {
    assertQueryFields(req.query, new Set(['page', 'page_size']));
    const { page, pageSize } = pagination(req.query);
    const rows = db.prepare(`
      SELECT id, campaign_json, status, created_at, updated_at, completed_at
      FROM matrix_runs
      ORDER BY id DESC
    `).all().map(row => {
      const campaign = parseObject(row.campaign_json);
      return {
        id: Number(row.id),
        name: typeof campaign.name === 'string' ? campaign.name : null,
        countries: Array.isArray(campaign.countries)
          ? campaign.countries.filter(country => typeof country === 'string' && COUNTRIES.has(country))
          : [],
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        completed_at: row.completed_at || null
      };
    });
    res.json(pagedResponse(rows, page, pageSize));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/candidates', (req, res) => {
  try {
    const filters = candidateFilters(req.query);
    const { page, pageSize } = pagination(req.query);
    const matches = listCandidates(db, filters);
    const total = matches.length;
    const start = (page - 1) * pageSize;
    const selected = matches.slice(start, start + pageSize);
    const evidence = evidenceUrlsByEntity(selected);
    res.json({
      rows: selected.map(row => safeCandidate(row, evidence.get(Number(row.id)) || [])),
      page,
      page_size: pageSize,
      total,
      total_pages: total ? Math.ceil(total / pageSize) : 0
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/candidates/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'invalid candidate id' });
  const row = listCandidates(db).find(candidate => Number(candidate.id) === id);
  if (!row) return res.status(404).json({ error: 'candidate not found' });

  const evidence = db.prepare(`
    SELECT source_url, retrieved_at, confidence
    FROM matrix_evidence
    WHERE entity_id = ?
    ORDER BY id
  `).all(id);
  audit({
    role: req.user.role,
    userName: req.user.userName,
    action: 'read_matrix_candidate_detail',
    resourceType: 'matrix_candidate',
    resourceId: id
  });
  res.json({
    ...safeCandidate(row, evidence.map(item => item.source_url)),
    evidence
  });
});

module.exports = router;

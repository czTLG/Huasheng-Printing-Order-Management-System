'use strict';

const express = require('express');
const { db, audit } = require('../db');
const { allowRoles } = require('../middleware/auth');
const { listCandidates, countCandidates } = require('../lib/signalCache');
const { APPROVED_COUNTRIES, PUBLIC_REASON_CODES } = require('../lib/schemaRank');

const router = express.Router();
const CRM_ROLES = ['super_admin', 'foreign_trade_crm_admin'];
const CLASSIFICATIONS = new Set(['valid', 'needs_review', 'noise', 'test']);
const PRIORITIES = new Set(['A', 'B', 'C']);
const COUNTRIES = new Set(APPROVED_COUNTRIES);
const PUBLIC_REASON_CODE_SET = new Set(PUBLIC_REASON_CODES);

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
    return Array.isArray(parsed) ? parsed.filter(item => PUBLIC_REASON_CODE_SET.has(item)) : [];
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
  assertQueryFields(query, new Set(['classification', 'priority', 'country', 'run_id', 'page', 'page_size']));
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
  if (query.run_id !== undefined) {
    const runId = Number(query.run_id);
    if (!/^\d+$/.test(String(query.run_id)) || !Number.isSafeInteger(runId) || runId < 1) throw new Error('invalid run_id');
    filters.run_id = runId;
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
    run_id: Number(row.run_id),
    priority: row.priority || null,
    reason_codes: publicReasonCodes(row.reason_json),
    confidence: row.classification_confidence,
    contacts: maskedContacts(row.public_contacts_json),
    evidence_urls: [...new Set(evidenceUrls)],
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function evidenceUrlsByClassification(rows) {
  if (!rows.length) return new Map();
  const ids = rows.map(row => Number(row.classification_id));
  const placeholders = ids.map(() => '?').join(', ');
  const evidence = db.prepare(`
    SELECT ce.classification_id, e.source_url
    FROM matrix_classification_evidence ce
    JOIN matrix_evidence e ON e.id = ce.evidence_id
    WHERE ce.classification_id IN (${placeholders})
    ORDER BY e.id
  `).all(...ids);
  const grouped = new Map();
  for (const item of evidence) {
    const urls = grouped.get(Number(item.classification_id)) || [];
    urls.push(item.source_url);
    grouped.set(Number(item.classification_id), urls);
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
    const total = db.prepare('SELECT COUNT(*) AS count FROM matrix_runs').get().count;
    const rows = db.prepare(`
      SELECT id, campaign_json, status, created_at, updated_at, completed_at
      FROM matrix_runs
      ORDER BY id DESC LIMIT ? OFFSET ?
    `).all(pageSize, (page - 1) * pageSize).map(row => {
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
    res.json({ rows, page, page_size: pageSize, total, total_pages: total ? Math.ceil(total / pageSize) : 0 });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/candidates', (req, res) => {
  try {
    const filters = candidateFilters(req.query);
    const { page, pageSize } = pagination(req.query);
    const total = countCandidates(db, filters);
    const selected = listCandidates(db, { ...filters, limit: pageSize, offset: (page - 1) * pageSize });
    const evidence = evidenceUrlsByClassification(selected);
    res.json({
      rows: selected.map(row => safeCandidate(row, evidence.get(Number(row.classification_id)) || [])),
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
  try { assertQueryFields(req.query, new Set(['run_id'])); } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  let runId;
  if (req.query.run_id !== undefined) {
    runId = Number(req.query.run_id);
    if (!/^\d+$/.test(String(req.query.run_id)) || !Number.isSafeInteger(runId) || runId < 1) {
      return res.status(400).json({ error: 'invalid run_id' });
    }
  }
  const row = listCandidates(db, { id, ...(runId ? { run_id: runId } : {}), limit: 1 })[0];
  if (!row) return res.status(404).json({ error: 'candidate not found' });

  const evidence = db.prepare(`
    SELECT e.source_url, e.retrieved_at, e.confidence
    FROM matrix_classification_evidence ce
    JOIN matrix_evidence e ON e.id = ce.evidence_id
    WHERE ce.classification_id = ?
    ORDER BY e.id
  `).all(row.classification_id);
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

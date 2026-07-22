'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  ensureResearchSchema,
  saveDossier,
  getDossier,
  saveRouteAssessment
} = require('../src/services/matrixResearchLedger');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-research-ledger-'));
const db = new Database(path.join(root, 'ledger.db'));
db.pragma('foreign_keys = ON');

const source = (role, url, title = role) => ({
  role,
  source_url: url,
  source_type: 'official_website',
  page_title: title,
  checked_at: '2026-07-22T10:00:00.000Z',
  excerpt: `${title} evidence`,
  fingerprint: `fp-${role}`
});

try {
  ensureResearchSchema(db);

  const incomplete = saveDossier(db, {
    candidate_id: 18,
    reviewer: 'admin',
    checked_at: '2026-07-22T10:00:00.000Z',
    sources: [
      source('profile', 'https://example.test/about'),
      source('products', 'https://example.test/products')
    ],
    facts: [
      { field: 'operating_model', value: 'OEM', confidence: 'confirmed', source_url: 'https://example.test/about', public_copy: true },
      { field: 'supplier_name', value: 'unknown', confidence: 'unknown', source_url: '', public_copy: false }
    ]
  });
  assert.equal(incomplete.status, 'insufficient');
  assert.ok(incomplete.blockers.includes('official_source_coverage_below_3'));
  assert.ok(incomplete.blockers.includes('process_source_missing'));
  assert.ok(incomplete.blockers.includes('contact_source_missing'));

  const completeInput = {
    candidate_id: 18,
    reviewer: 'admin',
    checked_at: '2026-07-22T11:00:00.000Z',
    sources: [
      source('profile', 'https://example.test/about'),
      source('products', 'https://example.test/products'),
      source('process', 'https://example.test/services'),
      source('contact', 'https://example.test/contact'),
      source('quality', 'https://example.test/quality')
    ],
    facts: [
      { field: 'operating_model', value: 'OEM and private label', confidence: 'confirmed', source_url: 'https://example.test/about', public_copy: true },
      { field: 'buyer_priority', value: 'multi-SKU control', confidence: 'inferred', source_url: 'https://example.test/products', public_copy: false },
      { field: 'current_supplier', value: 'not established', confidence: 'unknown', source_url: '', public_copy: false },
      { field: 'irrelevant_program', value: 'reviewed and excluded', confidence: 'not_relevant', source_url: 'https://example.test/about', public_copy: false }
    ]
  };
  const complete = saveDossier(db, completeInput);
  assert.equal(complete.status, 'complete');
  assert.deepEqual(complete.blockers, []);

  const repeated = saveDossier(db, completeInput);
  assert.equal(repeated.id, complete.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM matrix_research_sources WHERE candidate_id = 18 AND active = 1').get().n, 5);

  const stored = getDossier(db, 18);
  assert.equal(stored.candidate_id, 18);
  assert.equal(stored.sources.length, 5);
  assert.equal(stored.facts.length, 4);
  assert.deepEqual(stored.covered_roles.sort(), ['contact', 'process', 'products', 'profile', 'quality']);

  const route = saveRouteAssessment(db, {
    candidate_id: 18,
    route_set_id: 'th-liquid-care',
    locale: 'th',
    category: 'personal-care-liquid',
    canonical_urls: ['https://gdhspack.com/th/applications/daily-chemical-packaging'],
    source_commit: 'abc1234',
    status: 'verified-local',
    checks: { build: true, mobile: true, desktop: true },
    checked_at: '2026-07-22T12:00:00.000Z',
    verifier: 'admin',
    blocking_reason: ''
  });
  assert.equal(route.status, 'verified-local');
  assert.equal(route.route_set_id, 'th-liquid-care');

  assert.throws(() => saveDossier(db, {
    ...completeInput,
    candidate_id: 75,
    facts: [{ field: 'private_contact', value: 'person@example.test', confidence: 'inferred', source_url: '', public_copy: true }]
  }), /public copy requires confirmed sourced fact/);

  console.log('matrix research ledger tests passed');
} finally {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

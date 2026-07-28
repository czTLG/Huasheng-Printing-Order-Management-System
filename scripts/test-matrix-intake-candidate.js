'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { admitReviewedCandidate } = require('../src/services/matrixIntakeCandidate');

const NOW = '2026-07-28T08:00:00.000Z';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-intake-candidate-'));
const db = new Database(path.join(dir, 'candidate.db'));

function fixture(overrides = {}) {
  const value = {
    candidate_key: 'ae-nutty-nuts-20260728',
    company_name: 'Nutty Nuts Foodstuff Factory LLC',
    country_code: 'AE',
    normalized_domain: 'nutty-nuts.com',
    official_url: 'https://www.nutty-nuts.com/',
    recipient: {
      email: 'sales@nutty-nuts.com',
      source_url: 'https://www.nutty-nuts.com/pages/contact',
      verified_at: '2026-07-27T08:00:00.000Z',
      role: 'public sales'
    },
    categories: ['nuts', 'snacks'],
    formats: ['pouches', 'roll film'],
    size_signals: ['retail packs'],
    scale_tier: 'medium',
    priority: 'P0',
    fit_score: 93,
    confidence: 0.94,
    sources: [
      ['home', '/', 'Official home'],
      ['profile', '/pages/about-us', 'Company profile'],
      ['products', '/collections/all', 'Nut and snack products'],
      ['process', '/pages/quality', 'Manufacturing and quality'],
      ['contact', '/pages/contact', 'Public sales contact']
    ].map(([role, suffix, excerpt]) => ({
      role,
      source_url: `https://www.nutty-nuts.com${suffix}`,
      page_title: role,
      observed_at: '2026-07-27T08:00:00.000Z',
      excerpt
    })),
    discovery: {
      source_adapter: 'matrix_atlas',
      source_url: 'https://www.nutty-nuts.com/',
      source_query: 'UAE nut snack manufacturer',
      collected_at: '2026-07-27T08:00:00.000Z'
    },
    route_readiness: {
      id: 'food_snack_ar:AE',
      status: 'ready',
      commit: '650d7b3',
      verified_at: '2026-07-27T09:00:00.000Z',
      urls: {
        home: 'https://gdhspack.com/ar',
        about: 'https://gdhspack.com/ar/about',
        market: 'https://gdhspack.com/ar/markets/middle-east-food-packaging',
        application: 'https://gdhspack.com/ar/applications/snack-packaging',
        product: 'https://gdhspack.com/ar/products/food-packaging-roll-film'
      }
    }
  };
  return { ...value, ...overrides };
}

try {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE cache_records(
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_name TEXT NOT NULL, country_code TEXT NOT NULL, city TEXT,
      normalized_domain TEXT NOT NULL UNIQUE, official_url TEXT NOT NULL, product_categories_json TEXT NOT NULL,
      format_signals_json TEXT NOT NULL, size_signals_json TEXT NOT NULL, scale_tier TEXT,
      public_email TEXT, public_phone TEXT, public_whatsapp TEXT, contact_url TEXT,
      priority TEXT NOT NULL, fit_score REAL NOT NULL, confidence REAL NOT NULL, status TEXT NOT NULL,
      assessment_cn TEXT, next_action_cn TEXT, stage_code TEXT NOT NULL, first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      demand_fit_score REAL, access_score REAL, contact_role TEXT, audit_state TEXT NOT NULL, audit_note TEXT, audited_at TEXT
    );
    CREATE TABLE cache_evidence(
      id INTEGER PRIMARY KEY AUTOINCREMENT, record_id INTEGER NOT NULL, source_url TEXT NOT NULL, source_type TEXT NOT NULL,
      page_title TEXT, observed_at TEXT NOT NULL, excerpt TEXT, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(record_id, source_url, fingerprint), FOREIGN KEY(record_id) REFERENCES cache_records(id) ON DELETE CASCADE
    );
    CREATE TABLE cache_discovery(
      id INTEGER PRIMARY KEY AUTOINCREMENT, record_id INTEGER NOT NULL, normalized_domain TEXT NOT NULL,
      discovered_via TEXT NOT NULL, discovery_url TEXT NOT NULL, official_url TEXT NOT NULL, source_type TEXT NOT NULL,
      verified_at TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(record_id, fingerprint), FOREIGN KEY(record_id) REFERENCES cache_records(id) ON DELETE CASCADE
    );
  `);

  const admitted = admitReviewedCandidate(db, fixture(), { clock: () => NOW });
  assert.strictEqual(admitted.resolution, 'inserted');
  assert.strictEqual(admitReviewedCandidate(db, fixture(), { clock: () => NOW }).resolution, 'replayed');
  assert.throws(() => admitReviewedCandidate(db, fixture({ company_name: 'Conflicting Name' }), { clock: () => NOW }), /identity conflict/);

  const stale = fixture({ candidate_key: 'stale', sources: fixture().sources.map(row => ({ ...row, observed_at: '2025-01-01T00:00:00.000Z' })) });
  assert.throws(() => admitReviewedCandidate(db, stale, { clock: () => NOW }), /evidence is stale/);
  const missingProcess = fixture({ candidate_key: 'missing', sources: fixture().sources.filter(row => row.role !== 'process') });
  assert.throws(() => admitReviewedCandidate(db, missingProcess, { clock: () => NOW }), /required official source role/);
  const mismatchedEmail = fixture({ candidate_key: 'mismatch', recipient: { ...fixture().recipient, email: 'sales@outside.test' } });
  assert.throws(() => admitReviewedCandidate(db, mismatchedEmail, { clock: () => NOW }), /recipient domain mismatch/);

  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM cache_records').get().count, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM cache_evidence').get().count, 5);
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM cache_discovery').get().count, 1);
  assert.strictEqual(db.prepare("SELECT audit_state FROM cache_records").get().audit_state, 'audited');
} finally {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('matrix intake candidate tests passed');

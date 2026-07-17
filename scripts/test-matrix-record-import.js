'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { parseBatch, applyBatch } = require('./matrix-record-import');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-record-import-'));
const db = new Database(path.join(dir, 'records.db'));
const input = {
  version: 1,
  records: [{
    company_name: 'Sao Mai Agro Processing JSC', country_code: 'VN',
    normalized_domain: 'saomai-agrovietnam.com', official_url: 'https://saomai-agrovietnam.com/',
    categories: ['fruit puree', 'frozen fruit'], formats: [], size_signals: [], scale_tier: 'medium',
    contact_url: 'https://saomai-agrovietnam.com/#contact-us', priority: 'P1', fit_score: 78, confidence: 0.78,
    assessment_cn: '官网展示水果泥、冷冻水果及果汁原料。', next_action_cn: '核实当前包装形式、年用量和采购角色。',
    discovery: {
      discovered_via: 'benchmark_similarity_review', discovery_url: 'https://saomai-agrovietnam.com/',
      source_type: 'official_website', verified_at: '2026-07-17T00:00:00.000Z'
    },
    evidence: {
      source_url: 'https://saomai-agrovietnam.com/', source_type: 'official_website', page_title: 'Sao Mai',
      observed_at: '2026-07-17T00:00:00.000Z', excerpt: 'Official site presents fruit puree, frozen fruit and fruit ingredients.'
    }
  }]
};

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
  const batch = parseBatch(input);
  assert.deepStrictEqual(applyBatch(db, batch, { dryRun: true, now: '2026-07-17T01:00:00.000Z' }), {
    mode: 'dry-run', inserted: ['saomai-agrovietnam.com'], existing: []
  });
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM cache_records').get().count, 0);
  assert.deepStrictEqual(applyBatch(db, batch, { dryRun: false, now: '2026-07-17T01:00:00.000Z' }), {
    mode: 'apply', inserted: ['saomai-agrovietnam.com'], existing: []
  });
  const record = db.prepare('SELECT * FROM cache_records').get();
  assert.strictEqual(record.status, 'needs_review');
  assert.strictEqual(record.audit_state, 'unreviewed');
  assert.strictEqual(record.audited_at, null);
  assert.deepStrictEqual(JSON.parse(record.product_categories_json), input.records[0].categories);
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM cache_evidence').get().count, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM cache_discovery').get().count, 1);
  assert.deepStrictEqual(applyBatch(db, batch, { dryRun: false, now: '2026-07-17T02:00:00.000Z' }), {
    mode: 'apply', inserted: [], existing: ['saomai-agrovietnam.com']
  });
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM cache_records').get().count, 1);

  assert.throws(() => parseBatch({ ...input, unknown: true }), /unknown field/i);
  assert.throws(() => parseBatch({ version: 1, records: [{ ...input.records[0], status: 'valid' }] }), /unknown field/i);
  assert.throws(() => parseBatch({ version: 1, records: [{ ...input.records[0], country_code: 'US' }] }), /nearby country/i);
  assert.throws(() => parseBatch({ version: 1, records: [{ ...input.records[0], contact_url: 'http://localhost/contact' }] }), /public HTTPS/i);
  assert.throws(() => parseBatch({ version: 1, records: [input.records[0], input.records[0]] }), /duplicate domain/i);
} finally {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('matrix record import tests passed');

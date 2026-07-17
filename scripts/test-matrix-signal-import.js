'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { parseBatch, ensureSchema, applyBatch, fingerprint } = require('./matrix-signal-import');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-signal-import-'));
const dbPath = path.join(dir, 'matrix.db');
const db = new Database(dbPath);

const validInput = {
  version: 1,
  records: [{
    normalized_domain: 'vietnamthd.vn',
    relationship: {
      supplier_name: 'Guangdong Shunshun Packaging Co., Ltd.',
      supplier_country_code: 'CN',
      supplied_category: 'fruit jelly laminated film',
      confidence: 'confirmed',
      source_url: 'https://www.trademo.com/companies/thd-agricultural-processing-joint-stock-company/33328049',
      source_type: 'public_trade_record',
      observed_at: '2026-07-17T00:00:00.000Z',
      excerpt: 'Public record names buyer, supplier and MOPP/kraft/PE laminated film.'
    },
    strategy: {
      entry_product: 'fruit jelly laminated roll film',
      differentiation_angle: 'stable nearby supply and structure review',
      first_contact_goal: 'confirm current structure and annual consumption',
      questions: ['Current laminate structure?', 'Annual roll-film consumption?'],
      risks: ['Public relationship may not represent current exclusive supply'],
      source_url: 'https://www.trademo.com/companies/thd-agricultural-processing-joint-stock-company/33328049',
      observed_at: '2026-07-17T00:00:00.000Z'
    }
  }, {
    normalized_domain: 'missing.example.com',
    strategy: {
      entry_product: 'fruit puree pouch',
      differentiation_angle: 'structure review',
      first_contact_goal: 'confirm format demand',
      questions: ['Current format?'],
      risks: ['Supplier unknown'],
      source_url: 'https://missing.example.com/products',
      observed_at: '2026-07-17T00:00:00.000Z'
    }
  }]
};

try {
  db.exec('CREATE TABLE cache_records (id INTEGER PRIMARY KEY, normalized_domain TEXT NOT NULL UNIQUE)');
  db.prepare('INSERT INTO cache_records VALUES (?, ?)').run(1, 'vietnamthd.vn');

  const batch = parseBatch(validInput);
  assert.strictEqual(batch.records.length, 2);
  assert.match(fingerprint('relationship', batch.records[0].normalized_domain, batch.records[0].relationship), /^[a-f0-9]{64}$/);

  const dryRun = applyBatch(db, batch, { dryRun: true });
  assert.deepStrictEqual(dryRun, {
    mode: 'dry-run', matched: ['vietnamthd.vn'], unmatched: ['missing.example.com'],
    relationships: 1, strategies: 1
  });
  assert.strictEqual(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cache_relationships'").get(), undefined);

  const applied = applyBatch(db, batch, { dryRun: false });
  assert.deepStrictEqual(applied, {
    mode: 'apply', matched: ['vietnamthd.vn'], unmatched: ['missing.example.com'],
    relationships: 1, strategies: 1
  });
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM cache_relationships').get().count, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM cache_strategy_signals').get().count, 1);

  applyBatch(db, batch, { dryRun: false });
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM cache_relationships').get().count, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM cache_strategy_signals').get().count, 1);
  assert.strictEqual(db.prepare('SELECT confidence FROM cache_relationships').get().confidence, 'confirmed');
  assert.deepStrictEqual(JSON.parse(db.prepare('SELECT questions_json FROM cache_strategy_signals').get().questions_json), validInput.records[0].strategy.questions);

  ensureSchema(db);
  assert.throws(() => parseBatch({ ...validInput, unexpected: true }), /unknown field/i);
  assert.throws(() => parseBatch({ version: 2, records: [] }), /version/i);
  assert.throws(() => parseBatch({ version: 1, records: [{ ...validInput.records[0], unexpected: true }] }), /unknown field/i);
  assert.throws(() => parseBatch({ version: 1, records: [{
    ...validInput.records[0], relationship: { ...validInput.records[0].relationship, confidence: 'guessed' }
  }] }), /confidence/i);
  assert.throws(() => parseBatch({ version: 1, records: [{
    ...validInput.records[0], relationship: { ...validInput.records[0].relationship, source_url: 'http://localhost/private' }
  }] }), /public HTTPS/i);
  assert.throws(() => parseBatch({ version: 1, records: [{
    ...validInput.records[0], strategy: { ...validInput.records[0].strategy, questions: Array(11).fill('question') }
  }] }), /at most 10/i);
  assert.throws(() => parseBatch({ version: 1, records: [{
    ...validInput.records[0], strategy: { ...validInput.records[0].strategy, observed_at: 'not-a-date' }
  }] }), /ISO timestamp/i);
} finally {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('matrix signal import tests passed');

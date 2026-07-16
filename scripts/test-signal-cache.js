'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-cache-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');

const { db, initDb } = require('../src/db');
const {
  createRun,
  upsertEntity,
  appendEvidence,
  saveClassification,
  listCandidates
} = require('../src/lib/signalCache');
const { RULESET_VERSION } = require('../src/lib/schemaRank');

try {
  initDb();

  const run = createRun(db, { name: 'phase-one', countries: ['Vietnam'] });
  assert.ok(run.id);
  assert.equal(run.ruleset_version, RULESET_VERSION);

  const first = upsertEntity(db, {
    official_domain: 'brand.example',
    display_name: 'Brand',
    country: 'Vietnam',
    public_contacts: {
      email: 'hello@brand.example',
      raw_html: '<html>source page</html>'
    }
  });
  const second = upsertEntity(db, {
    official_domain: 'https://www.brand.example/',
    display_name: 'Brand Co',
    country: 'Vietnam'
  });
  assert.equal(first.id, second.id);
  assert.equal(second.normalized_domain, 'brand.example');
  assert.deepEqual(JSON.parse(second.public_contacts_json), { email: 'hello@brand.example' });
  const third = upsertEntity(db, {
    official_domain: 'https://user:pass@www.brand.example:443/path?q=1#about'
  });
  assert.equal(first.id, third.id);

  const evidence = {
    field: 'product',
    value: 'coffee',
    source_url: 'https://brand.example/products',
    retrieved_at: '2026-07-16T00:00:00Z',
    confidence: 'high'
  };
  const storedEvidence = appendEvidence(db, first.id, evidence);
  const duplicateEvidence = appendEvidence(db, first.id, evidence);
  assert.equal(storedEvidence.id, duplicateEvidence.id);
  assert.throws(
    () => appendEvidence(db, first.id, { ...evidence, source_url: '   ' }),
    /source URL/i
  );
  assert.throws(
    () => appendEvidence(db, first.id, { ...evidence, retrieved_at: '' }),
    /retrieval time/i
  );

  const classification = saveClassification(db, first.id, {
    classification: 'valid',
    priority: 'A',
    reason_codes: ['official_domain']
  }, run.id);
  assert.ok(classification.id);
  assert.equal(listCandidates(db, { classification: 'valid' }).length, 1);
  assert.equal(listCandidates(db, { classification: 'noise' }).length, 0);
  assert.equal(db.prepare('select count(*) n from customers').get().n, 0);

  console.log('signal-cache tests passed');
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

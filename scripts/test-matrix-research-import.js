'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { ensureResearchSchema, getDossier } = require('../src/services/matrixResearchLedger');
const { importDossierDocument, verifyCohort } = require('./matrix-research-import');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-research-import-'));
const db = new Database(path.join(root, 'app.db'));

const validDocument = candidateId => ({
  candidate_id: candidateId,
  checked_at: '2026-07-22T10:00:00.000Z',
  reviewer: 'admin',
  sources: [
    { role: 'profile', source_url: 'https://alpha.test/about', source_type: 'official_website', page_title: 'About', checked_at: '2026-07-22T10:00:00.000Z', excerpt: 'Factory profile' },
    { role: 'products', source_url: 'https://alpha.test/products', source_type: 'official_website', page_title: 'Products', checked_at: '2026-07-22T10:00:00.000Z', excerpt: 'Product portfolio' },
    { role: 'process', source_url: 'https://alpha.test/services', source_type: 'official_website', page_title: 'Services', checked_at: '2026-07-22T10:00:00.000Z', excerpt: 'OEM development process' },
    { role: 'contact', source_url: 'https://alpha.test/contact', source_type: 'official_website', page_title: 'Contact', checked_at: '2026-07-22T10:00:00.000Z', excerpt: 'Official team contact' }
  ],
  facts: [
    { field: 'operating_model', value: 'OEM manufacturer', confidence: 'confirmed', source_url: 'https://alpha.test/about', public_copy: true }
  ],
  content_gaps: [
    { concern: 'multi-SKU review', outcome: 'public_gap', note: 'Add reusable artwork control guidance' }
  ],
  unanswered_questions: ['Which representative SKU should be reviewed first?']
});

try {
  ensureResearchSchema(db);
  const result = importDossierDocument(db, validDocument(18), { candidateCompanyName: 'Alpha Industries' });
  assert.equal(result.status, 'complete');
  assert.equal(getDossier(db, 18).content_gaps[0].outcome, 'public_gap');
  assert.equal(getDossier(db, 18).unanswered_questions.length, 1);

  assert.throws(() => importDossierDocument(db, { ...validDocument(75), extra: true }, { candidateCompanyName: 'Beta Foods' }), /unknown dossier field/);
  assert.equal(getDossier(db, 75), null, 'unknown fields must not partially write');

  const badUrl = validDocument(121);
  badUrl.sources[2].source_url = 'http://alpha.test/services';
  assert.throws(() => importDossierDocument(db, badUrl, { candidateCompanyName: 'Gamma Foods' }), /HTTPS URL/);
  assert.equal(getDossier(db, 121), null, 'invalid source must not partially write');

  const leakedName = validDocument(116);
  leakedName.facts[0].value = 'Orda Trade Astana needs tea film';
  assert.throws(() => importDossierDocument(db, leakedName, { candidateCompanyName: 'Orda Trade Astana' }), /prospect name is not allowed in public copy/);
  assert.equal(getDossier(db, 116), null, 'prospect leakage must not partially write');

  const cohort = verifyCohort(db, [18, 63]);
  assert.deepEqual(cohort.map(row => [row.candidate_id, row.status]), [[18, 'complete'], [63, 'missing']]);

  console.log('matrix research import tests passed');
} finally {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-cache-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.MATRIX_SUPPRESS_BOOTSTRAP_SECRET = '1';

const { db, initDb } = require('../src/db');
const {
  createRun,
  upsertEntity,
  appendEvidence,
  saveClassification,
  listCandidates,
  deleteRun
} = require('../src/lib/signalCache');
const { RULESET_VERSION, APPROVED_COUNTRIES, REASON_CODES } = require('../src/lib/schemaRank');

const campaign = (overrides = {}) => ({
  name: 'phase-one',
  countries: ['Vietnam'],
  categories: ['dry_food'],
  languages: ['en'],
  max_companies_per_country: 20,
  max_pages_per_company: 4,
  max_probes: 80,
  run_deadline_ms: 60000,
  allowed_source_types: ['official_website'],
  official_hosts: ['brand.example'],
  third_party_sources: [],
  exclusion_terms: ['India'],
  existing_domain_suppression: true,
  actor: 'test-operator',
  ...overrides
});

try {
  initDb();

  const acceptedUnsafeInputs = [];
  const rollbackProbe = Symbol('rollback probe');
  function expectRejected(label, operation) {
    let rejected = false;
    try {
      db.transaction(() => {
        try {
          operation();
        } catch {
          rejected = true;
        }
        throw rollbackProbe;
      })();
    } catch (error) {
      if (error !== rollbackProbe) throw error;
    }
    if (!rejected) acceptedUnsafeInputs.push(label);
  }

  expectRejected('nested campaign content', () => createRun(db, {
    name: 'unsafe-run',
    counters: { discovered: 1, payload: { body: '<html>full page</html>' } }
  }));
  expectRejected('campaign alias field', () => createRun(db, {
    name: 'unsafe-run',
    page_content: 'complete page body'
  }));

  assert.throws(() => createRun(db, { name: 'incomplete' }), /campaign.*required/i);
  assert.throws(() => createRun(db, campaign({ countries: ['India'] })), /approved countries/i);
  assert.throws(() => createRun(db, campaign({ countries: ['Canada'] })), /approved countries/i);
  assert.throws(() => createRun(db, campaign({ countries: [] })), /approved countries/i);
  assert.throws(() => createRun(db, campaign({ countries: ['viet nam'] })), /approved countries/i);
  assert.throws(() => createRun(db, campaign({ actor: '' })), /actor.*required/i);
  assert.throws(() => createRun(db, campaign({ third_party_sources: [{ host: 'directory.example', source_type: 'public_directory', terms_url: 'x', approved_at: '2026-07-16' }] })), /third party/i);
  assert.throws(() => createRun(db, campaign({ third_party_sources: [{ host: 'bad host', source_type: 'public_directory', terms_url: 'https://bad.example/terms', approved_at: '2026-07-16T00:00:00Z' }] })), /third party/i);
  const run = createRun(db, campaign());
  assert.ok(run.id);
  assert.equal(run.ruleset_version, RULESET_VERSION);

  const first = upsertEntity(db, {
    official_domain: 'brand.example',
    display_name: 'Brand',
    country: 'Vietnam',
    public_contacts: { email: 'hello@brand.example' }
  });
  expectRejected('nested contact content', () => upsertEntity(db, {
    official_domain: 'nested.example',
    public_contacts: { profile: { raw_html: '<html>source page</html>' } }
  }));
  expectRejected('contact body alias', () => upsertEntity(db, {
    official_domain: 'body.example',
    public_contacts: { body: 'complete page body' }
  }));
  expectRejected('executable contact value', () => upsertEntity(db, {
    official_domain: 'script.example',
    public_contacts: { contact_page_url: 'javascript:alert(1)' }
  }));
  expectRejected('unknown entity field', () => upsertEntity(db, {
    official_domain: 'markup.example',
    markup: '<main>source</main>'
  }));
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
  const trailingDots = upsertEntity(db, {
    official_domain: 'https://www.brand.example.../'
  });
  assert.equal(first.id, trailingDots.id);
  assert.equal(trailingDots.normalized_domain, 'brand.example');

  const evidence = {
    source_type: 'official_website',
    field: 'product',
    value: 'coffee',
    source_url: 'https://brand.example/products',
    retrieved_at: '2026-07-16T00:00:00Z',
    confidence: 0.9
  };
  const storedEvidence = appendEvidence(db, first.id, evidence, run.id);
  const duplicateEvidence = appendEvidence(db, first.id, evidence, run.id);
  assert.equal(storedEvidence.id, duplicateEvidence.id);
  expectRejected('evidence HTML value', () => appendEvidence(db, first.id, {
    ...evidence,
    value: '<article>complete page</article>'
  }, run.id));
  expectRejected('evidence executable title', () => appendEvidence(db, first.id, {
    ...evidence,
    page_title: '<script>alert(1)</script>'
  }, run.id));
  expectRejected('evidence full page body', () => appendEvidence(db, first.id, {
    ...evidence,
    value: 'x'.repeat(5000)
  }, run.id));
  expectRejected('unknown evidence alias', () => appendEvidence(db, first.id, {
    ...evidence,
    page_content: 'complete page body'
  }, run.id));
  expectRejected('evidence fingerprint alias', () => appendEvidence(db, first.id, {
    ...evidence,
    content_fingerprint: 'complete page body'
  }, run.id));
  assert.throws(
    () => appendEvidence(db, first.id, { ...evidence, source_url: '   ' }, run.id),
    /source URL/i
  );
  assert.throws(
    () => appendEvidence(db, first.id, { ...evidence, retrieved_at: '' }, run.id),
    /retrieval time/i
  );

  assert.throws(() => appendEvidence(db, first.id, { ...evidence, field: 'anything' }, run.id), /evidence field/i);
  assert.throws(() => appendEvidence(db, first.id, { ...evidence, confidence: 1.1 }, run.id), /confidence/i);
  assert.throws(() => appendEvidence(db, first.id, { ...evidence, retrieved_at: 'yesterday' }, run.id), /retrieval time/i);
  assert.throws(() => appendEvidence(db, first.id, { ...evidence, source_url: 'https://brand.example/?token=secret' }, run.id), /sensitive query/i);

  const classification = saveClassification(db, first.id, {
    classification: 'valid',
    priority: 'B',
    reason_codes: [REASON_CODES.OFFICIAL_DOMAIN, REASON_CODES.PRODUCT_EVIDENCE],
    confidence: 0.85,
    evidence_ids: [storedEvidence.id]
  }, run.id);
  assert.ok(classification.id);
  assert.equal(classification.snapshot_id > 0, true);
  assert.deepEqual(db.prepare('SELECT evidence_id FROM matrix_classification_evidence WHERE classification_id = ?').all(classification.id).map(row => row.evidence_id), [storedEvidence.id]);
  assert.throws(() => saveClassification(db, first.id, { classification: 'noise', priority: 'C', reason_codes: [REASON_CODES.SECURITY_NOTICE], confidence: 1, evidence_ids: [storedEvidence.id] }, run.id), /priority/i);
  assert.throws(() => saveClassification(db, first.id, { classification: 'valid', priority: 'A', reason_codes: ['invented'], confidence: 1, evidence_ids: [storedEvidence.id] }, run.id), /reason code/i);
  assert.throws(() => saveClassification(db, first.id, { classification: 'valid', priority: 'A', reason_codes: [REASON_CODES.OFFICIAL_DOMAIN], confidence: -0.1, evidence_ids: [storedEvidence.id] }, run.id), /confidence/i);
  expectRejected('classification executable reason', () => saveClassification(db, first.id, {
    classification: 'valid',
    reason_codes: ['javascript:alert(1)']
  }, run.id));
  expectRejected('unknown classification alias', () => saveClassification(db, first.id, {
    classification: 'valid',
    raw_content: '<html>complete page</html>'
  }, run.id));
  expectRejected('unknown candidate filter', () => listCandidates(db, {
    classification: 'valid',
    body: 'complete page body'
  }));
  assert.equal(listCandidates(db, { classification: 'valid' }).length, 1);
  assert.equal(listCandidates(db, { classification: 'noise' }).length, 0);

  const firstRunBefore = listCandidates(db, { run_id: run.id });
  const laterRun = createRun(db, campaign({ name: 'phase-two', official_hosts: ['brand.example'] }));
  upsertEntity(db, { official_domain: 'brand.example', display_name: 'Changed Later', country: 'Thailand' });
  const laterEvidence = appendEvidence(db, first.id, { ...evidence, value: 'tea', source_url: 'https://brand.example/tea' }, laterRun.id);
  saveClassification(db, first.id, {
    classification: 'noise',
    priority: null,
    reason_codes: [REASON_CODES.SECURITY_NOTICE],
    confidence: 1,
    evidence_ids: [laterEvidence.id]
  }, laterRun.id);
  const firstRunCandidates = listCandidates(db, { run_id: run.id });
  assert.equal(firstRunCandidates.length, 1);
  assert.equal(firstRunCandidates[0].classification, 'valid');
  assert.equal(firstRunCandidates[0].priority, 'B');
  assert.equal(firstRunCandidates[0].display_name, firstRunBefore[0].display_name);
  assert.equal(firstRunCandidates[0].country, firstRunBefore[0].country);
  const laterRunCandidates = listCandidates(db, { run_id: laterRun.id, safe_only: false });
  assert.equal(laterRunCandidates.length, 1);
  assert.equal(laterRunCandidates[0].classification, 'noise');
  assert.equal(laterRunCandidates[0].display_name, 'Changed Later');
  const overrideEntity = upsertEntity(db, { official_domain: 'override.example', display_name: 'Override', country: 'Vietnam' });
  const overrideEvidence = appendEvidence(db, overrideEntity.id, { ...evidence, source_url: 'https://override.example/products' }, run.id);
  saveClassification(db, overrideEntity.id, {
    classification: 'valid', priority: 'B', reason_codes: [REASON_CODES.PRODUCT_EVIDENCE],
    confidence: 0.8, evidence_ids: [overrideEvidence.id],
    human_override_classification: 'noise', human_override_priority: null,
    human_override_reason: 'confirmed non-customer', human_override_actor: 'reviewer',
    human_override_at: '2026-07-16T02:00:00Z'
  }, run.id);
  assert.equal(listCandidates(db, { id: overrideEntity.id }).length, 0);
  const effectiveOverride = listCandidates(db, { id: overrideEntity.id, safe_only: false })[0];
  assert.equal(effectiveOverride.classification, 'noise');
  assert.equal(effectiveOverride.priority, null);
  deleteRun(db, laterRun.id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM matrix_evidence WHERE run_id = ?').get(laterRun.id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM matrix_entity_snapshots WHERE run_id = ?').get(laterRun.id).n, 0);
  assert.equal(listCandidates(db, { run_id: run.id })[0].display_name, firstRunBefore[0].display_name);
  const restoredEntity = db.prepare('SELECT display_name, country FROM matrix_entities WHERE id = ?').get(first.id);
  assert.deepEqual(restoredEntity, { display_name: firstRunBefore[0].display_name, country: firstRunBefore[0].country });
  assert.deepEqual(acceptedUnsafeInputs, []);
  assert.equal(db.prepare('select count(*) n from customers').get().n, 0);

  console.log('signal-cache tests passed');
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

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

  const run = createRun(db, { name: 'phase-one', countries: ['Vietnam'] });
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
    field: 'product',
    value: 'coffee',
    source_url: 'https://brand.example/products',
    retrieved_at: '2026-07-16T00:00:00Z',
    confidence: 'high'
  };
  const storedEvidence = appendEvidence(db, first.id, evidence);
  const duplicateEvidence = appendEvidence(db, first.id, evidence);
  assert.equal(storedEvidence.id, duplicateEvidence.id);
  expectRejected('evidence HTML value', () => appendEvidence(db, first.id, {
    ...evidence,
    value: '<article>complete page</article>'
  }));
  expectRejected('evidence executable title', () => appendEvidence(db, first.id, {
    ...evidence,
    page_title: '<script>alert(1)</script>'
  }));
  expectRejected('evidence full page body', () => appendEvidence(db, first.id, {
    ...evidence,
    value: 'x'.repeat(5000)
  }));
  expectRejected('unknown evidence alias', () => appendEvidence(db, first.id, {
    ...evidence,
    page_content: 'complete page body'
  }));
  expectRejected('evidence fingerprint alias', () => appendEvidence(db, first.id, {
    ...evidence,
    content_fingerprint: 'complete page body'
  }));
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

  const laterRun = createRun(db, { name: 'phase-two', countries: ['Vietnam'] });
  saveClassification(db, first.id, {
    classification: 'valid',
    priority: 'B',
    reason_codes: ['reviewed_again']
  }, run.id);
  saveClassification(db, first.id, {
    classification: 'noise',
    priority: 'C',
    reason_codes: ['later_run']
  }, laterRun.id);
  const firstRunCandidates = listCandidates(db, { run_id: run.id });
  assert.equal(firstRunCandidates.length, 1);
  assert.equal(firstRunCandidates[0].classification, 'valid');
  assert.equal(firstRunCandidates[0].priority, 'B');
  const laterRunCandidates = listCandidates(db, { run_id: laterRun.id });
  assert.equal(laterRunCandidates.length, 1);
  assert.equal(laterRunCandidates[0].classification, 'noise');
  assert.deepEqual(acceptedUnsafeInputs, []);
  assert.equal(db.prepare('select count(*) n from customers').get().n, 0);

  console.log('signal-cache tests passed');
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

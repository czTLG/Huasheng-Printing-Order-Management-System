'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-ledger-migration-'));
process.env.DB_PATH = path.join(root, 'app.db');
const { db, initDb } = require('../src/db');
const { createMatrixLedgerStore } = require('../src/services/matrixLedgerStore');
const { createMatrixLedgerMigration } = require('../src/services/matrixLedgerMigration');

const NOW = '2026-07-23T00:00:00.000Z';

function insertCustomer(name) {
  return Number(db.prepare(`
    INSERT INTO customers (name, active, created_at, updated_at) VALUES (?, 1, ?, ?)
  `).run(name, NOW, NOW).lastInsertRowid);
}

function insertContact(customerId, address) {
  db.prepare(`
    INSERT INTO matrix_contacts (
      canonical_customer_id, channel, address, role, source_url, verified_at, status,
      revoked_reason, created_at, updated_at
    ) VALUES (?, 'email', ?, 'director', 'https://official.example/contact', ?, 'active', '', ?, ?)
  `).run(customerId, address, NOW, NOW, NOW);
}

function insertLink(customerId, sourceKind, sourceId, domain = '') {
  db.prepare(`
    INSERT INTO matrix_customer_links (
      canonical_customer_id, source_kind, source_id, normalized_domain, confidence, created_at
    ) VALUES (?, ?, ?, ?, 'reviewed', ?)
  `).run(customerId, sourceKind, sourceId, domain, NOW);
}

function record(sourceKind, sourceId, evidence = {}, extra = {}) {
  return {
    sourceKind,
    sourceId,
    occurredAt: NOW,
    companyName: `Imported ${sourceId}`,
    provenance: { sourcePath: `/protected/${sourceKind}/${sourceId}.json`, bodyHash: `hash-${sourceId}` },
    evidence,
    ...extra
  };
}

try {
  const originalLog = console.log;
  console.log = () => {};
  initDb();
  console.log = originalLog;
  const store = createMatrixLedgerStore({ db, clock: () => new Date(NOW) });
  const existing = {
    explicit: insertCustomer('Explicit Mapping Ltd'),
    email: insertCustomer('Exact Email Ltd'),
    domain: insertCustomer('Verified Domain Ltd'),
    body: insertCustomer('Exact Draft Ltd'),
    chain: insertCustomer('Reference Chain Ltd')
  };
  insertLink(existing.explicit, 'legacy_registry', 'registry-1');
  insertContact(existing.email, 'official@exact-email.example');
  insertLink(existing.domain, 'protected_mapping', 'verified-domain', 'verified-domain.example');
  insertLink(existing.body, 'protected_mapping', 'draft:Hello:hash-draft-match', '');
  insertLink(existing.chain, 'protected_mapping', 'message-chain', '');

  const fixtures = {
    records: [
      record('legacy_registry', 'registry-1', { explicitSourceId: { kind: 'legacy_registry', id: 'registry-1' } }),
      record('candidate', 'email-1', { officialEmail: 'official@exact-email.example' }),
      record('candidate', 'domain-1', { verifiedDomain: 'verified-domain.example', companyName: 'Verified Domain Ltd' }),
      record('draft', 'draft-1', { exactSubjectAndBodyHash: { subject: 'Hello', bodyHash: 'hash-draft-match' } }, {
        privateEvidence: { subject: 'Hello', body: 'Private matching draft body' }
      }),
      record('email_message', 'message-1', { messageReferenceChain: ['<message-1@exact.test>'], protectedMappingId: 'message-chain' }, {
        privateEvidence: { messageId: '<message-1@exact.test>', body: 'Private reply body' }
      }),
      ...Array.from({ length: 8 }, (_, index) => record(['sent_message', 'reply', 'bounce'][index] || 'candidate', `import-${index + 1}`, {
        candidateId: String(200 + index),
        companyName: `Imported ${index + 1}`
      })),
      record('candidate', 'shared-mailbox', { publicMailbox: 'sales@shared.example' }),
      record('candidate', 'phone-suffix', { telephoneSuffix: '1234' }),
      record('candidate', 'product-spec', { productSpecification: 'stand-up pouch 100x200mm' }),
      record('candidate', 'ambiguous', {
        explicitSourceId: { kind: 'legacy_registry', id: 'registry-1' },
        officialEmail: 'official@exact-email.example'
      })
    ]
  };

  const migration = createMatrixLedgerMigration({ db, candidateDb: db, store, clock: () => new Date(NOW) });
  const first = migration.apply(migration.scan(fixtures), {
    actorUserId: 1,
    idempotencyKey: 'migration-fixture-1'
  });
  assert.deepStrictEqual(first.counts, {
    imported: 8,
    matched: 5,
    unresolved: 3,
    skipped: 0,
    conflicts: 1
  });
  assert.strictEqual(first.fingerprints.length, 17);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM matrix_unresolved_records WHERE state = ?').get('pending').count, 4);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM matrix_migration_records WHERE resolution = ?').get('unresolved').count, 3);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM matrix_migration_records WHERE resolution = ?').get('conflict').count, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM matrix_contacts WHERE address = ?').get('sales@shared.example').count, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM customers WHERE name LIKE ?').get('Imported %').count, 8);
  const storedProvenance = JSON.stringify(db.prepare('SELECT provenance_json FROM matrix_migration_records ORDER BY id').all());
  assert.strictEqual(storedProvenance.includes('/protected/'), true);
  assert.strictEqual(storedProvenance.includes('Hello'), false);
  assert.strictEqual(storedProvenance.includes('Private matching draft body'), false);

  const second = migration.apply(migration.scan(fixtures), {
    actorUserId: 1,
    idempotencyKey: 'migration-fixture-2'
  });
  assert.strictEqual(second.counts.imported, 0);
  assert.strictEqual(second.counts.unresolved, 0);
  assert.strictEqual(second.counts.skipped, 17);

  const beforeDryRun = db.prepare('SELECT COUNT(*) AS count FROM matrix_migration_records').get().count;
  const dryRun = migration.scan(fixtures);
  assert.strictEqual(dryRun.counts.imported, 0, 'already-seen records scan as skipped');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM matrix_migration_records').get().count, beforeDryRun, 'scan writes no operational rows');
  console.log('matrix ledger migration tests passed');
} finally {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

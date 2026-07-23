'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-ledger-migration-'));
process.env.DB_PATH = path.join(root, 'app.db');
const { db, initDb } = require('../src/db');
const { createMatrixLedgerStore } = require('../src/services/matrixLedgerStore');
const { createMatrixLedgerMigration } = require('../src/services/matrixLedgerMigration');
const { run: runMigrationCli, protectedReportPath } = require('./run-matrix-ledger-migration');

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

function databaseSnapshot(databasePath) {
  return {
    bytes: crypto.createHash('sha256').update(fs.readFileSync(databasePath)).digest('hex'),
    mtimeMs: fs.statSync(databasePath).mtimeMs,
    schema: db.prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'trigger') ORDER BY type, name").all(),
    users: db.prepare('SELECT id, username, role, status, created_at, approved_at FROM users ORDER BY id').all(),
    migrationRows: db.prepare('SELECT * FROM matrix_migration_records ORDER BY id').all()
  };
}

async function main() {
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
  insertLink(existing.chain, 'protected_mapping', 'message:<message-1@exact.test>', '');

  const fixtures = {
    records: [
      record('legacy_registry', 'registry-1', { explicitSourceId: { kind: 'legacy_registry', id: 'registry-1' } }),
      record('candidate', 'email-1', { officialEmail: 'official@exact-email.example' }),
      record('candidate', 'domain-1', { verifiedDomain: 'verified-domain.example', companyName: 'Verified Domain Ltd' }),
      record('draft', 'draft-1', { exactSubjectAndBodyHash: { subject: 'Hello', bodyHash: 'hash-draft-match' } }, {
        privateEvidence: { subject: 'Hello', body: 'Private matching draft body' }
      }),
      record('email_message', 'message-1', { messageReferenceChain: ['<message-1@exact.test>'] }, {
        privateEvidence: { messageId: '<message-1@exact.test>', body: 'Private reply body' }
      }),
      ...Array.from({ length: 8 }, (_, index) => record('candidate', `import-${index + 1}`, {
        candidateId: String(200 + index),
        companyName: `Imported ${index + 1}`
      })),
      record('bounce', 'shared-mailbox', { candidateId: '301', companyName: 'Bounced Record', publicMailbox: 'sales@shared.example' }, { deliveryState: 'bounced' }),
      record('reply', 'phone-suffix', { candidateId: '302', companyName: 'Suppressed Record', telephoneSuffix: '1234' }, { suppressed: true }),
      record('sent_message', 'product-spec', { candidateId: '303', companyName: 'Stale Record', productSpecification: 'stand-up pouch 100x200mm', semanticSimilarity: 0.99 }, { stale: true }),
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
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM customers WHERE name IN ('Bounced Record', 'Suppressed Record', 'Stale Record')").get().count, 0);
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

  const unresolvedChain = migration.scan({ records: [record('email_message', 'unmapped-chain', { messageReferenceChain: ['<unmapped@test>'] })] });
  assert.strictEqual(unresolvedChain.counts.unresolved, 1, 'an unmapped message reference chain cannot match');
  const sourceKindOnlyHistory = migration.scan({ records: [
    record('bounce', 'kind-only-bounce', { candidateId: '701', companyName: 'Source Kind Bounce' }),
    record('suppression', 'kind-only-suppression', { candidateId: '702', companyName: 'Source Kind Suppression' }),
    record('stale', 'kind-only-stale', { candidateId: '703', companyName: 'Source Kind Stale' })
  ] });
  assert.deepStrictEqual(sourceKindOnlyHistory.counts, { imported: 0, matched: 0, unresolved: 3, skipped: 0, conflicts: 0 }, 'source kinds alone fail closed for historical ineligible records');

  const duplicatePlan = migration.scan({ records: [
    record('candidate', 'duplicate-source', { candidateId: '401', companyName: 'Duplicate One' }),
    record('candidate', 'duplicate-source', { candidateId: '402', companyName: 'Duplicate Two' })
  ] });
  assert.strictEqual(duplicatePlan.counts.conflicts, 2, 'duplicate source identities fail closed during scan');
  const runsBeforeDuplicate = db.prepare('SELECT COUNT(*) AS count FROM matrix_migration_runs').get().count;
  assert.throws(() => migration.apply(duplicatePlan, { actorUserId: 1, idempotencyKey: 'duplicate-plan' }), /duplicate source identity/);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM matrix_migration_runs').get().count, runsBeforeDuplicate, 'duplicate plans leave no idempotency run');

  const atomicPlan = migration.scan({ records: [
    record('candidate', 'atomic-ok', { candidateId: '501', companyName: 'Atomic Customer' }),
    record('candidate', 'atomic-fail', { candidateId: '502', companyName: 'Will Be Cleared' })
  ] });
  atomicPlan.entries[1].record.companyName = '';
  atomicPlan.entries[1].record.evidence.companyName = '';
  assert.throws(() => migration.apply(atomicPlan, { actorUserId: 1, idempotencyKey: 'atomic-rollback' }), /company name required/);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM customers WHERE name = 'Atomic Customer'").get().count, 0, 'failed apply rolls back canonical writes');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM matrix_migration_runs WHERE idempotency_key = ?').get('atomic-rollback').count, 0, 'failed apply leaves no placeholder idempotency result');

  const protectedRuntime = path.join(root, 'protected-runtime');
  fs.mkdirSync(protectedRuntime, { mode: 0o700 });
  fs.chmodSync(protectedRuntime, 0o700);
  db.exec('CREATE TABLE candidate_import_rows (record_json TEXT NOT NULL)');
  db.prepare('INSERT INTO candidate_import_rows (record_json) VALUES (?)').run(JSON.stringify(record('candidate', 'cli-source', { candidateId: '601', companyName: 'CLI Candidate' })));
  const reportPath = path.join(protectedRuntime, 'reviewed-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ candidateQuery: 'SELECT record_json FROM candidate_import_rows' }), { mode: 0o600 });
  const rowsBeforeCliDryRun = db.prepare('SELECT COUNT(*) AS count FROM matrix_migration_records').get().count;
  const protectedDryRunBefore = databaseSnapshot(process.env.DB_PATH);
  const cliDryRun = await runMigrationCli(['--dry-run', '--report', reportPath], { runtimeDir: protectedRuntime, candidateDb: db });
  assert.deepStrictEqual(cliDryRun, { imported: 1, matched: 0, unresolved: 0, skipped: 0, conflicts: 0 }, 'CLI dry-run loads reviewed candidate sources');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM matrix_migration_records').get().count, rowsBeforeCliDryRun, 'CLI dry-run creates no operational rows');
  assert.deepStrictEqual(databaseSnapshot(process.env.DB_PATH), protectedDryRunBefore, 'protected dry-run changes no schema, rows, default user, bytes, or mtime');
  const applyReportPath = path.join(protectedRuntime, 'apply-report.json');
  fs.writeFileSync(applyReportPath, JSON.stringify({ records: [record('candidate', 'cli-apply', { candidateId: '602', companyName: 'CLI Apply Candidate' })] }), { mode: 0o600 });
  const cliApply = await runMigrationCli(['--apply', '--report', applyReportPath, '--idempotency-key', 'cli-apply-1'], { runtimeDir: protectedRuntime, candidateDb: db });
  assert.deepStrictEqual(cliApply, { imported: 1, matched: 0, unresolved: 0, skipped: 0, conflicts: 0 }, 'CLI apply uses the reviewed report after online backup preflight');
  const databasePath = db.prepare('PRAGMA database_list').all().find(row => row.name === 'main').file;
  const backupDirectories = fs.readdirSync(path.dirname(databasePath)).filter(name => name.startsWith('.matrix-ledger-backup-'));
  assert.strictEqual(backupDirectories.length, 1, 'apply creates one unique online-backup directory');
  const backupDirectory = path.join(path.dirname(databasePath), backupDirectories[0]);
  const backupPath = path.join(backupDirectory, 'snapshot.db');
  assert.strictEqual(fs.statSync(backupPath).mode & 0o777, 0o600, 'online backup is mode 0600');
  assert.match(path.basename(backupDirectory), /^\.matrix-ledger-backup-/, 'backup lives in a unique protected directory');
  assert.strictEqual(fs.statSync(backupDirectory).mode & 0o777, 0o700, 'backup directory is mode 0700');
  const escapedPath = path.join(protectedRuntime, 'escaped.json');
  fs.symlinkSync(path.join(root, 'outside.json'), escapedPath);
  assert.throws(() => protectedReportPath(escapedPath, protectedRuntime), /symlink|protected runtime directory/);

  const adapterCustomerId = insertCustomer('Adapter Customer');
  insertLink(adapterCustomerId, 'candidate', '704');
  db.prepare(`
    INSERT INTO matrix_work_items (candidate_id, owner_user_id, created_at, updated_at)
    VALUES (704, 1, ?, ?)
  `).run(NOW, NOW);
  const rowsBeforeBareDryRun = db.prepare('SELECT COUNT(*) AS count FROM matrix_migration_records').get().count;
  const bareDryRunBefore = databaseSnapshot(process.env.DB_PATH);
  const bareDryRun = await runMigrationCli(['--dry-run'], { candidateDb: db });
  assert.deepStrictEqual(bareDryRun, { imported: 0, matched: 1, unresolved: 0, skipped: 0, conflicts: 0 }, 'bare dry-run uses the authoritative work-item adapter');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM matrix_migration_records').get().count, rowsBeforeBareDryRun, 'bare dry-run creates no operational rows');
  assert.deepStrictEqual(databaseSnapshot(process.env.DB_PATH), bareDryRunBefore, 'bare dry-run changes no schema, rows, default user, bytes, or mtime');

  console.log('matrix ledger migration tests passed');
} finally {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

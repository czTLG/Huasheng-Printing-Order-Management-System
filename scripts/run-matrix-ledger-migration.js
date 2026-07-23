'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { db, initDb } = require('../src/db');
const { createMatrixLedgerStore } = require('../src/services/matrixLedgerStore');
const { createMatrixLedgerMigration } = require('../src/services/matrixLedgerMigration');

function usage() { throw new Error('usage: --dry-run [--report <protected-json-path>] | --apply --report <protected-json-path> --idempotency-key <key>'); }
function parseArgs(argv) {
  const args = { mode: '', report: '', idempotencyKey: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dry-run' || value === '--apply') {
      if (args.mode) usage();
      args.mode = value;
    } else if (value === '--report') args.report = argv[++index] || '';
    else if (value === '--idempotency-key') args.idempotencyKey = argv[++index] || '';
    else usage();
  }
  if (args.mode === '--dry-run' && !args.idempotencyKey) return args;
  if (args.mode === '--apply' && args.report && args.idempotencyKey) return args;
  usage();
}
function protectedReportPath(value, configuredRuntimeDir) {
  const requestedRuntimeDir = path.resolve(configuredRuntimeDir || process.env.MATRIX_MIGRATION_RUNTIME_DIR || path.join(process.cwd(), 'runtime-data-matrix-25ebb76'));
  const runtimeStat = fs.lstatSync(requestedRuntimeDir);
  if (runtimeStat.isSymbolicLink()) throw new Error('protected runtime directory must not be a symlink');
  if ((runtimeStat.mode & 0o077) !== 0) throw new Error('protected runtime directory permissions are too broad');
  const runtimeDir = fs.realpathSync(requestedRuntimeDir);
  const requestedReport = path.resolve(value);
  const reportStat = fs.lstatSync(requestedReport);
  if (reportStat.isSymbolicLink()) throw new Error('protected report must not be a symlink');
  const reportPath = fs.realpathSync(requestedReport);
  const relative = path.relative(runtimeDir, reportPath);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error('report path must be under the protected runtime directory');
  return reportPath;
}
function initializeQuietly() {
  const originalLog = console.log;
  console.log = () => {};
  try { initDb(); } finally { console.log = originalLog; }
}
async function databaseBackupPreflight() {
  const row = db.prepare('PRAGMA database_list').all().find(item => item.name === 'main');
  if (!row || !row.file || !fs.statSync(row.file).isFile()) throw new Error('database backup preflight failed');
  const backupPath = `${row.file}.matrix-ledger-backup-${Date.now()}`;
  await db.backup(backupPath);
  fs.chmodSync(backupPath, 0o600);
  if ((fs.statSync(backupPath).mode & 0o777) !== 0o600) throw new Error('database backup permissions are not 0600');
  let backup;
  try {
    backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    const integrity = backup.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error('database backup integrity check failed');
  } finally {
    if (backup) backup.close();
  }
  return backupPath;
}
function candidateDatabase(options = {}) {
  if (options.candidateDb) return { database: options.candidateDb, close: false };
  const candidatePath = process.env.MATRIX_STREAM_DB_PATH;
  if (!candidatePath) return { database: db, close: false };
  return { database: new Database(path.resolve(candidatePath), { readonly: true, fileMustExist: true }), close: true };
}
function tableExists(database, tableName) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}
function authoritativeSources(candidateDb) {
  if (!tableExists(candidateDb, 'matrix_work_items')) return { records: [] };
  const hasCanonicalEvidence = tableExists(candidateDb, 'matrix_customer_links') && tableExists(candidateDb, 'customers');
  const rows = candidateDb.prepare(hasCanonicalEvidence ? `
    SELECT w.id AS work_item_id, w.candidate_id, w.stage, w.created_at, w.updated_at,
      COALESCE(c.name, '') AS company_name, c.id AS canonical_customer_id
    FROM matrix_work_items w
    LEFT JOIN matrix_customer_links l
      ON l.source_kind = 'candidate' AND l.source_id = CAST(w.candidate_id AS TEXT)
    LEFT JOIN customers c ON c.id = l.canonical_customer_id AND c.active = 1
    ORDER BY w.id
  ` : `
    SELECT id AS work_item_id, candidate_id, stage, created_at, updated_at,
      '' AS company_name, NULL AS canonical_customer_id
    FROM matrix_work_items ORDER BY id
  `).all();
  return {
    records: rows.map(row => {
      const candidateId = String(row.candidate_id);
      const occurredAt = row.updated_at || row.created_at || '';
      const companyName = String(row.company_name || '');
      return {
        sourceKind: 'matrix_work_item',
        sourceId: String(row.work_item_id),
        occurredAt,
        companyName,
        state: String(row.stage || ''),
        evidence: row.canonical_customer_id ? {
          explicitSourceId: { kind: 'candidate', id: candidateId },
          companyName
        } : { candidateId, companyName },
        provenance: {
          sourcePath: `candidate-db:matrix_work_items/${row.work_item_id}`,
          bodyHash: crypto.createHash('sha256').update(`matrix_work_item:${row.work_item_id}:${candidateId}:${occurredAt}`).digest('hex')
        }
      };
    })
  };
}
async function run(argv, options = {}) {
  const args = parseArgs(argv);
  initializeQuietly();
  const candidate = candidateDatabase(options);
  try {
    const store = createMatrixLedgerStore({ db });
    const migration = createMatrixLedgerMigration({ db, candidateDb: candidate.database, store });
    const report = args.report ? JSON.parse(fs.readFileSync(protectedReportPath(args.report, options.runtimeDir), 'utf8')) : null;
    const plan = migration.scan(report ? report.sources || report : authoritativeSources(candidate.database));
    if (args.mode === '--dry-run') return plan.counts;
    await databaseBackupPreflight();
    return migration.apply(plan, { idempotencyKey: args.idempotencyKey }).counts;
  } finally {
    if (candidate.close) candidate.database.close();
  }
}
async function main() {
  const counts = await run(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(counts)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`matrix ledger migration failed: ${error.message}\n`);
    process.exitCode = 1;
  }).finally(() => db.close());
}

module.exports = { run, parseArgs, protectedReportPath, databaseBackupPreflight, authoritativeSources };

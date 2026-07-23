'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { db, initDb } = require('../src/db');
const { createMatrixLedgerStore } = require('../src/services/matrixLedgerStore');
const { createMatrixLedgerMigration } = require('../src/services/matrixLedgerMigration');

function usage() { throw new Error('usage: --dry-run --report <protected-json-path> | --apply --report <protected-json-path> --idempotency-key <key>'); }
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
  if (args.mode === '--dry-run' && args.report && !args.idempotencyKey) return args;
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
async function run(argv, options = {}) {
  const args = parseArgs(argv);
  initializeQuietly();
  const reportPath = protectedReportPath(args.report, options.runtimeDir);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const candidate = candidateDatabase(options);
  try {
    const store = createMatrixLedgerStore({ db });
    const migration = createMatrixLedgerMigration({ db, candidateDb: candidate.database, store });
    const plan = migration.scan(report.sources || report);
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

module.exports = { run, parseArgs, protectedReportPath, databaseBackupPreflight };

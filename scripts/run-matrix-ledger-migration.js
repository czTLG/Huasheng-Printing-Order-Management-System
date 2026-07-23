'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { db, initDb } = require('../src/db');
const { createMatrixLedgerStore } = require('../src/services/matrixLedgerStore');
const { createMatrixLedgerMigration } = require('../src/services/matrixLedgerMigration');

function usage() {
  throw new Error('usage: --dry-run | --apply --report <protected-json-path> --idempotency-key <key>');
}

function parseArgs(argv) {
  const args = { mode: '', report: '', idempotencyKey: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dry-run' || value === '--apply') {
      if (args.mode) usage();
      args.mode = value;
    } else if (value === '--report') {
      args.report = argv[++index] || '';
    } else if (value === '--idempotency-key') {
      args.idempotencyKey = argv[++index] || '';
    } else {
      usage();
    }
  }
  if (args.mode === '--dry-run' && (!args.report && !args.idempotencyKey)) return args;
  if (args.mode === '--apply' && args.report && args.idempotencyKey) return args;
  usage();
}

function protectedReportPath(value) {
  const runtimeDir = path.resolve(process.env.MATRIX_MIGRATION_RUNTIME_DIR || path.join(process.cwd(), 'runtime-data-matrix-25ebb76'));
  const reportPath = path.resolve(value);
  if (!reportPath.startsWith(`${runtimeDir}${path.sep}`)) throw new Error('report path must be under the protected runtime directory');
  const stat = fs.statSync(runtimeDir);
  if ((stat.mode & 0o077) !== 0) throw new Error('protected runtime directory permissions are too broad');
  return reportPath;
}

function databaseBackupPreflight() {
  const row = db.prepare('PRAGMA database_list').all().find(item => item.name === 'main');
  const databasePath = row && row.file;
  if (!databasePath || !fs.statSync(databasePath).isFile()) throw new Error('database backup preflight failed');
  const backupPath = `${databasePath}.matrix-ledger-backup-${Date.now()}`;
  fs.copyFileSync(databasePath, backupPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(backupPath, 0o600);
  return backupPath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const originalLog = console.log;
  console.log = () => {};
  try {
    initDb();
  } finally {
    console.log = originalLog;
  }
  const store = createMatrixLedgerStore({ db });
  const migration = createMatrixLedgerMigration({ db, candidateDb: db, store });
  if (args.mode === '--dry-run') {
    const plan = migration.scan({ records: [] });
    process.stdout.write(`${JSON.stringify(plan.counts)}\n`);
    return;
  }
  const reportPath = protectedReportPath(args.report);
  databaseBackupPreflight();
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const result = migration.apply(migration.scan(report.sources || report), { idempotencyKey: args.idempotencyKey });
  process.stdout.write(`${JSON.stringify(result.counts)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`matrix ledger migration failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  db.close();
}

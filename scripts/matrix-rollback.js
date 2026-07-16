'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const { rollbackRun } = require('../src/lib/matrixRollback');

function runIdFromArgs(argv) {
  if (argv.length !== 2 || argv[0] !== '--run-id' || !/^[1-9]\d*$/.test(argv[1])) {
    throw new Error('usage: node scripts/matrix-rollback.js --run-id <positive-id>');
  }
  return Number(argv[1]);
}

function authenticatedActor(db) {
  const token = process.env.MATRIX_LOCAL_OPERATOR_TOKEN;
  const secret = process.env.JWT_SECRET;
  if (!token || !secret || secret === 'change-this-in-production') throw new Error('authenticated local actor is required');
  const payload = jwt.verify(token, secret);
  const user = db.prepare('SELECT username, role, status FROM users WHERE id = ?').get(Number(payload.sub));
  if (!user || user.status !== 'active' || !['super_admin', 'foreign_trade_crm_admin'].includes(user.role)) {
    throw new Error('authenticated local actor is not authorized');
  }
  return user;
}

function main() {
  const runId = runIdFromArgs(process.argv.slice(2));
  const dbPath = path.resolve(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db'));
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    const result = rollbackRun(db, runId, authenticatedActor(db));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    db.close();
  }
}

try { main(); } catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}

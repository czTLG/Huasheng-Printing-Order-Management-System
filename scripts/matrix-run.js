'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const { runCampaign } = require('../src/lib/matrixRunner');

function inputPath(argv) {
  if (argv.length !== 2 || argv[0] !== '--input') throw new Error('usage: node scripts/matrix-run.js --input <workspace-json>');
  const root = fs.realpathSync(path.resolve(__dirname, '..'));
  const candidate = fs.realpathSync(path.resolve(argv[1]));
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) throw new Error('input must stay inside the workspace');
  return candidate;
}

function actorFromToken(db) {
  const token = process.env.MATRIX_LOCAL_OPERATOR_TOKEN;
  const secret = process.env.JWT_SECRET;
  if (!token || !secret || secret === 'change-this-in-production') throw new Error('authenticated local actor is required');
  const payload = jwt.verify(token, secret);
  const user = db.prepare('SELECT username, role, status FROM users WHERE id = ?').get(Number(payload.sub));
  if (!user || user.status !== 'active' || !['super_admin', 'foreign_trade_crm_admin'].includes(user.role)) {
    throw new Error('authenticated local actor is not authorized');
  }
  return user.username;
}

async function main() {
  const payload = JSON.parse(fs.readFileSync(inputPath(process.argv.slice(2)), 'utf8'));
  if (!payload || !Array.isArray(payload.records) || !payload.campaign) throw new Error('input requires campaign and records');
  const dbPath = path.resolve(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db'));
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    payload.campaign.actor = actorFromToken(db);
    const result = await runCampaign(db, payload.campaign, payload.records);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    db.close();
  }
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

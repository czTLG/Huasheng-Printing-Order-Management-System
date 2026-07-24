'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DIRECT_DELIVERY = /\b(?:nodemailer|SMTP_[A-Z0-9_]*|sendMail\s*\()/;

function ensureCutoverSchema(db) {
  if (!db || typeof db.exec !== 'function') throw new Error('cutover database required');
  db.exec(`
    CREATE TABLE IF NOT EXISTS matrix_runtime_state (
      state_key TEXT PRIMARY KEY,
      state_value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by INTEGER
    );
    CREATE TRIGGER IF NOT EXISTS trg_matrix_runtime_canonical_delivery_no_disable
    BEFORE UPDATE ON matrix_runtime_state
    WHEN OLD.state_key = 'canonical_delivery_only'
      AND OLD.state_value = '1'
      AND NEW.state_value <> '1'
    BEGIN
      SELECT RAISE(ABORT, 'canonical delivery cannot be disabled');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_matrix_runtime_canonical_delivery_no_delete
    BEFORE DELETE ON matrix_runtime_state
    WHEN OLD.state_key = 'canonical_delivery_only' AND OLD.state_value = '1'
    BEGIN
      SELECT RAISE(ABORT, 'canonical delivery cannot be disabled');
    END;
  `);
}

function enableCanonicalDeliveryOnly({ db, actorUserId, now = new Date().toISOString() } = {}) {
  ensureCutoverSchema(db);
  const actor = Number(actorUserId);
  if (!Number.isInteger(actor) || actor < 1) throw new Error('actor user id required');
  const timestamp = new Date(now).toISOString();
  db.prepare(`
    INSERT INTO matrix_runtime_state (state_key, state_value, updated_at, updated_by)
    VALUES ('canonical_delivery_only', '1', ?, ?)
    ON CONFLICT(state_key) DO UPDATE SET
      state_value = '1', updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `).run(timestamp, actor);
  return { state_key: 'canonical_delivery_only', state_value: '1' };
}

function assertCanonicalDeliveryOnly({ db } = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('cutover database required');
  const row = db.prepare(`
    SELECT state_value FROM matrix_runtime_state WHERE state_key = 'canonical_delivery_only'
  `).get();
  if (row?.state_value !== '1') throw new Error('canonical delivery required');
  return true;
}

function filesUnder(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const files = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(child));
    else if (entry.isFile() && /\.(?:c?js|mjs|ts)$/.test(entry.name)) files.push(child);
  }
  return files;
}

function scan({ trees = [], legacyPaths = [] } = {}) {
  for (const tree of trees) {
    for (const file of filesUnder(path.resolve(tree))) {
      if (DIRECT_DELIVERY.test(fs.readFileSync(file, 'utf8'))) {
        throw new Error(`direct delivery path: ${file}`);
      }
    }
  }
  for (const target of legacyPaths) {
    const mode = fs.statSync(target).mode & 0o777;
    if ((mode & 0o022) !== 0) throw new Error(`legacy ledger must be read-only: ${target}`);
  }
  return true;
}

module.exports = {
  ensureCutoverSchema,
  enableCanonicalDeliveryOnly,
  assertCanonicalDeliveryOnly,
  scan
};

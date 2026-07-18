'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-source-work-orders-'));
process.env.DB_PATH = path.join(root, 'app.db');
const { db, initDb } = require('../src/db');
const { createMatrixInquiryItems } = require('../src/services/matrixInquiryItems');
initDb();

for (const [table, column] of [
  ['inquiry_specifications', 'matrix_item_id'],
  ['costing_requests', 'matrix_item_id'],
  ['cost_snapshots', 'matrix_item_id']
]) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  assert(columns.includes(column), `${table}.${column} must exist for explicit item migration`);
}

const beforeEvents = db.prepare('SELECT COUNT(*) AS total FROM matrix_inquiry_item_events').get().total;
const beforeCommands = db.prepare('SELECT COUNT(*) AS total FROM matrix_inquiry_item_commands').get().total;
const service = createMatrixInquiryItems({ db });
assert.deepStrictEqual(
  service.resolveSourceVersionBinding({ sourceVersionBindingId: 999999, itemId: 999999, expectedItemVersion: 1 }),
  { status: 'needs_migration_review', reason: 'binding_not_exact' },
  'ambiguous legacy rows must fail closed'
);
assert.strictEqual(db.prepare('SELECT COUNT(*) AS total FROM matrix_inquiry_item_events').get().total, beforeEvents, 'legacy projection must create no event');
assert.strictEqual(db.prepare('SELECT COUNT(*) AS total FROM matrix_inquiry_item_commands').get().total, beforeCommands, 'legacy projection must create no task or command');

db.close();
fs.rmSync(root, { recursive: true, force: true });
console.log('PASS work-order item source migration boundary');

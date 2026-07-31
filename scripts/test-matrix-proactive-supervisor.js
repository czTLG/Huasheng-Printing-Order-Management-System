#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMatrixProactiveSupervisor } = require('../src/services/matrixProactiveSupervisor');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-proactive-supervisor-'));
process.env.DB_PATH = path.join(root, 'app.db');
const { db, initDb } = require('../src/db');
initDb();
db.prepare("INSERT INTO customers(id,name,company_name,country,active,created_at,updated_at) VALUES (1,'Example Foods','Example Foods','TH',1,'2026-07-01','2026-07-01')").run();
db.prepare("INSERT INTO matrix_tasks(canonical_customer_id,source_kind,source_id,task_type,due_at,state,priority,next_action,cancellation_reason,created_at,updated_at) VALUES (1,'customer','1','check_reply','2026-07-30T00:00:00.000Z','pending','high','检查是否收到回复','','2026-07-29','2026-07-29')").run();

const supervisor = createMatrixProactiveSupervisor({
  db,
  clock: () => new Date('2026-07-31T02:00:00.000Z')
});
const first = supervisor.prepare();
const second = supervisor.prepare();
assert.strictEqual(first.digest_id, second.digest_id);
assert.strictEqual(first.date, '2026-07-31');
assert.deepStrictEqual(first.channels.map(row => row.channel), ['bill', 'vmci']);
assert.strictEqual(first.channels[0].items[0].customer, 'Example Foods');
assert.strictEqual(first.channels[0].items[0].state, 'overdue');
assert.strictEqual(first.channels[1].items.length, 0);
assert.ok(!JSON.stringify(first).includes('@'));

db.close();
fs.rmSync(root, { recursive: true, force: true });
console.log('matrix proactive supervisor tests passed');

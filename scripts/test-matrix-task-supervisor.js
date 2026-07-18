'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-task-supervisor-'));
process.env.DB_PATH = path.join(root, 'app.db');
const { db, initDb } = require('../src/db');
const { createMatrixTaskSupervisor } = require('../src/services/matrixTaskSupervisor');
const { normalizePermissions } = require('../src/lib/permissions');
const fixture = require('./fixtures/matrix-core/task-dependency-chain.json');
const NOW = '2026-07-18T10:00:00.000Z';

initDb();
db.prepare("INSERT INTO users (id,username,password,role,status,created_at) VALUES (9401,'task-owner','x','foreign_trade_crm_admin','active',?)").run(NOW);
db.prepare("INSERT INTO users (id,username,password,role,status,created_at) VALUES (9402,'task-cost','x','costing_user','active',?)").run(NOW);
db.prepare("INSERT INTO matrix_actor_bindings (id,feishu_open_id,user_id,status,bound_by,bound_at) VALUES (9420,'ou-task-cost',9402,'active',9401,?)").run(NOW);

assert.deepStrictEqual(normalizePermissions('manager', { capabilities: { matrixDecide: true, matrixSend: true } }).capabilities, { matrixSend: false, matrixDecide: false });
assert.deepStrictEqual(normalizePermissions('foreign_trade_crm_admin', { capabilities: { matrixDecide: true } }).capabilities, { matrixSend: false, matrixDecide: true });
assert.deepStrictEqual(normalizePermissions('super_admin', { all: true }).capabilities, { matrixSend: true, matrixDecide: true });

const tasks = createMatrixTaskSupervisor({ db, clock: () => new Date(NOW) });
const bill = tasks.ensureTask({ ...fixture.bill, dueAt: NOW, bindings: { inquiryId: 8001, itemIds: [1] }, blocker: '', nextAction: 'Wait for cost', evidenceIds: ['whatsapp:63'], idempotencyKey: 'bill-1' });
const billReplay = tasks.ensureTask({ ...fixture.bill, dueAt: NOW, bindings: { inquiryId: 8001, itemIds: [1] }, blocker: '', nextAction: 'Wait for cost', evidenceIds: ['whatsapp:63'], idempotencyKey: 'bill-1' });
assert.deepStrictEqual(billReplay, bill);
assert.throws(() => tasks.ensureTask({ ...fixture.bill, dueAt: NOW, bindings: { inquiryId: 9999 }, blocker: '', nextAction: 'changed', evidenceIds: [], idempotencyKey: 'bill-1' }), /idempotency conflict/i);
const vmci = tasks.ensureTask({ ...fixture.vmci, dueAt: NOW, bindings: { inquiryId: 8001, itemIds: [1] }, blocker: '', nextAction: 'Review cost', evidenceIds: ['costing:2'], idempotencyKey: 'vmci-1' });
tasks.linkDependency({ blockedTaskId: bill.id, blockingTaskId: vmci.id, resumeAction: fixture.resumeAction, idempotencyKey: 'dep-1' });
assert.strictEqual(tasks.getTask(bill.id).state, 'blocked');

const decision = tasks.createDecision({ taskId: vmci.id, expectedTaskVersion: vmci.version, affectedItemIds: [1], question: 'Use reviewed cost?', recommendedOption: 'A', options: [{ key: 'A', label: 'Use' }, { key: 'B', label: 'Revise' }], idempotencyKey: 'decision-1' });
assert.strictEqual(decision.decision.state, 'pending');
assert.throws(() => tasks.createDecision({ taskId: bill.id, expectedTaskVersion: tasks.getTask(bill.id).version, affectedItemIds: [2], question: 'Wrong', recommendedOption: 'A', options: [{ key: 'A', label: 'A' }], idempotencyKey: 'decision-cross' }), /affected item.*task binding/i);
assert.throws(() => tasks.resolveDecision({ decisionId: decision.decision.id, expectedDecisionVersion: decision.decision.version, option: 'A', actorUserId: 9402, bindingId: 'wrong-binding', channel: 'vmci', chatId: 'vmci-chat', cardEventId: 'event-wrong', idempotencyKey: 'resolve-wrong' }), /binding mismatch/i);

const resolved = tasks.resolveDecision({ decisionId: decision.decision.id, expectedDecisionVersion: decision.decision.version, option: 'A', actorUserId: 9402, bindingId: '9420', channel: 'vmci', chatId: 'vmci-chat', cardEventId: 'event-1', idempotencyKey: 'resolve-1' });
assert.strictEqual(resolved.decision.state, 'resolved');
assert.deepStrictEqual(resolved.resumedTaskIds, [bill.id]);
assert.strictEqual(tasks.getTask(bill.id).state, 'open');
assert.strictEqual(tasks.getTask(bill.id).nextAction, fixture.resumeAction);
assert.throws(() => tasks.transition({ taskId: bill.id, expectedVersion: 1, action: 'complete', actorUserId: 9401, bindingId: bill.bindingId, channel: 'bill', chatId: 'bill-chat', cardEventId: 'stale', evidence: ['quote:1'], idempotencyKey: 'stale-transition' }), /stale task version/i);

const event = db.prepare('SELECT * FROM matrix_task_events ORDER BY id LIMIT 1').get();
assert.throws(() => db.prepare("UPDATE matrix_task_events SET event_type='changed' WHERE id=?").run(event.id), /append-only/i);
assert.throws(() => db.prepare('DELETE FROM matrix_decision_events').run(), /append-only/i);

const beforeTasks = db.prepare('SELECT COUNT(*) AS total FROM matrix_tasks').get().total;
const review = tasks.consumeMigrationProjection({ status: 'needs_migration_review', reason: 'binding_not_exact', sourceVersionBindingId: 88 }, { ownerRole: 'foreign_trade_crm_admin', channel: 'bill', idempotencyKey: 'projection-88' });
const reviewReplay = tasks.consumeMigrationProjection({ status: 'needs_migration_review', reason: 'binding_not_exact', sourceVersionBindingId: 88 }, { ownerRole: 'foreign_trade_crm_admin', channel: 'bill', idempotencyKey: 'projection-88' });
assert.deepStrictEqual(reviewReplay, review);
assert.strictEqual(db.prepare('SELECT COUNT(*) AS total FROM matrix_tasks').get().total, beforeTasks + 1);
assert.strictEqual(db.prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table' AND name IN ('matrix_migration_reviews','matrix_identity_reviews')").get().total, 0, 'no secondary migration or identity review table may exist');

db.close();
fs.rmSync(root, { recursive: true, force: true });
console.log('PASS matrix task supervisor');

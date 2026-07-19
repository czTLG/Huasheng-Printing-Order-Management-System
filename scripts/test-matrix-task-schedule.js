'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-task-schedule-'));
process.env.DB_PATH = path.join(root, 'app.db');
const { db, initDb } = require('../src/db');
const { createMatrixTaskSupervisor } = require('../src/services/matrixTaskSupervisor');
const { createMatrixTaskSchedule } = require('../src/services/matrixTaskSchedule');
const calendar = require('./fixtures/matrix-core/business-calendar.json');

initDb();
const tasks = createMatrixTaskSupervisor({ db, clock: () => new Date('2026-07-17T01:00:00.000Z') });
const bill = tasks.ensureTask({ taskType: 'quote_followup', ownerRole: 'foreign_trade_crm_admin', channel: 'bill', dueAt: '2026-07-17T01:00:00.000Z', bindings: { inquiryId: 1, itemIds: [1] }, blocker: '', nextAction: 'Follow up', evidenceIds: [], idempotencyKey: 'schedule-bill' });
const vmci = tasks.ensureTask({ taskType: 'cost_review', ownerRole: 'costing_user', channel: 'vmci', dueAt: '2026-07-17T02:00:00.000Z', bindings: { inquiryId: 1, itemIds: [1] }, blocker: '', nextAction: 'Review', evidenceIds: [], idempotencyKey: 'schedule-vmci' });
const schedule = createMatrixTaskSchedule({ db, timezone: calendar.timezone, holidays: calendar.holidays, billDigest: { hour: 9, minute: 0 }, vmciDigest: { hour: 10, minute: 0 }, overdueDigest: { hour: 16, minute: 30 }, quietHours: { start: '22:00', end: '08:00' } });

assert.deepStrictEqual(schedule.prepareDueDigests({ now: '2026-07-20T00:30:00.000Z', idempotencyKey: 'quiet' }), [], '08:30 Shanghai is before the first slot and produces no digest');
const billDigests = schedule.prepareDueDigests({ now: '2026-07-20T01:00:00.000Z', idempotencyKey: 'bill-slot' });
assert.strictEqual(billDigests.length, 1);
assert.strictEqual(billDigests[0].channel, 'bill');
const replay = schedule.prepareDueDigests({ now: '2026-07-20T01:00:00.000Z', idempotencyKey: 'bill-slot' });
assert.deepStrictEqual(replay, billDigests);
assert.strictEqual(db.prepare("SELECT COUNT(*) AS total FROM matrix_digest_outbox WHERE channel='bill'").get().total, 1);

const vmciDigests = schedule.prepareDueDigests({ now: '2026-07-20T02:00:00.000Z', idempotencyKey: 'vmci-slot' });
assert(vmciDigests.some(row => row.channel === 'vmci'));

const advanced1 = schedule.advance({ now: '2026-07-20T08:30:00.000Z', idempotencyKey: 'advance-1' });
assert(advanced1.proposedTaskIds.includes(bill.id));
assert.strictEqual(tasks.getTask(bill.id).state, 'open', 'silence must never complete a task');
schedule.advance({ now: '2026-07-22T08:30:00.000Z', idempotencyKey: 'advance-3' });
schedule.advance({ now: '2026-07-24T08:30:00.000Z', idempotencyKey: 'advance-5' });
assert.strictEqual(tasks.getTask(bill.id).followupCount, 2, 'at most two follow-up proposals');

const claim = schedule.claimDigest({ channel: 'bill', ownerToken: 'worker-1', leaseMs: 30000, now: '2026-07-20T01:01:00.000Z' });
assert(claim && claim.claimToken);
assert.strictEqual(schedule.ackDigest({ outboxId: claim.id, claimToken: claim.claimToken, receiptId: 'receipt-1', now: '2026-07-20T01:01:01.000Z' }).state, 'delivered');

schedule.prepareDueDigests({ now: '2026-07-21T01:00:00.000Z', idempotencyKey: 'bill-slot-next' });
const ambiguousClaim = schedule.claimDigest({ channel: 'bill', ownerToken: 'worker-2', leaseMs: 30000, now: '2026-07-21T01:01:00.000Z' });
assert(ambiguousClaim);
assert.strictEqual(schedule.nackDigest({ outboxId: ambiguousClaim.id, claimToken: ambiguousClaim.claimToken, outcome: 'ambiguous', now: '2026-07-21T01:01:01.000Z' }).state, 'manual_review');
assert.strictEqual(schedule.claimDigest({ channel: 'bill', ownerToken: 'worker-3', leaseMs: 30000, now: '2026-07-21T01:02:00.000Z' }), null, 'ambiguous delivery must never retry automatically');

const saturdayBill = schedule.prepareDueDigests({ now: '2026-07-18T01:00:00.000Z', idempotencyKey: 'saturday-bill-slot' });
assert(saturdayBill.some(row => row.channel === 'bill'), 'Saturday must run the Bill daily digest');
const sundayVmci = schedule.prepareDueDigests({ now: '2026-07-19T02:00:00.000Z', idempotencyKey: 'sunday-vmci-slot' });
assert(sundayVmci.some(row => row.channel === 'vmci'), 'Sunday must run the VMCI daily digest');
const sundayOverdue = schedule.prepareDueDigests({ now: '2026-07-19T08:30:00.000Z', idempotencyKey: 'sunday-overdue-slot' });
assert(sundayOverdue.some(row => row.slotKey === '2026-07-19:bill:overdue'), 'Sunday must run the overdue digest');

assert.strictEqual(tasks.getTask(vmci.id).state, 'open');
db.close();
fs.rmSync(root, { recursive: true, force: true });
console.log('PASS matrix task schedule');

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-inquiry-items-'));
process.env.DB_PATH = path.join(root, 'app.db');

const { db, initDb } = require('../src/db');
const { createMatrixInquiryItems } = require('../src/services/matrixInquiryItems');
const fixture = require('./fixtures/matrix-core/four-item-inquiry.json');

const NOW = '2026-07-18T08:00:00.000Z';
const actorUserId = 9201;
initDb();
db.prepare("INSERT INTO users (id,username,password,role,status,created_at) VALUES (?,'matrix-item-test','x','manager','active',?)").run(actorUserId, NOW);
db.prepare("INSERT INTO customers (id,name,created_at,updated_at) VALUES (7001,'Fixture Company',?,?)").run(NOW, NOW);
db.prepare("INSERT INTO inquiries (id,customer_id,inquiry_title,status,created_at,updated_at) VALUES (8001,7001,'Four items','new',?,?)").run(NOW, NOW);
db.prepare("INSERT INTO inquiry_specifications (id,inquiry_id,version_no,is_current,created_at,updated_at) VALUES (8101,8001,1,1,?,?)").run(NOW, NOW);
db.prepare("INSERT INTO inquiry_specifications (id,inquiry_id,version_no,is_current,created_at,updated_at) VALUES (8102,8001,2,1,?,?)").run(NOW, NOW);
db.prepare("INSERT INTO inquiries (id,customer_id,inquiry_title,status,created_at,updated_at) VALUES (8002,7001,'Other inquiry','new',?,?)").run(NOW, NOW);
db.prepare("INSERT INTO inquiry_specifications (id,inquiry_id,version_no,is_current,created_at,updated_at) VALUES (8201,8002,1,1,?,?)").run(NOW, NOW);

const service = createMatrixInquiryItems({ db, clock: () => new Date(NOW) });
const items = fixture.items.map((item, index) => service.createItem({
  inquiryId: 8001,
  ...item,
  actorUserId,
  idempotencyKey: `create-${index}`
}));
assert.strictEqual(items.length, 4);
assert.throws(() => service.createItem({ inquiryId: 8001, ...fixture.items[0], actorUserId, idempotencyKey: 'duplicate-key' }), /duplicate item key/i);

const bound = service.bindSpecification({ itemId: items[0].id, specificationId: 8101, expectedItemVersion: 1, actorUserId, idempotencyKey: 'bind-1' });
assert.strictEqual(bound.version, 2);
assert.throws(() => service.bindSpecification({ itemId: items[0].id, specificationId: 8102, expectedItemVersion: 1, actorUserId, idempotencyKey: 'bind-stale' }), /stale item version/i);
assert.throws(() => service.bindSpecification({ itemId: items[1].id, specificationId: 8201, expectedItemVersion: 1, actorUserId, idempotencyKey: 'bind-cross' }), /specification.*inquiry/i);
assert.throws(() => service.applyState({ itemId: items[0].id, expectedItemVersion: 2, disposition: 'completed', evidenceIds: [], actorUserId, idempotencyKey: 'terminal-no-evidence' }), /terminal disposition requires evidence/i);

const item1 = service.applyState({
  itemId: items[0].id, expectedItemVersion: 2,
  requirementState: 'complete', costingState: 'completed', quoteState: 'ready', disposition: 'completed',
  blockerCode: '', nextAction: 'owner approval', evidenceIds: ['whatsapp:63', 'cost:2'], actorUserId, idempotencyKey: 'state-1'
});
const item2 = service.applyState({ itemId: items[1].id, expectedItemVersion: 1, requirementState: 'complete', costingState: 'completed', quoteState: 'ready', disposition: 'active', blockerCode: '', nextAction: 'review', evidenceIds: ['whatsapp:67'], actorUserId, idempotencyKey: 'state-2' });
const item3 = service.applyState({ itemId: items[2].id, expectedItemVersion: 1, requirementState: 'waiting_factory', costingState: 'blocked', quoteState: 'blocked', disposition: 'active', blockerCode: 'factory_cost', nextAction: 'ask factory', evidenceIds: ['whatsapp:69'], actorUserId, idempotencyKey: 'state-3' });
const item4 = service.applyState({ itemId: items[3].id, expectedItemVersion: 1, requirementState: 'waiting_customer', costingState: 'blocked', quoteState: 'blocked', disposition: 'active', blockerCode: 'customer_spec', nextAction: 'ask customer', evidenceIds: ['whatsapp:231'], actorUserId, idempotencyKey: 'state-4' });
assert.strictEqual(item1.disposition, 'completed');
assert.strictEqual(item2.quoteState, 'ready');
assert.strictEqual(item3.blockerCode, 'factory_cost');
assert.strictEqual(item4.requirementState, 'waiting_customer');
const aggregate = service.aggregateInquiry(8001);
assert.strictEqual(aggregate.status, 'partial', 'one completed item must never complete a four-item inquiry');
assert.strictEqual(aggregate.completedCount, 1);
assert.strictEqual(aggregate.requiredCount, 4);
assert.throws(() => service.applyState({ itemId: items[1].id, expectedItemVersion: 1, nextAction: 'stale', evidenceIds: [], actorUserId, idempotencyKey: 'state-stale' }), /stale item version/i);

const replay = service.createItem({ inquiryId: 8001, ...fixture.items[0], actorUserId, idempotencyKey: 'create-0' });
assert.deepStrictEqual(replay, items[0]);
assert.throws(() => service.createItem({ inquiryId: 8002, itemKey: 'changed', title: 'changed', required: true, actorUserId, idempotencyKey: 'create-0' }), /idempotency conflict/i);

db.close();
fs.rmSync(root, { recursive: true, force: true });
console.log('PASS matrix inquiry item truth');

'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-source-orders-'));
process.env.DB_PATH = path.join(root, 'app.db');
const { db, initDb } = require('../src/db');
const { createMatrixInquiryItems } = require('../src/services/matrixInquiryItems');

const NOW = '2026-07-18T09:00:00.000Z';
initDb();
db.prepare("INSERT INTO users (id,username,password,role,status,created_at) VALUES (9301,'source-test','x','manager','active',?)").run(NOW);
db.prepare("INSERT INTO customers (id,name,created_at,updated_at) VALUES (7301,'Source Company',?,?)").run(NOW, NOW);
db.prepare("INSERT INTO inquiries (id,customer_id,inquiry_title,status,created_at,updated_at) VALUES (8301,7301,'Source inquiry','new',?,?)").run(NOW, NOW);
db.prepare("INSERT INTO inquiry_specifications (id,inquiry_id,version_no,is_current,created_at,updated_at) VALUES (8311,8301,1,1,?,?)").run(NOW, NOW);

const service = createMatrixInquiryItems({ db, clock: () => new Date(NOW) });
const item = service.createItem({ inquiryId: 8301, itemKey: 'line-1', title: 'Line 1', required: true, actorUserId: 9301, idempotencyKey: 'item-1' });
const boundItem = service.bindSpecification({ itemId: item.id, specificationId: 8311, expectedItemVersion: item.version, actorUserId: 9301, idempotencyKey: 'spec-1' });
const hash1 = crypto.createHash('sha256').update('source-v1').digest('hex');
const source1 = service.recordSourceVersion({ sourceType: 'order', sourceId: 'order-44', sourceVersion: 1, sourceContentHash: hash1, actorUserId: 9301, idempotencyKey: 'source-v1' });
const link = service.linkSource({ itemId: item.id, sourceType: 'order', sourceId: 'order-44', actorUserId: 9301, idempotencyKey: 'link-1' });
const binding1 = service.bindSourceVersion({ itemSourceLinkId: link.id, sourceVersionEventId: source1.id, sourceVersion: 1, sourceContentHash: hash1, boundItemVersion: boundItem.version, specificationId: 8311, specificationVersion: 1, actorUserId: 9301, idempotencyKey: 'binding-v1' });
assert.strictEqual(binding1.status, 'active');

assert.throws(() => service.bindSourceVersion({ itemSourceLinkId: link.id, sourceVersionEventId: source1.id, sourceVersion: 1, sourceContentHash: '0'.repeat(64), boundItemVersion: boundItem.version, specificationId: 8311, specificationVersion: 1, actorUserId: 9301, idempotencyKey: 'binding-hash-mismatch' }), /source version identity mismatch/i);
assert.throws(() => service.bindSourceVersion({ itemSourceLinkId: link.id, sourceVersionEventId: source1.id, sourceVersion: 1, sourceContentHash: hash1, boundItemVersion: boundItem.version - 1, specificationId: 8311, specificationVersion: 1, actorUserId: 9301, idempotencyKey: 'binding-stale-item' }), /stale item version/i);
assert.throws(() => service.bindSourceVersion({ itemSourceLinkId: link.id, sourceVersionEventId: source1.id, sourceVersion: 1, sourceContentHash: hash1, boundItemVersion: boundItem.version, specificationId: 8311, specificationVersion: 2, actorUserId: 9301, idempotencyKey: 'binding-stale-spec' }), /stale specification version/i);

const hash2 = crypto.createHash('sha256').update('source-v2').digest('hex');
const source2 = service.recordSourceVersion({ sourceType: 'order', sourceId: 'order-44', sourceVersion: 2, sourceContentHash: hash2, actorUserId: 9301, idempotencyKey: 'source-v2' });
const binding2 = service.bindSourceVersion({ itemSourceLinkId: link.id, sourceVersionEventId: source2.id, sourceVersion: 2, sourceContentHash: hash2, boundItemVersion: boundItem.version, specificationId: 8311, specificationVersion: 1, actorUserId: 9301, idempotencyKey: 'binding-v2' });
assert.strictEqual(binding2.supersedesBindingId, binding1.id);
assert.strictEqual(db.prepare('SELECT status FROM matrix_item_source_version_bindings WHERE id=?').get(binding1.id).status, 'superseded');
assert.throws(() => db.prepare("UPDATE matrix_item_source_version_bindings SET status='active',source_content_hash=? WHERE id=?").run('f'.repeat(64), binding1.id), /immutable/i, 'supersession must not permit another field mutation');

const stableLinkBefore = db.prepare('SELECT * FROM matrix_item_source_links WHERE id=?').get(link.id);
service.applyState({ itemId: item.id, expectedItemVersion: boundItem.version, requirementState: 'complete', evidenceIds: ['order:44'], actorUserId: 9301, idempotencyKey: 'state-after-source' });
const stableLinkAfter = db.prepare('SELECT * FROM matrix_item_source_links WHERE id=?').get(link.id);
assert.deepStrictEqual(stableLinkAfter, stableLinkBefore, 'ordinary item state changes must not mutate stable source identity');

db.close();
fs.rmSync(root, { recursive: true, force: true });
console.log('PASS order item source links');

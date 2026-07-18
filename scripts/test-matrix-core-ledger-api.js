'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-core-api-'));
process.env.DB_PATH = path.join(root, 'app.db');
const { db, initDb } = require('../src/db');
const { createMatrixInquiryItems } = require('../src/services/matrixInquiryItems');
const { createMatrixTaskSupervisor } = require('../src/services/matrixTaskSupervisor');
const { createMatrixTaskSchedule } = require('../src/services/matrixTaskSchedule');
const { createMatrixChannelPolicy } = require('../src/services/matrixChannelPolicy');
const { createMatrixCoreRouter } = require('../src/routes/matrixCore');

const NOW = '2026-07-18T11:00:00.000Z';
initDb();
db.prepare("INSERT INTO users (id,username,password,role,status,permissions_json,created_at) VALUES (9501,'core-user','x','foreign_trade_crm_admin','active',?,?)")
  .run(JSON.stringify({ modules: { crm: true }, capabilities: { matrixDecide: true, matrixSend: false } }), NOW);
db.prepare("INSERT INTO matrix_actor_bindings (id,feishu_open_id,user_id,status,bound_by,bound_at) VALUES (9511,'ou-core',9501,'active',9501,?)").run(NOW);
db.prepare("INSERT INTO customers (id,name,created_at,updated_at) VALUES (7501,'Core Company',?,?)").run(NOW, NOW);
db.prepare("INSERT INTO inquiries (id,customer_id,inquiry_title,status,created_at,updated_at) VALUES (8501,7501,'Core inquiry','new',?,?)").run(NOW, NOW);
db.prepare("INSERT INTO inquiry_specifications (id,inquiry_id,version_no,is_current,created_at,updated_at) VALUES (8511,8501,1,1,?,?)").run(NOW, NOW);

const items = createMatrixInquiryItems({ db, clock: () => new Date(NOW) });
const tasks = createMatrixTaskSupervisor({ db, clock: () => new Date(NOW) });
const schedule = createMatrixTaskSchedule({ db, clock: () => new Date(NOW) });
const channelPolicy = createMatrixChannelPolicy({ billChatId: 'oc_bill_exact', vmciChatId: 'oc_vmci_exact' });
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 9501, role: 'foreign_trade_crm_admin', userName: 'core-user', permissions: { capabilities: { matrixDecide: true } } };
  req.matrixBinding = { id: 9511, feishuOpenId: 'ou-core' };
  next();
});
app.use('/core', createMatrixCoreRouter({ db, items, tasks, schedule, channelPolicy }));

const port = 22000 + (process.pid % 1000);
const server = app.listen(port, '127.0.0.1');
async function call(route, { method = 'GET', body, chat = 'oc_bill_exact' } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-feishu-chat-id': chat },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

(async () => {
  try {
    let response = await call('/core/inquiries/8501/items', { method: 'POST', body: { itemKey: 'line-1', title: 'Line 1', required: true, idempotencyKey: 'api-item-1' } });
    assert.strictEqual(response.status, 201);
    const item = response.body.item;
    response = await call('/core/inquiries/8501/items');
    assert.strictEqual(response.body.aggregate.requiredCount, 1);
    response = await call('/core/inquiries/8501/items', { method: 'POST', body: { itemKey: 'bad', title: 'Bad', required: true, idempotencyKey: 'api-bad', actorUserId: 1 } });
    assert.strictEqual(response.status, 400, 'authenticated actor fields must be rejected from the body');
    response = await call(`/core/items/${item.id}/specifications/8511/bind`, { method: 'POST', body: { expectedItemVersion: item.version, idempotencyKey: 'api-bind-1' } });
    assert.strictEqual(response.status, 200);

    const task = tasks.ensureTask({ taskType: 'quote_followup', ownerRole: 'foreign_trade_crm_admin', channel: 'bill', dueAt: NOW, bindings: { inquiryId: 8501, itemIds: [item.id] }, blocker: '', nextAction: 'Prepare quote', evidenceIds: [], idempotencyKey: 'api-task-1' });
    response = await call('/core/tasks?channel=bill&limit=20');
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.rows[0].id, task.id);
    response = await call('/core/tasks?channel=bill', { chat: 'oc_vmci_exact' });
    assert.strictEqual(response.status, 403, 'one chat must not read the other channel queue');
    response = await call(`/core/tasks/${task.id}/decisions`, { method: 'POST', body: { expectedTaskVersion: task.version, affectedItemIds: [item.id], question: 'Approve?', recommendedOption: 'A', options: [{ key: 'A', label: 'Approve' }, { key: 'B', label: 'Revise' }], idempotencyKey: 'api-decision-1' } });
    assert.strictEqual(response.status, 201);
    const decision = response.body.decision;
    response = await call(`/core/decisions/${decision.id}/resolve`, { method: 'POST', body: { expectedDecisionVersion: decision.version, option: 'A', cardEventId: 'card-1', idempotencyKey: 'api-resolve-1' } });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.decision.state, 'resolved');
    console.log('PASS matrix core ledger API');
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

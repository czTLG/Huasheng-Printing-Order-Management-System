'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-ledger-store-'));
process.env.DB_PATH = path.join(root, 'app.db');
const { db, initDb } = require('../src/db');
const { createMatrixLedgerStore } = require('../src/services/matrixLedgerStore');

const NOW = '2026-07-23T00:00:00.000Z';

try {
  initDb();
  const store = createMatrixLedgerStore({ db, clock: () => new Date(NOW) });

  const customer = store.resolveCustomer({
    candidateId: 84,
    companyName: 'Pagoda Foods (Malaysia) Sdn Bhd',
    normalizedDomain: 'pagoda.com.my',
    countryCode: 'MY'
  });
  assert.strictEqual(customer.canonical_customer_id > 0, true);
  assert.strictEqual(
    store.resolveCustomer({ candidateId: 84 }).canonical_customer_id,
    customer.canonical_customer_id
  );
  assert.strictEqual(
    store.resolveCustomer({ normalizedDomain: 'HTTPS://PAGODA.COM.MY/contact-us/' }).canonical_customer_id,
    customer.canonical_customer_id
  );

  const contact = store.upsertContact({
    customerId: customer.canonical_customer_id,
    channel: 'email',
    address: 'enquiry@pagoda.com.my',
    role: 'organizational',
    sourceUrl: 'https://pagoda.com.my/contact-us/',
    verifiedAt: NOW,
    status: 'active',
    credential: 'must-not-be-stored'
  });
  assert.strictEqual(contact.address, 'enquiry@pagoda.com.my');
  assert.throws(() => store.upsertContact({
    ...contact,
    customerId: customer.canonical_customer_id + 1
  }), /contact identity conflict/);
  assert.strictEqual(
    store.resolveCustomer({ channel: 'email', address: 'ENQUIRY@PAGODA.COM.MY' }).canonical_customer_id,
    customer.canonical_customer_id
  );

  const message = store.recordThreadMessage({
    customerId: customer.canonical_customer_id,
    channel: 'email',
    conversationKey: 'pagoda-2026-07-23',
    sourceKind: 'email_message',
    sourceId: '1001',
    direction: 'inbound',
    classification: 'customer_reply',
    messageId: '<1001@pagoda.com.my>',
    contentHash: 'message-1001',
    occurredAt: NOW
  });
  assert.strictEqual(message.inserted, true);
  assert.strictEqual(store.recordThreadMessage({
    customerId: customer.canonical_customer_id,
    channel: 'email',
    conversationKey: 'pagoda-2026-07-23',
    sourceKind: 'email_message',
    sourceId: '1001',
    direction: 'inbound',
    classification: 'customer_reply',
    occurredAt: NOW
  }).inserted, false);

  const task = store.createTask({
    customerId: customer.canonical_customer_id,
    sourceKind: 'email_message',
    sourceId: '1001',
    taskType: 'review_reply',
    dueAt: '2026-07-24T00:00:00.000Z',
    priority: 'high',
    nextAction: 'Review the inbound reply'
  });
  assert.strictEqual(task.state, 'pending');
  assert.strictEqual(store.createTask({
    customerId: customer.canonical_customer_id,
    sourceKind: 'email_message',
    sourceId: '1001',
    taskType: 'review_reply',
    dueAt: '2026-07-24T00:00:00.000Z'
  }).id, task.id);
  assert.strictEqual(
    db.prepare("SELECT COUNT(*) AS count FROM matrix_tasks WHERE state = 'pending'").get().count,
    1
  );
  assert.strictEqual(store.cancelTasks({
    customerId: customer.canonical_customer_id,
    sourceKind: 'email_message',
    sourceId: '1001',
    reason: 'reply received'
  }).cancelled, 1);
  assert.strictEqual(db.prepare('SELECT state FROM matrix_tasks WHERE id = ?').get(task.id).state, 'cancelled');

  store.upsertContact({ ...contact, status: 'revoked', revokedReason: 'recipient opted out' });
  assert.throws(
    () => store.resolveCustomer({ channel: 'email', address: contact.address }),
    /customer could not be resolved/
  );

  const event = db.prepare('SELECT * FROM matrix_lifecycle_events ORDER BY id LIMIT 1').get();
  assert.ok(event, 'ledger actions create lifecycle events');
  assert.throws(
    () => db.prepare('UPDATE matrix_lifecycle_events SET event_type = ? WHERE id = ?').run('changed', event.id),
    /append-only/
  );
  assert.throws(
    () => db.prepare('DELETE FROM matrix_lifecycle_events WHERE id = ?').run(event.id),
    /append-only/
  );

  const snapshot = store.customerSnapshot(customer.canonical_customer_id);
  assert.strictEqual(snapshot.customer.id, customer.canonical_customer_id);
  assert.strictEqual(JSON.stringify(snapshot).includes('must-not-be-stored'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(snapshot.contacts[0], 'credential'), false);

  const secondCustomer = db.prepare(`
    INSERT INTO customers (name, active, created_at, updated_at) VALUES (?, 1, ?, ?)
  `).run('Other Pagoda', NOW, NOW);
  db.prepare(`
    INSERT INTO matrix_customer_links (
      canonical_customer_id, source_kind, source_id, normalized_domain, confidence, created_at
    ) VALUES (?, 'legacy_registry', 'other-pagoda', 'pagoda.com.my', 'reviewed', ?)
  `).run(Number(secondCustomer.lastInsertRowid), NOW);
  assert.throws(
    () => store.resolveCustomer({ normalizedDomain: 'pagoda.com.my' }),
    /customer domain identity conflict/
  );
  console.log('matrix ledger store tests passed');
} finally {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

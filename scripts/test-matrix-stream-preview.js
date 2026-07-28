'use strict';

const assert = require('node:assert');
const Database = require('better-sqlite3');
const { createMatrixStreamPreview } = require('../src/services/matrixStreamPreview');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, contact TEXT, active INTEGER);
  CREATE TABLE inquiries (id INTEGER PRIMARY KEY, customer_id INTEGER);
  CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_name TEXT);
  CREATE TABLE crm_messages (id INTEGER PRIMARY KEY, customer_id INTEGER, direction TEXT, sender_contact TEXT, receiver_contact TEXT, received_at TEXT, created_at TEXT);
  CREATE TABLE matrix_stream_events (id INTEGER PRIMARY KEY, action TEXT, before_json TEXT, after_json TEXT);
  CREATE TABLE matrix_stream_jobs (id INTEGER PRIMARY KEY, version_id INTEGER, state TEXT, updated_at TEXT, created_at TEXT);
  CREATE TABLE matrix_stream_versions (id INTEGER PRIMARY KEY, recipient_email TEXT);
`);

let readinessResult = { ok: true, hardFailures: [], checkedAt: '2026-07-19T13:00:00.000Z' };
const preview = createMatrixStreamPreview({
  db,
  clock: () => new Date('2026-07-19T13:00:00.000Z'),
  senderDomain: 'gdhspack.com',
  dkimSelector: 'default',
  readinessService: { check: async () => readinessResult }
});
const version = {
  recipient_email: 'team@alpha.test',
  source_snapshot_json: JSON.stringify({ company: 'Alpha Foods', aliases: [], country_code: 'US' })
};

(async () => {
  const ready = await preview.project({ version, allowed: true, reasons: [] });
  assert.strictEqual(ready.allowed, true);
  for (const key of ['duplicate', 'cooling', 'quota', 'readiness', 'policy']) assert.deepStrictEqual(ready[key], { ok: true, reasons: [] });

  db.prepare(`INSERT INTO crm_messages VALUES (2, 8, 'inbound', 'unrelated@gmail.com', 'sales@gdhspack.com', ?, ?)`).run('2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z');
  const publicMailbox = await preview.project({
    version: {
      recipient_email: 'official-company@gmail.com',
      source_snapshot_json: JSON.stringify({
        company: 'Official Company',
        organization_domain: 'official-company.test',
        aliases: [],
        country_code: 'MY'
      })
    },
    allowed: true,
    reasons: []
  });
  assert.deepStrictEqual(publicMailbox.duplicate, { ok: true, reasons: [] });
  assert.strictEqual(publicMailbox.allowed, true, 'unrelated provider-mailbox traffic must not create a false relationship');

  readinessResult = { ok: false, hardFailures: ['missing_dkim', 'country_channel_policy_not_approved'] };
  const blocked = await preview.project({ version, allowed: true, reasons: [] });
  assert.deepStrictEqual(blocked.readiness, { ok: false, reasons: ['missing_dkim'] });
  assert.deepStrictEqual(blocked.policy, { ok: false, reasons: ['country_channel_policy_not_approved'] });
  assert.strictEqual(blocked.allowed, false);

  db.prepare(`INSERT INTO crm_messages VALUES (1, 9, 'inbound', 'team@alpha.test', 'sales@gdhspack.com', ?, ?)`).run('2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z');
  readinessResult = { ok: true, hardFailures: [] };
  const existing = await preview.project({ version, allowed: true, reasons: [] });
  assert.deepStrictEqual(existing.duplicate, { ok: false, reasons: ['existing_relationship_requires_reply_route'] });
  assert.strictEqual(existing.allowed, false);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM matrix_stream_jobs').get().count, 0);
  db.close();
  console.log('matrix stream preview tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

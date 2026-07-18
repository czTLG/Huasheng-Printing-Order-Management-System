'use strict';

const assert = require('node:assert');
const Database = require('better-sqlite3');
const { scoreDraft } = require('../src/services/matrixStreamGate');

const base = {
  subject: '250g and 500g coffee pouch options for Alpha Coffee',
  bodyEn: 'Dear Alpha Coffee team,\nWe reviewed your 250g and 500g roasted coffee range. We would like to discuss high-barrier valve pouches with stable repeat printing. Could you share your current structure and annual volume?\nBest regards',
  bodyCn: '您好，我们查看了贵司250g和500g烘焙咖啡产品，希望沟通高阻隔带阀袋及稳定套色。请问当前材料结构和年用量？',
  recipient: {
    email: 'sales@alpha.test',
    sourceUrl: 'https://alpha.test/contact',
    verifiedAt: '2026-07-17T00:00:00Z',
    kind: 'public_company'
  },
  evidence: {
    company: 'Alpha Coffee',
    categories: ['coffee'],
    products: ['250g roasted coffee', '500g roasted coffee'],
    entryProduct: 'high-barrier valve pouch',
    supportedClaims: ['stable repeat printing'],
    evidenceIds: [11, 12]
  },
  now: '2026-07-18T00:00:00Z'
};

const good = scoreDraft(base);
assert.strictEqual(good.score, 100);
assert.strictEqual(good.passed, true);
assert.deepStrictEqual(Object.fromEntries(Object.entries(good.components).map(([key, value]) => [key, value.maximum])), {
  product_match: 20,
  company_specific: 15,
  entry_value: 15,
  questions: 15,
  subject: 10,
  bilingual_consistency: 10,
  readability: 10,
  recipient_provenance: 5
});
for (const component of Object.values(good.components)) assert.ok(Array.isArray(component.reasons));
assert.deepStrictEqual(good.components.product_match.evidence_ids, [11, 12]);
assert.deepStrictEqual(good.components.readability.evidence_ids, []);
assert.deepStrictEqual(good.components.recipient_provenance.evidence_ids, []);

const inconsistent = scoreDraft({
  ...base,
  bodyEn: 'Dear Alpha Coffee team,\nWe reviewed your 250g and 500g coffee range and can discuss pouches. Is anyone available?\nBest regards',
  bodyCn: '您好，我们查看了贵司1公斤茶叶产品，希望沟通普通纸盒。今天心情好吗？'
});
assert.ok(inconsistent.score < 80);
assert.strictEqual(inconsistent.passed, false);
assert.strictEqual(inconsistent.components.product_match.points, 0);
assert.strictEqual(inconsistent.components.entry_value.points, 0);
assert.strictEqual(inconsistent.components.questions.points, 0);
assert.strictEqual(inconsistent.components.bilingual_consistency.points, 0);

const staleProvenance = scoreDraft({
  ...base,
  recipient: { ...base.recipient, verifiedAt: '2025-01-01T00:00:00Z' }
});
assert.strictEqual(staleProvenance.passed, false);
assert.ok(staleProvenance.hardFailures.includes('invalid_recipient_provenance'));
const unrelatedProvenance = scoreDraft({
  ...base,
  recipient: { ...base.recipient, sourceUrl: 'https://unrelated.test/contact' }
});
assert.strictEqual(unrelatedProvenance.passed, false);
assert.ok(unrelatedProvenance.hardFailures.includes('invalid_recipient_provenance'));

const unsafe = scoreDraft({
  ...base,
  subject: 'Guaranteed lowest price',
  bodyEn: 'FDA approved. Final price is USD 0.05 with guaranteed lead time.'
});
assert.strictEqual(unsafe.passed, false);
assert.deepStrictEqual(unsafe.hardFailures.sort(), [
  'unsupported_certification',
  'unsupported_lead_time',
  'unsupported_price'
]);
const mismatchedEvidence = scoreDraft({
  ...base,
  bodyEn: [
    'FDA approved.',
    'Final price is USD 0.05 with guaranteed lead time.',
    'We are an authorized supplier with guaranteed barrier performance and guaranteed delivery.'
  ].join(' '),
  evidence: { ...base.evidence, supportedClaims: ['BRC certified', 'Final price is USD 0.50'] }
});
assert.deepStrictEqual(mismatchedEvidence.hardFailures.sort(), [
  'unsupported_certification', 'unsupported_delivery', 'unsupported_lead_time',
  'unsupported_performance', 'unsupported_price', 'unsupported_supplier'
]);
for (const [bodyEn, supportedClaim, expectedFailure] of [
  ['Lead time is 15 days.', 'Lead time is 10 days.', 'unsupported_lead_time'],
  ['Guaranteed shelf life 6 months.', 'Guaranteed shelf life 12 months.', 'unsupported_performance'],
  ['We are an authorized supplier for Brand A.', 'We are an authorized supplier for Brand B.', 'unsupported_supplier'],
  ['Fixed delivery July 20.', 'Fixed delivery July 30.', 'unsupported_delivery']
]) {
  const result = scoreDraft({ ...base, bodyEn, evidence: { ...base.evidence, supportedClaims: [supportedClaim] } });
  assert.ok(result.hardFailures.includes(expectedFailure), `${bodyEn} must require exact evidence`);
}

const { evaluateInitialContact } = require('../src/services/matrixStreamGate');
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, contact TEXT, active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE inquiries (id INTEGER PRIMARY KEY, customer_id INTEGER, created_at TEXT);
  CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_name TEXT NOT NULL, created_at TEXT);
  CREATE TABLE crm_messages (
    id INTEGER PRIMARY KEY, customer_id INTEGER, sender_contact TEXT, receiver_contact TEXT,
    direction TEXT NOT NULL, received_at TEXT NOT NULL, workflow_status TEXT NOT NULL DEFAULT 'pending'
  );
  CREATE TABLE matrix_stream_versions (
    id INTEGER PRIMARY KEY, recipient_email TEXT NOT NULL
  );
  CREATE TABLE matrix_stream_jobs (
    id INTEGER PRIMARY KEY, version_id INTEGER, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE matrix_stream_events (
    id INTEGER PRIMARY KEY, action TEXT NOT NULL, before_json TEXT NOT NULL DEFAULT '{}',
    after_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
  );
`);
db.prepare('INSERT INTO customers VALUES (1, ?, ?, 1)').run('Alpha Coffee', 'sales@alpha.test');
db.prepare('INSERT INTO customers VALUES (2, ?, ?, 1)').run('Acme Foods Limited', 'hello@acme-foods.example');
db.prepare('INSERT INTO orders VALUES (1, ?, ?)').run('Order Buyer', '2026-01-01T00:00:00Z');
db.prepare('INSERT INTO crm_messages VALUES (1, NULL, ?, ?, ?, ?, ?)').run(
  'operator@internal.test', 'new@cooling.test', 'outbound', '2026-06-01T00:00:00Z', 'complete'
);
db.prepare('INSERT INTO crm_messages VALUES (2, NULL, ?, ?, ?, ?, ?)').run(
  'reply@standalone.test', 'operator@internal.test', 'inbound', '2026-06-15T00:00:00Z', 'complete'
);
const insertAccepted = db.prepare('INSERT INTO matrix_stream_jobs VALUES (?, NULL, ?, ?, ?)');
for (let id = 1; id <= 5; id += 1) {
  insertAccepted.run(id, 'accepted', `2026-07-18T0${id}:00:00Z`, `2026-07-18T0${id}:00:00Z`);
}
db.prepare('INSERT INTO matrix_stream_versions VALUES (99, ?)').run('old@repeat.test');
db.prepare('INSERT INTO matrix_stream_jobs VALUES (99, 99, ?, ?, ?)').run('accepted', '2026-07-01T06:00:00Z', '2026-07-01T06:00:00Z');
db.prepare('INSERT INTO matrix_stream_events VALUES (1, ?, ?, ?, ?)').run(
  'suppressed', '{}', JSON.stringify({ email: 'blocked@suppressed.test', domain: 'suppressed.test' }), '2026-07-01T00:00:00Z'
);

assert.strictEqual(evaluateInitialContact(db, {
  email: ' SALES@ALPHA.TEST ', domain: 'alpha.test', companyName: 'Alpha Coffee', now: '2026-07-18T00:00:00Z'
}).route, 'existing_relationship');
assert.strictEqual(evaluateInitialContact(db, {
  email: 'buyer@order.test', domain: 'order.test', companyName: 'Order Buyer', now: '2026-07-18T00:00:00Z'
}).route, 'existing_relationship');
assert.strictEqual(evaluateInitialContact(db, {
  email: 'new@cooling.test', domain: 'cooling.test', companyName: 'Cooling Ltd', now: '2026-07-18T00:00:00Z'
}).reasons[0], 'domain_cooling_90_days');
assert.strictEqual(evaluateInitialContact(db, {
  email: 'reply@standalone.test', domain: 'standalone.test', companyName: 'Standalone Ltd', now: '2026-07-19T14:00:00+08:00'
}).route, 'existing_relationship');
assert.strictEqual(evaluateInitialContact(db, {
  email: 'new@repeat.test', domain: 'repeat.test', companyName: 'Repeat Ltd', now: '2026-07-19T14:00:00+08:00'
}).reasons[0], 'domain_cooling_90_days');
assert.strictEqual(evaluateInitialContact(db, {
  email: 'sixth@fresh.test', domain: 'fresh.test', companyName: 'Fresh Ltd', now: '2026-07-18T14:00:00+08:00'
}).reasons[0], 'daily_accepted_limit_5');
const possibleDuplicate = evaluateInitialContact(db, {
  email: 'new@other.example', domain: 'other.example', companyName: 'Acme Foods Ltd', now: '2026-07-19T14:00:00+08:00'
});
assert.strictEqual(possibleDuplicate.route, 'possible_duplicate_review');
assert.deepStrictEqual(possibleDuplicate.matchedCustomerIds, [2]);
assert.strictEqual(db.prepare('SELECT count(*) AS count FROM customers').get().count, 2);
assert.strictEqual(evaluateInitialContact(db, {
  email: 'blocked@suppressed.test', domain: 'suppressed.test', companyName: 'Suppressed Ltd', now: '2026-07-19T14:00:00+08:00'
}).route, 'blocked');
db.close();

const incompleteDb = new Database(':memory:');
incompleteDb.exec('CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, contact TEXT, active INTEGER)');
assert.deepStrictEqual(evaluateInitialContact(incompleteDb, {
  email: 'new@missing.test', domain: 'missing.test', companyName: 'Missing Ltd', now: '2026-07-19T14:00:00+08:00'
}), { allowed: false, route: 'blocked', reasons: ['identity_check_failed'], matchedCustomerIds: [] });
incompleteDb.close();

const { createMatrixStreamReadiness } = require('../src/services/matrixStreamReadiness');
const { thirdWeekdayAtTen, scheduleReplyCheck, closeReplyCheck } = require('../src/services/matrixStreamFollowup');

assert.strictEqual(thirdWeekdayAtTen('2026-07-17T14:00:00+08:00'), '2026-07-22T10:00:00+08:00');
assert.strictEqual(thirdWeekdayAtTen('2026-07-18T14:00:00+08:00'), '2026-07-22T10:00:00+08:00');

const followupDb = new Database(':memory:');
followupDb.exec(`
  CREATE TABLE matrix_work_items (
    id INTEGER PRIMARY KEY, next_action TEXT NOT NULL DEFAULT '', next_followup_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE matrix_stream_jobs (
    id INTEGER PRIMARY KEY, work_item_id INTEGER NOT NULL, state TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE matrix_stream_reply_checks (
    id INTEGER PRIMARY KEY, work_item_id INTEGER NOT NULL, originating_job_id INTEGER NOT NULL UNIQUE,
    purpose TEXT NOT NULL, channel TEXT NOT NULL, priority TEXT NOT NULL,
    due_at TEXT, state TEXT NOT NULL, terminal_reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, closed_at TEXT
  );
`);
followupDb.prepare('INSERT INTO matrix_work_items VALUES (1, ?, NULL, ?)').run('', '2026-07-17T06:00:00.000Z');
followupDb.prepare('INSERT INTO matrix_stream_jobs VALUES (11, 1, ?, ?)').run('accepted', '2026-07-17T06:00:00.000Z');
followupDb.prepare('INSERT INTO matrix_stream_jobs VALUES (12, 1, ?, ?)').run('pending', '2026-07-17T06:00:00.000Z');
followupDb.prepare('INSERT INTO matrix_stream_jobs VALUES (13, 1, ?, ?)').run('accepted', '2026-07-20T06:00:00.000Z');
const scheduled = scheduleReplyCheck(followupDb, { jobId: 11, channel: 'email', priority: 'normal' });
assert.deepStrictEqual({
  work_item_id: scheduled.work_item_id,
  originating_job_id: scheduled.originating_job_id,
  purpose: scheduled.purpose,
  channel: scheduled.channel,
  priority: scheduled.priority,
  due_at: scheduled.due_at
}, {
  work_item_id: 1, originating_job_id: 11, purpose: 'reply_check', channel: 'email', priority: 'normal',
  due_at: '2026-07-22T10:00:00+08:00'
});
assert.strictEqual(scheduleReplyCheck(followupDb, { jobId: 11, channel: 'email', priority: 'urgent' }).id, scheduled.id);
assert.strictEqual(followupDb.prepare('SELECT count(*) AS count FROM matrix_stream_reply_checks').get().count, 1);
assert.strictEqual(followupDb.prepare('SELECT next_followup_at FROM matrix_work_items WHERE id = 1').get().next_followup_at, scheduled.due_at);
assert.throws(() => scheduleReplyCheck(followupDb, { jobId: 12, channel: 'email' }), /accepted/);
const competing = scheduleReplyCheck(followupDb, { jobId: 13, channel: 'email', priority: 'normal' });
assert.strictEqual(competing.due_at, '2026-07-23T10:00:00+08:00');
assert.strictEqual(followupDb.prepare('SELECT next_followup_at FROM matrix_work_items WHERE id = 1').get().next_followup_at, scheduled.due_at);
const closed = closeReplyCheck(followupDb, { jobId: 11, reason: 'reply', closedAt: '2026-07-19T00:00:00.000Z' });
assert.strictEqual(closed.state, 'closed');
assert.strictEqual(closed.terminal_reason, 'reply');
assert.strictEqual(closed.due_at, null);
assert.deepStrictEqual(followupDb.prepare('SELECT next_action, next_followup_at FROM matrix_work_items WHERE id = 1').get(), {
  next_action: 'reply_check', next_followup_at: competing.due_at
});
assert.throws(() => closeReplyCheck(followupDb, { jobId: 11, reason: 'sent_again' }), /terminal reason/);
assert.strictEqual(scheduleReplyCheck(followupDb, { jobId: 11, channel: 'email' }).state, 'closed');
closeReplyCheck(followupDb, { jobId: 13, reason: 'manual_stop', closedAt: '2026-07-20T08:00:00.000Z' });
assert.deepStrictEqual(followupDb.prepare('SELECT next_action, next_followup_at FROM matrix_work_items WHERE id = 1').get(), {
  next_action: '', next_followup_at: null
});
followupDb.close();

(async () => {
  const readinessDb = new Database(':memory:');
  readinessDb.exec(`
    CREATE TABLE matrix_stream_sender_checks (
      id INTEGER PRIMARY KEY, sender_domain TEXT NOT NULL, checked_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      spf_ok INTEGER NOT NULL, dkim_ok INTEGER NOT NULL, dmarc_ok INTEGER NOT NULL,
      tls_ok INTEGER NOT NULL, smtp_ok INTEGER NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(sender_domain, checked_at)
    );
    CREATE TABLE matrix_stream_country_policies (
      country_code TEXT NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL,
      sender_identity_required INTEGER NOT NULL, opt_out_required INTEGER NOT NULL,
      reviewed_by INTEGER NOT NULL, reviewed_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      source_urls_json TEXT NOT NULL, PRIMARY KEY(country_code, channel)
    );
  `);
  readinessDb.prepare(`
    INSERT INTO matrix_stream_country_policies VALUES ('US', 'email', 'approved', 1, 1, 1, ?, ?, ?)
  `).run('2026-07-17T00:00:00.000Z', '2026-08-17T00:00:00.000Z', '["https://authority.example/policy"]');
  let txtCalls = 0;
  let transportCalls = 0;
  const readiness = createMatrixStreamReadiness({
    clock: () => new Date('2026-07-18T00:00:00Z'),
    resolveTxt: async name => {
      txtCalls += 1;
      return ({
        'sender.test': ['v=spf1 include:mail.test -all'],
        'selector._domainkey.sender.test': ['v=DKIM1; p=abc'],
        '_dmarc.sender.test': ['v=DMARC1; p=none']
      })[name] || [];
    },
    verifyTransport: async () => {
      transportCalls += 1;
      return { tls: true, smtp: true };
    }
  });
  const readyInput = { db: readinessDb, domain: 'sender.test', selector: 'selector', countryCode: 'US', channel: 'email' };
  assert.deepStrictEqual((await readiness.check(readyInput)).hardFailures, []);
  assert.strictEqual((await readiness.check(readyInput)).ok, true);
  assert.strictEqual(txtCalls, 3);
  assert.strictEqual(transportCalls, 1);
  assert.strictEqual(readinessDb.prepare('SELECT count(*) AS count FROM matrix_stream_sender_checks').get().count, 1);
  readinessDb.prepare("UPDATE matrix_stream_country_policies SET source_urls_json = '[\"http://invalid.example/policy\"]'").run();
  assert.deepStrictEqual((await readiness.check(readyInput)).hardFailures, ['country_channel_policy_not_approved']);
  readinessDb.prepare(`
    UPDATE matrix_stream_country_policies
    SET source_urls_json = '["https://authority.example/policy"]', sender_identity_required = 0
  `).run();
  assert.deepStrictEqual((await readiness.check(readyInput)).hardFailures, ['country_channel_policy_not_approved']);
  readinessDb.prepare('UPDATE matrix_stream_country_policies SET sender_identity_required = 1').run();

  const notReady = createMatrixStreamReadiness({
    clock: () => new Date('2026-07-18T00:00:00Z'),
    resolveTxt: async () => [],
    verifyTransport: async () => ({ tls: false, smtp: false })
  });
  const missing = await notReady.check({ db: readinessDb, domain: 'other.test', selector: '', countryCode: 'CA', channel: 'email' });
  assert.strictEqual(missing.ok, false);
  assert.deepStrictEqual(missing.hardFailures.sort(), [
    'country_channel_policy_not_approved', 'missing_dkim', 'missing_dmarc', 'missing_selector',
    'missing_smtp_verification', 'missing_spf', 'missing_tls'
  ]);
  readinessDb.prepare("UPDATE matrix_stream_country_policies SET expires_at = '2026-07-17T00:00:00.000Z'").run();
  assert.deepStrictEqual((await readiness.check(readyInput)).hardFailures, ['country_channel_policy_not_approved']);
  readinessDb.close();
  process.stdout.write('matrix stream gate tests passed\n');
})().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

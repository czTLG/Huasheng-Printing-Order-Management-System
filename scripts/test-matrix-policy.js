'use strict';

const assert = require('node:assert');
const Database = require('better-sqlite3');
const { parseArgs, setPolicy, listPolicies } = require('./matrix-policy');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
    role TEXT NOT NULL, status TEXT NOT NULL
  );
  CREATE TABLE matrix_stream_country_policies (
    country_code TEXT NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL,
    sender_identity_required INTEGER NOT NULL DEFAULT 1, opt_out_required INTEGER NOT NULL DEFAULT 1,
    reviewed_by INTEGER NOT NULL, reviewed_at TEXT NOT NULL, expires_at TEXT NOT NULL,
    source_urls_json TEXT NOT NULL, PRIMARY KEY(country_code, channel)
  );
  CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY, role TEXT NOT NULL, user_name TEXT NOT NULL, action TEXT NOT NULL,
    resource_type TEXT NOT NULL, resource_id TEXT, detail TEXT, created_at TEXT NOT NULL
  );
`);
db.prepare('INSERT INTO users VALUES (1, ?, ?, ?, ?)').run('root', 'secret-hash', 'super_admin', 'active');
db.prepare('INSERT INTO users VALUES (2, ?, ?, ?, ?)').run('worker', 'worker-secret', 'worker', 'active');
const policy = {
  actor: 'root', country: 'US', channel: 'email', status: 'approved',
  reviewedAt: '2026-07-18T00:00:00.000Z', expiresAt: '2026-08-18T00:00:00.000Z',
  sourceUrls: ['https://authority.example/rules']
};
assert.throws(() => setPolicy(db, { ...policy, actor: 'missing' }), /active super_admin/);
assert.throws(() => setPolicy(db, { ...policy, actor: 'worker' }), /active super_admin/);
assert.throws(() => setPolicy(db, { ...policy, country: '*' }), /ISO country/);
assert.throws(() => setPolicy(db, { ...policy, country: 'ZZ' }), /ISO country/);
assert.throws(() => setPolicy(db, { ...policy, channel: 'sms' }), /channel/);
assert.throws(() => setPolicy(db, { ...policy, sourceUrls: [] }), /source URL/);
assert.throws(() => setPolicy(db, { ...policy, expiresAt: policy.reviewedAt }), /expiry/);
const operationAt = '2026-07-18T12:34:56.000Z';
const saved = setPolicy(db, policy, { clock: () => new Date(operationAt) });
assert.strictEqual(saved.country_code, 'US');
assert.strictEqual(saved.status, 'approved');
assert.deepStrictEqual(listPolicies(db, { country: 'US', channel: 'email' }).map(row => row.status), ['approved']);
const audit = db.prepare('SELECT * FROM audit_logs').get();
assert.strictEqual(audit.action, 'matrix_policy_set');
assert.strictEqual(audit.created_at, operationAt);
assert.notStrictEqual(audit.created_at, policy.reviewedAt);
assert.ok(!audit.detail.includes('authority.example'));
assert.ok(!audit.detail.includes('secret'));
assert.deepStrictEqual(JSON.parse(audit.detail), {
  country_code: 'US', channel: 'email', status: 'approved',
  reviewed_at: policy.reviewedAt, expires_at: policy.expiresAt, source_count: 1
});
assert.deepStrictEqual(parseArgs(['list', '--country', 'US', '--channel', 'email']), {
  command: 'list', country: 'US', channel: 'email'
});
assert.throws(() => parseArgs(['set', '--actor', 'root', '--country', '*', '--channel', 'email']), /ISO country/);
assert.throws(() => parseArgs(['set', '--actor', 'root', '--country', 'ZZ', '--channel', 'email']), /ISO country/);
assert.throws(() => parseArgs(['remove']), /command/);
db.close();
process.stdout.write('matrix policy tests passed\n');

'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-identity-'));
process.env.DB_PATH = path.join(root, 'app.db');

const { db, initDb } = require('../src/db');
const { createMatrixIdentity } = require('../src/services/matrixIdentity');
const fixture = require('./fixtures/matrix-core/entity-crosswalk.json');

const NOW = '2026-07-18T06:00:00.000Z';
const actorUserId = 9101;
const reviewCalls = [];
const taskSupervisor = {
  createReviewTask(input) {
    reviewCalls.push(structuredClone(input));
    return { taskId: `review-${reviewCalls.length}`, status: 'review_required' };
  }
};

initDb();
db.prepare(`
  INSERT INTO users (id, username, password, role, status, created_at)
  VALUES (?, 'matrix-identity-test', 'test-only', 'manager', 'active', ?)
`).run(actorUserId, NOW);

const identity = createMatrixIdentity({
  db,
  clock: () => new Date(NOW),
  taskSupervisor
});

function link(overrides = {}) {
  return identity.linkExact({
    entityType: 'atlas_candidate',
    entityId: 'atlas-default',
    namespace: 'organization_domain',
    externalKey: 'default.example',
    matchMethod: 'exact_domain',
    evidence: { source: 'official_site', observedAt: NOW },
    actorUserId,
    idempotencyKey: `link-${crypto.randomUUID()}`,
    ...overrides
  });
}

assert(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='matrix_entity_links'").get(), 'matrix_entity_links missing');

for (const [index, matchMethod] of [
  'exact_domain',
  'verified_email_domain',
  'legal_id',
  'lei',
  'confirmed_alias'
].entries()) {
  const result = link({
    entityId: `allow-${index}`,
    namespace: `allow_${index}`,
    externalKey: `Exact-Key-${index}`,
    matchMethod,
    evidence: { source: 'confirmed_source', verified: matchMethod === 'verified_email_domain' }
  });
  assert.strictEqual(result.status, 'linked', `${matchMethod} must link automatically`);
  assert.strictEqual(result.matchMethod, matchMethod);
  assert.match(result.externalKeyHash, /^[a-f0-9]{64}$/);
  assert.deepStrictEqual(
    identity.resolve({ namespace: `ALLOW_${index}`, externalKey: ` exact-key-${index} ` }).map(item => item.entityId),
    [`allow-${index}`]
  );
}

const beforeAmbiguous = db.prepare('SELECT COUNT(*) AS count FROM matrix_entity_links').get().count;
const ambiguous = identity.proposeAmbiguous({
  candidates: [
    { method: 'caller_scored_match', entityType: 'crm_customer', entityId: 'candidate-1' },
    { method: 'approximate_name', entityType: 'crm_customer', entityId: 'candidate-2' },
    { method: 'approximate_address', entityType: 'crm_customer', entityId: 'candidate-3' },
    { method: 'unverified_email', entityType: 'crm_customer', entityId: 'candidate-4' }
  ],
  sourceEventId: 'source-event-1',
  actorUserId,
  idempotencyKey: 'review-ambiguous-1'
});
assert.strictEqual(ambiguous.status, 'review_required');
assert.strictEqual(reviewCalls.length, 1, 'all ambiguous candidates must produce one review task');
assert.strictEqual(reviewCalls[0].candidates.length, 4);
assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM matrix_entity_links').get().count, beforeAmbiguous, 'ambiguous candidates must never merge');

const invalidMethod = link({
  entityId: 'invalid-method',
  externalKey: 'similar-name',
  matchMethod: 'caller_supplied_score',
  idempotencyKey: 'invalid-method-1'
});
assert.strictEqual(invalidMethod.status, 'review_required');
assert.strictEqual(reviewCalls.length, 2);
assert.strictEqual(identity.resolve({ namespace: 'organization_domain', externalKey: 'similar-name' }).length, 0);

const unverified = link({
  entityId: 'unverified-email',
  externalKey: 'unverified.example',
  matchMethod: 'verified_email_domain',
  evidence: { source: 'email_header', verified: false },
  idempotencyKey: 'unverified-email-1'
});
assert.strictEqual(unverified.status, 'review_required');
assert.strictEqual(reviewCalls.length, 3);
assert.strictEqual(identity.resolve({ namespace: 'organization_domain', externalKey: 'unverified.example' }).length, 0);

for (const [index, item] of fixture.links.entries()) {
  link({
    entityType: item.entityType,
    entityId: item.entityId,
    namespace: fixture.namespace,
    externalKey: fixture.externalKey,
    matchMethod: fixture.matchMethod,
    evidence: { source: item.source, confirmedOrganizationLink: true },
    idempotencyKey: `fixture-${index}`
  });
}
const fixtureResolution = identity.resolve({ namespace: fixture.namespace, externalKey: fixture.externalKey });
const resolvedTargets = fixtureResolution.map(item => `${item.entityType}:${item.entityId}`).sort();
assert.deepStrictEqual(resolvedTargets, [...fixture.suppressionTargets].sort(), 'suppression must follow the confirmed organization link');
assert.deepStrictEqual(resolvedTargets, [...fixture.revocationTargets].sort(), 'revocation must follow the confirmed organization link');

const rawKey = 'Never-Store-This-Key.Example';
const immutable = link({
  entityId: 'immutable-evidence',
  externalKey: rawKey,
  evidence: { source: 'registry', recordId: 'registry-44' },
  idempotencyKey: 'immutable-link-1'
});
const stored = db.prepare('SELECT * FROM matrix_entity_links WHERE id = ?').get(immutable.id);
assert.strictEqual(stored.external_key_hash, crypto.createHash('sha256').update('organization_domain\0never-store-this-key.example').digest('hex'));
assert.ok(!JSON.stringify(stored).toLowerCase().includes(rawKey.toLowerCase()), 'raw external key must not be stored');
assert.throws(() => db.prepare("UPDATE matrix_entity_links SET evidence_json='{}' WHERE id=?").run(immutable.id), /immutable/i);
assert.throws(() => db.prepare('DELETE FROM matrix_entity_links WHERE id=?').run(immutable.id), /immutable/i);

const replay = link({
  entityId: 'immutable-evidence',
  externalKey: rawKey,
  evidence: { source: 'registry', recordId: 'registry-44' },
  idempotencyKey: 'immutable-link-1'
});
assert.deepStrictEqual(replay, immutable, 'identical idempotent replay must be stable');
assert.throws(() => link({
  entityId: 'different-entity',
  externalKey: rawKey,
  evidence: { source: 'registry', recordId: 'registry-44' },
  idempotencyKey: 'immutable-link-1'
}), /idempotency conflict/i);

db.close();
fs.rmSync(root, { recursive: true, force: true });
console.log('PASS matrix identity exact crosswalk');

'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openMatrixAtlas } = require('../src/lib/matrixAtlasDb');
const {
  createMatrixAtlasRegistry,
  validateSourceDefinition: productionValidateSourceDefinition
} = require('../src/services/matrixAtlasRegistry');

const NOW = '2026-07-18T01:00:00Z';
const registry = createMatrixAtlasRegistry({ clock: () => Date.parse(NOW) });
const { validateSourceDefinition, registerSources, authorizeFetch } = registry;
const source = {
  code: 'source-fixture',
  publisher: 'Registry Test Fixture',
  landing_url: 'https://www.registry.test/',
  source_class: 'P0',
  countries: ['TH'],
  allowed_origins: ['https://www.registry.test'],
  policy_origins: ['https://www.registry.test'],
  allowed_paths: ['/fair-content/'],
  disallowed_paths: ['/login', '/account', '/fair-content/private'],
  auth_mode: 'none',
  min_interval_ms: 5000,
  concurrency: 1,
  daily_budget: 150,
  cache_ttl_seconds: 86400,
  robots_url: 'https://www.registry.test/robots.txt',
  robots_sha256: 'a'.repeat(64),
  policy_url: 'https://www.registry.test/terms',
  policy_sha256: 'b'.repeat(64),
  policy_scope: 'site_access_terms',
  policy_authoritative: true,
  robots_reviewed_at: '2026-07-18T00:00:00Z',
  observed_at: '2026-07-18T00:00:00Z',
  policy_expires_at: '2026-10-18T00:00:00Z',
  activation_reviewer: 'registry-policy-reviewer',
  activation_reviewed_at: '2026-07-18T00:30:00Z',
  parser_version: '1',
  license_note: 'public official directory',
  status: 'active'
};

function rejected(change, pattern) {
  assert.throws(() => validateSourceDefinition({ ...source, ...change }), pattern);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-atlas-registry-'));
const dbPath = path.join(root, 'atlas.db');
const previousDbPath = process.env.DB_PATH;
process.env.DB_PATH = path.join(root, 'main.db');

let store;
try {
  assert.strictEqual(validateSourceDefinition(source).code, 'source-fixture');
  const productionNow = Date.now();
  const expiredForProduction = {
    ...source,
    robots_reviewed_at: new Date(productionNow - 86_400_000 * 2).toISOString(),
    observed_at: new Date(productionNow - 86_400_000 * 2).toISOString(),
    policy_expires_at: new Date(productionNow - 86_400_000).toISOString()
  };
  assert.throws(
    () => productionValidateSourceDefinition(expiredForProduction, '2000-01-01T00:00:00Z'),
    /expired/i,
    'production validation must not trust a caller-supplied historical time'
  );
  rejected({ min_interval_ms: 0 }, /interval/i);
  rejected({ concurrency: 3 }, /concurrency/i);
  rejected({ publisher: '' }, /publisher/i);
  rejected({ license_note: '' }, /license/i);
  rejected({ surprise: true }, /unknown field/i);
  rejected({ allowed_origins: ['http://www.registry.test'] }, /HTTPS/i);
  rejected({ allowed_origins: ['https://*.registry.test'] }, /wildcard/i);
  rejected({ policy_origins: ['http://www.registry.test'] }, /policy_origins.*HTTPS/i);
  rejected({ policy_origins: ['https://*.registry.test'] }, /policy_origins.*wildcard/i);
  rejected({ countries: ['ZZ'] }, /approved countr/i);
  rejected({ countries: ['CN'] }, /country CN/i);
  rejected({ countries: ['IN'] }, /country IN/i);
  rejected({ countries: ['DE'] }, /European.*paused/i);
  rejected({ auth_mode: 'user_login' }, /login authentication/i);
  rejected({ policy_expires_at: NOW }, /expired/i);
  rejected({ robots_url: 'http://www.registry.test/robots.txt' }, /robots_url.*HTTPS/i);
  rejected({ robots_url: 'https://example.com/robots.txt' }, /robots_url.*origin/i);
  rejected({ policy_url: 'https://example.com/terms' }, /policy_url.*origin/i);
  rejected({ policy_origins: ['https://policy.registry.test'] }, /robots_url.*policy_origins/i);
  rejected({ robots_sha256: 'not-a-digest' }, /robots_sha256.*SHA-256/i);
  rejected({ policy_sha256: 'not-a-digest' }, /policy_sha256.*SHA-256/i);
  rejected({ observed_at: '2025-01-01T00:00:00Z' }, /current/i);
  rejected({ policy_scope: 'event_manual' }, /activation.*scope/i);
  rejected({ policy_authoritative: false }, /activation.*authoritative/i);
  rejected({ activation_reviewer: null }, /activation.*reviewer/i);
  rejected({ activation_reviewed_at: null }, /activation.*review time/i);
  rejected({ activation_reviewed_at: '2026-07-18T01:30:00Z' }, /activation.*future/i);
  rejected({ activation_reviewed_at: '2026-07-17T23:59:00Z' }, /activation.*policy observation/i);
  assert.strictEqual(validateSourceDefinition({
    ...source,
    status: 'paused',
    policy_scope: 'event_manual',
    policy_authoritative: false,
    activation_reviewer: null,
    activation_reviewed_at: null
  }).status, 'paused');
  const missingPolicy = { ...source };
  delete missingPolicy.policy_url;
  assert.throws(() => validateSourceDefinition(missingPolicy), /policy_url.*required/i);

  store = openMatrixAtlas({ dbPath });
  store.init();

  assert.throws(() => registerSources(store.db, [source], { userName: 'registry-test', now: NOW }), /unknown actor field/i);
  assert.strictEqual(store.db.prepare('SELECT COUNT(*) AS count FROM atlas_sources').get().count, 0);

  const registration = registerSources(store.db, [source], { userName: 'registry-test' });
  assert.strictEqual(registration.length, 1);
  assert.match(registration[0].checksum, /^[a-f0-9]{64}$/);

  const saved = store.db.prepare('SELECT * FROM atlas_sources WHERE code = ?').get(source.code);
  assert.strictEqual(saved.publisher, source.publisher);
  assert.strictEqual(saved.landing_url, source.landing_url);
  const storedEnvelope = JSON.parse(saved.license_note);
  assert.strictEqual(storedEnvelope.version, 1);
  assert.strictEqual(storedEnvelope.definition_checksum, registration[0].checksum);
  assert.strictEqual(storedEnvelope.evidence.license_note, source.license_note);
  assert.strictEqual(JSON.stringify(storedEnvelope), saved.license_note, 'source evidence envelope must be canonical JSON');

  const tamperedEnvelope = {
    ...storedEnvelope,
    evidence: { ...storedEnvelope.evidence, robots_sha256: '0'.repeat(64) }
  };
  store.db.prepare('UPDATE atlas_sources SET license_note = ? WHERE id = ?')
    .run(JSON.stringify(tamperedEnvelope), saved.id);
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.registry.test/fair-content/list',
    countryCode: 'TH'
  }), /envelope|checksum|audit/i);
  store.db.prepare('UPDATE atlas_sources SET license_note = ? WHERE id = ?')
    .run(saved.license_note, saved.id);

  const createdEvent = store.db.prepare('SELECT * FROM atlas_events WHERE entity_type = ? AND entity_id = ?').get('source', saved.id);
  assert.deepStrictEqual(JSON.parse(createdEvent.before_json), {});
  assert.strictEqual(JSON.parse(createdEvent.after_json).checksum, registration[0].checksum);
  assert.strictEqual(JSON.parse(createdEvent.after_json).robots_url, source.robots_url);
  assert.strictEqual(JSON.parse(createdEvent.after_json).robots_sha256, source.robots_sha256);
  assert.strictEqual(JSON.parse(createdEvent.after_json).policy_url, source.policy_url);
  assert.strictEqual(JSON.parse(createdEvent.after_json).policy_sha256, source.policy_sha256);
  assert.strictEqual(JSON.parse(createdEvent.after_json).observed_at, source.observed_at);
  assert.match(createdEvent.reason, /registry-test/);

  const { checksum: _createdChecksum, ...createdDefinition } = JSON.parse(createdEvent.after_json);
  const selfConsistentTamperedDefinition = { ...createdDefinition, robots_sha256: '1'.repeat(64) };
  const selfConsistentTamperedChecksum = crypto.createHash('sha256')
    .update(JSON.stringify(selfConsistentTamperedDefinition)).digest('hex');
  const selfConsistentTamperedEnvelope = {
    ...storedEnvelope,
    definition_checksum: selfConsistentTamperedChecksum,
    evidence: { ...storedEnvelope.evidence, robots_sha256: '1'.repeat(64) }
  };
  store.db.prepare('UPDATE atlas_sources SET license_note = ? WHERE id = ?')
    .run(JSON.stringify(selfConsistentTamperedEnvelope), saved.id);
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.registry.test/fair-content/list',
    countryCode: 'TH'
  }), /audited definition/i);
  store.db.prepare('UPDATE atlas_sources SET license_note = ? WHERE id = ?')
    .run(saved.license_note, saved.id);

  const updatedSource = { ...source, license_note: 'public official directory; reviewed terms' };
  const update = registerSources(store.db, [updatedSource], { userName: 'registry-review' })[0];
  assert.notStrictEqual(update.checksum, registration[0].checksum);
  const updatedEvent = store.db.prepare('SELECT * FROM atlas_events WHERE entity_type = ? ORDER BY id DESC LIMIT 1').get('source');
  assert.strictEqual(JSON.parse(updatedEvent.before_json).license_note, source.license_note);
  assert.strictEqual(JSON.parse(updatedEvent.after_json).license_note, updatedSource.license_note);

  const authorization = authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://WWW.Registry.Test:443/fair-content/../fair-content/list?q=food#top',
    countryCode: 'TH'
  });
  assert.strictEqual(authorization.canonicalUrl, 'https://www.registry.test/fair-content/list?q=food');
  assert.strictEqual(authorization.source.code, source.code);

  assert.strictEqual(authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.registry.test/fair-content',
    countryCode: 'TH'
  }).canonicalUrl, 'https://www.registry.test/fair-content');

  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.registry.test/login',
    countryCode: 'TH'
  }), /disallowed/i);
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.registry.test.example/fair-content/list',
    countryCode: 'TH'
  }), /origin/i);
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.registry.test/fair-contentious',
    countryCode: 'TH'
  }), /allowed path/i);
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.registry.test/fair-content/private',
    countryCode: 'TH'
  }), /disallowed/i);
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.registry.test/fair-content/private/record',
    countryCode: 'TH'
  }), /disallowed/i);
  assert.strictEqual(authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.registry.test/fair-content/privateer',
    countryCode: 'TH'
  }).canonicalUrl, 'https://www.registry.test/fair-content/privateer');
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.registry.test/fair-content/list',
    countryCode: 'MY'
  }), /country/i);
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.registry.test/fair-content/list',
    countryCode: 'TH',
    now: NOW
  }), /unknown authorization field/i);

  const definitions = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/matrix-atlas-sources.json'), 'utf8'));
  assert.deepStrictEqual(definitions.map(({ code }) => code).sort(), ['source-mt', 'source-tx']);
  const reviewedEvidence = {
    'source-mt': {
      robots_sha256: 'f1a6b5e3f6e69a71c53516c4bce70e2414429d23dab6814239500999eb80907e',
      policy_sha256: '120898cc34fa43f8e5ad96d189ba2ad2c44b63553fbbd666fa0fb2b4df6bef85'
    },
    'source-tx': {
      robots_sha256: '842b34303164ead41bccb7c05d1707422e98d108753b397b6dcc19683eb02101',
      policy_sha256: 'f29743c01f39f60f610feba9de8d7171e8fec78a990b17906bd4d01092c427ab'
    }
  };
  for (const definition of definitions) {
    validateSourceDefinition(definition);
    assert.strictEqual(definition.status, 'paused', `${definition.code} must remain behind the human approval boundary`);
    assert.strictEqual(definition.robots_sha256, reviewedEvidence[definition.code].robots_sha256);
    assert.strictEqual(definition.policy_sha256, reviewedEvidence[definition.code].policy_sha256);
    const serialized = JSON.stringify(definition).toLowerCase();
    assert(!/(password|credential|secret|token|api_key)/.test(serialized), `${definition.code} must contain no credentials`);
  }
  const txDefinition = definitions.find(({ code }) => code === 'source-tx');
  assert.strictEqual(txDefinition.policy_scope, 'event_manual');
  assert.strictEqual(txDefinition.policy_authoritative, false);
  assert.strictEqual(txDefinition.activation_reviewer, null);
  assert.strictEqual(txDefinition.activation_reviewed_at, null);
  registerSources(store.db, definitions, { userName: 'seed-review' });
  assert.strictEqual(store.db.prepare("SELECT COUNT(*) AS count FROM atlas_sources WHERE status = 'paused'").get().count, 2);
  const txEnvelope = JSON.parse(store.db.prepare('SELECT license_note FROM atlas_sources WHERE code = ?').get('source-tx').license_note);
  assert.deepStrictEqual(txEnvelope.evidence.policy_origins, ['https://www.thaitradefair.com']);
  assert.strictEqual(txEnvelope.evidence.policy_scope, 'event_manual');
  assert.strictEqual(txEnvelope.evidence.policy_authoritative, false);
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: 'source-mt',
    url: 'https://www.matrade.gov.my/en/source-from-malaysia/directories/malaysia-products-directory',
    countryCode: 'MY'
  }), /not active/i);

  const eventTamperSource = { ...source, code: 'source-event-tamper' };
  const eventTamperRegistration = registerSources(store.db, [eventTamperSource], { userName: 'tamper-fixture' })[0];
  const eventTamperRow = store.db.prepare('SELECT * FROM atlas_sources WHERE id = ?').get(eventTamperRegistration.id);
  const eventTamperOriginal = JSON.parse(store.db.prepare(`
    SELECT after_json FROM atlas_events
    WHERE entity_type = 'source' AND entity_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(eventTamperRow.id).after_json);
  store.db.prepare(`
    INSERT INTO atlas_events (
      action, entity_type, entity_id, before_json, after_json,
      reason, idempotency_key, created_at
    ) VALUES ('source_updated', 'source', ?, '{}', ?, 'tamper fixture', ?, ?)
  `).run(
    eventTamperRow.id,
    JSON.stringify({ ...eventTamperOriginal, checksum: '0'.repeat(64) }),
    'source-event-tamper-invalid-checksum',
    NOW
  );
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: eventTamperSource.code,
    url: 'https://www.registry.test/fair-content/list',
    countryCode: 'TH'
  }), /audit checksum/i);

  const { checksum: _eventChecksum, ...eventTamperDefinition } = eventTamperOriginal;
  const mismatchedEventDefinition = { ...eventTamperDefinition, policy_sha256: '2'.repeat(64) };
  const mismatchedEventChecksum = crypto.createHash('sha256')
    .update(JSON.stringify(mismatchedEventDefinition)).digest('hex');
  store.db.prepare(`
    INSERT INTO atlas_events (
      action, entity_type, entity_id, before_json, after_json,
      reason, idempotency_key, created_at
    ) VALUES ('source_updated', 'source', ?, '{}', ?, 'tamper fixture', ?, ?)
  `).run(
    eventTamperRow.id,
    JSON.stringify({ ...mismatchedEventDefinition, checksum: mismatchedEventChecksum }),
    'source-event-tamper-valid-checksum',
    NOW
  );
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: eventTamperSource.code,
    url: 'https://www.registry.test/fair-content/list',
    countryCode: 'TH'
  }), /audited definition/i);

  assert.strictEqual(store.db.pragma('integrity_check', { simple: true }), 'ok');
  console.log('matrix atlas registry tests passed');
} finally {
  if (store) store.close();
  if (previousDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previousDbPath;
  fs.rmSync(root, { recursive: true, force: true });
}

'use strict';

const assert = require('node:assert');
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
  code: 'source-tx',
  publisher: 'Department of International Trade Promotion',
  landing_url: 'https://www.thaitradefair.com/',
  source_class: 'P0',
  countries: ['TH'],
  allowed_origins: ['https://www.thaitradefair.com'],
  allowed_paths: ['/fair-content/'],
  disallowed_paths: ['/login', '/account', '/fair-content/private'],
  auth_mode: 'none',
  min_interval_ms: 5000,
  concurrency: 1,
  daily_budget: 150,
  cache_ttl_seconds: 86400,
  robots_url: 'https://www.thaitradefair.com/robots.txt',
  robots_sha256: 'a'.repeat(64),
  policy_url: 'https://www.thaitradefair.com/terms',
  policy_sha256: 'b'.repeat(64),
  robots_reviewed_at: '2026-07-18T00:00:00Z',
  observed_at: '2026-07-18T00:00:00Z',
  policy_expires_at: '2026-10-18T00:00:00Z',
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
  assert.strictEqual(validateSourceDefinition(source).code, 'source-tx');
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
  rejected({ allowed_origins: ['http://www.thaitradefair.com'] }, /HTTPS/i);
  rejected({ allowed_origins: ['https://*.thaitradefair.com'] }, /wildcard/i);
  rejected({ countries: ['ZZ'] }, /approved countr/i);
  rejected({ countries: ['CN'] }, /country CN/i);
  rejected({ countries: ['IN'] }, /country IN/i);
  rejected({ countries: ['DE'] }, /European.*paused/i);
  rejected({ auth_mode: 'user_login' }, /login authentication/i);
  rejected({ policy_expires_at: NOW }, /expired/i);
  rejected({ robots_url: 'http://www.thaitradefair.com/robots.txt' }, /robots_url.*HTTPS/i);
  rejected({ robots_url: 'https://example.com/robots.txt' }, /robots_url.*origin/i);
  rejected({ policy_url: 'https://example.com/terms' }, /policy_url.*origin/i);
  rejected({ robots_sha256: 'not-a-digest' }, /robots_sha256.*SHA-256/i);
  rejected({ policy_sha256: 'not-a-digest' }, /policy_sha256.*SHA-256/i);
  rejected({ observed_at: '2025-01-01T00:00:00Z' }, /current/i);
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
  assert.strictEqual(saved.license_note, source.license_note);

  const createdEvent = store.db.prepare('SELECT * FROM atlas_events WHERE entity_type = ? AND entity_id = ?').get('source', saved.id);
  assert.deepStrictEqual(JSON.parse(createdEvent.before_json), {});
  assert.strictEqual(JSON.parse(createdEvent.after_json).checksum, registration[0].checksum);
  assert.strictEqual(JSON.parse(createdEvent.after_json).robots_url, source.robots_url);
  assert.strictEqual(JSON.parse(createdEvent.after_json).robots_sha256, source.robots_sha256);
  assert.strictEqual(JSON.parse(createdEvent.after_json).policy_url, source.policy_url);
  assert.strictEqual(JSON.parse(createdEvent.after_json).policy_sha256, source.policy_sha256);
  assert.strictEqual(JSON.parse(createdEvent.after_json).observed_at, source.observed_at);
  assert.match(createdEvent.reason, /registry-test/);

  const updatedSource = { ...source, license_note: 'public official directory; reviewed terms' };
  const update = registerSources(store.db, [updatedSource], { userName: 'registry-review' })[0];
  assert.notStrictEqual(update.checksum, registration[0].checksum);
  const updatedEvent = store.db.prepare('SELECT * FROM atlas_events WHERE entity_type = ? ORDER BY id DESC LIMIT 1').get('source');
  assert.strictEqual(JSON.parse(updatedEvent.before_json).license_note, source.license_note);
  assert.strictEqual(JSON.parse(updatedEvent.after_json).license_note, updatedSource.license_note);

  const authorization = authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://WWW.ThaiTradeFair.com:443/fair-content/../fair-content/list?q=food#top',
    countryCode: 'TH'
  });
  assert.strictEqual(authorization.canonicalUrl, 'https://www.thaitradefair.com/fair-content/list?q=food');
  assert.strictEqual(authorization.source.code, source.code);

  assert.strictEqual(authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.thaitradefair.com/fair-content',
    countryCode: 'TH'
  }).canonicalUrl, 'https://www.thaitradefair.com/fair-content');

  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.thaitradefair.com/login',
    countryCode: 'TH'
  }), /disallowed/i);
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.thaitradefair.com.example/fair-content/list',
    countryCode: 'TH'
  }), /origin/i);
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.thaitradefair.com/fair-contentious',
    countryCode: 'TH'
  }), /allowed path/i);
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.thaitradefair.com/fair-content/private',
    countryCode: 'TH'
  }), /disallowed/i);
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.thaitradefair.com/fair-content/private/record',
    countryCode: 'TH'
  }), /disallowed/i);
  assert.strictEqual(authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.thaitradefair.com/fair-content/privateer',
    countryCode: 'TH'
  }).canonicalUrl, 'https://www.thaitradefair.com/fair-content/privateer');
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.thaitradefair.com/fair-content/list',
    countryCode: 'MY'
  }), /country/i);
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.thaitradefair.com/fair-content/list',
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
  registerSources(store.db, definitions, { userName: 'seed-review' });
  assert.strictEqual(store.db.prepare("SELECT COUNT(*) AS count FROM atlas_sources WHERE status = 'paused'").get().count, 2);
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: 'source-mt',
    url: 'https://www.matrade.gov.my/en/source-from-malaysia/directories/malaysia-products-directory',
    countryCode: 'MY'
  }), /not active/i);

  assert.strictEqual(store.db.pragma('integrity_check', { simple: true }), 'ok');
  console.log('matrix atlas registry tests passed');
} finally {
  if (store) store.close();
  if (previousDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previousDbPath;
  fs.rmSync(root, { recursive: true, force: true });
}

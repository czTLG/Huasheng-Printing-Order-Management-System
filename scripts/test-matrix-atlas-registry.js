'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openMatrixAtlas } = require('../src/lib/matrixAtlasDb');
const {
  validateSourceDefinition,
  registerSources,
  authorizeFetch
} = require('../src/services/matrixAtlasRegistry');

const NOW = '2026-07-18T01:00:00Z';
const source = {
  code: 'source-tx',
  publisher: 'Department of International Trade Promotion',
  landing_url: 'https://www.thaitradefair.com/',
  source_class: 'P0',
  countries: ['TH'],
  allowed_origins: ['https://www.thaitradefair.com'],
  allowed_paths: ['/fair-content/'],
  disallowed_paths: ['/login', '/account'],
  auth_mode: 'none',
  min_interval_ms: 5000,
  concurrency: 1,
  daily_budget: 150,
  cache_ttl_seconds: 86400,
  robots_reviewed_at: '2026-07-18T00:00:00Z',
  policy_expires_at: '2026-10-18T00:00:00Z',
  parser_version: '1',
  license_note: 'public official directory',
  status: 'active'
};

function rejected(change, pattern) {
  assert.throws(() => validateSourceDefinition({ ...source, ...change }, NOW), pattern);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-atlas-registry-'));
const dbPath = path.join(root, 'atlas.db');
const previousDbPath = process.env.DB_PATH;
process.env.DB_PATH = path.join(root, 'main.db');

let store;
try {
  assert.strictEqual(validateSourceDefinition(source, NOW).code, 'source-tx');
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

  store = openMatrixAtlas({ dbPath });
  store.init();

  assert.throws(() => registerSources(store.db, [source], { userName: 'registry-test', now: 'not-a-date' }), /actor\.now/i);
  assert.throws(() => registerSources(store.db, [source], { userName: 'registry-test', now: source.policy_expires_at }), /expired/i);
  assert.strictEqual(store.db.prepare('SELECT COUNT(*) AS count FROM atlas_sources').get().count, 0);

  const registration = registerSources(store.db, [source], { userName: 'registry-test', now: NOW });
  assert.strictEqual(registration.length, 1);
  assert.match(registration[0].checksum, /^[a-f0-9]{64}$/);

  const saved = store.db.prepare('SELECT * FROM atlas_sources WHERE code = ?').get(source.code);
  assert.strictEqual(saved.publisher, source.publisher);
  assert.strictEqual(saved.landing_url, source.landing_url);
  assert.strictEqual(saved.license_note, source.license_note);

  const createdEvent = store.db.prepare('SELECT * FROM atlas_events WHERE entity_type = ? AND entity_id = ?').get('source', saved.id);
  assert.deepStrictEqual(JSON.parse(createdEvent.before_json), {});
  assert.strictEqual(JSON.parse(createdEvent.after_json).checksum, registration[0].checksum);
  assert.match(createdEvent.reason, /registry-test/);

  const updatedSource = { ...source, license_note: 'public official directory; reviewed terms' };
  const update = registerSources(store.db, [updatedSource], { userName: 'registry-review', now: NOW })[0];
  assert.notStrictEqual(update.checksum, registration[0].checksum);
  const updatedEvent = store.db.prepare('SELECT * FROM atlas_events WHERE entity_type = ? ORDER BY id DESC LIMIT 1').get('source');
  assert.strictEqual(JSON.parse(updatedEvent.before_json).license_note, source.license_note);
  assert.strictEqual(JSON.parse(updatedEvent.after_json).license_note, updatedSource.license_note);

  const authorization = authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://WWW.ThaiTradeFair.com:443/fair-content/../fair-content/list?q=food#top',
    countryCode: 'TH',
    now: NOW
  });
  assert.strictEqual(authorization.canonicalUrl, 'https://www.thaitradefair.com/fair-content/list?q=food');
  assert.strictEqual(authorization.source.code, source.code);

  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.thaitradefair.com/login',
    countryCode: 'TH',
    now: NOW
  }), /disallowed/i);
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.thaitradefair.com.example/fair-content/list',
    countryCode: 'TH',
    now: NOW
  }), /origin/i);
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.thaitradefair.com/fair-contentious',
    countryCode: 'TH',
    now: NOW
  }), /allowed path/i);
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.thaitradefair.com/fair-content/list',
    countryCode: 'MY',
    now: NOW
  }), /country/i);
  assert.throws(() => authorizeFetch(store.db, {
    sourceCode: source.code,
    url: 'https://www.thaitradefair.com/fair-content/list',
    countryCode: 'TH',
    now: source.policy_expires_at
  }), /expired/i);

  const definitions = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/matrix-atlas-sources.json'), 'utf8'));
  assert.deepStrictEqual(definitions.map(({ code }) => code).sort(), ['source-mt', 'source-tx']);
  for (const definition of definitions) {
    validateSourceDefinition(definition, NOW);
    const serialized = JSON.stringify(definition).toLowerCase();
    assert(!/(password|credential|secret|token|api_key)/.test(serialized), `${definition.code} must contain no credentials`);
  }

  assert.strictEqual(store.db.pragma('integrity_check', { simple: true }), 'ok');
  console.log('matrix atlas registry tests passed');
} finally {
  if (store) store.close();
  if (previousDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previousDbPath;
  fs.rmSync(root, { recursive: true, force: true });
}

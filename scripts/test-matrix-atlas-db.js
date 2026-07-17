const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-atlas-db-'));
const dbPath = path.join(root, 'atlas.db');
const { openMatrixAtlas } = require('../src/lib/matrixAtlasDb');

const tableNames = [
  'atlas_sources',
  'atlas_fetches',
  'atlas_organizations',
  'atlas_aliases',
  'atlas_evidence',
  'atlas_products',
  'atlas_relationships',
  'atlas_tasks',
  'atlas_scores',
  'atlas_packets',
  'atlas_events'
];

const jsonColumns = {
  atlas_sources: ['countries_json', 'allowed_origins_json', 'allowed_paths_json', 'disallowed_paths_json'],
  atlas_evidence: ['fact_json'],
  atlas_products: ['evidence_ids_json'],
  atlas_relationships: ['evidence_ids_json'],
  atlas_tasks: ['input_json', 'result_json'],
  atlas_scores: ['opportunity_components_json', 'confidence_components_json', 'evidence_ids_json', 'exclusions_json'],
  atlas_packets: ['packet_json', 'evidence_ids_json'],
  atlas_events: ['before_json', 'after_json']
};

function insertSource(db, countriesJson = '[]') {
  return db.prepare(`
    INSERT INTO atlas_sources (
      code, publisher, landing_url, source_class, countries_json,
      allowed_origins_json, allowed_paths_json, disallowed_paths_json,
      auth_mode, min_interval_ms, concurrency, daily_budget,
      cache_ttl_seconds, robots_reviewed_at, policy_expires_at,
      parser_version, license_note, status, created_at, updated_at
    ) VALUES (
      'source-1', 'Publisher', 'https://example.test', 'P0', ?,
      '[]', '[]', '[]', 'none', 1000, 1, 10, 3600,
      '2026-07-18T00:00:00Z', '2026-08-18T00:00:00Z',
      'v1', 'Public organizational information', 'active',
      '2026-07-18T00:00:00Z', '2026-07-18T00:00:00Z'
    )
  `).run(countriesJson);
}

try {
  assert.throws(() => openMatrixAtlas({}), /MATRIX_STREAM_DB_PATH/);

  const previousMainPath = process.env.DB_PATH;
  process.env.DB_PATH = dbPath;
  assert.throws(() => openMatrixAtlas({ dbPath }), /DB_PATH/);
  const mainPath = path.join(root, 'main.db');
  const mainDb = new Database(mainPath);
  mainDb.close();
  fs.chmodSync(mainPath, 0o600);
  const symlinkPath = path.join(root, 'main-symlink.db');
  const hardlinkPath = path.join(root, 'main-hardlink.db');
  fs.symlinkSync(mainPath, symlinkPath);
  fs.linkSync(mainPath, hardlinkPath);
  process.env.DB_PATH = mainPath;
  assert.throws(() => openMatrixAtlas({ dbPath: symlinkPath, readonly: true }), /DB_PATH/);
  assert.throws(() => openMatrixAtlas({ dbPath: hardlinkPath, readonly: true }), /DB_PATH/);
  if (previousMainPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previousMainPath;

  const store = openMatrixAtlas({ dbPath });
  store.init();

  for (const name of tableNames) {
    assert(store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name), `${name} missing`);
  }
  assert.strictEqual(fs.statSync(dbPath).mode & 0o777, 0o600);
  assert.strictEqual(store.db.pragma('foreign_keys', { simple: true }), 1);

  for (const [table, columns] of Object.entries(jsonColumns)) {
    const { sql } = store.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
    for (const column of columns) {
      assert.match(sql, new RegExp(`CHECK\\s*\\(json_valid\\(${column}\\)\\)`, 'i'), `${table}.${column} must validate JSON`);
    }
  }

  assert.throws(() => insertSource(store.db, '{invalid'), /CHECK constraint failed/);
  insertSource(store.db);

  store.db.prepare(`
    INSERT INTO atlas_organizations (
      canonical_name, country_code, normalized_domain, created_at, updated_at
    ) VALUES (?, 'US', ?, '2026-07-18T00:00:00Z', '2026-07-18T00:00:00Z')
  `).run('Example One', 'Example.COM');
  assert.throws(() => store.db.prepare(`
    INSERT INTO atlas_organizations (
      canonical_name, country_code, normalized_domain, created_at, updated_at
    ) VALUES (?, 'US', ?, '2026-07-18T00:00:00Z', '2026-07-18T00:00:00Z')
  `).run('Example Two', 'example.com'), /UNIQUE constraint failed/);

  store.db.prepare(`
    INSERT INTO atlas_events (action, entity_type, entity_id, idempotency_key, created_at)
    VALUES ('created', 'organization', 1, 'event-1', '2026-07-18T00:00:00Z')
  `).run();
  assert.throws(() => store.db.prepare("UPDATE atlas_events SET reason='changed' WHERE id=1").run(), /append-only/);
  assert.throws(() => store.db.prepare('DELETE FROM atlas_events WHERE id=1').run(), /append-only/);

  assert.strictEqual(store.db.pragma('integrity_check', { simple: true }), 'ok');
  store.close();

  const readonlyStore = openMatrixAtlas({ dbPath, readonly: true });
  assert.throws(() => readonlyStore.init(), /readonly/i);
  assert.throws(() => readonlyStore.db.prepare("INSERT INTO atlas_events (action, entity_type, idempotency_key, created_at) VALUES ('x', 'x', 'x', 'x')").run(), /readonly/i);
  readonlyStore.close();

  const raw = new Database(dbPath);
  raw.pragma('ignore_check_constraints = ON');
  raw.prepare("UPDATE atlas_sources SET countries_json='{invalid' WHERE id=1").run();
  raw.close();
  fs.chmodSync(dbPath, 0o600);

  const corruptStore = openMatrixAtlas({ dbPath, readonly: true });
  assert.throws(() => corruptStore.db.prepare('SELECT * FROM atlas_sources').get(), /invalid JSON.*countries_json/i);
  assert.throws(() => corruptStore.db.prepare('SELECT countries_json AS payload FROM atlas_sources').get(), /invalid JSON.*countries_json/i);
  assert.throws(() => corruptStore.db.prepare('SELECT countries_json FROM atlas_sources').pluck().get(), /invalid JSON.*countries_json/i);
  assert.throws(() => corruptStore.db.prepare('SELECT countries_json AS payload FROM atlas_sources').expand().get(), /invalid JSON.*countries_json/i);
  corruptStore.close();

  fs.chmodSync(dbPath, 0o640);
  assert.throws(() => openMatrixAtlas({ dbPath, readonly: true }), /0600/);

  const defaultPath = path.join(root, 'default-atlas.db');
  const previousStreamPath = process.env.MATRIX_STREAM_DB_PATH;
  process.env.MATRIX_STREAM_DB_PATH = defaultPath;
  const defaultStore = openMatrixAtlas({});
  defaultStore.init();
  defaultStore.close();
  assert.strictEqual(fs.statSync(defaultPath).mode & 0o777, 0o600);
  if (previousStreamPath === undefined) delete process.env.MATRIX_STREAM_DB_PATH;
  else process.env.MATRIX_STREAM_DB_PATH = previousStreamPath;

  console.log('matrix atlas db tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

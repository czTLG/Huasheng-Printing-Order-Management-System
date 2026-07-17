'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const JSON_COLUMNS = new Set([
  'countries_json',
  'allowed_origins_json',
  'allowed_paths_json',
  'disallowed_paths_json',
  'fact_json',
  'evidence_ids_json',
  'input_json',
  'result_json',
  'opportunity_components_json',
  'confidence_components_json',
  'exclusions_json',
  'packet_json',
  'before_json',
  'after_json'
]);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS atlas_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  publisher TEXT NOT NULL,
  landing_url TEXT NOT NULL,
  source_class TEXT NOT NULL CHECK(source_class IN ('P0','P1','P2','P3')),
  countries_json TEXT NOT NULL CHECK(json_valid(countries_json)),
  allowed_origins_json TEXT NOT NULL CHECK(json_valid(allowed_origins_json)),
  allowed_paths_json TEXT NOT NULL CHECK(json_valid(allowed_paths_json)),
  disallowed_paths_json TEXT NOT NULL CHECK(json_valid(disallowed_paths_json)),
  auth_mode TEXT NOT NULL CHECK(auth_mode IN ('none','public_api_key')),
  min_interval_ms INTEGER NOT NULL CHECK(min_interval_ms >= 1000),
  concurrency INTEGER NOT NULL CHECK(concurrency BETWEEN 1 AND 2),
  daily_budget INTEGER NOT NULL CHECK(daily_budget BETWEEN 1 AND 1000),
  cache_ttl_seconds INTEGER NOT NULL CHECK(cache_ttl_seconds >= 3600),
  robots_reviewed_at TEXT NOT NULL,
  policy_expires_at TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  license_note TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','paused','blocked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS atlas_organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_name TEXT NOT NULL,
  country_code TEXT NOT NULL,
  normalized_domain TEXT,
  legal_identifier TEXT,
  lei TEXT,
  organization_type TEXT NOT NULL DEFAULT 'unknown',
  review_state TEXT NOT NULL DEFAULT 'unreviewed',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_atlas_org_domain ON atlas_organizations(lower(normalized_domain)) WHERE normalized_domain IS NOT NULL AND normalized_domain != '';
CREATE TABLE IF NOT EXISTS atlas_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER,
  source_id INTEGER NOT NULL,
  canonical_url TEXT NOT NULL,
  source_type TEXT NOT NULL,
  page_title TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  content_fingerprint TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  fact_type TEXT NOT NULL,
  fact_json TEXT NOT NULL CHECK(json_valid(fact_json)),
  source_locator TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK(confidence IN ('confirmed','public_lead','conflicting','unknown')),
  UNIQUE(source_id, canonical_url, content_fingerprint, fact_type, source_locator),
  FOREIGN KEY(organization_id) REFERENCES atlas_organizations(id),
  FOREIGN KEY(source_id) REFERENCES atlas_sources(id)
);
CREATE TABLE IF NOT EXISTS atlas_fetches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  requested_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('fetched','cached','not_modified','blocked','retryable_error','terminal_error')),
  http_status INTEGER,
  content_type TEXT NOT NULL DEFAULT '',
  content_length INTEGER NOT NULL DEFAULT 0,
  content_fingerprint TEXT NOT NULL DEFAULT '',
  etag TEXT NOT NULL DEFAULT '',
  last_modified TEXT NOT NULL DEFAULT '',
  cache_expires_at TEXT,
  robots_allowed INTEGER NOT NULL,
  error_class TEXT NOT NULL DEFAULT '',
  observed_at TEXT NOT NULL,
  UNIQUE(source_id, canonical_url, observed_at),
  FOREIGN KEY(source_id) REFERENCES atlas_sources(id)
);
CREATE TABLE IF NOT EXISTS atlas_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  alias_type TEXT NOT NULL CHECK(alias_type IN ('name','domain','legal_identifier','lei')),
  normalized_value TEXT NOT NULL,
  original_value TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('confirmed','possible_duplicate_review','conflicting')),
  evidence_id INTEGER NOT NULL,
  confirmed_by INTEGER,
  confirmed_at TEXT,
  UNIQUE(alias_type, normalized_value, organization_id),
  FOREIGN KEY(organization_id) REFERENCES atlas_organizations(id),
  FOREIGN KEY(evidence_id) REFERENCES atlas_evidence(id)
);
CREATE TABLE IF NOT EXISTS atlas_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  product_name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT '',
  specification TEXT NOT NULL DEFAULT '',
  evidence_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_ids_json)),
  observed_at TEXT NOT NULL,
  UNIQUE(organization_id, product_name, format, specification, observed_at),
  FOREIGN KEY(organization_id) REFERENCES atlas_organizations(id)
);
CREATE TABLE IF NOT EXISTS atlas_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  relationship_type TEXT NOT NULL,
  counterpart_name TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK(state IN ('confirmed','public_lead','unknown','conflicting')),
  evidence_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_ids_json)),
  observed_at TEXT NOT NULL,
  FOREIGN KEY(organization_id) REFERENCES atlas_organizations(id)
);
CREATE TABLE IF NOT EXISTS atlas_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_type TEXT NOT NULL CHECK(task_type IN ('discover','light_read','deep_read','score','packet','materialize')),
  task_key TEXT NOT NULL UNIQUE,
  country_code TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  source_id INTEGER,
  organization_id INTEGER,
  input_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(input_json)),
  state TEXT NOT NULL CHECK(state IN ('pending','running','completed','failed_retryable','failed_terminal')),
  priority INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT NOT NULL DEFAULT '',
  lease_expires_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(result_json)),
  last_error TEXT NOT NULL DEFAULT '',
  run_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(source_id) REFERENCES atlas_sources(id),
  FOREIGN KEY(organization_id) REFERENCES atlas_organizations(id)
);
CREATE TABLE IF NOT EXISTS atlas_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  opportunity_score INTEGER NOT NULL CHECK(opportunity_score BETWEEN 0 AND 100),
  confidence_score INTEGER NOT NULL CHECK(confidence_score BETWEEN 0 AND 100),
  opportunity_components_json TEXT NOT NULL CHECK(json_valid(opportunity_components_json)),
  confidence_components_json TEXT NOT NULL CHECK(json_valid(confidence_components_json)),
  evidence_ids_json TEXT NOT NULL CHECK(json_valid(evidence_ids_json)),
  eligible INTEGER NOT NULL,
  exclusions_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(exclusions_json)),
  score_version TEXT NOT NULL,
  scored_at TEXT NOT NULL,
  UNIQUE(organization_id, score_version, scored_at),
  FOREIGN KEY(organization_id) REFERENCES atlas_organizations(id)
);
CREATE TABLE IF NOT EXISTS atlas_packets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  score_id INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('text_pending','review_pending','reviewed','materialized','rejected')),
  packet_json TEXT NOT NULL CHECK(json_valid(packet_json)),
  evidence_ids_json TEXT NOT NULL CHECK(json_valid(evidence_ids_json)),
  content_fingerprint TEXT NOT NULL UNIQUE,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  materialized_cache_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(organization_id) REFERENCES atlas_organizations(id),
  FOREIGN KEY(score_id) REFERENCES atlas_scores(id)
);
CREATE TABLE IF NOT EXISTS atlas_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  before_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(after_json)),
  reason TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_atlas_fetch_source_time ON atlas_fetches(source_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_atlas_evidence_org_type_time ON atlas_evidence(organization_id, fact_type, observed_at);
CREATE INDEX IF NOT EXISTS idx_atlas_task_state_date_priority ON atlas_tasks(state, run_date, priority);
CREATE INDEX IF NOT EXISTS idx_atlas_score_org_time ON atlas_scores(organization_id, scored_at);
CREATE INDEX IF NOT EXISTS idx_atlas_packet_state_time ON atlas_packets(state, created_at);
CREATE TRIGGER IF NOT EXISTS atlas_events_no_update
BEFORE UPDATE ON atlas_events
BEGIN
  SELECT RAISE(ABORT, 'atlas_events is append-only');
END;
CREATE TRIGGER IF NOT EXISTS atlas_events_no_delete
BEFORE DELETE ON atlas_events
BEGIN
  SELECT RAISE(ABORT, 'atlas_events is append-only');
END;
`;

function validateJsonValue(value, column) {
  try {
    JSON.parse(value);
  } catch {
    throw new Error(`invalid JSON hydrated from ${column}`);
  }
}

function validateHydratedRow(row, statement) {
  if (row === undefined) return row;
  const columns = statement.columns();

  if (!row || typeof row !== 'object') {
    const column = columns[0]?.column;
    if (JSON_COLUMNS.has(column)) validateJsonValue(row, column);
    return row;
  }

  if (Array.isArray(row)) {
    columns.forEach((metadata, index) => {
      if (JSON_COLUMNS.has(metadata.column)) validateJsonValue(row[index], metadata.column);
    });
    return row;
  }

  for (const metadata of columns) {
    if (!JSON_COLUMNS.has(metadata.column)) continue;
    if (Object.hasOwn(row, metadata.name)) {
      validateJsonValue(row[metadata.name], metadata.column);
      continue;
    }
    const expandedTable = metadata.table && row[metadata.table];
    if (expandedTable && Object.hasOwn(expandedTable, metadata.name)) {
      validateJsonValue(expandedTable[metadata.name], metadata.column);
    }
  }
  for (const [column, value] of Object.entries(row)) {
    if (!JSON_COLUMNS.has(column)) continue;
    try {
      JSON.parse(value);
    } catch {
      throw new Error(`invalid JSON hydrated from ${column}`);
    }
  }
  return row;
}

function protectStatement(statement) {
  let proxy;
  proxy = new Proxy(statement, {
    get(target, property) {
      if (property === 'get') {
        return (...args) => validateHydratedRow(target.get(...args), target);
      }
      if (property === 'all') {
        return (...args) => target.all(...args).map((row) => validateHydratedRow(row, target));
      }
      if (property === 'iterate') {
        return function* iterate(...args) {
          for (const row of target.iterate(...args)) yield validateHydratedRow(row, target);
        };
      }
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        const result = value.apply(target, args);
        return result === target ? proxy : result;
      };
    }
  });
  return proxy;
}

function protectDatabase(database) {
  return new Proxy(database, {
    get(target, property) {
      if (property === 'prepare') return (sql) => protectStatement(target.prepare(sql));
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function selectedDatabasePath(dbPath) {
  const configuredPath = dbPath || process.env.MATRIX_STREAM_DB_PATH;
  if (!configuredPath || !String(configuredPath).trim()) {
    throw new Error('MATRIX_STREAM_DB_PATH is required');
  }

  const selectedPath = path.resolve(String(configuredPath));
  const mainPath = path.resolve(process.env.DB_PATH || './data/app.db');
  const selectedCanonicalPath = fs.existsSync(selectedPath)
    ? fs.realpathSync(selectedPath)
    : path.join(fs.realpathSync(path.dirname(selectedPath)), path.basename(selectedPath));
  const mainCanonicalPath = fs.existsSync(mainPath)
    ? fs.realpathSync(mainPath)
    : path.join(fs.realpathSync(path.dirname(mainPath)), path.basename(mainPath));
  const sameExistingFile = fs.existsSync(selectedPath) && fs.existsSync(mainPath)
    && fs.statSync(selectedPath).dev === fs.statSync(mainPath).dev
    && fs.statSync(selectedPath).ino === fs.statSync(mainPath).ino;
  if (selectedCanonicalPath === mainCanonicalPath || sameExistingFile) {
    throw new Error('Matrix Atlas database path must not equal DB_PATH');
  }
  return selectedPath;
}

function assertProtectedExistingFile(dbPath) {
  if (!fs.existsSync(dbPath)) return;
  const mode = fs.statSync(dbPath).mode & 0o777;
  if (mode !== 0o600) throw new Error('Matrix Atlas database file must have mode 0600');
}

function openMatrixAtlas({ dbPath, readonly = false } = {}) {
  const selectedPath = selectedDatabasePath(dbPath);
  assertProtectedExistingFile(selectedPath);

  const existed = fs.existsSync(selectedPath);
  const database = new Database(selectedPath, {
    readonly,
    fileMustExist: readonly
  });

  try {
    if (!existed) fs.chmodSync(selectedPath, 0o600);
    database.pragma('foreign_keys = ON');
  } catch (error) {
    database.close();
    throw error;
  }

  const db = protectDatabase(database);
  return {
    db,
    init() {
      if (readonly) throw new Error('cannot initialize a readonly Matrix Atlas store');
      database.exec(SCHEMA);
      fs.chmodSync(selectedPath, 0o600);
    },
    close() {
      database.close();
    }
  };
}

module.exports = { openMatrixAtlas };

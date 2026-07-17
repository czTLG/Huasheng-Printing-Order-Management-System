'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const TOP_KEYS = ['records', 'version'];
const RECORD_KEYS = ['normalized_domain', 'relationship', 'strategy'];
const RELATIONSHIP_KEYS = [
  'confidence', 'excerpt', 'observed_at', 'source_type', 'source_url',
  'supplied_category', 'supplier_country_code', 'supplier_name'
];
const STRATEGY_KEYS = [
  'differentiation_angle', 'entry_product', 'first_contact_goal', 'observed_at',
  'questions', 'risks', 'source_url'
];

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function exactKeys(value, allowed, required, label) {
  assertObject(value, label);
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) throw new Error(`${label} has unknown field: ${key}`);
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`${label} missing field: ${key}`);
}

function prose(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text`);
  const clean = value.trim();
  if ([...clean].length > 500) throw new Error(`${label} must be at most 500 characters`);
  return clean;
}

function publicHttpsUrl(value, label) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${label} must be a public HTTPS URL`); }
  const hostname = parsed.hostname.toLowerCase();
  const privateIpv4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
  if (parsed.protocol !== 'https:' || !hostname.includes('.') || hostname === 'localhost' || hostname === '::1' || privateIpv4.test(hostname)) {
    throw new Error(`${label} must be a public HTTPS URL`);
  }
  return parsed.toString();
}

function isoTimestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return value;
}

function textList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (value.length > 10) throw new Error(`${label} must contain at most 10 items`);
  return value.map((item, index) => prose(item, `${label}[${index}]`));
}

function normalizedDomain(value) {
  if (typeof value !== 'string') throw new Error('normalized_domain must be a domain');
  const domain = value.trim().toLowerCase().replace(/^www\./, '');
  if (!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new Error('normalized_domain must be a domain');
  return domain;
}

function relationship(value, label) {
  exactKeys(value, RELATIONSHIP_KEYS, RELATIONSHIP_KEYS, label);
  if (!['confirmed', 'public_lead'].includes(value.confidence)) throw new Error(`${label}.confidence must be confirmed or public_lead`);
  if (!/^[A-Z]{2}$/.test(value.supplier_country_code || '')) throw new Error(`${label}.supplier_country_code must be a two-letter uppercase code`);
  return {
    supplier_name: prose(value.supplier_name, `${label}.supplier_name`),
    supplier_country_code: value.supplier_country_code,
    supplied_category: prose(value.supplied_category, `${label}.supplied_category`),
    confidence: value.confidence,
    source_url: publicHttpsUrl(value.source_url, `${label}.source_url`),
    source_type: prose(value.source_type, `${label}.source_type`),
    observed_at: isoTimestamp(value.observed_at, `${label}.observed_at`),
    excerpt: prose(value.excerpt, `${label}.excerpt`)
  };
}

function strategy(value, label) {
  exactKeys(value, STRATEGY_KEYS, STRATEGY_KEYS, label);
  return {
    entry_product: prose(value.entry_product, `${label}.entry_product`),
    differentiation_angle: prose(value.differentiation_angle, `${label}.differentiation_angle`),
    first_contact_goal: prose(value.first_contact_goal, `${label}.first_contact_goal`),
    questions: textList(value.questions, `${label}.questions`),
    risks: textList(value.risks, `${label}.risks`),
    source_url: publicHttpsUrl(value.source_url, `${label}.source_url`),
    observed_at: isoTimestamp(value.observed_at, `${label}.observed_at`)
  };
}

function parseBatch(input) {
  exactKeys(input, TOP_KEYS, TOP_KEYS, 'batch');
  if (input.version !== 1) throw new Error('batch version must be 1');
  if (!Array.isArray(input.records)) throw new Error('batch.records must be an array');
  return {
    version: 1,
    records: input.records.map((value, index) => {
      const label = `batch.records[${index}]`;
      exactKeys(value, RECORD_KEYS, ['normalized_domain'], label);
      if (!value.relationship && !value.strategy) throw new Error(`${label} must include relationship or strategy`);
      return {
        normalized_domain: normalizedDomain(value.normalized_domain),
        relationship: value.relationship ? relationship(value.relationship, `${label}.relationship`) : null,
        strategy: value.strategy ? strategy(value.strategy, `${label}.strategy`) : null
      };
    })
  };
}

function fingerprint(kind, domain, signal) {
  return crypto.createHash('sha256').update(JSON.stringify({ kind, domain, signal })).digest('hex');
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cache_relationships (
      id INTEGER PRIMARY KEY, record_id INTEGER NOT NULL, supplier_name TEXT NOT NULL,
      supplier_country_code TEXT, supplied_category TEXT, confidence TEXT NOT NULL,
      source_url TEXT NOT NULL, source_type TEXT NOT NULL, observed_at TEXT NOT NULL,
      excerpt TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE
    );
    CREATE INDEX IF NOT EXISTS idx_cache_relationships_record ON cache_relationships(record_id, observed_at DESC);
    CREATE TABLE IF NOT EXISTS cache_strategy_signals (
      id INTEGER PRIMARY KEY, record_id INTEGER NOT NULL, entry_product TEXT NOT NULL,
      differentiation_angle TEXT NOT NULL, first_contact_goal TEXT NOT NULL,
      questions_json TEXT NOT NULL, risks_json TEXT NOT NULL, source_url TEXT NOT NULL,
      observed_at TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE
    );
    CREATE INDEX IF NOT EXISTS idx_cache_strategy_signals_record ON cache_strategy_signals(record_id, observed_at DESC);
  `);
}

function applyBatch(db, batch, { dryRun = true } = {}) {
  const execute = () => {
    const result = { mode: dryRun ? 'dry-run' : 'apply', matched: [], unmatched: [], relationships: 0, strategies: 0 };
    const findRecord = db.prepare('SELECT id FROM cache_records WHERE normalized_domain = ?');
    const insertRelationship = dryRun ? null : db.prepare(`
      INSERT INTO cache_relationships (
        record_id, supplier_name, supplier_country_code, supplied_category, confidence,
        source_url, source_type, observed_at, excerpt, fingerprint
      ) VALUES (@record_id,@supplier_name,@supplier_country_code,@supplied_category,@confidence,@source_url,@source_type,@observed_at,@excerpt,@fingerprint)
      ON CONFLICT(fingerprint) DO UPDATE SET
        record_id=excluded.record_id, supplier_name=excluded.supplier_name,
        supplier_country_code=excluded.supplier_country_code, supplied_category=excluded.supplied_category,
        confidence=excluded.confidence, source_url=excluded.source_url, source_type=excluded.source_type,
        observed_at=excluded.observed_at, excerpt=excluded.excerpt
    `);
    const insertStrategy = dryRun ? null : db.prepare(`
      INSERT INTO cache_strategy_signals (
        record_id, entry_product, differentiation_angle, first_contact_goal,
        questions_json, risks_json, source_url, observed_at, fingerprint
      ) VALUES (@record_id,@entry_product,@differentiation_angle,@first_contact_goal,@questions_json,@risks_json,@source_url,@observed_at,@fingerprint)
      ON CONFLICT(fingerprint) DO UPDATE SET
        record_id=excluded.record_id, entry_product=excluded.entry_product,
        differentiation_angle=excluded.differentiation_angle, first_contact_goal=excluded.first_contact_goal,
        questions_json=excluded.questions_json, risks_json=excluded.risks_json,
        source_url=excluded.source_url, observed_at=excluded.observed_at
    `);
    for (const item of batch.records) {
      const record = findRecord.get(item.normalized_domain);
      if (!record) {
        result.unmatched.push(item.normalized_domain);
        continue;
      }
      result.matched.push(item.normalized_domain);
      if (item.relationship) {
        result.relationships += 1;
        if (insertRelationship) insertRelationship.run({ record_id: record.id, ...item.relationship, fingerprint: fingerprint('relationship', item.normalized_domain, item.relationship) });
      }
      if (item.strategy) {
        result.strategies += 1;
        if (insertStrategy) insertStrategy.run({
          record_id: record.id, ...item.strategy,
          questions_json: JSON.stringify(item.strategy.questions),
          risks_json: JSON.stringify(item.strategy.risks),
          fingerprint: fingerprint('strategy', item.normalized_domain, item.strategy)
        });
      }
    }
    return result;
  };
  if (dryRun) return execute();
  ensureSchema(db);
  return db.transaction(execute).immediate();
}

function parseArgs(argv) {
  const args = { dryRun: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--db') args.dbPath = argv[++index];
    else if (arg === '--input') args.inputPath = argv[++index];
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--apply') args.dryRun = false;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.dbPath || !args.inputPath) throw new Error('usage: --db <path> --input <json> [--dry-run|--apply]');
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const batch = parseBatch(JSON.parse(fs.readFileSync(path.resolve(args.inputPath), 'utf8')));
  const db = new Database(path.resolve(args.dbPath), { readonly: args.dryRun, fileMustExist: true });
  try { process.stdout.write(`${JSON.stringify(applyBatch(db, batch, { dryRun: args.dryRun }), null, 2)}\n`); }
  finally { db.close(); }
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { parseBatch, ensureSchema, applyBatch, fingerprint };

#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { NEARBY_COUNTRY_CODES } = require('../src/lib/cacheIndexView');

const TOP_KEYS = ['records', 'version'];
const RECORD_KEYS = [
  'assessment_cn', 'categories', 'company_name', 'confidence', 'contact_url', 'country_code',
  'discovery', 'evidence', 'fit_score', 'formats', 'next_action_cn', 'normalized_domain',
  'official_url', 'priority', 'scale_tier', 'size_signals'
];
const DISCOVERY_KEYS = ['discovered_via', 'discovery_url', 'source_type', 'verified_at'];
const EVIDENCE_KEYS = ['excerpt', 'observed_at', 'page_title', 'source_type', 'source_url'];

function exactKeys(value, allowed, required, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const accepted = new Set(allowed);
  for (const key of Object.keys(value)) if (!accepted.has(key)) throw new Error(`${label} has unknown field: ${key}`);
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`${label} missing field: ${key}`);
}

function text(value, label, maximum = 500) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text`);
  const clean = value.trim();
  if ([...clean].length > maximum) throw new Error(`${label} must be at most ${maximum} characters`);
  return clean;
}

function publicHttps(value, label, { optional = false } = {}) {
  if (optional && (value === '' || value == null)) return '';
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${label} must be a public HTTPS URL`); }
  const host = parsed.hostname.toLowerCase();
  const privateIpv4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
  if (parsed.protocol !== 'https:' || !host.includes('.') || host === 'localhost' || host === '::1' || privateIpv4.test(host)) {
    throw new Error(`${label} must be a public HTTPS URL`);
  }
  return parsed.toString();
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return value;
}

function domain(value) {
  const clean = String(value || '').trim().toLowerCase().replace(/^www\./, '');
  if (!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(clean)) throw new Error('normalized_domain must be a domain');
  return clean;
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.length > 20) throw new Error(`${label} must be an array with at most 20 items`);
  return value.map((item, index) => text(item, `${label}[${index}]`, 120));
}

function score(value, label, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) throw new Error(`${label} must be from 0 to ${maximum}`);
  return value;
}

function parseBatch(input) {
  exactKeys(input, TOP_KEYS, TOP_KEYS, 'batch');
  if (input.version !== 1) throw new Error('batch version must be 1');
  if (!Array.isArray(input.records)) throw new Error('batch.records must be an array');
  const seen = new Set();
  return {
    version: 1,
    records: input.records.map((value, index) => {
      const label = `batch.records[${index}]`;
      exactKeys(value, RECORD_KEYS, RECORD_KEYS, label);
      const normalizedDomain = domain(value.normalized_domain);
      if (seen.has(normalizedDomain)) throw new Error(`duplicate domain in batch: ${normalizedDomain}`);
      seen.add(normalizedDomain);
      if (!NEARBY_COUNTRY_CODES.has(value.country_code)) throw new Error(`${label}.country_code must be an approved nearby country`);
      if (!['P0', 'P1', 'P2', 'P3'].includes(value.priority)) throw new Error(`${label}.priority is invalid`);
      if (!['small', 'medium', 'large', 'enterprise', ''].includes(value.scale_tier)) throw new Error(`${label}.scale_tier is invalid`);
      exactKeys(value.discovery, DISCOVERY_KEYS, DISCOVERY_KEYS, `${label}.discovery`);
      exactKeys(value.evidence, EVIDENCE_KEYS, EVIDENCE_KEYS, `${label}.evidence`);
      return {
        company_name: text(value.company_name, `${label}.company_name`, 160),
        country_code: value.country_code,
        normalized_domain: normalizedDomain,
        official_url: publicHttps(value.official_url, `${label}.official_url`),
        categories: stringArray(value.categories, `${label}.categories`),
        formats: stringArray(value.formats, `${label}.formats`),
        size_signals: stringArray(value.size_signals, `${label}.size_signals`),
        scale_tier: value.scale_tier,
        contact_url: publicHttps(value.contact_url, `${label}.contact_url`, { optional: true }),
        priority: value.priority,
        fit_score: score(value.fit_score, `${label}.fit_score`, 100),
        confidence: score(value.confidence, `${label}.confidence`, 1),
        assessment_cn: text(value.assessment_cn, `${label}.assessment_cn`),
        next_action_cn: text(value.next_action_cn, `${label}.next_action_cn`),
        discovery: {
          discovered_via: text(value.discovery.discovered_via, `${label}.discovery.discovered_via`, 120),
          discovery_url: publicHttps(value.discovery.discovery_url, `${label}.discovery.discovery_url`),
          source_type: text(value.discovery.source_type, `${label}.discovery.source_type`, 80),
          verified_at: timestamp(value.discovery.verified_at, `${label}.discovery.verified_at`)
        },
        evidence: {
          source_url: publicHttps(value.evidence.source_url, `${label}.evidence.source_url`),
          source_type: text(value.evidence.source_type, `${label}.evidence.source_type`, 80),
          page_title: text(value.evidence.page_title, `${label}.evidence.page_title`, 160),
          observed_at: timestamp(value.evidence.observed_at, `${label}.evidence.observed_at`),
          excerpt: text(value.evidence.excerpt, `${label}.evidence.excerpt`)
        }
      };
    })
  };
}

function fingerprint(kind, value) {
  return crypto.createHash('sha256').update(JSON.stringify({ kind, value })).digest('hex');
}

function applyBatch(db, batch, { dryRun = true, now = new Date().toISOString() } = {}) {
  const createdAt = timestamp(now, 'now');
  const execute = () => {
    const result = { mode: dryRun ? 'dry-run' : 'apply', inserted: [], existing: [] };
    const find = db.prepare('SELECT id FROM cache_records WHERE lower(normalized_domain) = lower(?)');
    const insertRecord = dryRun ? null : db.prepare(`
      INSERT INTO cache_records (
        company_name,country_code,city,normalized_domain,official_url,product_categories_json,
        format_signals_json,size_signals_json,scale_tier,public_email,public_phone,public_whatsapp,
        contact_url,priority,fit_score,confidence,status,assessment_cn,next_action_cn,stage_code,
        first_seen_at,updated_at,demand_fit_score,access_score,contact_role,audit_state,audit_note,audited_at
      ) VALUES (
        @company_name,@country_code,'',@normalized_domain,@official_url,@categories_json,
        @formats_json,@sizes_json,@scale_tier,'','','',@contact_url,@priority,@fit_score,@confidence,
        'needs_review',@assessment_cn,@next_action_cn,'observed',@created_at,@created_at,
        @fit_score,@access_score,'','unreviewed','Imported from public source; requires human review',NULL
      )
    `);
    const insertEvidence = dryRun ? null : db.prepare(`
      INSERT INTO cache_evidence (record_id,source_url,source_type,page_title,observed_at,excerpt,fingerprint,created_at)
      VALUES (@record_id,@source_url,@source_type,@page_title,@observed_at,@excerpt,@fingerprint,@created_at)
    `);
    const insertDiscovery = dryRun ? null : db.prepare(`
      INSERT INTO cache_discovery (record_id,normalized_domain,discovered_via,discovery_url,official_url,source_type,verified_at,fingerprint,created_at)
      VALUES (@record_id,@normalized_domain,@discovered_via,@discovery_url,@official_url,@source_type,@verified_at,@fingerprint,@created_at)
    `);
    for (const item of batch.records) {
      if (find.get(item.normalized_domain)) {
        result.existing.push(item.normalized_domain);
        continue;
      }
      result.inserted.push(item.normalized_domain);
      if (dryRun) continue;
      const inserted = insertRecord.run({
        ...item, categories_json: JSON.stringify(item.categories), formats_json: JSON.stringify(item.formats),
        sizes_json: JSON.stringify(item.size_signals), access_score: item.contact_url ? 60 : 20, created_at: createdAt
      });
      const recordId = Number(inserted.lastInsertRowid);
      insertEvidence.run({ record_id: recordId, ...item.evidence, fingerprint: fingerprint('evidence', { domain: item.normalized_domain, ...item.evidence }), created_at: createdAt });
      insertDiscovery.run({ record_id: recordId, normalized_domain: item.normalized_domain, official_url: item.official_url, ...item.discovery, fingerprint: fingerprint('discovery', { domain: item.normalized_domain, ...item.discovery }), created_at: createdAt });
    }
    return result;
  };
  return dryRun ? execute() : db.transaction(execute).immediate();
}

function parseArgs(argv) {
  const result = { dryRun: true };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--db') result.dbPath = argv[++index];
    else if (argv[index] === '--input') result.inputPath = argv[++index];
    else if (argv[index] === '--dry-run') result.dryRun = true;
    else if (argv[index] === '--apply') result.dryRun = false;
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!result.dbPath || !result.inputPath) throw new Error('usage: --db <path> --input <json> [--dry-run|--apply]');
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const batch = parseBatch(JSON.parse(fs.readFileSync(path.resolve(args.inputPath), 'utf8')));
  const db = new Database(path.resolve(args.dbPath), { readonly: args.dryRun, fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON');
    process.stdout.write(`${JSON.stringify(applyBatch(db, batch, { dryRun: args.dryRun }), null, 2)}\n`);
  } finally { db.close(); }
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { parseBatch, applyBatch, fingerprint };

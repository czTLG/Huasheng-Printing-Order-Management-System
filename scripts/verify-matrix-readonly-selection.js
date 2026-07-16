#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { createCacheIndexView } = require('../src/lib/cacheIndexView');

const ROOT = path.resolve(__dirname, '..');
const ELIGIBLE = "r.country_code NOT IN ('CN','IN') AND r.stage_code <> 'suppressed' AND r.status IN ('valid','needs_review')";
const FOCUSED_TESTS = [
  'scripts/test-cache-index-view.js',
  'scripts/test-packet-gate.js',
  'scripts/test-matrix-api.js',
  '.runtime/vm_debug_ci/workspace/tests/test-bridge-patch.js',
  '.runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js',
  'scripts/test-verify-matrix-readonly-selection.js'
];

function repositoryContract() {
  const env = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  for (const line of [
    'MATRIX_STREAM_DB_PATH=./data/matrix-stream.db',
    'MATRIX_BRIDGE_TOKEN=',
    'MATRIX_DELIVERY_ENABLED=0',
    'MATRIX_RECOMMEND_HOUR=9',
    'MATRIX_RECOMMEND_MINUTE=0'
  ]) assert.ok(env.split(/\r?\n/).includes(line), `.env.example missing ${line}`);

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(manifest.scripts?.['verify:matrix-readonly-selection'], 'node scripts/verify-matrix-readonly-selection.js');

  const catalogPath = path.join(ROOT, 'docs/matrix-stream-catalog-2026-07-16.md');
  const catalog = fs.readFileSync(catalogPath, 'utf8');
  for (const marker of [
    '/api/matrix', 'matrix-bind-actor.js', '开发客户', '1,500',
    '来源分离', '不存在外发适配器', 'MATRIX_DELIVERY_ENABLED=0',
    'MATRIX_VERIFY_FIXTURE=1', 'fail closed',
    '桌面端', '移动端', '等待明确部署授权'
  ]) assert.ok(catalog.includes(marker), `catalog missing ${marker}`);
}

function createCandidateFixture(root) {
  const dbPath = path.join(root, 'matrix-stream-fixture.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE cache_records (
      id INTEGER PRIMARY KEY, company_name TEXT, country_code TEXT, city TEXT,
      normalized_domain TEXT UNIQUE, official_url TEXT, product_categories_json TEXT,
      format_signals_json TEXT, size_signals_json TEXT, scale_tier TEXT,
      public_email TEXT, public_phone TEXT, public_whatsapp TEXT, contact_url TEXT,
      priority TEXT, fit_score REAL, demand_fit_score REAL, access_score REAL,
      confidence REAL, status TEXT, assessment_cn TEXT, next_action_cn TEXT,
      stage_code TEXT, audit_state TEXT, audit_note TEXT, audited_at TEXT, updated_at TEXT
    );
    CREATE TABLE cache_evidence (
      id INTEGER PRIMARY KEY, record_id INTEGER, source_url TEXT, source_type TEXT,
      page_title TEXT, observed_at TEXT, excerpt TEXT, fingerprint TEXT
    );
    CREATE TABLE cache_discovery (
      id INTEGER PRIMARY KEY, record_id INTEGER, normalized_domain TEXT,
      discovered_via TEXT, discovery_url TEXT, official_url TEXT, source_type TEXT,
      verified_at TEXT, fingerprint TEXT
    );
  `);
  const insert = db.prepare(`
    INSERT INTO cache_records VALUES (
      @id,@company,@country,'',@domain,@url,@categories,@formats,@sizes,'medium',
      '', '', '', @contact,@priority,@score,@score,70,0.9,@status,@assessment,
      '核实公开联系入口','observed','audited',NULL,NULL,'2026-07-17T00:00:00.000Z'
    )
  `);
  const rows = [
    { id: 1, company: 'Fixture Coffee', country: 'US', domain: 'fixture-coffee.test', url: 'https://fixture-coffee.test/', categories: '["coffee"]', formats: '["pouch"]', sizes: '[]', contact: 'https://fixture-coffee.test/contact', priority: 'P0', score: 90, status: 'valid', assessment: '官网确认咖啡品类。' },
    { id: 2, company: 'Fixture Tea', country: 'GB', domain: 'fixture-tea.test', url: 'https://fixture-tea.test/', categories: '["tea"]', formats: '["sachet"]', sizes: '[]', contact: 'https://fixture-tea.test/contact', priority: 'P1', score: 80, status: 'needs_review', assessment: '官网确认茶品类，联系人待核实。' }
  ];
  for (const row of rows) {
    insert.run(row);
    db.prepare('INSERT INTO cache_evidence VALUES (?,?,?,?,?,?,?,?)').run(row.id, row.id, `${row.url}products`, 'official_website', 'Products', '2026-07-17T00:00:00.000Z', row.assessment, `e-${row.id}`);
    db.prepare('INSERT INTO cache_discovery VALUES (?,?,?,?,?,?,?,?,?)').run(row.id, row.id, row.domain, 'official_directory', `https://directory.test/${row.id}`, row.url, 'official_directory', '2026-07-17T00:00:00.000Z', `d-${row.id}`);
  }
  db.close();
  fs.chmodSync(dbPath, 0o600);
  return dbPath;
}

function candidateInput({ root = ROOT, temporary, env = process.env } = {}) {
  const fixtureSetting = String(env.MATRIX_VERIFY_FIXTURE || '').trim();
  if (fixtureSetting && fixtureSetting !== '1') throw new Error('MATRIX_VERIFY_FIXTURE must be exactly 1 when enabled');
  const configuredPath = String(env.MATRIX_STREAM_DB_PATH || '').trim();
  if (fixtureSetting === '1') {
    if (configuredPath) throw new Error('MATRIX_VERIFY_FIXTURE cannot be combined with MATRIX_STREAM_DB_PATH');
    if (!temporary) throw new Error('temporary fixture directory required');
    return { dbPath: createCandidateFixture(temporary), source: 'explicit-fixture' };
  }
  const selected = configuredPath || './data/matrix-stream.db';
  return {
    dbPath: path.resolve(root, selected),
    source: configuredPath ? 'configured-readonly-database' : 'default-readonly-database'
  };
}

function inspectCandidates(dbPath) {
  const stat = fs.statSync(dbPath);
  const candidateMode = (stat.mode & 0o777).toString(8).padStart(3, '0');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  try {
    const candidateIntegrity = db.pragma('integrity_check', { simple: true });
    const candidateCount = db.prepare(`SELECT COUNT(*) AS count FROM cache_records r WHERE ${ELIGIBLE}`).get().count;
    const duplicateDomains = db.prepare(`
      SELECT COUNT(*) AS count FROM (
        SELECT lower(normalized_domain) FROM cache_records
        WHERE normalized_domain IS NOT NULL AND normalized_domain <> ''
        GROUP BY lower(normalized_domain) HAVING COUNT(*) > 1
      )
    `).get().count;
    const excludedCountries = db.prepare("SELECT COUNT(*) AS count FROM cache_records WHERE country_code IN ('CN','IN')").get().count;
    const missingEvidence = db.prepare(`
      SELECT COUNT(*) AS count FROM cache_records r
      WHERE ${ELIGIBLE} AND NOT EXISTS (SELECT 1 FROM cache_evidence e WHERE e.record_id = r.id)
    `).get().count;
    const missingDiscovery = db.prepare(`
      SELECT COUNT(*) AS count FROM cache_records r
      WHERE ${ELIGIBLE} AND NOT EXISTS (SELECT 1 FROM cache_discovery d WHERE d.record_id = r.id)
    `).get().count;
    return { candidateIntegrity, candidateMode, candidateCount, duplicateDomains, excludedCountries, missingEvidence, missingDiscovery };
  } finally {
    db.close();
  }
}

function recommendFromView(view) {
  return view.recommend({ limit: Number.MAX_SAFE_INTEGER, excludeIds: [] });
}

function recommendations(dbPath) {
  const view = createCacheIndexView({ dbPath });
  try { return recommendFromView(view); }
  finally { view.close(); }
}

function outboundAdapterFiles() {
  const files = [
    'src/lib/cacheIndexView.js', 'src/lib/packetGate.js', 'src/routes/matrix.js',
    'scripts/matrix-bind-actor.js',
    '.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs',
    '.runtime/vm_debug_ci/workspace/scripts/matrix-client.js',
    '.runtime/vm_debug_ci/workspace/scripts/matrix-watch.js'
  ];
  const capability = /\b(?:nodemailer|imapflow|sendMail|SMTP_|IMAP_|WHATSAPP)\b/;
  return files.filter(file => capability.test(fs.readFileSync(path.join(ROOT, file), 'utf8')));
}

function duplicateSelectionCount(root) {
  const previousPath = process.env.DB_PATH;
  process.env.DB_PATH = path.join(root, 'idempotency-app.db');
  const dbModulePath = require.resolve('../src/db');
  delete require.cache[dbModulePath];
  const { db, initDb } = require('../src/db');
  const { createPacketGate } = require('../src/lib/packetGate');
  try {
    const originalLog = console.log;
    try {
      console.log = () => undefined;
      initDb();
    } finally {
      console.log = originalLog;
    }
    const at = '2026-07-17T00:00:00.000Z';
    const insertUser = db.prepare("INSERT INTO users (id, username, password, role, status, created_at) VALUES (?, ?, 'test-only', 'manager', 'active', ?)");
    insertUser.run(7001, 'matrix-verifier-actor', at);
    insertUser.run(7002, 'matrix-verifier-admin', at);
    const gate = createPacketGate({ db, now: () => at });
    gate.bindActor({ feishuOpenId: 'ou-matrix-verifier', userId: 7001, boundByUserId: 7002 });
    const session = gate.createSession({
      actorUserId: 7001, feishuOpenId: 'ou-matrix-verifier', chatId: 'verification-chat',
      filters: {}, expiresAt: '2026-07-18T00:00:00.000Z'
    });
    const input = {
      candidateId: 1, actorUserId: 7001, sessionId: session.id, expectedVersion: 1,
      idempotencyKey: 'matrix-verifier-event', nextAction: '核实公开证据'
    };
    gate.selectCandidate(input);
    gate.selectCandidate(input);
    return db.prepare("SELECT COUNT(*) AS count FROM matrix_selection_events WHERE idempotency_key = 'matrix-verifier-event'").get().count;
  } finally {
    db.close();
    delete require.cache[dbModulePath];
    if (previousPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previousPath;
  }
}

function runFocusedTests() {
  for (const file of FOCUSED_TESTS) {
    const result = spawnSync(process.execPath, [file], {
      cwd: ROOT, env: { ...process.env, MATRIX_DELIVERY_ENABLED: '0' }, encoding: 'utf8'
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const detail = `${result.stdout || ''}\n${result.stderr || ''}`
        .replace(/password=\S+/gi, 'password=[redacted]')
        .trim();
      throw new Error(`${file} failed${detail ? `: ${detail}` : ''}`);
    }
    process.stdout.write(`${file}: passed\n`);
  }
}

function main() {
  repositoryContract();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-readonly-verifier-'));
  try {
    const input = candidateInput({ root: ROOT, temporary: root, env: process.env });
    const dbPath = input.dbPath;
    const metrics = inspectCandidates(dbPath);
    const selected = recommendations(dbPath);
    const adapters = outboundAdapterFiles();
    const idempotentEvents = duplicateSelectionCount(root);
    const delivery = process.env.MATRIX_DELIVERY_ENABLED || '0';

    assert.strictEqual(metrics.candidateIntegrity, 'ok');
    assert.strictEqual(metrics.candidateMode, '600');
    assert.strictEqual(metrics.duplicateDomains, 0);
    assert.strictEqual(metrics.excludedCountries, 0);
    assert.strictEqual(metrics.missingEvidence, 0);
    assert.strictEqual(metrics.missingDiscovery, 0);
    assert.ok(selected.length <= 5);
    assert.strictEqual(delivery, '0');
    assert.strictEqual(adapters.length, 0);
    assert.strictEqual(idempotentEvents, 1);

    runFocusedTests();
    process.stdout.write(`${JSON.stringify({
      candidate_count: metrics.candidateCount,
      candidate_integrity: metrics.candidateIntegrity,
      candidate_mode: metrics.candidateMode,
      duplicate_domains: metrics.duplicateDomains,
      excluded_countries: metrics.excludedCountries,
      missing_evidence: metrics.missingEvidence,
      missing_discovery: metrics.missingDiscovery,
      recommendations: selected.length,
      idempotent_selection_events: idempotentEvents,
      delivery_enabled: false,
      source: input.source
    }, null, 2)}\n`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`matrix read-only verification failed: ${error?.message || 'unknown error'}\n`);
    process.exitCode = 1;
  }
}

module.exports = { recommendations, recommendFromView, candidateInput, inspectCandidates };

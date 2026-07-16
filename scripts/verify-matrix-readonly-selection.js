#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { createCacheIndexView, BASE_WHERE, CURRENT_REVIEW_WHERE, RECOMMENDATION_WHERE } = require('../src/lib/cacheIndexView');

const ROOT = path.resolve(__dirname, '..');
const ELIGIBLE = RECOMMENDATION_WHERE;
const FOCUSED_TESTS = [
  'scripts/test-cache-index-view.js',
  'scripts/test-packet-gate.js',
  'scripts/test-matrix-api.js',
  '.runtime/vm_debug_ci/workspace/tests/test-bridge-patch.js',
  '.runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js',
  '.runtime/vm_debug_ci/workspace/tests/test-runtime-supervisor.js',
  'scripts/test-bridge-artifact-local-input.js',
  'scripts/test-bridge-artifact-0.6.9.js',
  'scripts/test-verify-matrix-readonly-selection.js'
];
const RUNTIME_SURFACE_ROOTS = [
  '.runtime/vm_debug_ci/Dockerfile',
  '.runtime/vm_debug_ci/compose.yaml',
  '.runtime/vm_debug_ci/bridge-patch',
  '.runtime/vm_debug_ci/workspace/extensions',
  '.runtime/vm_debug_ci/workspace/scripts',
  'src/db.js',
  'src/server.js',
  'src/lib/cacheIndexView.js',
  'src/lib/packetGate.js',
  'src/routes/matrix.js',
  'scripts/matrix-bind-actor.js'
].map(file => path.join(ROOT, file));
// Reviewed production-only surface. Tests and verifier sources are deliberately excluded.
// Any production edit requires review plus an explicit digest update here.
const RUNTIME_MANIFEST = {
  '.runtime/vm_debug_ci/Dockerfile': '0389bfbc40f8523f598a4becd211d77c7fde646b9a751ed628183e065280d203',
  '.runtime/vm_debug_ci/compose.yaml': '93aa33c33929298186a33da6c6bc5a8aa4a8278c532fa98d6b04e1d2721e21a8',
  '.runtime/vm_debug_ci/bridge-patch/patch-stream-card.cjs': '75c68ddae8cc7526de6a2b8832cf12563a63021fbdfdcf7b199af77ac0bc96ee',
  '.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs': '866d6c454ae49a95e297248881be41592e58334882853f9c7ee20e10fc9a95a6',
  '.runtime/vm_debug_ci/workspace/scripts/matrix-client.js': '7827552970849c41dd4df94f2bb0e1b3d87b8522e3917c53016091e6d2251f9d',
  '.runtime/vm_debug_ci/workspace/scripts/matrix-runtime.js': 'ce090ea576cec5713477b9bc2f7ef29b942bcbbdf4a7a461bf899c36a0c7ec1c',
  '.runtime/vm_debug_ci/workspace/scripts/matrix-watch.js': '5d8d3053ddd0369cb93c5d87926035ffe34e611fee189e5a643bc72acdfc846e',
  'src/db.js': '48e99c09d72ce248790b31f300ba22613b54d4956dde39ae1c722763f6724c3c',
  'src/server.js': '4d9cc3ec0cd4bf4d1369316785f7a2c0dc64543f1ed88be5440abd93a2577aa7',
  'src/lib/cacheIndexView.js': 'f00e1177c587f19330b09aa2dfa43c133230af8dc1fdff6d269cf35d6aae5ee3',
  'src/lib/packetGate.js': 'a952eed38d570a441c23f4124f83e29f7147778c8d2fa0e5bba7d2da1238c829',
  'src/routes/matrix.js': 'b71e09ef13946a323131f049180d0991c2b69e13276a446105aaf89df9e510b8',
  'scripts/matrix-bind-actor.js': '984f43dd17ea5163b434f154751a9b4312b44999b180ff7d59e422190587e28c'
};

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
      '核实公开联系入口','observed','audited',NULL,'2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z'
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
      WHERE ${BASE_WHERE} AND NOT EXISTS (
        SELECT 1 FROM cache_evidence e
        WHERE e.record_id = r.id AND e.source_type = 'official_website' AND trim(COALESCE(e.source_url, '')) <> ''
      )
    `).get().count;
    const missingDiscovery = db.prepare(`
      SELECT COUNT(*) AS count FROM cache_records r
      WHERE ${BASE_WHERE} AND NOT EXISTS (SELECT 1 FROM cache_discovery d WHERE d.record_id = r.id)
    `).get().count;
    const recommendationMissingOfficialEvidence = db.prepare(`
      SELECT COUNT(*) AS count FROM cache_records r WHERE ${ELIGIBLE}
      AND NOT EXISTS (
        SELECT 1 FROM cache_evidence e
        WHERE e.record_id = r.id AND e.source_type = 'official_website' AND trim(COALESCE(e.source_url, '')) <> ''
      )
    `).get().count;
    const recommendationMissingDiscovery = db.prepare(`
      SELECT COUNT(*) AS count FROM cache_records r WHERE ${ELIGIBLE}
      AND NOT EXISTS (SELECT 1 FROM cache_discovery d WHERE d.record_id = r.id)
    `).get().count;
    const recommendationMissingContact = db.prepare(`
      SELECT COUNT(*) AS count FROM cache_records r WHERE ${ELIGIBLE}
      AND trim(COALESCE(r.public_email, '')) = ''
      AND trim(COALESCE(r.public_phone, '')) = ''
      AND trim(COALESCE(r.public_whatsapp, '')) = ''
      AND trim(COALESCE(r.contact_url, '')) = ''
    `).get().count;
    const recommendationStaleReview = db.prepare(`
      SELECT COUNT(*) AS count FROM cache_records r WHERE ${ELIGIBLE} AND NOT (${CURRENT_REVIEW_WHERE})
    `).get().count;
    return {
      candidateIntegrity, candidateMode, candidateCount,
      recommendationEligibleCount: candidateCount,
      recommendationMissingOfficialEvidence, recommendationMissingDiscovery,
      recommendationMissingContact, recommendationStaleReview,
      duplicateDomains, excludedCountries, missingEvidence, missingDiscovery
    };
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

function runtimeSurfaceFiles(roots = RUNTIME_SURFACE_ROOTS) {
  const files = [];
  const visit = target => {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error(`runtime surface must not contain symlinks: ${target}`);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target).sort()) visit(path.join(target, entry));
    } else if (stat.isFile()) files.push(target);
  };
  for (const root of roots) visit(path.resolve(root));
  return files;
}

function runtimeManifest() {
  return { ...RUNTIME_MANIFEST };
}

function validateRuntimeManifest({ files = runtimeSurfaceFiles(), root = ROOT, manifest = RUNTIME_MANIFEST } = {}) {
  const actual = files.map(file => path.relative(root, path.resolve(file)).split(path.sep).join('/')).sort();
  const expected = Object.keys(manifest).sort();
  const missing = expected.filter(file => !actual.includes(file));
  const unexpected = actual.filter(file => !expected.includes(file));
  if (missing.length || unexpected.length) {
    throw new Error(`runtime manifest set mismatch: missing=${missing.join(',') || '-'} unexpected=${unexpected.join(',') || '-'}`);
  }
  for (const relative of expected) {
    const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');
    if (digest !== manifest[relative]) throw new Error(`runtime manifest hash mismatch: ${relative}`);
  }
  return true;
}

const CAPABILITY_PATTERNS = [
  /\bfetch\b/,
  /\baxios\b/,
  /\bundici\b/,
  /(?:from\s+|require\s*\(|import\s*\()\s*['"](?:node:)?(?:http|https|http2)['"]/,
  /(?:from\s+|require\s*\(|import\s*\()\s*['"](?:node:)?(?:net|tls|dgram)['"]/,
  /\b(?:WebSocket|EventSource)\b/,
  /(?:node:)?child_process/,
  /\b(?:curl|wget|ncat|socat)\b/,
  /\b(?:nodemailer|imapflow|SMTP_[A-Z0-9_]*|IMAP_[A-Z0-9_]*|WHATSAPP[A-Z0-9_]*)\b/,
  /\bsendMail\s*\(/
];
const APPROVED_CAPABILITY_SHA256 = {
  client: '7827552970849c41dd4df94f2bb0e1b3d87b8522e3917c53016091e6d2251f9d',
  supervisor: 'ce090ea576cec5713477b9bc2f7ef29b942bcbbdf4a7a461bf899c36a0c7ec1c'
};

function approvedCapabilitySource(kind, sourceValue) {
  const source = String(sourceValue);
  if (crypto.createHash('sha256').update(source).digest('hex') !== APPROVED_CAPABILITY_SHA256[kind]) return false;
  const unsafeEvaluation = /\beval\s*\(|\bFunction\s*\(|\bimport\s*\(/.test(source);
  if (unsafeEvaluation || /https?:\/\//i.test(source)) return false;
  if (kind === 'client') {
    const envNames = [...source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map(match => match[1]).sort();
    return JSON.stringify(envNames) === JSON.stringify(['MATRIX_API_BASE_URL', 'MATRIX_BRIDGE_TOKEN']) &&
      (source.match(/\bfetch\s*\(/g) || []).length === 1 &&
      (source.match(/\bfetch\s*\(url,\s*\{/g) || []).length === 1 &&
      source.includes("if (BASE_PATH !== '/api/matrix') throw new Error('MATRIX_API_BASE_URL path must be /api/matrix');") &&
      source.includes('const url = target(pathname, query);') &&
      source.includes('if (url.origin !== BASE.origin || !url.pathname.startsWith(`${BASE_PATH}/`))') &&
      !CAPABILITY_PATTERNS.slice(1).some(pattern => pattern.test(source));
  }
  if (kind === 'supervisor') {
    const spawnCalls = source.match(/\bspawn\s*\(/g) || [];
    const namedEnv = [...source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map(match => match[1]);
    const allowedEnv = new Set(['MATRIX_API_BASE_URL', 'MATRIX_RUNTIME_STATE_PATH', 'MATRIX_API_STARTUP_ATTEMPTS']);
    return namedEnv.every(name => allowedEnv.has(name)) &&
      (source.match(/\bfetch\b/g) || []).length === 2 &&
      (source.match(/\bfetchImpl\s*\(url,/g) || []).length === 1 &&
      source.includes('const url = healthUrl(baseUrl);') &&
      spawnCalls.length === 2 &&
      source.includes("spawn(process.execPath, ['/workspace/scripts/matrix-watch.js']") &&
      source.includes("spawn('feishu-codex-bridge', ['run', '--bot', 'stream-node']") &&
      source.includes("return new URL('/health', base.origin).href;") &&
      !/\b(?:exec|execFile|execSync|execFileSync|fork)\s*\(/.test(source) &&
      !CAPABILITY_PATTERNS.slice(1, 6).some(pattern => pattern.test(source)) &&
      !CAPABILITY_PATTERNS.slice(7).some(pattern => pattern.test(source));
  }
  return false;
}

function outboundAdapterFiles(files = runtimeSurfaceFiles()) {
  const clientPath = path.join(ROOT, '.runtime/vm_debug_ci/workspace/scripts/matrix-client.js');
  const supervisorPath = path.join(ROOT, '.runtime/vm_debug_ci/workspace/scripts/matrix-runtime.js');
  return files.filter(file => {
    const source = fs.readFileSync(file, 'utf8');
    if (!CAPABILITY_PATTERNS.some(pattern => pattern.test(source))) return false;
    if (path.resolve(file) === clientPath) return !approvedCapabilitySource('client', source);
    if (path.resolve(file) === supervisorPath) return !approvedCapabilitySource('supervisor', source);
    return true;
  });
}

function validateComposeConfig({ runCompose } = {}) {
  const composePath = path.join(ROOT, '.runtime/vm_debug_ci/compose.yaml');
  const execute = runCompose || (() => spawnSync('docker', ['compose', '-f', composePath, 'config'], {
    cwd: ROOT,
    env: {
      ...process.env,
      MATRIX_API_HOST_PORT: '8080',
      MATRIX_BRIDGE_TOKEN: 'sanitized-verifier-token',
      MATRIX_OWNER_OPEN_ID: 'ou_sanitized_verifier',
      STREAM_APP_ID: 'cli_sanitized_verifier',
      STREAM_CHAT_ID: 'oc_sanitized_verifier'
    },
    encoding: 'utf8'
  }));
  const result = execute();
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'docker compose config failed').trim());
  const config = String(result.stdout || '');
  assert.ok(config.includes('http://host.docker.internal:8080/api/matrix'), 'Compose API default did not resolve to port 8080');
  assert.ok(config.includes('/workspace/scripts/matrix-runtime.js') && config.includes('health'), 'Compose health gate missing');
  assert.ok(config.includes('host-gateway'), 'Compose host gateway missing');
  return config;
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
      filters: {}, snapshotKey: 'a'.repeat(64), candidateIds: [1], expiresAt: '2026-07-18T00:00:00.000Z'
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
  validateComposeConfig();
  validateRuntimeManifest();
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
    assert.strictEqual(metrics.recommendationMissingOfficialEvidence, 0);
    assert.strictEqual(metrics.recommendationMissingDiscovery, 0);
    assert.strictEqual(metrics.recommendationMissingContact, 0);
    assert.strictEqual(metrics.recommendationStaleReview, 0);
    assert.ok(selected.length <= 5);
    assert.strictEqual(delivery, '0');
    assert.strictEqual(adapters.length, 0);
    assert.strictEqual(idempotentEvents, 1);

    runFocusedTests();
    process.stdout.write(`${JSON.stringify({
      candidate_count: metrics.candidateCount,
      recommendation_eligible_count: metrics.recommendationEligibleCount,
      candidate_integrity: metrics.candidateIntegrity,
      candidate_mode: metrics.candidateMode,
      duplicate_domains: metrics.duplicateDomains,
      excluded_countries: metrics.excludedCountries,
      ordinary_missing_official_evidence: metrics.missingEvidence,
      ordinary_missing_discovery: metrics.missingDiscovery,
      recommendation_missing_official_evidence: metrics.recommendationMissingOfficialEvidence,
      recommendation_missing_discovery: metrics.recommendationMissingDiscovery,
      recommendation_missing_contact: metrics.recommendationMissingContact,
      recommendation_stale_review: metrics.recommendationStaleReview,
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

module.exports = {
  recommendations, recommendFromView, candidateInput, inspectCandidates,
  runtimeSurfaceFiles, runtimeManifest, validateRuntimeManifest,
  outboundAdapterFiles, validateComposeConfig, approvedCapabilitySource
};

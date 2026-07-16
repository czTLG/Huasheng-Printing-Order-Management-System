'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const jwt = require('jsonwebtoken');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-phase1-'));
const dbPath = path.join(tempDir, 'phase1.db');
process.env.DB_PATH = dbPath;
process.env.MATRIX_SUPPRESS_BOOTSTRAP_SECRET = '1';

const { db, initDb } = require('../src/db');
const {
  APPROVED_COUNTRIES,
  EXCLUDED_COUNTRIES,
  classifyRecord,
  isApprovedCountry
} = require('../src/lib/schemaRank');
const { createRun } = require('../src/lib/signalCache');
const { importDiscoveryBatch } = require('../src/lib/matrixStream');
const { runCampaign } = require('../src/lib/matrixRunner');
const { classifyCurrentCrm } = require('../src/lib/matrixCrmAdapter');

const PUBLIC_ADDRESS = '8.8.8.8';
const FORMAL_TABLES = Object.freeze([
  'customers',
  'crm_messages',
  'email_messages',
  'communication_logs'
]);
let server;
let serverError = '';

function record(country, index) {
  const slug = `${country.toLowerCase().replace(/[^a-z]+/g, '-')}-${index}`;
  const domain = `${slug}.example`;
  return {
    country,
    display_name: `${country} Brand ${index}`,
    official_url: `https://${domain}/`,
    business_email: `sales@${domain}`,
    product_evidence: ['coffee'],
    evidence: [
      ['display_name', `${country} Brand ${index}`], ['official_domain', domain],
      ['country', country], ['public_email', `sales@${domain}`], ['product', 'coffee']
    ].map(([field, value]) => ({
      source_type: 'official_website', field, value, source_url: `https://${domain}/products`,
      retrieved_at: '2026-07-16T00:00:00Z', confidence: 0.9
    }))
  };
}

function campaign(name, countries) {
  return {
    name, countries, categories: ['dry_food'], languages: ['en'],
    max_companies_per_country: 20, max_pages_per_company: 4, max_redirects: 5, max_probes: 240,
    run_deadline_ms: 120000, allowed_source_types: ['official_website'],
    official_hosts: ['*.example'], third_party_sources: [], exclusion_terms: ['India'],
    existing_domain_suppression: true, actor: 'phase1-verifier'
  };
}

async function publicDnsLookup(hostname, options) {
  assert(hostname.endsWith('.example'), `unexpected DNS lookup: ${hostname}`);
  return options && options.all
    ? [{ address: PUBLIC_ADDRESS, family: 4 }]
    : { address: PUBLIC_ADDRESS, family: 4 };
}

async function safeTransport(_url, options) {
  return {
    status: 200,
    connectedAddress: options.connectAddress,
    connectedFamily: options.connectFamily,
    headers: { get: () => null }
  };
}

function tableRows(table) {
  return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
}

function formalSnapshot() {
  return Object.fromEntries(FORMAL_TABLES.map(table => [table, tableRows(table)]));
}

function seedCurrentCrmFixture() {
  const now = '2026-07-16T00:00:00Z';
  const customer = db.prepare(`
    INSERT INTO customers (name, active, created_at, updated_at)
    VALUES (?, 1, ?, ?)
  `).run('Phase One Read Fixture', now, now);
  db.prepare(`
    INSERT INTO crm_messages (
      source_type, source_message_id, customer_id, direction, sender_name,
      sender_contact, receiver_contact, message_text, raw_payload_json,
      received_at, dedupe_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'whatsapp', 'token-verification-fixture', Number(customer.lastInsertRowid), 'inbound',
    'Fixture', '+84912345678', '', 'hello token ok', '{}', now,
    'phase1-fixture-dedupe', now, now
  );
}

function assertClassification() {
  assert.deepEqual(APPROVED_COUNTRIES, [
    'Vietnam', 'Thailand', 'Malaysia', 'Indonesia', 'Philippines', 'Kazakhstan'
  ]);
  assert(EXCLUDED_COUNTRIES.includes('India'));
  for (const country of APPROVED_COUNTRIES) assert.equal(isApprovedCountry(country), true);
  assert.equal(isApprovedCountry('India'), false);
  assert.equal(classifyRecord({ fixture_marker: 'token-verification' }, {}).classification, 'test');
  assert.equal(classifyRecord({ source_kind: 'security_notice', country: 'Malaysia' }, {}).classification, 'noise');
}

async function assertBoundedImport() {
  const records = APPROVED_COUNTRIES.flatMap(country =>
    Array.from({ length: 20 }, (_, index) => record(country, index + 1))
  );
  assert.equal(records.length, 120);
  const run = createRun(db, campaign('phase-one-verification', APPROVED_COUNTRIES));
  const summary = await importDiscoveryBatch(db, run.id, records, {
    dnsLookup: publicDnsLookup,
    transport: safeTransport,
    now: '2026-07-16'
  });
  assert.deepEqual(summary, {
    input: 120,
    excluded: 0,
    test: 0,
    noise: 0,
    needs_review: 0,
    valid: 120,
    errors: 0
  });
  const persistedCountries = db.prepare(`
    SELECT country, COUNT(*) count
    FROM matrix_entities
    GROUP BY country
    ORDER BY country
  `).all();
  assert.deepEqual(
    Object.fromEntries(persistedCountries.map(row => [row.country, row.count])),
    Object.fromEntries(APPROVED_COUNTRIES.map(country => [country, 20]))
  );

  assert.throws(() => createRun(db, campaign('india-run-rejected', ['India'])), /approved countries/i);
  const indiaRecordRun = createRun(db, campaign('india-record-rejected', ['Vietnam']));
  const indiaSummary = await importDiscoveryBatch(db, indiaRecordRun.id, [record('India', 1)], {
    dnsLookup: publicDnsLookup,
    transport: safeTransport,
    now: '2026-07-16'
  });
  assert.equal(indiaSummary.excluded, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM matrix_entities WHERE lower(country) = 'india'").get().count, 0);

  const countryLimitRun = createRun(db, campaign('country-limit-check', ['Vietnam']));
  const countryLimitSummary = await importDiscoveryBatch(
    db,
    countryLimitRun.id,
    Array.from({ length: 21 }, (_, index) => record('Vietnam', index + 101)),
    { dnsLookup: publicDnsLookup, transport: safeTransport, now: '2026-07-16' }
  );
  assert.equal(countryLimitSummary.valid, 20);
  assert.equal(countryLimitSummary.errors, 1);

  const oversizedRun = createRun(db, campaign('run-limit-check', APPROVED_COUNTRIES));
  await assert.rejects(
    importDiscoveryBatch(
      db,
      oversizedRun.id,
      Array.from({ length: 121 }, (_, index) => record('Thailand', index + 201)),
      { dnsLookup: publicDnsLookup, transport: safeTransport, now: '2026-07-16' }
    ),
    /exceeds 120 input records/
  );
}

async function assertControlledRunner() {
  const before = formalSnapshot();
  const result = await runCampaign(db, campaign('controlled-runner-check', ['Vietnam']), [record('Vietnam', 999)], {
    dnsLookup: publicDnsLookup, transport: safeTransport, now: '2026-07-16'
  });
  const run = db.prepare('SELECT * FROM matrix_runs WHERE id = ?').get(result.run_id);
  assert.equal(run.status, 'completed');
  assert(run.completed_at);
  assert.deepEqual(JSON.parse(run.counters_json), { ...result.summary, resume_cursor: null });
  const actions = db.prepare('SELECT action FROM audit_logs WHERE resource_type = ? AND resource_id = ? ORDER BY id')
    .all('matrix_run', String(result.run_id)).map(row => row.action);
  assert.deepEqual(actions, ['matrix_run_started', 'matrix_discovery_recorded', 'matrix_evidence_recorded', 'matrix_classification_recorded', 'matrix_run_completed']);
  assert.deepEqual(formalSnapshot(), before, 'controlled runner must not write formal CRM tables');
  const rollbackUser = db.prepare(`
    INSERT INTO users (username, password, role, status, created_at, approved_at)
    VALUES ('matrix_rollback_verifier', 'unused', 'foreign_trade_crm_admin', 'active', ?, ?)
  `).run('2026-07-16T00:00:00Z', '2026-07-16T00:00:00Z');
  const rollbackSecret = 'matrix-rollback-verification-secret';
  const rollbackToken = jwt.sign({ sub: String(rollbackUser.lastInsertRowid) }, rollbackSecret);
  const deniedRollback = spawnSync(process.execPath, ['scripts/matrix-rollback.js', '--run-id', String(result.run_id)], {
    cwd: root, env: { ...process.env, DB_PATH: dbPath, JWT_SECRET: rollbackSecret, MATRIX_LOCAL_OPERATOR_TOKEN: '' }, encoding: 'utf8'
  });
  assert.notEqual(deniedRollback.status, 0);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM matrix_runs WHERE id = ?').get(result.run_id).count, 1);
  const rollbackProcess = spawnSync(process.execPath, ['scripts/matrix-rollback.js', '--run-id', String(result.run_id)], {
    cwd: root,
    env: { ...process.env, DB_PATH: dbPath, JWT_SECRET: rollbackSecret, MATRIX_LOCAL_OPERATOR_TOKEN: rollbackToken },
    encoding: 'utf8'
  });
  assert.equal(rollbackProcess.status, 0, rollbackProcess.stderr);
  const rollback = JSON.parse(rollbackProcess.stdout);
  assert.equal(rollback.deleted, 1);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM matrix_runs WHERE id = ?').get(result.run_id).count, 0);
  const rollbackAudit = db.prepare("SELECT action, user_name FROM audit_logs WHERE action = 'matrix_run_rolled_back' AND resource_id = ? ORDER BY id DESC LIMIT 1").get(String(result.run_id));
  assert.deepEqual(rollbackAudit, { action: 'matrix_run_rolled_back', user_name: 'matrix_rollback_verifier' });
  assert.deepEqual(formalSnapshot(), before, 'rollback must not write formal CRM tables');
}

function assertCurrentCrmReadOnly() {
  const before = formalSnapshot();
  const report = classifyCurrentCrm(db, { now: '2026-07-16' });
  assert.equal(report.counts.input, 1);
  assert.equal(report.counts.test, 1);
  assert.deepEqual(formalSnapshot(), before);
}

function assertDeliveryUnavailable() {
  const phaseOneFiles = [
    'src/lib/schemaRank.js',
    'src/lib/signalCache.js',
    'src/lib/matrixStream.js',
    'src/lib/matrixCrmAdapter.js',
    'src/lib/matrixRunner.js',
    'src/lib/matrixRollback.js',
    'scripts/matrix-run.js',
    'scripts/matrix-rollback.js',
    'src/routes/matrix.js'
  ];
  const prohibitedImports = /require\(['"](?:nodemailer|imapflow)['"]\)|\b(?:sendMail|sendMessage|deliverCandidate)\s*\(/;
  for (const relative of phaseOneFiles) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    assert(!prohibitedImports.test(source), `${relative} must not expose a delivery adapter`);
  }
  for (const modulePath of [
    '../src/lib/schemaRank',
    '../src/lib/signalCache',
    '../src/lib/matrixStream',
    '../src/lib/matrixCrmAdapter',
    '../src/lib/matrixRunner',
    '../src/lib/matrixRollback'
  ]) {
    const exportedNames = Object.keys(require(modulePath));
    assert(
      exportedNames.every(name => !/(?:send|deliver|dispatch|smtp|whatsapp)/i.test(name)),
      `${modulePath} must export zero delivery adapters`
    );
  }
  const routerSource = fs.readFileSync(path.join(root, 'src/routes/matrix.js'), 'utf8');
  assert(!/router\.(?:post|put|patch|delete)\s*\(/.test(routerSource), 'matrix API must remain read-only');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const phaseScripts = Object.keys(packageJson.scripts || {}).filter(name => name.includes('matrix'));
  assert(
    phaseScripts.every(name => !/(?:send|deliver|dispatch|smtp|whatsapp)/i.test(name)),
    'package scripts must expose zero Matrix delivery commands'
  );
}

function assertRunbookAccuracy() {
  const runbook = fs.readFileSync(path.join(root, 'docs/operations/matrix-phase1-runbook.md'), 'utf8');
  assert(
    runbook.includes('node scripts/matrix-classify-current.js --output ./matrix-current-summary.json'),
    'runbook output example must use a file in the workspace root'
  );
  assert(!runbook.includes('--output ./tmp/'), 'runbook must not use a CLI-rejected nested output path');
  assert(
    /matrix_runs\.counters_json/.test(runbook) && /resume_cursor/.test(runbook),
    'runbook must document persisted runner counters and resume cursor'
  );
  assert(runbook.includes('npm run matrix:rollback -- --run-id 123'), 'runbook must use the authenticated rollback entrypoint');
  assert(!/DELETE FROM matrix_/i.test(runbook), 'runbook must not publish an incomplete manual rollback');
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`server health timeout: ${serverError.slice(-1000)}`);
}

async function assertReadOnlyApi() {
  const now = '2026-07-16T00:00:00Z';
  db.prepare(`
    INSERT INTO users (username, password, role, status, created_at, approved_at)
    VALUES (?, ?, ?, 'active', ?, ?)
  `).run('phase1_verifier', 'verify123', 'foreign_trade_crm_admin', now, now);

  const before = formalSnapshot();
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      DB_PATH: dbPath,
      PORT: String(port),
      DISABLE_CRON: '1',
      FORCE_HTTPS: '0'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  server.stderr.on('data', chunk => { serverError += String(chunk); });
  await waitForHealth(baseUrl);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'phase1_verifier', password: 'verify123' })
  });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  assert(token);
  const response = await fetch(`${baseUrl}/api/matrix/candidates?page_size=100`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert(payload.total >= 120);
  assert(payload.rows.length <= 100);
  assert.deepEqual(formalSnapshot(), before);
}

async function main() {
  initDb();
  seedCurrentCrmFixture();
  assertClassification();
  const formalBeforeImport = formalSnapshot();
  await assertBoundedImport();
  await assertControlledRunner();
  assert.deepEqual(formalSnapshot(), formalBeforeImport, 'guarded import must not write formal CRM tables');
  assertCurrentCrmReadOnly();
  assertDeliveryUnavailable();
  await assertReadOnlyApi();
  assertRunbookAccuracy();

  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts && packageJson.scripts['verify:matrix-phase1'],
    'npm run test:matrix-rank && npm run test:signal-cache && npm run test:matrix-stream && npm run test:matrix-crm && npm run test:matrix-api && node scripts/verify-matrix-phase1.js && npm run verify:smoke && git diff --check',
    'unified package command must wire every focused, integration, smoke and diff contract'
  );
  console.log('matrix phase-one verification passed');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
}).finally(() => {
  if (server) server.kill('SIGTERM');
  try { db.close(); } catch (_) {}
  fs.rmSync(tempDir, { recursive: true, force: true });
});

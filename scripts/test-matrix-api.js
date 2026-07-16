'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const { REASON_CODES, PUBLIC_REASON_CODES } = require('../src/lib/schemaRank');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-api-'));
const dbPath = path.join(tempDir, 'app.db');
const port = Number(process.env.MATRIX_API_TEST_PORT || 19115);
const baseUrl = `http://127.0.0.1:${port}`;
let child;
let stderr = '';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHealth() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch (_) {}
    await sleep(100);
  }
  throw new Error(`server health timeout: ${stderr.slice(-1000)}`);
}

async function request(urlPath, { method = 'GET', token, body, status = 200 } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text }; }
  assert.equal(response.status, status, `${method} ${urlPath}: ${text}`);
  return json;
}

async function login(username) {
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: { username, password: 'guard123' }
  });
  assert(result.token, `${username} login should return a token`);
  return result.token;
}

function assertNoPrivateFields(value, forbiddenValues = []) {
  const serialized = JSON.stringify(value);
  const forbiddenKeys = [
    'public_contacts_json', 'reason_json', 'campaign_json', 'ruleset_version',
    'content_fingerprint', 'extraction_method', 'human_override_reason',
    'human_override_actor', 'raw_page', 'page_text', 'message_body',
    'secret', 'config'
  ];
  forbiddenKeys.forEach(key => assert(!serialized.toLowerCase().includes(`"${key.toLowerCase()}"`), `response leaked ${key}`));
  forbiddenValues.forEach(secret => assert(!serialized.includes(secret), `response leaked ${secret}`));
}

function seed() {
  process.env.DB_PATH = dbPath;
  process.env.MATRIX_SUPPRESS_BOOTSTRAP_SECRET = '1';
  const { db, initDb } = require('../src/db');
  const { createRun, upsertEntity, appendEvidence, saveClassification } = require('../src/lib/signalCache');
  initDb();
  const createdAt = '2026-07-16 09:00:00';
  const insertUser = db.prepare(`
    INSERT INTO users (username, password, role, status, created_at, approved_at)
    VALUES (?, 'guard123', ?, 'active', ?, ?)
  `);
  insertUser.run('matrix_super', 'super_admin', createdAt, createdAt);
  insertUser.run('matrix_crm', 'foreign_trade_crm_admin', createdAt, createdAt);
  insertUser.run('matrix_sales', 'ai_sales', createdAt, createdAt);

  const campaign = (name, countries, hosts, actor = 'api-test') => ({
    name, countries, categories: ['dry_food'], languages: ['en'],
    max_companies_per_country: 20, max_pages_per_company: 4, max_probes: 80,
    run_deadline_ms: 60000, allowed_source_types: ['official_website'],
    official_hosts: hosts, third_party_sources: [], exclusion_terms: ['India'],
    existing_domain_suppression: true, actor
  });
  const firstRun = createRun(db, campaign(
    'Southeast Asia public scan', ['Vietnam'], ['alpha.example'], 'SECRET_CONFIG_ACTOR'
  ));
  const secondRun = createRun(db, campaign('Thailand public scan', ['Thailand'], ['beta.example']));
  const first = upsertEntity(db, {
    official_domain: 'alpha.example',
    display_name: 'Alpha Foods',
    country: 'Vietnam',
    public_contacts: {
      email: 'buyer@alpha.example',
      phone: '+84 912 345 678',
      whatsapp: '+84 998 765 432',
      linkedin_url: 'https://linkedin.example/private-contact',
      contact_page_url: 'https://alpha.example/private-contact'
    }
  });
  const second = upsertEntity(db, {
    official_domain: 'beta.example',
    display_name: 'Beta Foods',
    country: 'Thailand',
    public_contacts: { email: 'owner@beta.example' }
  });
  const firstEvidence = appendEvidence(db, first.id, {
    source_type: 'official_website', field: 'product',
    value: 'RAW_PAGE_TEXT_SENTINEL private CRM message body',
    source_url: 'https://alpha.example/products',
    page_title: 'Alpha public products',
    retrieved_at: '2026-07-16T01:00:00Z',
    confidence: 0.9,
    extraction_method: 'SECRET_INTERNAL_RULE'
  }, firstRun.id);
  saveClassification(db, first.id, {
    classification: 'valid',
    priority: 'A',
    reason_codes: [REASON_CODES.APPROVED_COUNTRY, REASON_CODES.OFFICIAL_DOMAIN, REASON_CODES.PRODUCT_EVIDENCE],
    confidence: 0.95,
    evidence_ids: [firstEvidence.id]
  }, firstRun.id);
  const secondEvidence = appendEvidence(db, second.id, {
    source_type: 'official_website', field: 'product', value: 'tea', source_url: 'https://beta.example/products',
    retrieved_at: '2026-07-16T01:00:00Z', confidence: 0.7
  }, secondRun.id);
  saveClassification(db, second.id, {
    classification: 'needs_review',
    priority: null,
    reason_codes: ['missing_identity'],
    confidence: 0.5,
    evidence_ids: [secondEvidence.id]
  }, secondRun.id);
  for (const [index, country, classification] of [
    [1, 'Vietnam', 'test'], [2, 'Vietnam', 'noise'], [3, 'India', 'needs_review'], [4, 'Canada', 'needs_review']
  ]) {
    const hidden = upsertEntity(db, {
      official_domain: `hidden-${index}.example`, display_name: `Hidden ${index}`, country
    });
    const hiddenEvidence = appendEvidence(db, hidden.id, {
      source_type: 'official_website', field: 'product', value: 'hidden', source_url: `https://hidden-${index}.example/products`,
      retrieved_at: '2026-07-16T01:00:00Z', confidence: 0.5
    }, firstRun.id);
    saveClassification(db, hidden.id, {
      classification, priority: null,
      reason_codes: [classification === 'test' ? REASON_CODES.FIXTURE_MARKER
        : classification === 'noise' ? REASON_CODES.SECURITY_NOTICE : REASON_CODES.UNAPPROVED_COUNTRY],
      confidence: 0.5, evidence_ids: [hiddenEvidence.id]
    }, firstRun.id);
  }
  db.close();
  return { firstId: Number(first.id), firstRunId: Number(firstRun.id) };
}

async function main() {
  assert(REASON_CODES && typeof REASON_CODES === 'object' && !Array.isArray(REASON_CODES), 'schemaRank should export REASON_CODES');
  assert(Object.isFrozen(REASON_CODES), 'REASON_CODES should be immutable');
  assert(Array.isArray(PUBLIC_REASON_CODES) && Object.isFrozen(PUBLIC_REASON_CODES), 'PUBLIC_REASON_CODES should be an immutable collection');
  const reasonCodeValues = Object.values(REASON_CODES);
  assert(reasonCodeValues.length >= 20, 'reason-code contract should remain complete');
  assert.equal(new Set(reasonCodeValues).size, reasonCodeValues.length, 'reason-code values should be unique');
  assert.deepEqual(PUBLIC_REASON_CODES, reasonCodeValues, 'every REASON_CODES value should be public');

  const schemaSource = fs.readFileSync(path.join(root, 'src', 'lib', 'schemaRank.js'), 'utf8');
  const schemaProducerSource = schemaSource.slice(schemaSource.indexOf('function result'));
  const crmProducerSource = fs.readFileSync(path.join(root, 'src', 'lib', 'matrixCrmAdapter.js'), 'utf8');
  for (const code of reasonCodeValues) {
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const literal = new RegExp(`['"]${escaped}['"]`);
    assert(!literal.test(schemaProducerSource), `schemaRank producer should consume REASON_CODES for ${code}`);
    assert(!literal.test(crmProducerSource), `matrixCrmAdapter producer should consume REASON_CODES for ${code}`);
  }

  const { firstId, firstRunId } = seed();
  child = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), DISABLE_CRON: '1', FORCE_HTTPS: '0' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  await waitForHealth();

  await request('/api/matrix/candidates', { status: 401 });
  const salesToken = await login('matrix_sales');
  await request('/api/matrix/candidates', { token: salesToken, status: 403 });
  const adminToken = await login('matrix_super');
  const crmToken = await login('matrix_crm');

  const list = await request('/api/matrix/candidates?page=1&page_size=1&classification=valid&priority=A&country=Vietnam', { token: crmToken });
  assert.deepEqual(Object.keys(list).sort(), ['page', 'page_size', 'rows', 'total', 'total_pages']);
  assert.equal(list.page, 1);
  assert.equal(list.page_size, 1);
  assert.equal(list.total, 1);
  assert.equal(list.rows.length, 1);
  assert.equal(list.rows[0].run_id, firstRunId);
  const publicReasonCodes = [REASON_CODES.APPROVED_COUNTRY, REASON_CODES.OFFICIAL_DOMAIN, REASON_CODES.PRODUCT_EVIDENCE];
  assert.deepEqual(list.rows[0].reason_codes, publicReasonCodes);
  assert.deepEqual(list.rows[0].evidence_urls, ['https://alpha.example/products']);
  assert.equal(list.rows[0].contacts.email, 'b***@alpha.example');
  assert.equal(list.rows[0].contacts.phone, '***5678');
  assertNoPrivateFields(list, [
    'buyer@alpha.example', '+84 912 345 678', '+84 998 765 432',
    'private-contact', 'RAW_PAGE_TEXT_SENTINEL', 'SECRET_INTERNAL_RULE',
    'SECRET_OVERRIDE_TEXT', 'private-reviewer', 'SECRET_REASON_RULE_SENTENCE'
  ]);

  const capped = await request('/api/matrix/candidates?page_size=999', { token: adminToken });
  assert.equal(capped.page_size, 100);
  assert.equal(capped.total, 2);
  for (const classification of ['test', 'noise']) {
    const hidden = await request(`/api/matrix/candidates?classification=${classification}`, { token: adminToken });
    assert.equal(hidden.total, 0, `${classification} must not enter the default candidate view`);
  }
  await request('/api/matrix/candidates?country=India', { token: adminToken, status: 400 });
  await request('/api/matrix/candidates?classification=unknown', { token: adminToken, status: 400 });
  await request('/api/matrix/candidates?priority=urgent', { token: adminToken, status: 400 });
  await request('/api/matrix/candidates?country=Neverland', { token: adminToken, status: 400 });
  await request('/api/matrix/candidates?page=0', { token: adminToken, status: 400 });
  await request(`/api/matrix/candidates?page=${'9'.repeat(400)}`, { token: adminToken, status: 400 });

  const secondPage = await request('/api/matrix/candidates?page=2&page_size=1', { token: adminToken });
  assert.equal(secondPage.page, 2);
  assert.equal(secondPage.rows.length, 1);

  const runs = await request('/api/matrix/runs', { token: adminToken });
  assert.equal(runs.total, 2);
  assert.equal(runs.rows[0].id > 0, true);
  assertNoPrivateFields(runs, ['SECRET_CONFIG_ACTOR']);

  const before = new Database(dbPath, { readonly: true });
  const entityBefore = before.prepare('SELECT * FROM matrix_entities WHERE id = ?').get(firstId);
  const classificationBefore = before.prepare('SELECT * FROM matrix_classifications WHERE entity_id = ? ORDER BY id DESC LIMIT 1').get(firstId);
  const auditBefore = before.prepare("SELECT count(*) count FROM audit_logs WHERE action = 'read_matrix_candidate_detail'").get().count;
  before.close();

  const detail = await request(`/api/matrix/candidates/${firstId}?run_id=${firstRunId}`, { token: crmToken });
  assert.equal(detail.id, firstId);
  assert.deepEqual(detail.reason_codes, publicReasonCodes);
  assert.deepEqual(detail.evidence.map(item => item.source_url), ['https://alpha.example/products']);
  assert.equal(detail.run_id, firstRunId);
  assert.deepEqual(Object.keys(detail.evidence[0]).sort(), ['confidence', 'retrieved_at', 'source_url']);
  assertNoPrivateFields(detail, [
    'buyer@alpha.example', 'RAW_PAGE_TEXT_SENTINEL', 'SECRET_INTERNAL_RULE',
    'SECRET_OVERRIDE_TEXT', 'SECRET_REASON_RULE_SENTENCE', 'SECRET_EVIDENCE_FIELD_SENTINEL'
  ]);
  await request('/api/matrix/candidates/999999', { token: crmToken, status: 404 });
  await request(`/api/matrix/candidates/${firstId}?run_id=bad`, { token: crmToken, status: 400 });

  const after = new Database(dbPath, { readonly: true });
  assert.deepEqual(after.prepare('SELECT * FROM matrix_entities WHERE id = ?').get(firstId), entityBefore);
  assert.deepEqual(after.prepare('SELECT * FROM matrix_classifications WHERE entity_id = ? ORDER BY id DESC LIMIT 1').get(firstId), classificationBefore);
  assert.equal(after.prepare("SELECT count(*) count FROM audit_logs WHERE action = 'read_matrix_candidate_detail'").get().count, auditBefore + 1);
  after.close();

  for (const method of ['POST', 'PATCH', 'DELETE']) {
    await request('/api/matrix/candidates', { method, token: adminToken, body: {}, status: 404 });
  }
  console.log('matrix API tests passed');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
}).finally(() => {
  if (child) child.kill('SIGTERM');
  fs.rmSync(tempDir, { recursive: true, force: true });
});

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

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

  const firstRun = createRun(db, {
    name: 'Southeast Asia public scan',
    countries: ['Vietnam'],
    actor: 'SECRET_CONFIG_ACTOR'
  });
  const secondRun = createRun(db, { name: 'Thailand public scan', countries: ['Thailand'] });
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
  appendEvidence(db, first.id, {
    field: 'SECRET_EVIDENCE_FIELD_SENTINEL',
    value: 'RAW_PAGE_TEXT_SENTINEL private CRM message body',
    source_url: 'https://alpha.example/products',
    page_title: 'Alpha public products',
    retrieved_at: '2026-07-16T01:00:00Z',
    confidence: 'high',
    extraction_method: 'SECRET_INTERNAL_RULE'
  });
  saveClassification(db, first.id, {
    classification: 'valid',
    priority: 'A',
    reason_codes: [
      'approved_country', 'official_domain', 'confirmed_international_whatsapp',
      'business_evidence', 'duplicated_message_segments', 'malformed_json_payload',
      'uncertain_direction', 'missing_business_evidence', 'classification_error',
      'SECRET_REASON_RULE_SENTENCE'
    ],
    confidence: 0.95,
    human_override_reason: 'SECRET_OVERRIDE_TEXT',
    human_override_actor: 'private-reviewer'
  }, firstRun.id);
  saveClassification(db, second.id, {
    classification: 'needs_review',
    priority: 'B',
    reason_codes: ['missing_identity'],
    confidence: 0.5
  }, secondRun.id);
  db.close();
  return { firstId: Number(first.id) };
}

async function main() {
  const { PUBLIC_REASON_CODES } = require('../src/lib/schemaRank');
  assert(Array.isArray(PUBLIC_REASON_CODES), 'schemaRank should export the authoritative public reason-code list');
  [
    'approved_country', 'official_domain', 'confirmed_international_whatsapp',
    'business_evidence', 'duplicated_message_segments', 'malformed_json_payload',
    'uncertain_direction', 'missing_business_evidence', 'classification_error'
  ].forEach(code => assert(PUBLIC_REASON_CODES.includes(code), `public reason-code list should include ${code}`));

  const { firstId } = seed();
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
  const publicReasonCodes = [
    'approved_country', 'official_domain', 'confirmed_international_whatsapp',
    'business_evidence', 'duplicated_message_segments', 'malformed_json_payload',
    'uncertain_direction', 'missing_business_evidence', 'classification_error'
  ];
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

  const detail = await request(`/api/matrix/candidates/${firstId}`, { token: crmToken });
  assert.equal(detail.id, firstId);
  assert.deepEqual(detail.reason_codes, publicReasonCodes);
  assert.deepEqual(detail.evidence.map(item => item.source_url), ['https://alpha.example/products']);
  assert.deepEqual(Object.keys(detail.evidence[0]).sort(), ['confidence', 'retrieved_at', 'source_url']);
  assertNoPrivateFields(detail, [
    'buyer@alpha.example', 'RAW_PAGE_TEXT_SENTINEL', 'SECRET_INTERNAL_RULE',
    'SECRET_OVERRIDE_TEXT', 'SECRET_REASON_RULE_SENTENCE', 'SECRET_EVIDENCE_FIELD_SENTINEL'
  ]);
  await request('/api/matrix/candidates/999999', { token: crmToken, status: 404 });

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

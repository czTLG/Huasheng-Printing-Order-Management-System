'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { createMatrixBridgeAuth } = require('../src/routes/matrix');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-api-'));
const appDbPath = path.join(root, 'app.db');
const candidateDbPath = path.join(root, 'candidate.db');
const port = 21000 + (process.pid % 1000);
const jwtSecret = 'matrix-api-test-jwt-secret';
const bridgeToken = 'matrix-api-test-bridge-token-0123456789abcdef';
let child;
let serverOutput = '';

function testConstantTimeTokenComparison() {
  const middleware = createMatrixBridgeAuth({
    bridgeToken,
    db: {
      prepare: () => ({
        get: () => ({ id: 103, username: 'matrix-crm', full_name: '', role: 'foreign_trade_crm_admin', permissions_json: null, binding_id: 1 })
      })
    }
  });
  const original = crypto.timingSafeEqual;
  let calls = 0;
  crypto.timingSafeEqual = (left, right) => {
    calls += 1;
    assert.strictEqual(left.length, 32);
    assert.strictEqual(right.length, 32);
    return original(left, right);
  };
  try {
    for (const supplied of ['', 'short', 'x'.repeat(bridgeToken.length), bridgeToken]) {
      let status = 200;
      let nextCalled = false;
      middleware(
        { get: name => name === 'x-matrix-bridge-token' ? supplied : 'ou-test' },
        { status: code => { status = code; return { json: () => undefined }; } },
        () => { nextCalled = true; }
      );
      assert.strictEqual(nextCalled, supplied === bridgeToken);
      assert.strictEqual(status, supplied === bridgeToken ? 200 : 401);
    }
    assert.strictEqual(calls, 4);

    const disabledMiddleware = createMatrixBridgeAuth({
      bridgeToken: '',
      db: { prepare: () => ({ get: () => { throw new Error('disabled bridge must not query bindings'); } }) }
    });
    let disabledStatus = 200;
    let disabledNext = false;
    disabledMiddleware(
      { get: name => name === 'x-matrix-bridge-token' ? '' : 'ou-test' },
      { status: code => { disabledStatus = code; return { json: () => undefined }; } },
      () => { disabledNext = true; }
    );
    assert.strictEqual(disabledStatus, 401);
    assert.strictEqual(disabledNext, false);
    assert.strictEqual(calls, 5);
  } finally {
    crypto.timingSafeEqual = original;
  }
}

function seedApplicationDb() {
  process.env.DB_PATH = appDbPath;
  const { db, initDb } = require('../src/db');
  initDb();
  const insertUser = db.prepare(`
    INSERT INTO users (id, username, password, role, status, created_at)
    VALUES (?, ?, 'test-only', ?, ?, '2026-07-17 00:00:00')
  `);
  insertUser.run(101, 'matrix-root', 'super_admin', 'active');
  insertUser.run(102, 'matrix-worker', 'worker', 'active');
  insertUser.run(103, 'matrix-crm', 'foreign_trade_crm_admin', 'active');
  insertUser.run(104, 'matrix-crm-two', 'foreign_trade_crm_admin', 'active');
  insertUser.run(105, 'matrix-disabled', 'foreign_trade_crm_admin', 'disabled');
  const insertBinding = db.prepare(`
    INSERT INTO matrix_actor_bindings (feishu_open_id, user_id, status, bound_by, bound_at)
    VALUES (?, ?, 'active', 101, '2026-07-17 00:00:00')
  `);
  insertBinding.run('ou-service', 103);
  insertBinding.run('ou-disabled', 105);
  db.close();
}

function seedCandidateDb() {
  const db = new Database(candidateDbPath);
  db.exec(`
    CREATE TABLE cache_records (
      id INTEGER PRIMARY KEY, company_name TEXT, country_code TEXT, city TEXT,
      normalized_domain TEXT UNIQUE, official_url TEXT, product_categories_json TEXT,
      format_signals_json TEXT, size_signals_json TEXT, scale_tier TEXT,
      public_email TEXT, public_phone TEXT, public_whatsapp TEXT, contact_url TEXT,
      priority TEXT, fit_score REAL, demand_fit_score REAL, access_score REAL,
      confidence REAL, status TEXT, assessment_cn TEXT, next_action_cn TEXT,
      stage_code TEXT, audit_state TEXT, audit_note TEXT, audited_at TEXT, updated_at TEXT,
      internal_formula TEXT
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
      @id,@company,@country,'',@domain,@url,@categories,'["pouches"]','["exports"]','medium',
      @email,@phone,@whatsapp,@contact,@priority,@score,@score,80,0.9,@status,
      '公开信息确认','核实公开联系入口','observed','audited',NULL,@updated,@updated,'SECRET-COST-FORMULA'
    )
  `);
  insert.run({ id: 1, company: 'Alpha Coffee', country: 'US', domain: 'alpha.test', url: 'https://alpha.test/', categories: '["coffee"]', email: 'team@alpha.test', phone: '+1 202 555 0123', whatsapp: '+1 202 555 0456', contact: 'https://alpha.test/contact', priority: 'P0', score: 95, status: 'valid', updated: '2026-07-17T00:00:00Z' });
  insert.run({ id: 2, company: 'Beta Tea', country: 'GB', domain: 'beta.test', url: 'https://beta.test/', categories: '["tea"]', email: 'sales@beta.test', phone: '', whatsapp: '', contact: 'https://beta.test/contact', priority: 'P1', score: 88, status: 'valid', updated: '2026-07-16T00:00:00Z' });
  insert.run({ id: 3, company: 'India Blocked', country: 'IN', domain: 'blocked.test', url: 'https://blocked.test/', categories: '["coffee"]', email: '', phone: '', whatsapp: '', contact: '', priority: 'P0', score: 99, status: 'valid', updated: '2026-07-17T00:00:00Z' });
  insert.run({ id: 4, company: 'Review Snacks', country: 'NZ', domain: 'review.test', url: 'https://review.test/', categories: '["snacks"]', email: '', phone: '', whatsapp: '', contact: 'https://review.test/contact', priority: 'P2', score: 70, status: 'needs_review', updated: '2026-07-15T00:00:00Z' });
  db.prepare('INSERT INTO cache_evidence VALUES (1,1,?,?,?,?,?,?)').run('https://alpha.test/products', 'official_website', 'Products', '2026-07-17T00:00:00Z', 'Coffee', 'e1');
  db.prepare('INSERT INTO cache_discovery VALUES (1,1,?,?,?,?,?,?,?)').run('alpha.test', 'official_association_directory', 'https://association.test/members/alpha', 'https://alpha.test/', 'official_association_directory', '2026-07-17T00:00:00Z', 'd1');
  db.close();
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start: ${serverOutput}`);
}

async function request(route, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.serviceToken !== undefined) headers['x-matrix-bridge-token'] = options.serviceToken;
  if (options.openId !== undefined) headers['x-feishu-open-id'] = options.openId;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
  return { status: response.status, body };
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 2000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

(async () => {
  try {
    testConstantTimeTokenComparison();
    seedApplicationDb();
    seedCandidateDb();
    child = spawn(process.execPath, ['src/server.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(port),
        DB_PATH: appDbPath,
        MATRIX_STREAM_DB_PATH: candidateDbPath,
        MATRIX_BRIDGE_TOKEN: bridgeToken,
        JWT_SECRET: jwtSecret,
        DISABLE_CRON: '1',
        NODE_ENV: 'test'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', chunk => { serverOutput += chunk; });
    child.stderr.on('data', chunk => { serverOutput += chunk; });
    await waitForServer();

    const workerToken = jwt.sign({ sub: '102', role: 'worker', userName: 'matrix-worker' }, jwtSecret);
    const crmAdminToken = jwt.sign({ sub: '103', role: 'foreign_trade_crm_admin', userName: 'matrix-crm' }, jwtSecret);
    const rootToken = jwt.sign({ sub: '101', role: 'super_admin', userName: 'matrix-root' }, jwtSecret);

    assert.strictEqual((await request('/api/matrix/facets')).status, 401);
    assert.strictEqual((await request('/api/matrix/facets', { token: workerToken })).status, 403);
    assert.strictEqual((await request('/api/matrix/facets', { token: crmAdminToken })).status, 200);
    assert.strictEqual((await request('/api/matrix/facets?unexpected=1', { token: rootToken })).status, 400);
    assert.strictEqual((await request('/api/matrix/candidates?country=CN', { token: rootToken })).status, 400);
    assert.strictEqual((await request('/api/matrix/candidates?country=IN', { token: rootToken })).status, 400);

    const list = await request('/api/matrix/candidates?region=americas&category=coffee&page=1&page_size=100', { token: rootToken });
    assert.strictEqual(list.status, 200);
    assert.match(list.body.snapshot_key, /^[a-f0-9]{64}$/);
    assert.strictEqual(list.body.page_size, 20);
    assert.strictEqual(list.body.rows.length, 1);
    assert.strictEqual(list.body.rows[0].stage_code, 'observed');
    const listText = JSON.stringify(list.body);
    assert.ok(listText.includes('t***@alpha.test'));
    assert.ok(!listText.includes('team@alpha.test'));
    assert.ok(!listText.includes('SECRET-COST-FORMULA'));
    assert.ok(!/internal_formula|material_price|cost_formula/.test(listText));

    const priorityList = await request('/api/matrix/candidates?priority=P1&page_size=20', { token: rootToken });
    const statusList = await request('/api/matrix/candidates?status=needs_review&page_size=20', { token: rootToken });
    assert.strictEqual(priorityList.status, 200);
    assert.deepStrictEqual(priorityList.body.rows.map(row => row.id), [2]);
    assert.strictEqual(priorityList.body.total, 1);
    assert.strictEqual(statusList.status, 200);
    assert.deepStrictEqual(statusList.body.rows.map(row => row.id), [4]);
    assert.strictEqual(statusList.body.total, 1);
    assert.notStrictEqual(priorityList.body.snapshot_key, statusList.body.snapshot_key);
    assert.notStrictEqual(priorityList.body.snapshot_key, list.body.snapshot_key);

    const recommendations = await request('/api/matrix/recommendations/today?page_size=99', { token: crmAdminToken });
    assert.strictEqual(recommendations.status, 200);
    assert.deepStrictEqual(recommendations.body.rows.map(row => row.id), [1]);
    assert.strictEqual(recommendations.body.page_size, 5);
    assert.strictEqual(recommendations.body.rows[0].stage_code, 'observed');
    assert.strictEqual(recommendations.body.total, 1);
    assert.strictEqual(recommendations.body.total_pages, 1);
    const recommendationPage2 = await request('/api/matrix/recommendations/today?page=2&page_size=5', { token: crmAdminToken });
    assert.strictEqual(recommendationPage2.status, 200);
    assert.strictEqual(recommendationPage2.body.page, 2);
    assert.deepStrictEqual(recommendationPage2.body.rows, []);
    assert.match(recommendationPage2.body.snapshot_key, /^[a-f0-9]{64}$/);
    assert.strictEqual(recommendationPage2.body.snapshot_key, recommendations.body.snapshot_key);
    const weakRecommendation = await request('/api/matrix/recommendations/today?category=snacks&page=1&page_size=5', { token: crmAdminToken });
    assert.deepStrictEqual(weakRecommendation.body.rows, []);

    const detail = await request('/api/matrix/candidates/1', { token: crmAdminToken });
    assert.strictEqual(detail.status, 200);
    assert.strictEqual(detail.body.discovery.discovered_via, 'official_association_directory');
    assert.strictEqual(detail.body.stage_code, 'observed');
    assert.strictEqual(detail.body.contacts.email, 'team@alpha.test');
    assert.ok(!JSON.stringify(detail.body).includes('SECRET-COST-FORMULA'));
    assert.strictEqual((await request('/api/matrix/candidates/not-a-number', { token: rootToken })).status, 400);

    assert.strictEqual((await request('/api/matrix/selections', { method: 'POST', serviceToken: 'bad', openId: 'ou-service', body: {} })).status, 401);
    assert.strictEqual((await request('/api/matrix/facets', { serviceToken: bridgeToken, openId: 'ou-none' })).status, 403);
    assert.strictEqual((await request('/api/matrix/facets', { serviceToken: bridgeToken, openId: 'ou-disabled' })).status, 403);
    assert.strictEqual((await request('/api/matrix/facets', { serviceToken: bridgeToken, openId: 'ou-service' })).status, 200);
    assert.deepStrictEqual((await request('/api/matrix/ready', { serviceToken: bridgeToken, openId: 'ou-service' })), { status: 200, body: { ok: true, service: 'matrix' } });
    assert.strictEqual((await request('/api/matrix/ready', { token: crmAdminToken })).status, 403);
    assert.strictEqual((await request('/api/matrix/ready', { serviceToken: bridgeToken, openId: 'ou-none' })).status, 403);

    const rejectedSession = await request('/api/matrix/sessions', {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { chat_id: 'chat-1', filters: { region: 'americas', page: 9 }, expires_at: '2099-01-01T00:00:00.000Z' }
    });
    assert.strictEqual(rejectedSession.status, 400);

    for (const country of ['CN', 'IN']) {
      const excludedCreate = await request('/api/matrix/sessions', {
        method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: { chat_id: `chat-${country}`, filters: { country }, expires_at: '2099-01-01T00:00:00.000Z' }
      });
      assert.strictEqual(excludedCreate.status, 400);
    }

    const missingChat = await request('/api/matrix/sessions', {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { filters: { region: 'americas' }, expires_at: '2099-01-01T00:00:00.000Z' }
    });
    assert.strictEqual(missingChat.status, 400);

    const createdSession = await request('/api/matrix/sessions', {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { chat_id: 'chat-1', thread_id: 'thread-1', filters: { region: 'americas', page_size: 10 }, snapshot_key: recommendations.body.snapshot_key, candidate_ids: [1], expires_at: '2099-01-01T00:00:00.000Z' }
    });
    assert.strictEqual(createdSession.status, 201);
    assert.strictEqual(createdSession.body.page, 1);
    assert.deepStrictEqual(createdSession.body.filters, { region: 'americas', page_size: 10 });
    assert.deepStrictEqual(createdSession.body.candidate_ids, [1]);

    const restored = await request(`/api/matrix/sessions/${createdSession.body.id}?chat_id=chat-1&thread_id=thread-1`, { serviceToken: bridgeToken, openId: 'ou-service' });
    assert.strictEqual(restored.status, 200);
    assert.deepStrictEqual(restored.body.candidates.map(row => row.id), [1]);
    assert.ok(!JSON.stringify(restored.body).includes('team@alpha.test'));
    for (const forbidden of ['contacts', 'discovery', 'official_evidence', 'supporting_evidence', 'evidence', 'excerpt']) assert.strictEqual(Object.prototype.hasOwnProperty.call(restored.body.candidates[0], forbidden), false);
    assert.strictEqual((await request('/api/matrix/candidates/1', { serviceToken: bridgeToken, openId: 'ou-service' })).status, 400);
    assert.strictEqual((await request(`/api/matrix/candidates/1?session_id=${createdSession.body.id}&chat_id=chat-1&thread_id=thread-1`, { serviceToken: bridgeToken, openId: 'ou-service' })).status, 200);

    const invalidExpiryDb = new Database(appDbPath);
    let invalidExpirySessionId;
    try {
      invalidExpirySessionId = Number(invalidExpiryDb.prepare(`INSERT INTO matrix_sessions (actor_user_id, chat_id, thread_id, filters_json, snapshot_key, candidate_ids_json, page, version, expires_at, created_at, updated_at) VALUES (103, 'chat-invalid-expiry', '', '{}', ?, '[1]', 1, 1, 'not-a-time', '2026-07-17T00:00:00Z', '2026-07-17T00:00:00Z')`).run('c'.repeat(64)).lastInsertRowid);
    } finally { invalidExpiryDb.close(); }
    assert.strictEqual((await request(`/api/matrix/sessions/${invalidExpirySessionId}?chat_id=chat-invalid-expiry&thread_id=`, { serviceToken: bridgeToken, openId: 'ou-service' })).status, 400);
    assert.strictEqual((await request(`/api/matrix/candidates/1?session_id=${invalidExpirySessionId}&chat_id=chat-invalid-expiry&thread_id=`, { serviceToken: bridgeToken, openId: 'ou-service' })).status, 400);

    for (const [chatId, candidateIds] of [['chat-missing', [1, 999]], ['chat-suppressed', [1, 3]]]) {
      const incomplete = await request('/api/matrix/sessions', {
        method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: { chat_id: chatId, thread_id: '', filters: {}, snapshot_key: 'b'.repeat(64), candidate_ids: candidateIds, expires_at: '2099-01-01T00:00:00.000Z' }
      });
      assert.strictEqual(incomplete.status, 201);
      assert.strictEqual((await request(`/api/matrix/sessions/${incomplete.body.id}?chat_id=${chatId}&thread_id=`, { serviceToken: bridgeToken, openId: 'ou-service' })).status, 409);
      assert.strictEqual((await request(`/api/matrix/sessions/current?chat_id=${chatId}&thread_id=`, { serviceToken: bridgeToken, openId: 'ou-service' })).status, 409);
    }

    const patchedSession = await request(`/api/matrix/sessions/${createdSession.body.id}`, {
      method: 'PATCH', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_version: 1, page: 2, filters: { region: 'americas', page_size: 10 } }
    });
    assert.strictEqual(patchedSession.status, 200);
    assert.strictEqual(patchedSession.body.version, 2);
    assert.strictEqual(patchedSession.body.page, 2);

    for (const country of ['CN', 'IN']) {
      const excludedPatch = await request(`/api/matrix/sessions/${createdSession.body.id}`, {
        method: 'PATCH', serviceToken: bridgeToken, openId: 'ou-service',
        body: { expected_version: 2, page: 9, filters: { country } }
      });
      assert.strictEqual(excludedPatch.status, 400);
    }

    const selectionBody = {
      candidate_id: 1,
      session_id: createdSession.body.id,
      expected_version: 2,
      idempotency_key: 'api-event-001',
      next_action: '核实公开联系入口'
    };
    const firstSelection = await request('/api/matrix/selections', { method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: selectionBody });
    const mutableCandidateDb = new Database(candidateDbPath);
    try { mutableCandidateDb.prepare("UPDATE cache_records SET country_code = 'IN', stage_code = 'suppressed' WHERE id = 1").run(); }
    finally { mutableCandidateDb.close(); }
    const secondSelection = await request('/api/matrix/selections', { method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: selectionBody });
    assert.strictEqual(firstSelection.status, 201);
    assert.strictEqual(secondSelection.status, 200);
    assert.strictEqual(firstSelection.body.work_item_id, secondSelection.body.work_item_id);
    assert.strictEqual((await request('/api/matrix/selections', { method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: { ...selectionBody, idempotency_key: 'api-event-new-after-suppression', expected_version: firstSelection.body.session_version } })).status, 404);
    assert.strictEqual((await request('/api/matrix/selections', { method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: { ...selectionBody, extra: true } })).status, 400);

    const workItems = await request('/api/matrix/work-items', { serviceToken: bridgeToken, openId: 'ou-service' });
    assert.strictEqual(workItems.status, 200);
    assert.deepStrictEqual(workItems.body.rows.map(row => row.candidate_id), [1]);
    const workItem = await request(`/api/matrix/work-items/${firstSelection.body.work_item_id}`, { serviceToken: bridgeToken, openId: 'ou-service' });
    assert.strictEqual(workItem.status, 200);
    assert.strictEqual(workItem.body.candidate_id, 1);

    await stopServer();
    const inspect = new Database(appDbPath, { readonly: true });
    try {
      assert.strictEqual(inspect.prepare("SELECT COUNT(*) n FROM matrix_selection_events WHERE idempotency_key = 'api-event-001'").get().n, 1);
      assert.strictEqual(inspect.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action = 'matrix_candidate_detail'").get().n, 2);
      const persistedSession = JSON.stringify(inspect.prepare('SELECT snapshot_key, candidate_ids_json, filters_json FROM matrix_sessions WHERE id = ?').get(createdSession.body.id));
      assert.ok(!persistedSession.includes('Alpha Foods'));
      assert.ok(!persistedSession.includes('team@alpha.test'));
    } finally {
      inspect.close();
    }

    const cliEnv = { ...process.env, DB_PATH: appDbPath };
    const invalidRole = spawnSync(process.execPath, ['scripts/matrix-bind-actor.js', '--open-id', 'ou-cli-worker', '--username', 'matrix-worker', '--bound-by', 'matrix-root'], { cwd: path.resolve(__dirname, '..'), env: cliEnv, encoding: 'utf8' });
    assert.notStrictEqual(invalidRole.status, 0);
    const firstBind = spawnSync(process.execPath, ['scripts/matrix-bind-actor.js', '--open-id', 'ou-cli', '--username', 'matrix-crm', '--bound-by', 'matrix-root'], { cwd: path.resolve(__dirname, '..'), env: cliEnv, encoding: 'utf8' });
    assert.strictEqual(firstBind.status, 0, firstBind.stderr);
    assert.ok(!`${firstBind.stdout}${firstBind.stderr}`.includes('ou-cli'));
    const refusedReplace = spawnSync(process.execPath, ['scripts/matrix-bind-actor.js', '--open-id', 'ou-cli', '--username', 'matrix-crm-two', '--bound-by', 'matrix-root'], { cwd: path.resolve(__dirname, '..'), env: cliEnv, encoding: 'utf8' });
    assert.notStrictEqual(refusedReplace.status, 0);
    const replaced = spawnSync(process.execPath, ['scripts/matrix-bind-actor.js', '--open-id', 'ou-cli', '--username', 'matrix-crm-two', '--bound-by', 'matrix-root', '--replace'], { cwd: path.resolve(__dirname, '..'), env: cliEnv, encoding: 'utf8' });
    assert.strictEqual(replaced.status, 0, replaced.stderr);
    assert.ok(!`${replaced.stdout}${replaced.stderr}`.includes('ou-cli'));
    assert.ok(!`${replaced.stdout}${replaced.stderr}`.match(/\b(?:103|104)\b/));
    const cliDb = new Database(appDbPath, { readonly: true });
    try {
      assert.strictEqual(cliDb.prepare("SELECT user_id FROM matrix_actor_bindings WHERE feishu_open_id = 'ou-cli'").get().user_id, 104);
      const bindingAudit = JSON.parse(cliDb.prepare("SELECT detail FROM audit_logs WHERE action = 'matrix_bind_actor' ORDER BY id DESC LIMIT 1").get().detail);
      assert.deepStrictEqual(bindingAudit.old, { userId: 103, status: 'active' });
      assert.deepStrictEqual(bindingAudit.new, { userId: 104, status: 'active' });
    } finally {
      cliDb.close();
    }

    child = spawn(process.execPath, ['src/server.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, PORT: String(port), DB_PATH: appDbPath, MATRIX_STREAM_DB_PATH: path.join(root, 'missing-candidate.db'), MATRIX_BRIDGE_TOKEN: bridgeToken, JWT_SECRET: jwtSecret, DISABLE_CRON: '1', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', chunk => { serverOutput += chunk; });
    child.stderr.on('data', chunk => { serverOutput += chunk; });
    await waitForServer();
    assert.strictEqual((await request('/api/matrix/ready', { serviceToken: bridgeToken, openId: 'ou-service' })).status, 503);
    await stopServer();

    assert.ok(!serverOutput.includes(bridgeToken));
    console.log('matrix API tests passed');
  } finally {
    await stopServer();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

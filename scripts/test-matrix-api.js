'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { createMatrixBridgeAuth, createMatrixRouter } = require('../src/routes/matrix');
const matrixReviewService = require('../src/services/matrixStreamReview');

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
  insertBinding.run('ou-worker', 102);
  insertBinding.run('ou-no-cap', 104);
  insertBinding.run('ou-inactive', 104);
  db.prepare("UPDATE matrix_actor_bindings SET status = 'revoked', revoked_at = '2026-07-17 00:00:00' WHERE feishu_open_id = 'ou-inactive'").run();
  db.prepare(`
    UPDATE users SET permissions_json = ? WHERE id = 103
  `).run(JSON.stringify({ modules: { crm: true }, capabilities: { matrixSend: true } }));
  db.prepare(`
    UPDATE users SET permissions_json = ? WHERE id = 102
  `).run(JSON.stringify({ modules: { crm: true }, capabilities: { matrixSend: true } }));
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
    CREATE TABLE cache_strategy_signals (
      id INTEGER PRIMARY KEY, record_id INTEGER NOT NULL, entry_product TEXT NOT NULL,
      differentiation_angle TEXT NOT NULL, first_contact_goal TEXT NOT NULL,
      questions_json TEXT NOT NULL, risks_json TEXT NOT NULL, source_url TEXT NOT NULL,
      observed_at TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE
    );
    CREATE TABLE cache_reviewed_intakes (
      candidate_key TEXT PRIMARY KEY, record_id INTEGER NOT NULL UNIQUE,
      request_fingerprint TEXT NOT NULL, route_readiness_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  const insert = db.prepare(`
    INSERT INTO cache_records VALUES (
      @id,@company,@country,'',@domain,@url,@categories,'["pouches"]','["exports"]','medium',
      @email,@phone,@whatsapp,@contact,@priority,@score,@score,80,0.9,@status,
      '公开信息确认','核实公开联系入口','observed','audited',NULL,@updated,@updated,'SECRET-COST-FORMULA'
    )
  `);
  insert.run({ id: 1, company: 'Alpha Coffee', country: 'VN', domain: 'alpha.test', url: 'https://alpha.test/', categories: '["coffee"]', email: 'team@alpha.test', phone: '+1 202 555 0123', whatsapp: '+1 202 555 0456', contact: 'https://alpha.test/contact', priority: 'P0', score: 95, status: 'valid', updated: '2026-07-17T00:00:00Z' });
  insert.run({ id: 2, company: 'Beta Tea', country: 'GB', domain: 'beta.test', url: 'https://beta.test/', categories: '["tea"]', email: 'sales@beta.test', phone: '', whatsapp: '', contact: 'https://beta.test/contact', priority: 'P1', score: 88, status: 'valid', updated: '2026-07-16T00:00:00Z' });
  insert.run({ id: 3, company: 'India Blocked', country: 'IN', domain: 'blocked.test', url: 'https://blocked.test/', categories: '["coffee"]', email: '', phone: '', whatsapp: '', contact: '', priority: 'P0', score: 99, status: 'valid', updated: '2026-07-17T00:00:00Z' });
  insert.run({ id: 4, company: 'Review Snacks', country: 'NZ', domain: 'review.test', url: 'https://review.test/', categories: '["snacks"]', email: '', phone: '', whatsapp: '', contact: 'https://review.test/contact', priority: 'P2', score: 70, status: 'needs_review', updated: '2026-07-15T00:00:00Z' });
  db.prepare('INSERT INTO cache_evidence VALUES (1,1,?,?,?,?,?,?)').run('https://alpha.test/products', 'official_website', 'Products', '2026-07-17T00:00:00Z', '250g and 500g roasted coffee', 'e1');
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
  const response = await fetch(`http://127.0.0.1:${options.port || port}${route}`, {
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

function reviewState(workItemId) {
  const stateDb = new Database(appDbPath, { readonly: true });
  try {
    return {
      evidence: stateDb.prepare('SELECT COUNT(*) AS count FROM matrix_stream_recipient_evidence').get().count,
      apiRequests: stateDb.prepare('SELECT COUNT(*) AS count FROM matrix_stream_api_requests').get().count,
      claims: stateDb.prepare('SELECT COUNT(*) AS count FROM matrix_stream_api_claims').get().count,
      versions: stateDb.prepare('SELECT COUNT(*) AS count FROM matrix_stream_versions').get().count,
      events: stateDb.prepare('SELECT COUNT(*) AS count FROM matrix_stream_events').get().count,
      jobs: stateDb.prepare('SELECT COUNT(*) AS count FROM matrix_stream_jobs').get().count,
      workItem: stateDb.prepare(`
        SELECT owner_user_id, stage, stream_state, current_stream_version_id, version
        FROM matrix_work_items WHERE id = ?
      `).get(workItemId)
    };
  } finally {
    stateDb.close();
  }
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

    const list = await request('/api/matrix/candidates?region=asia&category=coffee&page=1&page_size=100', { token: rootToken });
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
      body: { chat_id: 'chat-1', filters: { region: 'asia', page: 9 }, expires_at: '2099-01-01T00:00:00.000Z' }
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
      body: { filters: { region: 'asia' }, expires_at: '2099-01-01T00:00:00.000Z' }
    });
    assert.strictEqual(missingChat.status, 400);

    const createdSession = await request('/api/matrix/sessions', {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { chat_id: 'chat-1', thread_id: 'thread-1', filters: { region: 'asia', page_size: 10 }, snapshot_key: recommendations.body.snapshot_key, candidate_ids: [1], expires_at: '2099-01-01T00:00:00.000Z' }
    });
    assert.strictEqual(createdSession.status, 201);
    assert.strictEqual(createdSession.body.page, 1);
    assert.deepStrictEqual(createdSession.body.filters, { region: 'asia', page_size: 10 });
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
      body: { expected_version: 1, page: 2, filters: { region: 'asia', page_size: 10 } }
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
    assert.strictEqual(firstSelection.status, 201);
    const driftCases = [
      ['needs-review', db => db.prepare("UPDATE cache_records SET status = 'needs_review' WHERE id = 1").run()],
      ...['bounced', 'opted_out', 'delivered', 'unknown'].map(stage => [`stage-${stage}`, db => db.prepare('UPDATE cache_records SET stage_code = ? WHERE id = 1').run(stage)]),
      ['stale-audit', db => db.prepare("UPDATE cache_records SET audited_at = '2026-07-16T00:00:00Z', updated_at = '2026-07-17T00:00:00Z' WHERE id = 1").run()],
      ['missing-evidence', db => db.prepare('DELETE FROM cache_evidence WHERE record_id = 1').run()],
      ['missing-discovery', db => db.prepare('DELETE FROM cache_discovery WHERE record_id = 1').run()],
      ['missing-contact', db => db.prepare("UPDATE cache_records SET public_email='', public_phone='', public_whatsapp='', contact_url='' WHERE id = 1").run()]
    ];
    for (const [name, mutate] of driftCases) {
      const mutableCandidateDb = new Database(candidateDbPath);
      try {
        mutableCandidateDb.prepare("UPDATE cache_records SET country_code='VN', status='valid', stage_code='observed', audited_at='2026-07-17T00:00:00Z', updated_at='2026-07-17T00:00:00Z', public_email='team@alpha.test', public_phone='+1 202 555 0123', public_whatsapp='+1 202 555 0456', contact_url='https://alpha.test/contact' WHERE id=1").run();
        mutableCandidateDb.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (1,1,'https://alpha.test/products','official_website','Products','2026-07-17T00:00:00Z','250g and 500g roasted coffee','e1')").run();
        mutableCandidateDb.prepare("INSERT OR REPLACE INTO cache_discovery VALUES (1,1,'alpha.test','official_association_directory','https://association.test/members/alpha','https://alpha.test/','official_association_directory','2026-07-17T00:00:00Z','d1')").run();
        mutate(mutableCandidateDb);
      } finally { mutableCandidateDb.close(); }
      const replayed = await request('/api/matrix/selections', { method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: selectionBody });
      assert.strictEqual(replayed.status, 200, `${name} replay must remain authoritative`);
      assert.strictEqual(replayed.body.event_id, firstSelection.body.event_id);
      const rejected = await request('/api/matrix/selections', { method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: { ...selectionBody, idempotency_key: `api-event-new-${name}`, expected_version: firstSelection.body.session_version } });
      assert.strictEqual(rejected.status, 400, `${name} new selection must fail strict eligibility`);
      const stateDb = new Database(appDbPath, { readonly: true });
      try {
        assert.strictEqual(stateDb.prepare('SELECT version FROM matrix_sessions WHERE id = ?').get(createdSession.body.id).version, firstSelection.body.session_version);
        assert.strictEqual(stateDb.prepare('SELECT COUNT(*) n FROM matrix_work_items').get().n, 1);
        assert.strictEqual(stateDb.prepare('SELECT COUNT(*) n FROM matrix_selection_events').get().n, 1);
      } finally { stateDb.close(); }
    }
    const secondSelection = await request('/api/matrix/selections', { method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: selectionBody });
    assert.strictEqual(secondSelection.status, 200);
    assert.strictEqual(firstSelection.body.work_item_id, secondSelection.body.work_item_id);
    assert.strictEqual((await request('/api/matrix/selections', { method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: { ...selectionBody, extra: true } })).status, 400);

    const workItems = await request('/api/matrix/work-items', { serviceToken: bridgeToken, openId: 'ou-service' });
    assert.strictEqual(workItems.status, 200);
    assert.deepStrictEqual(workItems.body.rows.map(row => row.candidate_id), [1]);
    const workItem = await request(`/api/matrix/work-items/${firstSelection.body.work_item_id}`, { serviceToken: bridgeToken, openId: 'ou-service' });
    assert.strictEqual(workItem.status, 200);
    assert.strictEqual(workItem.body.candidate_id, 1);

    const workItemId = firstSelection.body.work_item_id;
    const mutateApp = callback => {
      const stateDb = new Database(appDbPath);
      try { callback(stateDb); } finally { stateDb.close(); }
    };
    const mutateCandidate = callback => {
      const stateDb = new Database(candidateDbPath);
      try { callback(stateDb); } finally { stateDb.close(); }
    };
    const assertFailedWithoutReviewWrite = async (label, expectedStatus, action) => {
      const before = reviewState(workItemId);
      const response = await action();
      assert.strictEqual(response.status, expectedStatus, `${label}: ${JSON.stringify(response.body)}`);
      assert.deepStrictEqual(reviewState(workItemId), before, `${label} must not write review state`);
      return response;
    };
    const versionRoute = `/api/matrix/work-items/${workItemId}/versions`;

    mutateCandidate(db => {
      db.prepare("UPDATE cache_records SET public_email='team@alpha.test', contact_url='https://alpha.test/contact' WHERE id=1").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (1,1,'https://alpha.test/products','official_website','Products','2026-07-17T00:00:00Z','250g and 500g roasted coffee','e1')").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (11,1,'https://alpha.test/about','official_website','Company profile','2026-07-17T00:00:00Z','Coffee manufacturer with export production capacity','e11')").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (12,1,'https://alpha.test/services','official_website','Packaging development service','2026-07-17T00:00:00Z','Packaging development, filling review and artwork control','e12')").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (13,1,'https://alpha.test/quality','official_website','Quality testing','2026-07-17T00:00:00Z','Quality testing and production traceability','e13')").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (14,1,'https://alpha.test/sustainability','official_website','Sustainable packaging','2026-07-17T00:00:00Z','Recyclable packaging and material efficiency','e14')").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (15,1,'https://alpha.test/contact','official_website','Supplier contact','2026-07-17T00:00:00Z','Packaging sourcing and procurement contact','e15')").run();
    });

    await assertFailedWithoutReviewWrite('JWT request without a Matrix binding', 403, () => request(versionRoute, {
      method: 'POST', token: rootToken, body: { expected_work_version: 1, idempotency_key: 'jwt-no-binding' }
    }));
    await assertFailedWithoutReviewWrite('inactive binding', 403, () => request(versionRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-inactive',
      body: { expected_work_version: 1, idempotency_key: 'inactive-binding' }
    }));

    mutateApp(db => db.prepare('UPDATE matrix_work_items SET owner_user_id = 102 WHERE id = ?').run(workItemId));
    await assertFailedWithoutReviewWrite('worker role with requested capability', 403, () => request(versionRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-worker',
      body: { expected_work_version: 1, idempotency_key: 'worker-role' }
    }));
    mutateApp(db => db.prepare('UPDATE matrix_work_items SET owner_user_id = 103 WHERE id = ?').run(workItemId));

    mutateApp(db => db.prepare('UPDATE matrix_work_items SET owner_user_id = 104 WHERE id = ?').run(workItemId));
    await assertFailedWithoutReviewWrite('missing explicit matrixSend capability', 403, () => request(versionRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-no-cap',
      body: { expected_work_version: 1, idempotency_key: 'missing-capability' }
    }));
    await assertFailedWithoutReviewWrite('another owner', 403, () => request(versionRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 1, idempotency_key: 'another-owner' }
    }));
    mutateApp(db => db.prepare('UPDATE matrix_work_items SET owner_user_id = 103 WHERE id = ?').run(workItemId));

    await assertFailedWithoutReviewWrite('unknown create field', 400, () => request(versionRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 1, recipient_email: 'other@outside.test', idempotency_key: 'bad-field' }
    }));
    await assertFailedWithoutReviewWrite('base without instruction', 400, () => request(versionRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 1, base_version_id: 1, idempotency_key: 'base-only' }
    }));
    await assertFailedWithoutReviewWrite('instruction without base', 400, () => request(versionRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 1, revision_instruction: '更简洁', idempotency_key: 'instruction-only' }
    }));
    await assertFailedWithoutReviewWrite('stale create work version', 409, () => request(versionRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 99, idempotency_key: 'stale-create' }
    }));

    mutateCandidate(db => db.prepare("UPDATE cache_records SET public_email='', contact_url='https://alpha.test/contact' WHERE id=1").run());
    await assertFailedWithoutReviewWrite('contact-form-only candidate', 400, () => request(versionRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 1, idempotency_key: 'contact-form-only' }
    }));
    mutateCandidate(db => {
      db.prepare("UPDATE cache_records SET public_email='team@alpha.test', contact_url='' WHERE id=1").run();
      db.prepare('DELETE FROM cache_evidence WHERE record_id=1').run();
    });
    await assertFailedWithoutReviewWrite('missing official source evidence', 400, () => request(versionRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 1, idempotency_key: 'missing-source' }
    }));
    mutateCandidate(db => {
      db.prepare("UPDATE cache_records SET public_email='team@alpha.test', contact_url='https://alpha.test/contact' WHERE id=1").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (1,1,'https://outside.test/products','official_website','Products','2026-07-17T00:00:00Z','250g and 500g roasted coffee','e1')").run();
    });
    await assertFailedWithoutReviewWrite('official evidence on another organization domain', 400, () => request(versionRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 1, idempotency_key: 'foreign-source' }
    }));
    mutateCandidate(db => {
      db.prepare("UPDATE cache_records SET public_email='team@alpha.test', contact_url='https://alpha.test/contact' WHERE id=1").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (1,1,'https://alpha.test/products','official_website','Products','2026-07-17T00:00:00Z','250g and 500g roasted coffee','e1')").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (11,1,'https://alpha.test/about','official_website','Company profile','2026-07-17T00:00:00Z','Coffee manufacturer with export production capacity','e11')").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (12,1,'https://alpha.test/services','official_website','Packaging development service','2026-07-17T00:00:00Z','Packaging development, filling review and artwork control','e12')").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (13,1,'https://alpha.test/quality','official_website','Quality testing','2026-07-17T00:00:00Z','Quality testing and production traceability','e13')").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (14,1,'https://alpha.test/sustainability','official_website','Sustainable packaging','2026-07-17T00:00:00Z','Recyclable packaging and material efficiency','e14')").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (15,1,'https://alpha.test/contact','official_website','Supplier contact','2026-07-17T00:00:00Z','Packaging sourcing and procurement contact','e15')").run();
    });

    mutateCandidate(db => db.prepare('DELETE FROM cache_evidence WHERE record_id=1 AND id<>1').run());
    const matchBlocked = await assertFailedWithoutReviewWrite('strategy match gate blocks thin research', 422, () => request(versionRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 1, idempotency_key: 'strategy-match-thin' }
    }));
    assert.strictEqual(matchBlocked.body.error.code, 'strategy_match_blocked');
    assert.ok(matchBlocked.body.error.details.score < matchBlocked.body.error.details.threshold);
    assert.ok(matchBlocked.body.error.details.blockers.includes('official_source_coverage_below_3'));
    mutateCandidate(db => {
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (11,1,'https://alpha.test/about','official_website','Company profile','2026-07-17T00:00:00Z','Coffee manufacturer with export production capacity','e11')").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (12,1,'https://alpha.test/services','official_website','Packaging development service','2026-07-17T00:00:00Z','Packaging development, filling review and artwork control','e12')").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (13,1,'https://alpha.test/quality','official_website','Quality testing','2026-07-17T00:00:00Z','Quality testing and production traceability','e13')").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (14,1,'https://alpha.test/sustainability','official_website','Sustainable packaging','2026-07-17T00:00:00Z','Recyclable packaging and material efficiency','e14')").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (15,1,'https://alpha.test/contact','official_website','Supplier contact','2026-07-17T00:00:00Z','Packaging sourcing and procurement contact','e15')").run();
    });

    mutateCandidate(db => {
      db.prepare(`INSERT INTO cache_records VALUES (5,'Gamma Personal Care','ID','','gamma.test','https://gamma.test/',
        '["liquid detergent","hand soap","body soap","shampoo"]','["bottles","OEM/ODM"]','["exports"]','medium',
        'packaging@gamma.test','','','https://gamma.test/contact','P0',92,92,80,0.9,'valid',
        '公开信息确认','确认补充装产品线与年度计划','observed','audited',NULL,
        '2026-07-17T00:00:00Z','2026-07-17T00:00:00Z','SECRET-COST-FORMULA')`).run();
      db.prepare("INSERT INTO cache_evidence VALUES (5,5,'https://gamma.test/products','official_website','Personal care products','2026-07-17T00:00:00Z','Shampoo, body wash and private-label personal care products','e5')").run();
      db.prepare("INSERT INTO cache_evidence VALUES (51,5,'https://gamma.test/about','official_website','Company profile','2026-07-17T00:00:00Z','OEM ODM manufacturer with export production capacity','e51')").run();
      db.prepare("INSERT INTO cache_evidence VALUES (52,5,'https://gamma.test/services','official_website','Packaging service and development','2026-07-17T00:00:00Z','Private label development, packaging testing and filling-line review','e52')").run();
      db.prepare("INSERT INTO cache_evidence VALUES (53,5,'https://gamma.test/quality','official_website','Quality and regulatory','2026-07-17T00:00:00Z','Laboratory testing, regulatory review and traceability','e53')").run();
      db.prepare("INSERT INTO cache_evidence VALUES (54,5,'https://gamma.test/sustainability','official_website','Sustainable packaging','2026-07-17T00:00:00Z','Recyclable mono material, material efficiency and product waste reduction','e54')").run();
      db.prepare("INSERT INTO cache_evidence VALUES (55,5,'https://gamma.test/contact','official_website','Supplier contact','2026-07-18T00:00:00Z','Packaging sourcing and procurement contact','e55')").run();
      db.prepare(`INSERT INTO cache_strategy_signals VALUES
        (5,5,'Printed refill formats or spouted pouches for liquid detergent, hand soap, body soap and shampoo',
        'Compatibility, leak resistance, filling-line fit and repeat-print consistency',
        'Reach packaging sourcing or procurement','["size","quantity"]','["Current pouch use is not confirmed"]',
        'https://gamma.test/products','2026-07-17T00:00:00Z','strategy-5')`).run();
    });
    let personalCareWorkItemId;
    mutateApp(db => {
      personalCareWorkItemId = Number(db.prepare(`INSERT INTO matrix_work_items
        (candidate_id,stage,owner_user_id,current_summary,next_action,version,created_at,updated_at,stream_state)
        VALUES (5,'selected',103,'','确认补充装产品线与年度计划',1,?,?, 'selected')`).run('2026-07-17T00:00:00Z','2026-07-17T00:00:00Z').lastInsertRowid);
    });
    const personalCareVersion = await request(`/api/matrix/work-items/${personalCareWorkItemId}/versions`, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 1, idempotency_key: 'draft-personal-care-1' }
    });
    assert.strictEqual(personalCareVersion.status, 201, JSON.stringify(personalCareVersion.body));
    assert.strictEqual(personalCareVersion.body.recipient_email, 'packaging@gamma.test');
    assert.strictEqual(personalCareVersion.body.recipient_verified_at, '2026-07-18T00:00:00.000Z');
    assert.ok(/flexible packaging/i.test(personalCareVersion.body.subject));
    assert.ok(/liquid detergent/i.test(personalCareVersion.body.subject));
    assert.ok(!/\b\d+\s*(?:kg|g)\b/i.test(personalCareVersion.body.subject));
    assert.ok(/public liquid detergent, hand soap, body soap, and shampoo capabilities/i.test(personalCareVersion.body.body_en));
    assert.ok(/packaging sourcing and compatibility-testing process/i.test(personalCareVersion.body.body_en));
    assert.ok(/leak resistance/i.test(personalCareVersion.body.body_en));
    assert.ok(/https:\/\/gdhspack\.com\/id\/applications\/daily-chemical-packaging/.test(personalCareVersion.body.body_en));
    assert.ok(!/https:\/\/gdhspack\.com\/id\/products\/spout-pouches/.test(personalCareVersion.body.body_en));
    assert.ok(!/https:\/\/gdhspack\.com\/id\/about/.test(personalCareVersion.body.body_en));
    assert.strictEqual((personalCareVersion.body.body_en.match(/https?:\/\//g) || []).length, 1);
    assert.ok(/Terima kasih atas waktu Anda/.test(personalCareVersion.body.body_en));
    assert.ok(/tim pengadaan kemasan perusahaan Anda/.test(personalCareVersion.body.body_en));
    assert.ok(!/\bCSE\b/.test(personalCareVersion.body.body_en));
    assert.ok(!/\bsachets?\b|\broll film\b/i.test(personalCareVersion.body.body_en));
    assert.ok(/Gavin\nHuasheng Printing Co\., Ltd\./.test(personalCareVersion.body.body_en));
    assert.ok(!/with refill pouches among its packaging formats/i.test(personalCareVersion.body.body_en));
    assert.ok(!/一页针对性建议/.test(personalCareVersion.body.body_cn));
    assert.ok(/Gavin\n华胜印刷有限公司/.test(personalCareVersion.body.body_cn));
    assert.ok(!/shampoo, body wash, personal care/i.test(personalCareVersion.body.body_en));
    assert.ok(!/current material structure and expected annual volume/i.test(personalCareVersion.body.body_en));
    assert.strictEqual((personalCareVersion.body.body_en.match(/\?/g) || []).length, 1);
    assert.ok(personalCareVersion.body.body_en.split(/\n\s*\n/).length >= 4);
    const restoredPersonalCareVersion = await request(
      `/api/matrix/work-items/${personalCareWorkItemId}/versions/${personalCareVersion.body.id}`,
      { serviceToken: bridgeToken, openId: 'ou-service' }
    );
    assert.strictEqual(restoredPersonalCareVersion.status, 200, JSON.stringify(restoredPersonalCareVersion.body));
    assert.strictEqual(restoredPersonalCareVersion.body.id, personalCareVersion.body.id);
    assert.strictEqual(restoredPersonalCareVersion.body.work_item_id, personalCareWorkItemId);
    assert.strictEqual(restoredPersonalCareVersion.body.work_item_version, personalCareVersion.body.work_item_version);
    const personalCareItems = await request('/api/matrix/work-items', {
      serviceToken: bridgeToken, openId: 'ou-service'
    });
    assert.strictEqual(personalCareItems.status, 200, JSON.stringify(personalCareItems.body));
    const restoredPersonalCareItem = personalCareItems.body.rows.find(row => row.id === personalCareWorkItemId);
    assert.ok(restoredPersonalCareItem, 'created personal-care work item must remain discoverable');
    assert.strictEqual(restoredPersonalCareItem.current_stream_version_id, personalCareVersion.body.id);
    assert.strictEqual(restoredPersonalCareItem.stream_state, 'draft_pending');

    mutateCandidate(db => {
      db.prepare(`INSERT INTO cache_records VALUES (6,'Delta Foods','VN','','delta.test','https://delta.test/',
        '["spices","seasonings","sauces","soup bases"]','["sachets","spout pouches","roll film"]','["100+ SKUs"]','medium',
        'purchase@delta.test','','','https://delta.test/factory','P0',94,94,90,0.9,'valid',
        '公开信息确认','联系包装采购','observed','audited',NULL,
        '2026-07-18T00:00:00Z','2026-07-18T00:00:00Z','SECRET-COST-FORMULA')`).run();
      db.prepare("INSERT INTO cache_evidence VALUES (61,6,'https://delta.test/about','official_website','Company profile','2026-07-18T00:00:00Z','Food manufacturer with more than 100 SKUs and export markets','e61')").run();
      db.prepare("INSERT INTO cache_evidence VALUES (62,6,'https://delta.test/products','official_website','Sauces and seasonings','2026-07-18T00:00:00Z','Sauces, chili sauces, seasonings and soup bases; a separate HORECA range includes 1kg, 5kg and 10kg bulk packs','e62')").run();
      db.prepare("INSERT INTO cache_evidence VALUES (63,6,'https://delta.test/factory','official_website','Manufacturing Process and Packaging Inspection','2026-07-18T00:00:00Z','Factory performs incoming packaging and label inspection','e63')").run();
      db.prepare("INSERT INTO cache_evidence VALUES (64,6,'https://delta.test/purchasing','official_website','Supplier evaluation','2026-07-18T00:00:00Z','Purchasing department performs a periodic supplier-evaluation process','e64')").run();
      db.prepare("INSERT INTO cache_evidence VALUES (65,6,'https://delta.test/quality','official_website','Quality workflow','2026-07-18T00:00:00Z','Quality testing and non-conforming shipment controls','e65')").run();
      db.prepare("INSERT INTO cache_evidence VALUES (66,6,'https://delta.test/contact','official_contact','Purchasing contact','2026-07-18T00:00:00Z','Official packaging purchasing email purchase@delta.test','e66')").run();
      db.prepare(`INSERT INTO cache_strategy_signals VALUES
        (6,6,'Printed sachets, spout pouches or roll film for sauces, seasonings and soup bases',
        'Filling method, seal compatibility, contamination control and repeat-print consistency',
        'Reach packaging purchasing with one representative SKU',
        '["pack photo","dimensions","fill weight or volume","filling method","quantity"]',
        '["Current flexible-packaging format and supplier are not confirmed"]',
        'https://delta.test/factory','2026-07-18T00:00:00Z','strategy-6')`).run();
    });
    let foodWorkItemId;
    mutateApp(db => {
      foodWorkItemId = Number(db.prepare(`INSERT INTO matrix_work_items
        (candidate_id,stage,owner_user_id,current_summary,next_action,version,created_at,updated_at,stream_state)
        VALUES (6,'selected',103,'','联系包装采购',1,?,?, 'selected')`).run('2026-07-18T00:00:00Z','2026-07-18T00:00:00Z').lastInsertRowid);
    });
    const foodVersion = await request(`/api/matrix/work-items/${foodWorkItemId}/versions`, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 1, idempotency_key: 'draft-food-sauce-1' }
    });
    assert.strictEqual(foodVersion.status, 201, JSON.stringify(foodVersion.body));
    assert.match(foodVersion.body.subject, /sauce|seasoning/i);
    assert.match(foodVersion.body.body_en, /packaging and label inspection/i);
    assert.match(foodVersion.body.body_en, /supplier-evaluation process/i);
    assert.match(foodVersion.body.body_en, /one current pack photo/i);
    assert.match(foodVersion.body.body_en, /https:\/\/gdhspack\.com\/vi\/applications\/sauce-packaging/);
    assert.strictEqual((foodVersion.body.body_en.match(/https?:\/\//g) || []).length, 1);
    assert.match(foodVersion.body.body_en, /Cảm ơn Quý công ty/);
    assert.doesNotMatch(foodVersion.body.body_en, /current pouch supplier|guarantee|final structure/i);
    assert.strictEqual(JSON.parse(foodVersion.body.quality_json).passed, true);
    assert.strictEqual(foodVersion.body.status, 'draft');

    const createdVersion = await request(`/api/matrix/work-items/${firstSelection.body.work_item_id}/versions`, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 1, idempotency_key: 'draft-api-1' }
    });
    assert.strictEqual(createdVersion.status, 201, JSON.stringify(createdVersion.body));
    assert.strictEqual(createdVersion.body.revision, 1);
    assert.strictEqual(createdVersion.body.recipient_email, 'team@alpha.test');
    assert.strictEqual(createdVersion.body.recipient_source_url, 'https://alpha.test/contact');
    assert.strictEqual(createdVersion.body.work_item_version, 2);
    assert.ok(createdVersion.body.quality_score >= 80);
    assert.strictEqual(JSON.parse(createdVersion.body.quality_json).passed, true);
    assert.strictEqual(JSON.parse(createdVersion.body.source_snapshot_json).country_code, 'VN');
    mutateCandidate(db => {
      db.prepare("UPDATE cache_records SET public_email='', contact_url='' WHERE id=1").run();
      db.prepare('DELETE FROM cache_evidence WHERE record_id=1').run();
    });
    const createdReplayState = reviewState(workItemId);
    const createdReplay = await request(versionRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 1, idempotency_key: 'draft-api-1' }
    });
    assert.strictEqual(createdReplay.status, 200, JSON.stringify(createdReplay.body));
    assert.strictEqual(createdReplay.body.id, createdVersion.body.id);
    assert.deepStrictEqual(reviewState(workItemId), createdReplayState, 'create replay must not write');
    await assertFailedWithoutReviewWrite('create replay request mismatch', 409, () => request(versionRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 2, idempotency_key: 'draft-api-1' }
    }));
    await assertFailedWithoutReviewWrite('new create key revalidates drifted candidate', 400, () => request(versionRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 2, idempotency_key: 'draft-api-drifted-candidate' }
    }));
    mutateCandidate(db => {
      db.prepare("UPDATE cache_records SET public_email='team@alpha.test', contact_url='https://alpha.test/contact' WHERE id=1").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (1,1,'https://alpha.test/products','official_website','Products','2026-07-17T00:00:00Z','250g and 500g roasted coffee','e1')").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (11,1,'https://alpha.test/about','official_website','Company profile','2026-07-17T00:00:00Z','Coffee manufacturer with export production capacity','e11')").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (12,1,'https://alpha.test/services','official_website','Packaging development service','2026-07-17T00:00:00Z','Packaging development, filling review and artwork control','e12')").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (13,1,'https://alpha.test/quality','official_website','Quality testing','2026-07-17T00:00:00Z','Quality testing and production traceability','e13')").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (14,1,'https://alpha.test/sustainability','official_website','Sustainable packaging','2026-07-17T00:00:00Z','Recyclable packaging and material efficiency','e14')").run();
      db.prepare("INSERT OR REPLACE INTO cache_evidence VALUES (15,1,'https://alpha.test/contact','official_website','Supplier contact','2026-07-17T00:00:00Z','Packaging sourcing and procurement contact','e15')").run();
    });

    await assertFailedWithoutReviewWrite('unknown revision field', 400, () => request(versionRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 2, base_version_id: createdVersion.body.id, revision_instruction: '更简洁', subject: 'client supplied', idempotency_key: 'bad-revision-field' }
    }));
    const unavailableRevision = await assertFailedWithoutReviewWrite('bounded text provider unavailable', 503, () => request(versionRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 2, base_version_id: createdVersion.body.id, revision_instruction: '语气更简洁，询问年用量', idempotency_key: 'revision-provider-unavailable' }
    }));
    assert.deepStrictEqual(unavailableRevision.body, {
      error: { code: 'text_provider_unavailable', message: 'Text revision service is unavailable.' }
    });

    const approveRoute = `${versionRoute}/${createdVersion.body.id}/approve`;
    await assertFailedWithoutReviewWrite('stale approval work version', 409, () => request(approveRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 1, expected_content_hash: createdVersion.body.content_hash, idempotency_key: 'stale-approve' }
    }));
    await assertFailedWithoutReviewWrite('stale approval hash', 400, () => request(approveRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 2, expected_content_hash: '0'.repeat(64), idempotency_key: 'stale-hash' }
    }));
    await assertFailedWithoutReviewWrite('unknown approval field', 400, () => request(approveRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 2, expected_content_hash: createdVersion.body.content_hash, recipient_email: 'other@outside.test', idempotency_key: 'bad-approve-field' }
    }));

    const approvedVersion = await request(approveRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 2, expected_content_hash: createdVersion.body.content_hash, idempotency_key: 'approve-api-1' }
    });
    assert.strictEqual(approvedVersion.status, 200, JSON.stringify(approvedVersion.body));
    assert.strictEqual(approvedVersion.body.status, 'approved');
    assert.strictEqual(approvedVersion.body.work_item_version, 3);
    const approvedReplayState = reviewState(workItemId);
    const approvedReplay = await request(approveRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 2, expected_content_hash: createdVersion.body.content_hash, idempotency_key: 'approve-api-1' }
    });
    assert.strictEqual(approvedReplay.status, 200, JSON.stringify(approvedReplay.body));
    assert.strictEqual(approvedReplay.body.id, approvedVersion.body.id);
    assert.deepStrictEqual(reviewState(workItemId), approvedReplayState, 'approval replay must not write');
    await assertFailedWithoutReviewWrite('approval replay hash mismatch', 409, () => request(approveRoute, {
      method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
      body: { expected_work_version: 2, expected_content_hash: 'f'.repeat(64), idempotency_key: 'approve-api-1' }
    }));

    const preview = await request(`${versionRoute}/${createdVersion.body.id}/preview`, {
      serviceToken: bridgeToken, openId: 'ou-service'
    });
    assert.strictEqual(preview.status, 200, JSON.stringify(preview.body));
    assert.strictEqual(preview.body.allowed, false);
    for (const gate of ['duplicate', 'cooling', 'quota', 'readiness', 'policy']) {
      assert.deepStrictEqual(preview.body[gate], { ok: false, reasons: ['preview_gate_unavailable'] });
    }
    assert.strictEqual(preview.body.version.id, createdVersion.body.id);
    assert.strictEqual(preview.body.version.recipient_email, 'team@alpha.test');
    assert.strictEqual(preview.body.version.subject, createdVersion.body.subject);
    assert.strictEqual(preview.body.version.body_en, createdVersion.body.body_en);
    assert.strictEqual(preview.body.version.body_cn, createdVersion.body.body_cn);
    assert.strictEqual(preview.body.work_item_version, 3);
    assert.strictEqual(reviewState(workItemId).jobs, 0, 'preview must never create a delivery job');
    await assertFailedWithoutReviewWrite('preview path work-item mismatch', 404, () => request(`/api/matrix/work-items/99999/versions/${createdVersion.body.id}/preview`, {
      serviceToken: bridgeToken, openId: 'ou-service'
    }));

    await stopServer();
    const injectedPort = port + 1000;
    const injectedDb = new Database(appDbPath);
    const injectedReviewService = { ...matrixReviewService };
    let providerCalls = 0;
    let providerImpl = async ({ current }) => ({
      subject: current.subject,
      body_en: current.body_en,
      body_cn: current.body_cn
    });
    const injectedTextService = {
      revise(input) {
        providerCalls += 1;
        return providerImpl(input);
      }
    };
    const claimOptions = { leaseMs: 5000, waitMs: 1000, pollMs: 10 };
    const deliveryCalls = [];
    let deliveryImpl = async () => ({ state: 'accepted', error_class: '', work_item_version: 4, message_id: '<must-not-leave-api@sender.test>' });
    const injectedDeliveryService = {
      async confirm(input) {
        deliveryCalls.push(input);
        return deliveryImpl(input);
      }
    };
    const ledgerCommandCalls = [];
    const injectedLedgerCommand = {
      customerSnapshot(input) {
        return {
          customer_id: input.customerId,
          stage: 'waiting_customer',
          last_delivery_state: 'accepted',
          pending_task: { type: 'check_reply', due_at: '2026-07-26T11:32:16.000Z' },
          next_action: '等待客户回复'
        };
      },
      threadList(input) {
        return { customer_id: input.customerId, rows: [{ id: 31, state: 'waiting_customer' }] };
      },
      taskList(input) {
        return { customer_id: input.customerId, rows: [{ id: 41, type: 'check_reply', state: 'pending' }] };
      },
      async finalPreview(input) {
        if (input.customerId === 404) throw new Error('canonical customer not found');
        ledgerCommandCalls.push({ kind: 'preview', ...input });
        return { customer_id: input.customerId, customer_name: 'UNITEA Kazakhstan', contact_id: 9, recipient: 'procurement@unitea.kz', subject: 'Tea pouch and roll-film review for one UNITEA SKU', body_en: 'exact body', body_cn: '准确中文', attachments: [], version_id: createdVersion.body.id, content_hash: createdVersion.body.content_hash, allowed: true, blockers: [] };
      },
      async confirmDelivery(input) {
        if (input.customerId === 88) throw new Error('stale research or route readiness');
        if (input.customerId === 404) throw new Error('canonical customer not found');
        if (input.customerId === 77) throw new Error('delivery confirmation expired');
        if (input.customerId === 78) throw new Error('delivery confirmation version missing');
        ledgerCommandCalls.push({ kind: 'confirm', ...input });
        return { state: 'accepted', error_class: '', work_item_version: 4 };
      }
    };
    const replyDraftCalls = [];
    const intakeCalls = [];
    let firstIntakeSubject = '';
    const injectedIntakeBridge = {
      async create(input) {
        intakeCalls.push(input);
        if (firstIntakeSubject && input.subject !== firstIntakeSubject) throw new Error('intake idempotency conflict');
        if (!firstIntakeSubject) firstIntakeSubject = input.subject;
        if (intakeCalls.length > 1) return {
          customer_id: 61, work_item_id: 62, work_item_version: 2,
          version_id: 63, content_hash: 'intake-hash', status: 'draft', resolution: 'replayed'
        };
        return {
          customer_id: 61, work_item_id: 62, work_item_version: 2,
          version_id: 63, content_hash: 'intake-hash', status: 'draft', resolution: 'inserted'
        };
      }
    };
    const injectedCorrelationService = {
      startReplyDraft(_db, input) {
        replyDraftCalls.push(input);
        return { notification_id: input.notificationId, work_item_id: workItemId, state: 'draft_pending' };
      },
      async retryInboundTranslation(_db, input) {
        replyDraftCalls.push({ retry: true, ...input });
        return { notification_id: input.notificationId, translation_status: 'ready', retry_available: false };
      },
      claimNotification(_db, input) {
        replyDraftCalls.push({ claim: true, ...input });
        return { id: 51, notification_key: '00000000-0000-4000-8000-000000000051', claim_token: '00000000-0000-4000-8000-000000000052', delivery_state: 'inflight', work_item_id: workItemId, job_id: 71, kind: 'reply', original_preview: 'Hello', translation_status: 'pending', translation_cn: '', requirements_cn: '', work_item_state: 'replied', attempt_count: 1 };
      },
      ackNotification(_db, input) {
        replyDraftCalls.push({ ack: true, ...input });
        return { notification_id: input.notificationId, delivery_state: 'delivered' };
      },
      nackNotification(_db, input) {
        replyDraftCalls.push({ nack: true, ...input });
        return { notification_id: input.notificationId, delivery_state: input.outcome === 'ambiguous' ? 'manual_review' : 'pending' };
      },
      notificationStatus(_db, input) {
        replyDraftCalls.push({ status: true, ...input });
        return { notification_id: input.notificationId, delivery_state: 'delivered', can_deliver: false };
      }
    };
    const injectedApp = express();
    injectedApp.use(express.json());
    injectedApp.use('/api/matrix', createMatrixBridgeAuth({ db: injectedDb, bridgeToken }));
    injectedApp.use('/api/matrix', createMatrixRouter({
      db: injectedDb,
      audit: () => undefined,
      candidateDbPath,
      reviewService: injectedReviewService,
      deliveryService: injectedDeliveryService,
      ledgerCommand: injectedLedgerCommand,
      correlationService: injectedCorrelationService,
      intakeBridge: injectedIntakeBridge,
      intakeCandidateResolver: id => id === 1 ? {
        id: 1, company_name: 'Alpha Coffee', official_domain: 'alpha.test',
        status: 'valid', audit_state: 'audited',
        audited_at: '2026-07-18T00:00:00.000Z', updated_at: '2026-07-18T00:00:00.000Z',
        contacts: { email: 'team@alpha.test', contact_page: 'https://alpha.test/contact' }
      } : null,
      intakeReviewedResolver: id => id === 1 ? {
        request_fingerprint: 'candidate-fingerprint-1',
        route_readiness_json: JSON.stringify({ id: 'food_sauce:VN', status: 'ready' })
      } : null,
      textService: injectedTextService,
      claimOptions
    }));
    const injectedServer = await new Promise((resolve, reject) => {
      const server = injectedApp.listen(injectedPort, '127.0.0.1', () => resolve(server));
      server.once('error', reject);
    });
    try {
      const intakeBody = {
        candidate_id: 1,
        expected_candidate_fingerprint: 'candidate-fingerprint-1',
        subject: 'Exact subject',
        body_en: 'Exact English body',
        body_cn: '准确中文正文',
        strategy_summary: 'Exact reviewed strategy',
        attachment_manifest: [],
        route_readiness_id: 'food_sauce:VN',
        approval_reference: 'current-session:A',
        idempotency_key: 'intake-api-1'
      };
      const intakeCreated = await request('/api/matrix/intakes', {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: intakeBody
      });
      assert.strictEqual(intakeCreated.status, 201, JSON.stringify(intakeCreated.body));
      assert.strictEqual(intakeCreated.body.status, 'draft');
      assert.strictEqual(intakeCalls.length, 1);
      assert.strictEqual(intakeCalls[0].candidate.normalized_domain, 'alpha.test');
      assert.strictEqual(intakeCalls[0].candidate.public_email, 'team@alpha.test');
      assert.strictEqual(intakeCalls[0].candidate.contact_url, 'https://alpha.test/contact');
      const intakeReplay = await request('/api/matrix/intakes', {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: intakeBody
      });
      assert.strictEqual(intakeReplay.status, 200, JSON.stringify(intakeReplay.body));
      assert.strictEqual(intakeReplay.body.resolution, 'replayed');
      const intakeConflict = await request('/api/matrix/intakes', {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: { ...intakeBody, subject: 'Changed subject' }
      });
      assert.strictEqual(intakeConflict.status, 409, JSON.stringify(intakeConflict.body));
      const intakeUnknown = await request('/api/matrix/intakes', {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: { ...intakeBody, send: true }
      });
      assert.strictEqual(intakeUnknown.status, 400);
      const intakeWorker = await request('/api/matrix/intakes', {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-worker', body: intakeBody
      });
      assert.strictEqual(intakeWorker.status, 403);
      const ledgerPreview = await request(`/api/matrix/customers/1/final-preview?version_id=${createdVersion.body.id}`, {
        port: injectedPort, serviceToken: bridgeToken, openId: 'ou-service'
      });
      assert.strictEqual(ledgerPreview.status, 200, JSON.stringify(ledgerPreview.body));
      assert.strictEqual(ledgerPreview.body.allowed, true);
      const ledgerCustomer = await request('/api/matrix/customers/1', {
        port: injectedPort, serviceToken: bridgeToken, openId: 'ou-service'
      });
      assert.strictEqual(ledgerCustomer.status, 200, JSON.stringify(ledgerCustomer.body));
      assert.deepStrictEqual(ledgerCustomer.body, {
        customer_id: 1,
        stage: 'waiting_customer',
        last_delivery_state: 'accepted',
        pending_task: { type: 'check_reply', due_at: '2026-07-26T11:32:16.000Z' },
        next_action: '等待客户回复'
      });
      const ledgerThreads = await request('/api/matrix/customers/1/threads', {
        port: injectedPort, serviceToken: bridgeToken, openId: 'ou-service'
      });
      assert.strictEqual(ledgerThreads.status, 200, JSON.stringify(ledgerThreads.body));
      assert.strictEqual(ledgerThreads.body.rows[0].state, 'waiting_customer');
      const ledgerTasks = await request('/api/matrix/customers/1/tasks', {
        port: injectedPort, serviceToken: bridgeToken, openId: 'ou-service'
      });
      assert.strictEqual(ledgerTasks.status, 200, JSON.stringify(ledgerTasks.body));
      assert.strictEqual(ledgerTasks.body.rows[0].type, 'check_reply');
      const missingLedgerPreview = await request(`/api/matrix/customers/404/final-preview?version_id=${createdVersion.body.id}`, {
        port: injectedPort, serviceToken: bridgeToken, openId: 'ou-service'
      });
      assert.strictEqual(missingLedgerPreview.status, 404, JSON.stringify(missingLedgerPreview.body));
      const ledgerConfirmRoute = `/api/matrix/customers/1/final-preview/${createdVersion.body.id}/confirm`;
      const ledgerConfirmBody = {
        expected_content_hash: createdVersion.body.content_hash,
        confirmation_text: '确认发送 UNITEA Kazakhstan',
        chat_id: 'ledger-chat',
        card_event_id: 'ledger-card',
        idempotency_key: 'ledger-api-1'
      };
      const ledgerConfirmed = await request(ledgerConfirmRoute, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: ledgerConfirmBody
      });
      assert.deepStrictEqual(ledgerConfirmed, { status: 200, body: { state: 'accepted', error_class: '', work_item_version: 4 } });
      assert.strictEqual(ledgerCommandCalls.filter(call => call.kind === 'confirm').length, 1);
      const ledgerReplay = await request(ledgerConfirmRoute, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: ledgerConfirmBody
      });
      assert.deepStrictEqual(ledgerReplay, ledgerConfirmed);
      assert.strictEqual(ledgerCommandCalls.filter(call => call.kind === 'confirm').length, 1, 'exact ledger confirmation replay must not execute twice');
      const ledgerMismatch = await request(ledgerConfirmRoute, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: { ...ledgerConfirmBody, confirmation_text: '确认发送 another customer' }
      });
      assert.strictEqual(ledgerMismatch.status, 409, JSON.stringify(ledgerMismatch.body));
      const rejectedLedgerField = await request(ledgerConfirmRoute, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: { ...ledgerConfirmBody, recipient: 'outside@test' }
      });
      assert.strictEqual(rejectedLedgerField.status, 400);
      const staleLedgerConfirm = await request(`/api/matrix/customers/88/final-preview/${createdVersion.body.id}/confirm`, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: { ...ledgerConfirmBody, idempotency_key: 'ledger-api-stale-research' }
      });
      assert.strictEqual(staleLedgerConfirm.status, 409, JSON.stringify(staleLedgerConfirm.body));
      const missingLedgerConfirm = await request('/api/matrix/customers/1/final-preview/999999/confirm', {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: { ...ledgerConfirmBody, idempotency_key: 'ledger-api-missing-version' }
      });
      assert.strictEqual(missingLedgerConfirm.status, 404, JSON.stringify(missingLedgerConfirm.body));
      const expiredLedgerConfirm = await request(`/api/matrix/customers/77/final-preview/${createdVersion.body.id}/confirm`, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: { ...ledgerConfirmBody, idempotency_key: 'ledger-api-expired' }
      });
      assert.strictEqual(expiredLedgerConfirm.status, 409, JSON.stringify(expiredLedgerConfirm.body));
      const missingStateLedgerConfirm = await request(`/api/matrix/customers/78/final-preview/${createdVersion.body.id}/confirm`, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: { ...ledgerConfirmBody, idempotency_key: 'ledger-api-missing-state' }
      });
      assert.strictEqual(missingStateLedgerConfirm.status, 404, JSON.stringify(missingStateLedgerConfirm.body));
      assert.strictEqual(ledgerCommandCalls.filter(call => call.kind === 'confirm').length, 1, 'failed canonical validation must not invoke delivery');
      const sendRoute = `${versionRoute}/${createdVersion.body.id}/send`;
      const sendBody = {
        expected_work_version: 3,
        expected_content_hash: createdVersion.body.content_hash,
        chat_id: 'chat-send-api',
        card_event_id: 'card-send-api',
        idempotency_key: 'send-api-1'
      };
      const sent = await request(sendRoute, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: sendBody
      });
      assert.deepStrictEqual(sent, {
        status: 200,
        body: { state: 'accepted', error_class: '', work_item_version: 4 }
      });
      assert.strictEqual(deliveryCalls.length, 1);
      assert.deepStrictEqual(deliveryCalls[0], {
        actorUserId: 103,
        bindingId: 1,
        workItemId,
        versionId: createdVersion.body.id,
        expectedWorkVersion: 3,
        expectedContentHash: createdVersion.body.content_hash,
        chatId: 'chat-send-api',
        cardEventId: 'card-send-api',
        idempotencyKey: 'send-api-1'
      });
      deliveryImpl = async () => { throw new Error('delivery in progress timeout'); };
      const timedOut = await request(sendRoute, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: { ...sendBody, idempotency_key: 'send-api-timeout-1' }
      });
      assert.deepStrictEqual(timedOut, {
        status: 503,
        body: { error: { code: 'delivery_in_progress', message: 'Delivery confirmation is still in progress.' } }
      });
      deliveryImpl = async () => ({ state: 'accepted', error_class: '', work_item_version: 4 });
      for (const field of ['recipient', 'subject', 'body', 'smtp_host', 'callback_url', 'attachment', 'retry']) {
        const rejected = await request(sendRoute, {
          port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
          body: { ...sendBody, idempotency_key: `send-api-reject-${field}`, [field]: true }
        });
        assert.strictEqual(rejected.status, 400, `${field}: ${JSON.stringify(rejected.body)}`);
      }
      assert.strictEqual(deliveryCalls.length, 2, 'unknown send fields must be rejected before delivery service');

      const replyDraft = await request('/api/matrix/notifications/41/reply-draft', {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: {}
      });
      assert.deepStrictEqual(replyDraft, {
        status: 200,
        body: { notification_id: 41, work_item_id: workItemId, state: 'draft_pending' }
      });
      assert.strictEqual(replyDraftCalls.length, 1);
      assert.strictEqual(replyDraftCalls[0].actorUserId, 103);
      assert.strictEqual(replyDraftCalls[0].notificationId, 41);
      const rejectedReplyDraft = await request('/api/matrix/notifications/41/reply-draft', {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: { send: true }
      });
      assert.strictEqual(rejectedReplyDraft.status, 400);
      assert.strictEqual(replyDraftCalls.length, 1, 'reply draft route must reject delivery-like fields');
      const retriedTranslation = await request('/api/matrix/notifications/42/retry-translation', {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: {}
      });
      assert.deepStrictEqual(retriedTranslation, {
        status: 200,
        body: { notification_id: 42, translation_status: 'ready', retry_available: false }
      });
      assert.strictEqual(replyDraftCalls.at(-1).retry, true);
      const claimedNotification = await request('/api/matrix/notifications/claim', {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: {}
      });
      assert.strictEqual(claimedNotification.status, 200);
      assert.strictEqual(claimedNotification.body.notification.id, 51);
      assert.strictEqual(replyDraftCalls.at(-1).bindingId, 1);
      const ackedNotification = await request('/api/matrix/notifications/51/ack', {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: { claim_token: '00000000-0000-4000-8000-000000000052', receipt_id: 'message-51' }
      });
      assert.deepStrictEqual(ackedNotification, { status: 200, body: { notification_id: 51, delivery_state: 'delivered' } });
      const nackedNotification = await request('/api/matrix/notifications/51/nack', {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: { claim_token: '00000000-0000-4000-8000-000000000052', outcome: 'ambiguous' }
      });
      assert.deepStrictEqual(nackedNotification, { status: 200, body: { notification_id: 51, delivery_state: 'manual_review' } });
      const notificationStatus = await request('/api/matrix/notifications/51/status', {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: { claim_token: '00000000-0000-4000-8000-000000000052' }
      });
      assert.deepStrictEqual(notificationStatus, { status: 200, body: { notification_id: 51, delivery_state: 'delivered', can_deliver: false } });
      const rejectedClaim = await request('/api/matrix/notifications/claim', {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: { limit: 2 }
      });
      assert.strictEqual(rejectedClaim.status, 400);

      const reviseBody = {
        expected_work_version: 3,
        base_version_id: createdVersion.body.id,
        revision_instruction: '保持证据边界并缩短措辞',
        idempotency_key: 'revision-api-success-1'
      };
      const revisedVersion = await request(versionRoute, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: reviseBody
      });
      assert.strictEqual(revisedVersion.status, 201, JSON.stringify(revisedVersion.body));
      assert.strictEqual(revisedVersion.body.revision, 2);
      assert.strictEqual(providerCalls, 1);
      const historicalReplayState = reviewState(workItemId);
      const historicalCreateReplay = await request(versionRoute, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: { expected_work_version: 1, idempotency_key: 'draft-api-1' }
      });
      assert.strictEqual(historicalCreateReplay.status, 200, JSON.stringify(historicalCreateReplay.body));
      assert.strictEqual(historicalCreateReplay.body.status, 'draft');
      assert.strictEqual(historicalCreateReplay.body.current_status, 'superseded');
      assert.strictEqual(historicalCreateReplay.body.work_item_version, 2);
      assert.strictEqual(historicalCreateReplay.body.current_work_item_version, 4);
      const historicalApprovalReplay = await request(approveRoute, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: { expected_work_version: 2, expected_content_hash: createdVersion.body.content_hash, idempotency_key: 'approve-api-1' }
      });
      assert.strictEqual(historicalApprovalReplay.status, 200, JSON.stringify(historicalApprovalReplay.body));
      assert.strictEqual(historicalApprovalReplay.body.status, 'approved');
      assert.strictEqual(historicalApprovalReplay.body.current_status, 'superseded');
      assert.strictEqual(historicalApprovalReplay.body.work_item_version, 3);
      assert.strictEqual(historicalApprovalReplay.body.current_work_item_version, 4);
      assert.deepStrictEqual(reviewState(workItemId), historicalReplayState, 'historical replay must return snapshots without writing');
      const revisedReplayState = reviewState(workItemId);
      const revisedReplay = await request(versionRoute, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: reviseBody
      });
      assert.strictEqual(revisedReplay.status, 200, JSON.stringify(revisedReplay.body));
      assert.strictEqual(revisedReplay.body.id, revisedVersion.body.id);
      assert.strictEqual(providerCalls, 1, 'exact revision replay must not call provider again');
      assert.deepStrictEqual(reviewState(workItemId), revisedReplayState, 'revision replay must not write');

      const changedInstruction = await request(versionRoute, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: { ...reviseBody, revision_instruction: '不同指令' }
      });
      assert.strictEqual(changedInstruction.status, 409, JSON.stringify(changedInstruction.body));
      assert.strictEqual(providerCalls, 1, 'idempotency mismatch must precede provider');
      assert.deepStrictEqual(reviewState(workItemId), revisedReplayState, 'revision mismatch must not write');
      const changedScope = await request(versionRoute, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: { ...reviseBody, base_version_id: revisedVersion.body.id }
      });
      assert.strictEqual(changedScope.status, 409, JSON.stringify(changedScope.body));
      assert.strictEqual(providerCalls, 1, 'idempotency scope mismatch must precede provider');
      assert.deepStrictEqual(reviewState(workItemId), revisedReplayState, 'revision scope mismatch must not write');

      const staleNewRevision = await request(versionRoute, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: { ...reviseBody, idempotency_key: 'revision-api-stale-new-key' }
      });
      assert.strictEqual(staleNewRevision.status, 409, JSON.stringify(staleNewRevision.body));
      assert.strictEqual(providerCalls, 1, 'new stale revision must fail before provider');
      assert.deepStrictEqual(reviewState(workItemId), revisedReplayState, 'new stale revision must not write');

      const bindingEntered = {};
      bindingEntered.promise = new Promise(resolve => { bindingEntered.resolve = resolve; });
      const bindingRelease = {};
      bindingRelease.promise = new Promise(resolve => { bindingRelease.resolve = resolve; });
      providerImpl = async ({ current }) => {
        bindingEntered.resolve();
        await bindingRelease.promise;
        return { subject: current.subject, body_en: current.body_en, body_cn: current.body_cn };
      };
      const bindingRaceState = reviewState(workItemId);
      const bindingRaceRequest = request(versionRoute, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: {
          expected_work_version: 4,
          base_version_id: revisedVersion.body.id,
          revision_instruction: 'binding race',
          idempotency_key: 'revision-binding-race'
        }
      });
      await bindingEntered.promise;
      mutateApp(db => db.prepare("UPDATE matrix_actor_bindings SET status='revoked', revoked_at='2026-07-18T00:00:00Z' WHERE feishu_open_id='ou-service'").run());
      bindingRelease.resolve();
      const bindingRace = await bindingRaceRequest;
      assert.strictEqual(bindingRace.status, 403, JSON.stringify(bindingRace.body));
      assert.deepStrictEqual(reviewState(workItemId), bindingRaceState, 'binding revocation during provider wait must write nothing');
      mutateApp(db => db.prepare("UPDATE matrix_actor_bindings SET status='active', revoked_at=NULL WHERE feishu_open_id='ou-service'").run());

      const capabilityEntered = {};
      capabilityEntered.promise = new Promise(resolve => { capabilityEntered.resolve = resolve; });
      const capabilityRelease = {};
      capabilityRelease.promise = new Promise(resolve => { capabilityRelease.resolve = resolve; });
      providerImpl = async ({ current }) => {
        capabilityEntered.resolve();
        await capabilityRelease.promise;
        return { subject: current.subject, body_en: current.body_en, body_cn: current.body_cn };
      };
      const capabilityRaceState = reviewState(workItemId);
      const capabilityRaceRequest = request(versionRoute, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: {
          expected_work_version: 4,
          base_version_id: revisedVersion.body.id,
          revision_instruction: 'capability race',
          idempotency_key: 'revision-capability-race'
        }
      });
      await capabilityEntered.promise;
      mutateApp(db => db.prepare('UPDATE users SET permissions_json=? WHERE id=103').run(JSON.stringify({ modules: { crm: true }, capabilities: { matrixSend: false } })));
      capabilityRelease.resolve();
      const capabilityRace = await capabilityRaceRequest;
      assert.strictEqual(capabilityRace.status, 403, JSON.stringify(capabilityRace.body));
      assert.deepStrictEqual(reviewState(workItemId), capabilityRaceState, 'capability revocation during provider wait must write nothing');
      mutateApp(db => db.prepare('UPDATE users SET permissions_json=? WHERE id=103').run(JSON.stringify({ modules: { crm: true }, capabilities: { matrixSend: true } })));

      const rawDiagnostic = 'upstream SECRET_TOKEN=abc /srv/private/provider.js SELECT * FROM users SQLITE_BUSY';
      providerImpl = async () => { throw new Error(rawDiagnostic); };
      const providerFailureState = reviewState(workItemId);
      const providerFailure = await request(versionRoute, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: {
          expected_work_version: 4,
          base_version_id: revisedVersion.body.id,
          revision_instruction: 'provider failure',
          idempotency_key: 'revision-provider-raw-failure'
        }
      });
      assert.strictEqual(providerFailure.status, 503, JSON.stringify(providerFailure.body));
      assert.deepStrictEqual(providerFailure.body, {
        error: { code: 'text_provider_failure', message: 'Text revision service is temporarily unavailable.' }
      });
      assert.ok(!JSON.stringify(providerFailure.body).includes(rawDiagnostic));
      assert.ok(!/SECRET_TOKEN|\/srv\/private|SELECT \*|SQLITE_BUSY/.test(JSON.stringify(providerFailure.body)));
      assert.deepStrictEqual(reviewState(workItemId), providerFailureState, 'provider failure must write nothing');

      const originalApproveVersion = injectedReviewService.approveVersion;
      injectedReviewService.approveVersion = () => { throw new Error('SQLITE_CONSTRAINT at /srv/private/app.db SMTP_PASS=hunter2'); };
      const internalFailureState = reviewState(workItemId);
      const internalFailure = await request(`${versionRoute}/${revisedVersion.body.id}/approve`, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
        body: {
          expected_work_version: 4,
          expected_content_hash: revisedVersion.body.content_hash,
          idempotency_key: 'approve-internal-failure'
        }
      });
      assert.strictEqual(internalFailure.status, 500, JSON.stringify(internalFailure.body));
      assert.deepStrictEqual(internalFailure.body, {
        error: { code: 'internal_error', message: 'Review request could not be completed.' }
      });
      assert.ok(!/SQLITE|\/srv\/private|SMTP_PASS|hunter2/.test(JSON.stringify(internalFailure.body)));
      assert.deepStrictEqual(reviewState(workItemId), internalFailureState, 'internal failure must write nothing');
      injectedReviewService.approveVersion = originalApproveVersion;

      const concurrentEntered = {};
      concurrentEntered.promise = new Promise(resolve => { concurrentEntered.resolve = resolve; });
      const concurrentRelease = {};
      concurrentRelease.promise = new Promise(resolve => { concurrentRelease.resolve = resolve; });
      const concurrentCallsBefore = providerCalls;
      providerImpl = async ({ current }) => {
        concurrentEntered.resolve();
        await concurrentRelease.promise;
        return { subject: current.subject, body_en: current.body_en, body_cn: current.body_cn };
      };
      const concurrentBody = {
        expected_work_version: 4,
        base_version_id: revisedVersion.body.id,
        revision_instruction: 'concurrent exact revision',
        idempotency_key: 'revision-concurrent-exact'
      };
      const concurrentFirst = request(versionRoute, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: concurrentBody
      });
      await concurrentEntered.promise;
      const concurrentSecond = request(versionRoute, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: concurrentBody
      });
      const concurrentMismatch = await Promise.race([
        request(versionRoute, {
          port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service',
          body: { ...concurrentBody, revision_instruction: 'concurrent mismatched revision' }
        }),
        new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 250))
      ]);
      await new Promise(resolve => setTimeout(resolve, 25));
      concurrentRelease.resolve();
      const concurrentResults = await Promise.all([concurrentFirst, concurrentSecond]);
      assert.strictEqual(concurrentMismatch.timeout, undefined, 'active-claim mismatch must fail without waiting');
      assert.strictEqual(concurrentMismatch.status, 409, JSON.stringify(concurrentMismatch.body));
      assert.deepStrictEqual(concurrentResults.map(result => result.status).sort(), [200, 201]);
      assert.strictEqual(providerCalls - concurrentCallsBefore, 1, 'concurrent exact revisions must invoke provider once');
      assert.strictEqual(concurrentResults[0].body.id, concurrentResults[1].body.id);
      const concurrentDb = new Database(appDbPath, { readonly: true });
      try {
        assert.strictEqual(concurrentDb.prepare("SELECT COUNT(*) AS count FROM matrix_stream_api_requests WHERE idempotency_key='revision-concurrent-exact'").get().count, 1);
        assert.strictEqual(concurrentDb.prepare("SELECT COUNT(*) AS count FROM matrix_stream_events WHERE idempotency_key='revision-concurrent-exact'").get().count, 1);
      } finally {
        concurrentDb.close();
      }

      const concurrentVersion = concurrentResults.find(result => result.status === 201);
      const takeoverBody = {
        expected_work_version: 5,
        base_version_id: concurrentVersion.body.id,
        revision_instruction: 'crash takeover revision',
        idempotency_key: 'revision-crash-takeover'
      };
      const takeoverFingerprint = crypto.createHash('sha256').update(matrixReviewService.canonicalJson({
        action: 'revise',
        actorUserId: 103,
        workItemId,
        expectedWorkVersion: takeoverBody.expected_work_version,
        baseVersionId: takeoverBody.base_version_id,
        instruction: takeoverBody.revision_instruction
      })).digest('hex');
      const crashedAt = new Date().toISOString();
      mutateApp(db => db.prepare(`
        INSERT INTO matrix_stream_api_claims (
          idempotency_key, actor_user_id, work_item_id, action, request_fingerprint,
          owner_token, lease_expires_at, created_at, updated_at
        ) VALUES (?, 103, ?, 'revise', ?, 'crashed-owner', ?, ?, ?)
      `).run(takeoverBody.idempotency_key, workItemId, takeoverFingerprint, new Date(Date.now() + 5000).toISOString(), crashedAt, crashedAt));
      mutateApp(db => assert.throws(
        () => db.prepare("UPDATE matrix_stream_api_claims SET action='approve' WHERE idempotency_key=?").run(takeoverBody.idempotency_key),
        /identity is immutable/
      ));
      claimOptions.waitMs = 60;
      const callsBeforeTimeout = providerCalls;
      const waitTimeout = await request(versionRoute, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: takeoverBody
      });
      assert.strictEqual(waitTimeout.status, 503, JSON.stringify(waitTimeout.body));
      assert.deepStrictEqual(waitTimeout.body, {
        error: { code: 'review_in_progress', message: 'Review request is still in progress.' }
      });
      assert.strictEqual(providerCalls, callsBeforeTimeout, 'active claim wait timeout must not invoke provider');
      mutateApp(db => {
        const claim = db.prepare('SELECT owner_token FROM matrix_stream_api_claims WHERE idempotency_key=?').get(takeoverBody.idempotency_key);
        assert.strictEqual(claim.owner_token, 'crashed-owner', 'waiter must not delete another owner claim');
        db.prepare("UPDATE matrix_stream_api_claims SET lease_expires_at=?, updated_at=? WHERE idempotency_key=? AND owner_token='crashed-owner'")
          .run(new Date(Date.now() - 1000).toISOString(), new Date().toISOString(), takeoverBody.idempotency_key);
      });
      claimOptions.waitMs = 1000;
      providerImpl = async ({ current }) => ({
        subject: current.subject, body_en: current.body_en, body_cn: current.body_cn
      });
      const takeoverCallsBefore = providerCalls;
      const takeover = await request(versionRoute, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: takeoverBody
      });
      assert.strictEqual(takeover.status, 201, JSON.stringify(takeover.body));
      assert.strictEqual(takeover.body.work_item_version, 6);
      assert.strictEqual(providerCalls - takeoverCallsBefore, 1, 'expired claim takeover must invoke provider once');
      mutateApp(db => {
        assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM matrix_stream_api_claims WHERE idempotency_key=?').get(takeoverBody.idempotency_key).count, 0);
        assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM matrix_stream_api_requests WHERE idempotency_key=?').get(takeoverBody.idempotency_key).count, 1);
      });

      const leaseEntered = {};
      leaseEntered.promise = new Promise(resolve => { leaseEntered.resolve = resolve; });
      const leaseRelease = {};
      leaseRelease.promise = new Promise(resolve => { leaseRelease.resolve = resolve; });
      providerImpl = async ({ current }) => {
        leaseEntered.resolve();
        await leaseRelease.promise;
        return { subject: current.subject, body_en: current.body_en, body_cn: current.body_cn };
      };
      const leaseLossBody = {
        expected_work_version: 6,
        base_version_id: takeover.body.id,
        revision_instruction: 'lease ownership loss',
        idempotency_key: 'revision-lease-loss'
      };
      const leaseLossState = reviewState(workItemId);
      const leaseLossRequest = request(versionRoute, {
        port: injectedPort, method: 'POST', serviceToken: bridgeToken, openId: 'ou-service', body: leaseLossBody
      });
      await leaseEntered.promise;
      mutateApp(db => {
        const changed = db.prepare(`
          UPDATE matrix_stream_api_claims
          SET owner_token='replacement-owner', lease_expires_at=?, updated_at=?
          WHERE idempotency_key=?
        `).run(new Date(Date.now() + 5000).toISOString(), new Date().toISOString(), leaseLossBody.idempotency_key);
        assert.strictEqual(changed.changes, 1);
      });
      leaseRelease.resolve();
      const leaseLoss = await leaseLossRequest;
      assert.strictEqual(leaseLoss.status, 409, JSON.stringify(leaseLoss.body));
      assert.deepStrictEqual(leaseLoss.body, {
        error: { code: 'review_claim_lost', message: 'Review request lease was lost.' }
      });
      mutateApp(db => {
        assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM matrix_stream_api_requests WHERE idempotency_key=?').get(leaseLossBody.idempotency_key).count, 0);
        assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM matrix_stream_events WHERE idempotency_key=?').get(leaseLossBody.idempotency_key).count, 0);
        assert.strictEqual(db.prepare('DELETE FROM matrix_stream_api_claims WHERE idempotency_key=? AND owner_token=?')
          .run(leaseLossBody.idempotency_key, 'replacement-owner').changes, 1);
      });
      assert.deepStrictEqual(reviewState(workItemId), leaseLossState, 'lost lease must not commit a review transition');
    } finally {
      await new Promise(resolve => injectedServer.close(resolve));
      injectedDb.close();
    }

    const inspect = new Database(appDbPath, { readonly: true });
    try {
      assert.strictEqual(inspect.prepare("SELECT COUNT(*) n FROM matrix_selection_events WHERE idempotency_key = 'api-event-001'").get().n, 1);
      assert.strictEqual(inspect.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action = 'matrix_candidate_detail'").get().n, 2);
      assert.deepStrictEqual(
        inspect.prepare('SELECT action FROM matrix_stream_api_requests ORDER BY id').all().map(row => row.action),
        ['create', 'create', 'create', 'approve', 'approve', 'revise', 'revise', 'revise']
      );
      const persistedSession = JSON.stringify(inspect.prepare('SELECT snapshot_key, candidate_ids_json, filters_json FROM matrix_sessions WHERE id = ?').get(createdSession.body.id));
      assert.ok(!persistedSession.includes('Alpha Foods'));
      assert.ok(!persistedSession.includes('team@alpha.test'));
    } finally {
      inspect.close();
    }
    const immutableApiDb = new Database(appDbPath);
    try {
      assert.throws(() => immutableApiDb.prepare("UPDATE matrix_stream_api_requests SET action='approve' WHERE action='create'").run(), /immutable/);
      assert.throws(() => immutableApiDb.prepare('DELETE FROM matrix_stream_api_requests').run(), /immutable/);
    } finally {
      immutableApiDb.close();
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

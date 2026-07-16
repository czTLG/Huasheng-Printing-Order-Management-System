'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'packet-gate-'));
process.env.DB_PATH = path.join(tmpRoot, 'data', 'app.db');

const { db, initDb } = require('../src/db');
const { createPacketGate } = require('../src/lib/packetGate');

let clock = '2026-07-17T00:00:00.000Z';

try {
  initDb();
  initDb();

  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
  ['matrix_actor_bindings', 'matrix_sessions', 'matrix_work_items', 'matrix_selection_events'].forEach(name => {
    assert.ok(tables.has(name), `missing ${name}`);
  });

  const insertUser = db.prepare(`
    INSERT INTO users (id, username, password, role, status, created_at)
    VALUES (?, ?, 'test-only', 'manager', 'active', ?)
  `);
  insertUser.run(7, 'actor-seven', clock);
  insertUser.run(8, 'actor-eight', clock);
  insertUser.run(9, 'binding-admin', clock);

  const gate = createPacketGate({ db, now: () => clock });
  assert.strictEqual(gate.send, undefined);
  assert.strictEqual(gate.sendEmail, undefined);

  const binding7 = gate.bindActor({ feishuOpenId: 'ou-7', userId: 7, boundByUserId: 9 });
  const binding8 = gate.bindActor({ feishuOpenId: 'ou-8', userId: 8, boundByUserId: 9 });
  assert.strictEqual(binding7.user_id, 7);
  assert.strictEqual(binding8.user_id, 8);
  assert.strictEqual(gate.resolveActor({ feishuOpenId: 'ou-7' }).user_id, 7);
  assert.throws(
    () => gate.bindActor({ feishuOpenId: 'ou-7', userId: 8, boundByUserId: 9 }),
    /already bound/
  );

  assert.throws(
    () => gate.createSession({
      actorUserId: 7,
      feishuOpenId: 'ou-8',
      chatId: 'chat-cross-binding',
      filters: {},
      expiresAt: '2026-07-18T00:00:00.000Z'
    }),
    /not authorized/
  );

  const sessionCountBeforeUnsafeFilters = db.prepare('SELECT COUNT(*) n FROM matrix_sessions').get().n;
  assert.throws(
    () => gate.createSession({
      actorUserId: 7,
      feishuOpenId: 'ou-7',
      chatId: 'chat-unsafe-contact',
      filters: { region: 'europe', email: 'buyer@example.test' },
      expiresAt: '2026-07-18T00:00:00.000Z'
    }),
    /unknown filter/
  );
  assert.throws(
    () => gate.createSession({
      actorUserId: 7,
      feishuOpenId: 'ou-7',
      chatId: 'chat-unsafe-nested',
      filters: { category: { company: 'Candidate facts' } },
      expiresAt: '2026-07-18T00:00:00.000Z'
    }),
    /category filter/
  );
  assert.throws(
    () => gate.createSession({
      actorUserId: 7,
      feishuOpenId: 'ou-7',
      chatId: 'chat-unsafe-category',
      filters: { category: 'buyer@example.test' },
      expiresAt: '2026-07-18T00:00:00.000Z'
    }),
    /category filter/
  );
  assert.throws(
    () => gate.createSession({
      actorUserId: 7,
      feishuOpenId: 'ou-7',
      chatId: 'chat-unsafe-page-size',
      filters: { page_size: 21 },
      expiresAt: '2026-07-18T00:00:00.000Z'
    }),
    /page_size filter/
  );
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM matrix_sessions').get().n, sessionCountBeforeUnsafeFilters);

  const session = gate.createSession({
    actorUserId: 7,
    feishuOpenId: 'ou-7',
    chatId: 'chat-1',
    threadId: 'thread-1',
    filters: {
      region: 'europe', country: 'US', category: 'coffee',
      priority: 'P1', status: 'valid', page: 1, page_size: 20
    },
    expiresAt: '2026-07-18T00:00:00.000Z'
  });
  assert.strictEqual(session.version, 1);
  assert.deepStrictEqual(session.filters, {
    region: 'europe', country: 'US', category: 'coffee',
    priority: 'P1', status: 'valid', page: 1, page_size: 20
  });

  const updated = gate.updateSession({
    sessionId: session.id,
    actorUserId: 7,
    expectedVersion: 1,
    patch: { page: 2, filters: { region: 'americas' } }
  });
  assert.strictEqual(updated.version, 2);
  assert.strictEqual(updated.page, 2);
  assert.deepStrictEqual(updated.filters, { region: 'americas' });
  assert.throws(
    () => gate.updateSession({
      sessionId: session.id,
      actorUserId: 7,
      expectedVersion: 2,
      patch: { filters: { region: 'americas', contact: { phone: '123456' } } }
    }),
    /unknown filter/
  );
  assert.strictEqual(db.prepare('SELECT version FROM matrix_sessions WHERE id = ?').get(session.id).version, 2);
  assert.deepStrictEqual(JSON.parse(db.prepare('SELECT filters_json FROM matrix_sessions WHERE id = ?').get(session.id).filters_json), { region: 'americas' });
  assert.throws(
    () => gate.updateSession({ sessionId: session.id, actorUserId: 7, expectedVersion: 1, patch: { page: 3 } }),
    /stale version/
  );
  assert.throws(
    () => gate.updateSession({ sessionId: session.id, actorUserId: 8, expectedVersion: 2, patch: { page: 2 } }),
    /not authorized/
  );

  const selectionSession = gate.createSession({
    actorUserId: 7,
    feishuOpenId: 'ou-7',
    chatId: 'chat-selection',
    filters: { region: 'americas' },
    expiresAt: '2026-07-18T00:00:00.000Z'
  });

  assert.throws(
    () => gate.selectCandidate({ candidateId: 42, actorUserId: 7, sessionId: selectionSession.id, expectedVersion: 1, idempotencyKey: '', nextAction: '查看产品页' }),
    /idempotency key required/
  );
  assert.throws(
    () => gate.selectCandidate({ candidateId: 42, actorUserId: 7, sessionId: selectionSession.id, expectedVersion: 1, idempotencyKey: 'too-long', nextAction: 'x'.repeat(501) }),
    /next action too long/
  );
  assert.strictEqual(db.prepare('SELECT version FROM matrix_sessions WHERE id = ?').get(selectionSession.id).version, 1);

  const first = gate.selectCandidate({
    candidateId: 42,
    actorUserId: 7,
    sessionId: selectionSession.id,
    expectedVersion: 1,
    idempotencyKey: 'evt-001',
    nextAction: '查看产品页和联系页'
  });
  const firstEvent = db.prepare('SELECT * FROM matrix_selection_events WHERE idempotency_key = ?').get('evt-001');
  const second = gate.selectCandidate({
    candidateId: 42,
    actorUserId: 7,
    sessionId: selectionSession.id,
    expectedVersion: 1,
    idempotencyKey: 'evt-001',
    nextAction: '查看产品页和联系页'
  });
  assert.strictEqual(first.work_item_id, second.work_item_id);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM matrix_work_items').get().n, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM matrix_selection_events').get().n, 1);
  assert.deepStrictEqual(db.prepare('SELECT * FROM matrix_selection_events WHERE idempotency_key = ?').get('evt-001'), firstEvent);
  assert.strictEqual(db.prepare('SELECT version FROM matrix_sessions WHERE id = ?').get(selectionSession.id).version, 2);
  assert.throws(
    () => db.prepare("UPDATE matrix_selection_events SET reason = 'tampered' WHERE id = ?").run(firstEvent.id),
    /append-only/
  );
  assert.throws(
    () => db.prepare('DELETE FROM matrix_selection_events WHERE id = ?').run(firstEvent.id),
    /append-only/
  );
  assert.deepStrictEqual(db.prepare('SELECT * FROM matrix_selection_events WHERE id = ?').get(firstEvent.id), firstEvent);

  assert.deepStrictEqual(gate.listWorkItems({ actorUserId: 7 }).map(item => item.candidate_id), [42]);
  assert.deepStrictEqual(gate.listWorkItems({ actorUserId: 8 }), []);
  assert.strictEqual(gate.getWorkItem({ workItemId: first.work_item_id, actorUserId: 7 }).candidate_id, 42);
  assert.throws(
    () => gate.getWorkItem({ workItemId: first.work_item_id, actorUserId: 8 }),
    /not authorized/
  );

  const actor8Session = gate.createSession({
    actorUserId: 8,
    feishuOpenId: 'ou-8',
    chatId: 'chat-actor-8',
    filters: {},
    expiresAt: '2026-07-18T00:00:00.000Z'
  });
  assert.throws(
    () => gate.selectCandidate({
      candidateId: 42,
      actorUserId: 8,
      sessionId: actor8Session.id,
      expectedVersion: 1,
      idempotencyKey: 'evt-cross-user',
      nextAction: '不应成功'
    }),
    /not authorized/
  );
  assert.strictEqual(db.prepare('SELECT version FROM matrix_sessions WHERE id = ?').get(actor8Session.id).version, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM matrix_selection_events').get().n, 1);
  assert.throws(
    () => gate.selectCandidate({
      candidateId: 42,
      actorUserId: 8,
      sessionId: actor8Session.id,
      expectedVersion: 1,
      idempotencyKey: 'evt-001',
      nextAction: '不应读取其他用户幂等结果'
    }),
    /not authorized/
  );

  const third = gate.selectCandidate({
    candidateId: 43,
    actorUserId: 7,
    sessionId: selectionSession.id,
    expectedVersion: 2,
    idempotencyKey: 'evt-002',
    nextAction: '核实公开信息'
  });
  assert.notStrictEqual(third.work_item_id, first.work_item_id);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM matrix_work_items').get().n, 2);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM matrix_selection_events').get().n, 2);
  assert.deepStrictEqual(db.prepare('SELECT * FROM matrix_selection_events WHERE idempotency_key = ?').get('evt-001'), firstEvent);

  gate.selectCandidate({
    candidateId: 42,
    actorUserId: 7,
    sessionId: selectionSession.id,
    expectedVersion: 3,
    idempotencyKey: 'evt-003',
    nextAction: '更新后的下一步'
  });
  const replayedFirst = gate.selectCandidate({
    candidateId: 42,
    actorUserId: 7,
    sessionId: selectionSession.id,
    expectedVersion: 1,
    idempotencyKey: 'evt-001',
    nextAction: '调用方重试时的不同文本不应覆盖旧结果'
  });
  assert.strictEqual(replayedFirst.next_action, first.next_action);
  assert.strictEqual(replayedFirst.session_version, first.session_version);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM matrix_selection_events').get().n, 3);

  const expiredSession = gate.createSession({
    actorUserId: 8,
    feishuOpenId: 'ou-8',
    chatId: 'chat-expired',
    filters: {},
    expiresAt: '2026-07-17T00:30:00.000Z'
  });
  clock = '2026-07-17T01:00:00.000Z';
  assert.throws(
    () => gate.updateSession({ sessionId: expiredSession.id, actorUserId: 8, expectedVersion: 1, patch: { page: 2 } }),
    /session expired/
  );

  db.prepare("UPDATE users SET status = 'disabled' WHERE id = 8").run();
  assert.strictEqual(gate.resolveActor({ feishuOpenId: 'ou-8' }), null);
  assert.throws(() => gate.listWorkItems({ actorUserId: 8 }), /application user inactive/);
  assert.throws(
    () => gate.getWorkItem({ workItemId: first.work_item_id, actorUserId: 8 }),
    /application user inactive/
  );
  assert.throws(
    () => gate.updateSession({ sessionId: actor8Session.id, actorUserId: 8, expectedVersion: 1, patch: { page: 2 } }),
    /application user inactive/
  );
  assert.throws(
    () => gate.selectCandidate({
      candidateId: 44,
      actorUserId: 8,
      sessionId: actor8Session.id,
      expectedVersion: 1,
      idempotencyKey: 'evt-inactive-user',
      nextAction: '不应成功'
    }),
    /application user inactive/
  );
  assert.strictEqual(db.prepare('SELECT version FROM matrix_sessions WHERE id = ?').get(actor8Session.id).version, 1);
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM matrix_selection_events WHERE idempotency_key = 'evt-inactive-user'").get().n, 0);

  db.prepare("UPDATE matrix_actor_bindings SET status = 'revoked', revoked_at = ? WHERE feishu_open_id = 'ou-7'").run(clock);
  assert.strictEqual(gate.resolveActor({ feishuOpenId: 'ou-7' }), null);
  assert.throws(() => gate.listWorkItems({ actorUserId: 7 }), /binding revoked/);
  assert.throws(
    () => gate.updateSession({ sessionId: selectionSession.id, actorUserId: 7, expectedVersion: 3, patch: { page: 3 } }),
    /binding revoked/
  );

  console.log('packet gate tests passed');
} finally {
  db.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

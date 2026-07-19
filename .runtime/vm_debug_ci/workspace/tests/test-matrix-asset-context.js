'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createStore } = require('../scripts/matrix-asset-context.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-asset-context-'));
const target = path.join(root, 'contexts.json');
let current = Date.parse('2026-07-19T10:00:00.000Z');

try {
  const store = createStore({ target, clock: () => current });
  store.bind({ chatId: 'chat-a', operatorId: 'operator-a', recordId: 5878 });

  assert.deepStrictEqual(store.resolve({ chatId: 'chat-a', operatorId: 'operator-a' }), { recordId: 5878 });
  assert.strictEqual(store.resolve({ chatId: 'chat-b', operatorId: 'operator-a' }), null);
  assert.strictEqual(store.resolve({ chatId: 'chat-a', operatorId: 'operator-b' }), null);

  store.bind({ chatId: 'chat-a', operatorId: 'operator-a', recordId: 6001 });
  assert.deepStrictEqual(store.resolve({ chatId: 'chat-a', operatorId: 'operator-a' }), { recordId: 6001 });

  const persisted = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.deepStrictEqual(Object.keys(persisted).sort(), ['records', 'version']);
  assert.deepStrictEqual(Object.keys(persisted.records[0]).sort(), ['chat_id', 'created_at', 'expires_at', 'operator_id', 'record_id']);
  assert.strictEqual(fs.statSync(target).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(persisted).includes('Acepac'));
  assert.ok(!JSON.stringify(persisted).includes('/refs/'));

  const restarted = createStore({ target, clock: () => current });
  assert.deepStrictEqual(restarted.resolve({ chatId: 'chat-a', operatorId: 'operator-a' }), { recordId: 6001 });

  current += 30 * 60 * 1000 + 1;
  assert.strictEqual(restarted.resolve({ chatId: 'chat-a', operatorId: 'operator-a' }), null);

  console.log('matrix asset context tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

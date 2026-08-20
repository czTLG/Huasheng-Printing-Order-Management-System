'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const context = require('../scripts/matrix-choice-context.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-choice-'));
const storePath = path.join(root, 'contexts.json');
const now = new Date('2026-07-19T03:00:00.000Z');

try {
  assert.deepStrictEqual(context.parseScopedChoice('候选A'), { index: 0, explicit: true });
  assert.deepStrictEqual(context.parseScopedChoice('开发客户 E'), { index: 4, explicit: true });
  assert.deepStrictEqual(context.parseScopedChoice('A'), { index: 0, explicit: false });
  assert.strictEqual(context.parseScopedChoice('汇率A'), null);

  context.registerChoiceContext({
    message_id: 'om-candidate',
    chat_id: 'build-chat',
    kind: 'candidate',
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString()
  }, { storePath, now });

  assert.strictEqual(context.resolveChoiceContext({
    messageId: 'om-candidate', chatId: 'build-chat', now
  }, { storePath }).kind, 'candidate');
  context.registerChoiceContext({
    message_id: 'om-knowledge',
    chat_id: 'build-chat',
    kind: 'knowledge',
    question_id: 'commercial-threshold-scope',
    question_version: 1,
    fingerprint: 'a'.repeat(64),
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString()
  }, { storePath, now });
  const knowledge = context.resolveChoiceContext({
    messageId: 'om-knowledge', chatId: 'build-chat', now
  }, { storePath });
  assert.deepStrictEqual({
    kind: knowledge.kind,
    question_id: knowledge.question_id,
    question_version: knowledge.question_version,
    fingerprint: knowledge.fingerprint
  }, {
    kind: 'knowledge',
    question_id: 'commercial-threshold-scope',
    question_version: 1,
    fingerprint: 'a'.repeat(64)
  });
  assert.throws(() => context.registerChoiceContext({
    message_id: 'om-bad-knowledge', chat_id: 'build-chat', kind: 'knowledge',
    question_id: 'bad', question_version: 1, fingerprint: 'short',
    created_at: now.toISOString(), expires_at: new Date(now.getTime() + 1000).toISOString()
  }, { storePath, now }), /knowledge choice context/);
  assert.strictEqual(context.resolveChoiceContext({
    messageId: 'om-other', chatId: 'build-chat', now
  }, { storePath }), null);
  assert.strictEqual(context.resolveChoiceContext({
    messageId: 'om-candidate', chatId: 'other-chat', now
  }, { storePath }), null);
  assert.strictEqual(context.resolveChoiceContext({
    messageId: 'om-candidate', chatId: 'build-chat', now: new Date(now.getTime() + 31 * 60 * 1000)
  }, { storePath }), null);
  assert.strictEqual(fs.statSync(storePath).mode & 0o777, 0o600);
  console.log('PASS matrix choice context');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

'use strict';

process.env.MATRIX_DELIVERY_ENABLED = '0';
const assert = require('node:assert');
const extension = require('../.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs');

const helper = {
  card: (elements, opts = {}) => ({ elements, opts }),
  md: content => ({ tag: 'md', content }),
  note: content => ({ tag: 'note', content }),
  hr: () => ({ tag: 'hr' }),
  actions: actions => ({ tag: 'actions', actions }),
  button: (label, value, type) => ({ label, value, type }),
  linkButton: () => ({})
};
const route = status => ({
  id: 4, route: 'existing_relationship', revision: 1, status,
  customer_id: 10, inquiry_id: 20, recipient_email: 'buyer@example.sg',
  subject: 'Clarification', body_en: 'English', body_cn: '中文',
  attachment_manifest: [], content_hash: 'a'.repeat(64)
});
const preview = {
  ...route('approved'), allowed: true,
  authorization: { ok: true, reasons: [] }, thread: { ok: true, reasons: [] },
  approval: { ok: true, reasons: [] }, suppression: { ok: true, reasons: [] },
  readiness: { ok: true, reasons: [] }, duplicate: { ok: true, reasons: [] }
};

function setup(client, assetContext = { resolve: () => ({ recordId: 10 }), bind: () => {} }) {
  const cards = [];
  const handlers = new Map();
  const registered = extension.register({
    channel: {}, dispatcher: { on: (action, handler) => handlers.set(action, handler) },
    sendManagedCard: async (_channel, _chat, card) => { cards.push(card); return { messageId: 'card' }; },
    card: helper, assetContext,
    scheduleReminderPoll: () => ({ unref() {} }), clearReminderPoll: () => {}, client
  });
  return { cards, handlers, registered };
}

(async () => {
  const prepareCalls = [];
  const prepared = setup({
    prepareThreadRoute: async (openId, input) => {
      prepareCalls.push([openId, input]);
      return route('draft');
    }
  });
  assert.strictEqual(await prepared.registered.onMessage({ msg: {
    content: '发送邮件', chatId: 'chat', threadId: 'thread', senderId: 'ou-owner', messageId: 'msg'
  } }), true);
  assert.strictEqual(prepareCalls.length, 1);
  assert.ok(JSON.stringify(prepared.cards[0]).includes('buyer@example.sg'));
  prepared.registered.dispose();

  const resumeCalls = [];
  const draftResume = setup({
    resumeThreadRoute: async (openId, input) => {
      resumeCalls.push([openId, input]);
      return route('draft');
    }
  }, { resolve: () => null, bind: () => {} });
  assert.strictEqual(await draftResume.registered.onMessage({ msg: {
    content: '我允许你发送', chatId: 'chat', threadId: '', senderId: 'ou-owner', messageId: 'allow-1'
  } }), true);
  assert.deepStrictEqual(resumeCalls, [['ou-owner', { chat_id: 'chat', thread_id: '' }]]);
  const draftText = JSON.stringify(draftResume.cards.at(-1));
  assert.ok(draftText.includes('buyer@example.sg'));
  assert.ok(draftText.includes('采用并查看最终预览'));
  assert.ok(!draftText.includes('没有对外邮件发送权限'));
  draftResume.registered.dispose();

  const confirmCalls = [];
  const approvedResume = setup({
    resumeThreadRoute: async () => route('approved'),
    previewThreadRoute: async () => preview,
    confirmThreadRoute: async (...args) => {
      confirmCalls.push(args);
      return { state: 'accepted' };
    }
  }, { resolve: () => null, bind: () => {} });
  assert.strictEqual(await approvedResume.registered.onMessage({ msg: {
    content: '发送吧', chatId: 'chat', threadId: '', senderId: 'ou-owner', messageId: 'allow-2'
  } }), true);
  const previewText = JSON.stringify(approvedResume.cards.at(-1));
  assert.ok(previewText.includes('最终发送预览'));
  assert.ok(previewText.includes('确认发送'));
  assert.strictEqual(confirmCalls.length, 0, 'authorization phrase must restore preview, not send immediately');
  assert.strictEqual(await approvedResume.registered.onMessage({ msg: {
    content: '确认发送', chatId: 'chat', threadId: '', senderId: 'ou-owner', messageId: 'confirm-1'
  } }), true);
  assert.strictEqual(confirmCalls.length, 1);
  approvedResume.registered.dispose();

  console.log('matrix thread command tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

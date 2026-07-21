'use strict';

const assert = require('assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.MATRIX_DELIVERY_ENABLED = '0';
const choiceContextRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-choice-extension-'));
process.env.MATRIX_CHOICE_CONTEXT_PATH = path.join(choiceContextRoot, 'contexts.json');
process.env.MATRIX_ASSET_CONTEXT_PATH = path.join(choiceContextRoot, 'asset-contexts.json');
process.on('exit', () => fs.rmSync(choiceContextRoot, { recursive: true, force: true }));
const extension = require('../extensions/stream-card.cjs');

async function testNarrowClient() {
  process.env.MATRIX_API_BASE_URL = 'https://matrix.test/api/matrix';
  process.env.MATRIX_BRIDGE_TOKEN = 'test-bridge-token';
  process.env.MATRIX_CONTEXT_OPEN_ID = 'ou-context-service';
  const clientPath = require.resolve('../scripts/matrix-client.js');
  delete require.cache[clientPath];
  const client = require(clientPath);
  assert.deepStrictEqual(Object.keys(client).sort(), [
    'ackInboxJob', 'ackNotification', 'approveThreadRoute', 'approveVersion', 'candidateDetail',
    'claimInboxJob', 'claimNotification', 'confirmSend', 'confirmThreadRoute', 'contextRecord',
    'contextResolve', 'contextSearch', 'createSession', 'createVersion', 'facets',
    'failInboxJob', 'getVersion', 'inboxWorkbench', 'listCandidates', 'nackNotification',
    'notificationStatus', 'prepareThreadRoute', 'previewThreadRoute', 'rehydrateSession', 'resumeThreadRoute', 'retryTranslation', 'reviseVersion',
    'selectCandidate', 'startReplyDraft', 'today', 'versionPreview', 'workItems'
  ]);
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return { ok: true, status: 200, headers: { get: name => name === 'content-type' ? 'application/json; charset=utf-8' : null }, json: async () => ({ ok: true }) };
  };
  try {
    await client.facets('ou-client');
    await client.createSession('ou-client', { chat_id: 'chat', filters: {}, expires_at: '2099-01-01T00:00:00Z' });
    await client.createSession('ou-client', { session_id: 7, expected_version: 2, page: 3, filters: { region: 'europe' } });
    await client.rehydrateSession('ou-client', { session_id: 7, chat_id: 'chat', thread_id: 'thread' });
    await client.listCandidates('ou-client', { region: 'europe', page: 1, page_size: 5 });
    await client.candidateDetail('ou-client', 4);
    await client.today('ou-client', { page_size: 5 });
    await client.inboxWorkbench('ou-client');
    await client.contextSearch('ou-client', 'Acepac Singapore');
    await client.contextResolve('ou-client', '新加坡的客户你能看到了吗？');
    await client.contextRecord('ou-client', 5878);
    await client.selectCandidate('ou-client', { candidate_id: 4, session_id: 7, expected_version: 2, idempotency_key: 'evt', next_action: 'verify' });
    await client.workItems('ou-client', { stage: 'selected' });
    await client.claimInboxJob('ou-client');
    await client.ackInboxJob('ou-client', 9, { lease_token: 'lease', notification_uuid: 'uuid', status: 'delivered' });
    await client.failInboxJob('ou-client', 9, { lease_token: 'lease', error_code: 'delivery_failed' });
    await client.createVersion('ou-client', 91, { expected_work_version: 1, idempotency_key: 'create-91' });
    await client.reviseVersion('ou-client', 91, { expected_work_version: 2, base_version_id: 301, revision_instruction: '更简洁', idempotency_key: 'revise-91' });
    await client.approveVersion('ou-client', 91, 302, { expected_work_version: 3, expected_content_hash: 'a'.repeat(64), idempotency_key: 'approve-91' });
    await client.versionPreview('ou-client', 91, 302);
    await client.confirmSend('ou-client', 91, 302, { expected_work_version: 4, expected_content_hash: 'a'.repeat(64), chat_id: 'chat', card_event_id: 'card-91', idempotency_key: 'send-91' });
    await client.startReplyDraft('ou-client', 41);
    await client.retryTranslation('ou-client', 42);
    await client.claimNotification('ou-client');
    await client.ackNotification('ou-client', 51, { claim_token: '00000000-0000-4000-8000-000000000052', receipt_id: 'message-51' });
    await client.nackNotification('ou-client', 51, { claim_token: '00000000-0000-4000-8000-000000000052', outcome: 'ambiguous' });
    await client.notificationStatus('ou-client', 51, { claim_token: '00000000-0000-4000-8000-000000000052' });
    await client.resumeThreadRoute('ou-client', { chat_id: 'chat', thread_id: 'thread' });
    assert.ok(requests.every(item => new URL(item.url).origin === 'https://matrix.test'));
    assert.ok(requests.every(item => new URL(item.url).pathname.startsWith('/api/matrix/')));
    assert.ok(requests.every(item => item.options.redirect === 'manual'));
    assert.ok(requests.every(item => item.options.signal));
    assert.ok(requests.every(item => item.options.headers['x-matrix-bridge-token'] === 'test-bridge-token'));
    const contextRequests = requests.filter(item => new URL(item.url).pathname.includes('/context/'));
    const operatorRequests = requests.filter(item => !new URL(item.url).pathname.includes('/context/'));
    assert.ok(contextRequests.every(item => item.options.headers['x-feishu-open-id'] === 'ou-context-service'));
    assert.ok(operatorRequests.every(item => item.options.headers['x-feishu-open-id'] === 'ou-client'));
    assert.strictEqual(requests[1].options.method, 'POST');
    assert.strictEqual(requests[2].options.method, 'PATCH');
    assert.ok(requests[2].url.endsWith('/sessions/7'));
    assert.ok(requests.some(item => item.url.endsWith('/notifications/41/reply-draft')));
    assert.ok(requests.some(item => item.url.endsWith('/notifications/42/retry-translation')));
    assert.ok(requests.some(item => item.url.endsWith('/notifications/claim')));
    assert.ok(requests.some(item => item.url.endsWith('/notifications/51/ack')));
    assert.ok(requests.some(item => item.url.endsWith('/notifications/51/nack')));
    assert.ok(requests.some(item => item.url.endsWith('/notifications/51/status')));
    assert.ok(requests.some(item => item.url.endsWith('/thread-routes/resume')));
    assert.ok(requests.some(item => item.url.endsWith('/work-items/91/versions')));
    assert.ok(requests.some(item => item.url.endsWith('/work-items/91/versions/302/approve')));
    assert.ok(requests.some(item => item.url.endsWith('/work-items/91/versions/302/preview')));
    assert.ok(requests.some(item => item.url.endsWith('/work-items/91/versions/302/send')));
    assert.strictEqual(requests.at(-1).options.method, 'POST');
    assert.throws(() => client.candidateDetail('ou-client', '../outside'), /candidate id/);
    assert.throws(() => client.createVersion('ou-client', 0, { expected_work_version: 1, idempotency_key: 'x' }), /work item id/);
    assert.throws(() => client.createVersion('ou-client', 91, { expected_work_version: 0, idempotency_key: 'x' }), /expected work version/);
    assert.throws(() => client.reviseVersion('ou-client', 91, { expected_work_version: 2, base_version_id: 0, revision_instruction: 'x', idempotency_key: 'x' }), /base version id/);
    assert.throws(() => client.reviseVersion('ou-client', 91, { expected_work_version: 2, base_version_id: 301, revision_instruction: 'x', idempotency_key: 'x', subject: 'forbidden' }), /unknown revision field/);
    assert.throws(() => client.confirmSend('ou-client', 91, 302, { expected_work_version: 4, expected_content_hash: 'a'.repeat(64), chat_id: 'chat', card_event_id: 'card', idempotency_key: 'send', body: 'forbidden' }), /unknown send confirmation field/);

    global.fetch = async () => ({ ok: false, status: 302, headers: { get: () => 'application/json' }, json: async () => ({}) });
    await assert.rejects(() => client.facets('ou-client'), /redirect|HTTP 302/);
    global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'text/html' }, json: async () => ({}) });
    await assert.rejects(() => client.facets('ou-client'), /JSON/);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testAuthoritativeContextInjection() {
  const calls = [];
  const timer = { unref() {} };
  const registered = extension.register({
    channel: {}, dispatcher: { on: () => undefined }, card: helpers(),
    scheduleReminderPoll: () => timer, clearReminderPoll: () => undefined,
    sendManagedCard: async () => undefined,
    client: {
      contextResolve: async (openId, text) => {
        calls.push([openId, text]);
        return { matches: [{
          customer: { id: 5878, company_name: 'Acepac International (S) Pte Ltd', contact_person: 'Tio Jia Ling', country: 'Singapore' },
          inquiry: { inquiry_code: 'MX-ACEPAC', status: 'quote_pending' },
          specifications: [{ bag_type: 'stand_up_pouch', size_width: '160mm', size_height: '220mm', material_structure_text: 'PET/PE' }],
          messages: [{ email_message_id: 63, direction: 'inbound', lines: ['Please quote the attached pouch.'] }],
          attachments: [{ filename: 'product.png', mime_type: 'image/png', availability: 'available', local_path: '/refs/matrix-inbox-attachments/2026/07/product.png', evidence_role: 'product_reference', display_recommended: true, summary_cn: '自立拉链袋产品图' }],
          existing_tasks: [{ id: 2, status: 'pending', note_cn: 'Prepare quote' }]
        }] };
      }
    }
  });
  const msg = { content: '新加坡的客户你能看到了吗？', chatId: 'chat-context', senderId: 'ou-context' };
  assert.strictEqual(await registered.onMessage({ msg, project: {} }), false);
  assert.deepStrictEqual(calls, [['ou-context', '新加坡的客户你能看到了吗？']]);
  assert.match(msg.content, /权威系统上下文/);
  assert.match(msg.content, /Acepac International/);
  assert.match(msg.content, /product\.png/);
  assert.match(msg.content, /不得要求.*Outlook.*Gmail/);
  assert.match(msg.content, /是否把这1张产品图发到群里/);
  registered.dispose();

  const delivered = [];
  const confirmations = [];
  const display = extension.register({
    channel: {}, dispatcher: { on: () => undefined }, card: helpers(),
    scheduleReminderPoll: () => timer, clearReminderPoll: () => undefined,
    sendManagedCard: async (_channel, _chat, card) => confirmations.push(card),
    sendCustomerAttachment: async input => delivered.push(input),
    client: {
      contextResolve: async () => ({ matches: [{
        customer: { id: 5878, company_name: 'Acepac International (S) Pte Ltd' },
        attachments: [{ filename: 'product.png', mime_type: 'image/png', availability: 'available', local_path: '/refs/matrix-inbox-attachments/2026/07/product.png', evidence_role: 'product_reference', display_recommended: true }]
      }] })
    }
  });
  assert.strictEqual(await display.onMessage({ msg: { content: '显示 Acepac 客户图片', chatId: 'chat-context', senderId: 'ou-context', messageId: 'message-confirm' } }), true);
  assert.strictEqual(delivered.length, 1);
  assert.deepStrictEqual(delivered[0], { replyTo: 'message-confirm', absolutePath: '/refs/matrix-inbox-attachments/2026/07/product.png', filename: 'product.png', mimeType: 'image/png' });
  assert.strictEqual(confirmations.length, 1);
  assert.match(visibleText(confirmations[0]), /已发出 1 张产品图/);
  display.dispose();
}

async function testShortImageConfirmationUsesBoundContext() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-asset-extension-'));
  const delivered = [];
  const calls = [];
  const timer = { unref() {} };
  try {
    const registered = extension.register({
      channel: {}, dispatcher: { on: () => undefined }, card: helpers(),
      assetContextPath: path.join(root, 'contexts.json'),
      now: () => Date.parse('2026-07-19T10:00:00.000Z'),
      scheduleReminderPoll: () => timer, clearReminderPoll: () => undefined,
      sendManagedCard: async () => undefined,
      sendCustomerAttachment: async input => delivered.push(input),
      client: {
        contextResolve: async (_openId, text) => {
          calls.push(['resolve', text]);
          return { matches: [{
            customer: { id: 5878, company_name: 'Acepac International (S) Pte Ltd' },
            attachments: [{ filename: 'product.png', mime_type: 'image/png', availability: 'available', local_path: '/refs/matrix-inbox-attachments/product.png', evidence_role: 'product_reference', display_recommended: true }]
          }] };
        },
        contextRecord: async (_openId, recordId) => {
          calls.push(['record', recordId]);
          return { matches: [{
            customer: { id: 5878, company_name: 'Acepac International (S) Pte Ltd' },
            attachments: [{ filename: 'product.png', mime_type: 'image/png', availability: 'available', local_path: '/refs/matrix-inbox-attachments/product.png', evidence_role: 'product_reference', display_recommended: true }]
          }] };
        }
      }
    });

    const mention = { content: '新加坡客户你看到了吗？', chatId: 'chat-context', senderId: 'ou-context' };
    assert.strictEqual(await registered.onMessage({ msg: mention }), false);
    assert.match(mention.content, /只要回复“显示”或“发图”/);
    assert.doesNotMatch(mention.content, /长指令|客户图片/);
    assert.strictEqual(await registered.onMessage({ msg: { content: '显示', chatId: 'chat-context', senderId: 'ou-context', messageId: 'confirm-message' } }), true);
    assert.deepStrictEqual(calls, [['resolve', '新加坡客户你看到了吗？'], ['record', 5878]]);
    assert.strictEqual(delivered.length, 1);
    assert.strictEqual(delivered[0].absolutePath, '/refs/matrix-inbox-attachments/product.png');
    registered.dispose();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testImageConfirmationReportsReadFailure() {
  const sent = [];
  const timer = { unref() {} };
  const registered = extension.register({
    channel: {}, dispatcher: { on: () => undefined }, card: helpers(),
    assetContext: { resolve: () => ({ recordId: 5878 }), bind: () => undefined },
    scheduleReminderPoll: () => timer, clearReminderPoll: () => undefined,
    logReminder: () => undefined,
    sendManagedCard: async (_channel, _chat, card) => sent.push(card),
    client: {
      contextRecord: async () => { const error = new Error('matrix API HTTP 403'); error.status = 403; throw error; }
    }
  });
  assert.strictEqual(await registered.onMessage({ msg: { content: '显示', chatId: 'chat-context', senderId: 'ou-context', messageId: 'confirm-message' } }), true);
  assert.match(visibleText(sent[0]), /资料读取失败.*显示.*重试/);
  registered.dispose();
}

async function testOneShotUnmentionedFollowupWindow() {
  let now = Date.parse('2026-07-19T13:27:00.000Z');
  const registered = extension.register({
    channel: {}, dispatcher: { on: () => undefined }, card: helpers(), client: {},
    now: () => now,
    scheduleReminderPoll: () => ({ unref() {} }), clearReminderPoll: () => undefined,
    sendManagedCard: async () => undefined
  });
  const anchor = {
    content: '记录一下BOPP镀铝膜的参数', chatId: 'chat-knowledge', senderId: 'ou-owner',
    mentionedBot: true, mentions: []
  };
  assert.strictEqual(await registered.onMessage({ msg: anchor, project: {} }), false);
  assert.strictEqual(await registered.shouldHandleUnmentioned({
    msg: { content: '目前单价36元/公斤 现阶段都是出口产品在用', chatId: 'chat-knowledge', senderId: 'ou-other', mentionedBot: false, mentions: [] },
    project: {}
  }), false, 'another sender must not inherit the mention');
  assert.strictEqual(await registered.shouldHandleUnmentioned({
    msg: { content: '目前单价36元/公斤 现阶段都是出口产品在用', chatId: 'chat-knowledge', senderId: 'ou-owner', mentionedBot: false, mentions: [] },
    project: {}
  }), true, 'same-sender immediate continuation should pass exactly once');
  assert.strictEqual(await registered.shouldHandleUnmentioned({
    msg: { content: '有bug', chatId: 'chat-knowledge', senderId: 'ou-owner', mentionedBot: false, mentions: [] },
    project: {}
  }), false, 'the continuation window must be consumed');

  await registered.onMessage({ msg: anchor, project: {} });
  assert.strictEqual(await registered.shouldHandleUnmentioned({
    msg: { content: '转给某同事', chatId: 'chat-knowledge', senderId: 'ou-owner', mentionedBot: false, mentions: [{ isBot: false }] },
    project: {}
  }), false, 'messages mentioning another person must not be captured');
  now += 2 * 60 * 1000 + 1;
  assert.strictEqual(await registered.shouldHandleUnmentioned({
    msg: { content: '过期补充', chatId: 'chat-knowledge', senderId: 'ou-owner', mentionedBot: false, mentions: [] },
    project: {}
  }), false, 'expired continuations must fail closed');
  registered.dispose();
}

async function testTwoConfirmationReviewFlow() {
  let now = Date.parse('2026-07-17T00:00:00.000Z');
  const handlers = new Map();
  const sent = [];
  const clientCalls = [];
  const row = {
    id: 901, company_name: 'Alpha', country_code: 'US', region: 'americas',
    official_domain: 'alpha.test', official_url: 'https://alpha.test/', categories: ['coffee'],
    format_signals: ['pouch'], size_signals: [], scale_tier: 'medium', priority: 'P1',
    fit_score: 90, demand_fit_score: 90, access_score: 90, confidence: 0.9, status: 'valid',
    stage_code: 'observed', audit_state: 'audited', assessment_cn: '公开产品证据',
    next_action_cn: '确认当前需求', updated_at: '2026-07-17T00:00:00.000Z'
  };
  let currentVersion = {
    id: 301, work_item_id: 91, revision: 1, recipient_email: 'sales@alpha.test',
    recipient_source_url: 'https://alpha.test/contact', subject: 'Proposal for Alpha',
    body_en: 'Dear Alpha team,\nCould you share your current requirements?\nBest regards',
    body_cn: '您好，请问能否提供当前需求？', content_hash: 'a'.repeat(64), status: 'draft',
    quality_score: 91, quality_json: JSON.stringify({
      score: 91, passed: true, hardFailures: [],
      components: { questions: { points: 15, maximum: 15, reasons: ['clear_question'], evidence_ids: [] } }
    }), work_item_version: 2
  };
  let blockedPreview = false;
  let minimalPreview = false;
  let previewOverride = null;
  let deliveryState = 'accepted';
  const client = {
    today: async () => ({ rows: [row], snapshot_key: '9'.repeat(64) }),
    createSession: async (_openId, input) => ({
      id: 91, chat_id: input.chat_id, thread_id: input.thread_id || '', filters: input.filters,
      snapshot_key: input.snapshot_key, candidate_ids: input.candidate_ids, page: 1, version: 1,
      expires_at: input.expires_at
    }),
    candidateDetail: async () => ({ ...row, discovery: {}, official_evidence: [], contacts: { email: 'sales@alpha.test' } }),
    selectCandidate: async (openId, input) => {
      clientCalls.push(['selectCandidate', openId, input]);
      return { work_item_id: 91, candidate_id: 901, session_id: 91, session_version: 2, next_action: input.next_action };
    },
    createVersion: async (openId, workItemId, input) => {
      clientCalls.push(['createVersion', openId, workItemId, input]);
      return currentVersion;
    },
    reviseVersion: async (openId, workItemId, input) => {
      clientCalls.push(['reviseVersion', openId, workItemId, input]);
      currentVersion = {
        ...currentVersion, id: 302, revision: 2, subject: 'Short proposal for Alpha',
        body_en: 'Dear Alpha team,\nCould you share annual volume?\nBest regards',
        body_cn: '您好，请问能否提供年用量？', content_hash: 'b'.repeat(64), work_item_version: 3
      };
      return currentVersion;
    },
    approveVersion: async (openId, workItemId, versionId, input) => {
      clientCalls.push(['approveVersion', openId, workItemId, versionId, input]);
      currentVersion = { ...currentVersion, status: 'approved', work_item_version: 4 };
      return currentVersion;
    },
    versionPreview: async (openId, workItemId, versionId) => {
      clientCalls.push(['versionPreview', openId, workItemId, versionId]);
      if (previewOverride) return previewOverride;
      if (minimalPreview) return {
        allowed: true, work_item_version: 4, version: currentVersion,
        quality: JSON.parse(currentVersion.quality_json), reasons: []
      };
      if (blockedPreview) return {
        allowed: false, work_item_version: 4, version: currentVersion,
        quality: {
          score: 72,
          components: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
            index === 0 ? 'questions' : `long_component_${index}`,
            { points: 4, maximum: 15, reasons: [index === 0 ? 'missing_volume_question' : `long_reason_${index}_${'x'.repeat(160)}`] }
          ])),
          hardFailures: ['unsupported_product_fact']
        },
        reasons: ['quality_score_below_80'],
        duplicate: { ok: false, reasons: ['possible_duplicate'] },
        cooling: { ok: false, reasons: ['domain_cooling_90_days'] },
        quota: { ok: false, reasons: ['daily_quota_exhausted'] },
        readiness: { ok: false, hardFailures: ['missing_dkim', 'missing_dmarc'] },
        policy: { ok: false, hardFailures: ['country_channel_policy_not_approved'] }
      };
      return {
        allowed: true, work_item_version: 4, version: currentVersion,
        quality: JSON.parse(currentVersion.quality_json), reasons: [],
        duplicate: { ok: true, reasons: [] }, cooling: { ok: true, reasons: [] },
        quota: { ok: true, reasons: [] }, readiness: { ok: true, hardFailures: [] },
        policy: { ok: true, hardFailures: [] }
      };
    },
    confirmSend: async (openId, workItemId, versionId, input) => {
      clientCalls.push(['confirmSend', openId, workItemId, versionId, input]);
      return { state: deliveryState, error_class: 'RAW-SERVER-DIAGNOSTIC-MUST-NOT-RENDER', work_item_version: 5 };
    }
  };
  const registered = extension.register({
    channel: {}, dispatcher: { on: (name, handler) => handlers.set(name, handler) }, card: helpers(), client,
    now: () => now, scheduleReminderPoll: () => ({ unref() {} }), clearReminderPoll: () => undefined,
    sendManagedCard: async (_channel, _chatId, card) => sent.push(card)
  });
  const msg = { content: '开发客户', chatId: 'chat-review', threadId: 'thread-review', senderId: 'ou-review' };
  const evt = { operator: { openId: 'ou-review' }, chatId: msg.chatId, threadId: msg.threadId, messageId: 'card-review' };
  await registered.onMessage({ msg });
  await handlers.get('mx.detail')({ evt, value: buttons(sent.at(-1)).find(item => item.value?.a === 'mx.detail').value });
  await handlers.get('mx.select')({ evt, value: buttons(sent.at(-1)).find(item => item.value?.a === 'mx.select').value });
  assert.deepStrictEqual(buttons(sent.at(-1)).map(item => item.label), ['确认采用', '修改草稿', '暂不处理']);
  assert.strictEqual(clientCalls.filter(item => item[0] === 'confirmSend').length, 0, 'selection must never send');
  assert.ok([...visibleText(sent.at(-1))].length <= 1500);

  await handlers.get('mx.revise')({ evt, value: buttons(sent.at(-1)).find(item => item.value?.a === 'mx.revise').value });
  assert.ok(visibleText(sent.at(-1)).includes('请回复“修改：……”'));
  assert.strictEqual(await registered.onMessage({ msg: { ...msg, senderId: 'ou-other', content: '修改：错误操作者' } }), false);
  assert.strictEqual(await registered.onMessage({ msg: { ...msg, threadId: 'thread-other', content: '修改：错误话题' } }), false);
  assert.strictEqual(await registered.onMessage({ msg: { ...msg, content: '修改：语气更简洁，询问年用量' } }), true);
  assert.strictEqual(clientCalls.at(-1)[0], 'reviseVersion');
  assert.strictEqual(clientCalls.at(-1)[3].revision_instruction, '语气更简洁，询问年用量');
  assert.strictEqual(await registered.onMessage({ msg: { ...msg, content: '修改：成功后不应继续消费' } }), false);

  await handlers.get('mx.approve')({ evt, value: buttons(sent.at(-1)).find(item => item.value?.a === 'mx.approve').value });
  assert.ok(visibleText(sent.at(-1)).includes('尚未发送'));
  assert.ok(visibleText(sent.at(-1)).includes('sales@alpha.test'));
  assert.strictEqual(clientCalls.filter(item => item[0] === 'confirmSend').length, 0, 'approval must never send');
  assert.strictEqual(await registered.onMessage({ msg: { ...msg, content: '你直接发送给他' } }), true);
  assert.strictEqual(clientCalls.filter(item => item[0] === 'confirmSend').length, 0, 'first natural confirmation must only open final preview');
  const finalCard = sent.at(-1);
  assert.ok(visibleText(finalCard).includes('质量评分'));
  assert.ok(buttons(finalCard).some(item => item.value?.a === 'mx.confirm'));
  assert.ok([...visibleText(finalCard)].length <= 1500);
  const confirmValue = buttons(finalCard).find(item => item.value?.a === 'mx.confirm').value;
  assert.strictEqual(await registered.onMessage({ msg: { ...msg, senderId: 'ou-other', content: '确认发送' } }), true);
  assert.strictEqual(clientCalls.filter(item => item[0] === 'confirmSend').length, 0, 'another operator must never inherit a final preview');
  assert.match(visibleText(sent.at(-1)), /没有.*最终预览|尚未发送/);
  assert.strictEqual(await registered.onMessage({ msg: { ...msg, content: '确认发送' } }), true);
  assert.strictEqual(clientCalls.filter(item => item[0] === 'confirmSend').length, 1, 'second natural confirmation should submit the exact previewed version');
  await handlers.get('mx.confirm')({ evt, value: confirmValue });
  await handlers.get('mx.confirm')({ evt, value: confirmValue });
  assert.ok(visibleText(sent.at(-1)).includes('邮件服务器已接受'));
  const confirmations = clientCalls.filter(item => item[0] === 'confirmSend');
  assert.strictEqual(confirmations.length, 3);
  assert.ok(confirmations.every(item => item[4].idempotency_key === confirmations[0][4].idempotency_key));
  assert.ok(!visibleText(sent.at(-1)).includes('Message-ID'));

  deliveryState = 'failed';
  await handlers.get('mx.confirm')({ evt, value: confirmValue });
  const failedCard = sent.at(-1);
  assert.ok(visibleText(failedCard).includes('明确失败'));
  assert.deepStrictEqual(buttons(failedCard).map(item => item.label), ['重新预览']);
  assert.ok(!visibleText(failedCard).includes('RAW-SERVER-DIAGNOSTIC'));
  deliveryState = 'ambiguous';
  await handlers.get('mx.confirm')({ evt, value: confirmValue });
  const ambiguousCard = sent.at(-1);
  assert.ok(visibleText(ambiguousCard).includes('提交结果不明确'));
  assert.strictEqual(buttons(ambiguousCard).length, 0, 'ambiguous result must expose no retry action');
  assert.ok(!visibleText(ambiguousCard).includes('RAW-SERVER-DIAGNOSTIC'));

  blockedPreview = true;
  await handlers.get('mx.preview')({ evt, value: { ...confirmValue, a: 'mx.preview' } });
  const blocked = sent.at(-1);
  const blockedText = visibleText(blocked);
  for (const expected of ['质量评分', 'missing_volume_question', 'unsupported_product_fact', 'possible_duplicate', 'domain_cooling_90_days', 'daily_quota_exhausted', 'missing_dkim', 'country_channel_policy_not_approved']) {
    assert.ok(blockedText.includes(expected), `blocked preview missing ${expected}`);
  }
  assert.ok(!buttons(blocked).some(item => item.value?.a === 'mx.confirm'));
  assert.strictEqual(clientCalls.filter(item => item[0] === 'confirmSend').length, 5);
  assert.ok([...blockedText].length <= 1500);

  blockedPreview = false;
  minimalPreview = true;
  await handlers.get('mx.preview')({ evt, value: { ...confirmValue, a: 'mx.preview' } });
  const minimalText = visibleText(sent.at(-1));
  assert.strictEqual((minimalText.match(/提交时复核/g) || []).length, 5, 'absent gate projections must not be shown as passed');
  assert.ok(!buttons(sent.at(-1)).some(item => item.value?.a === 'mx.confirm'), 'missing required gates must fail closed');

  minimalPreview = false;
  const trustedGates = {
    duplicate: { ok: true, reasons: [] }, cooling: { ok: true, reasons: [] },
    quota: { ok: true, reasons: [] }, readiness: { ok: true, hardFailures: [] },
    policy: { ok: true, hardFailures: [] }
  };
  for (const [label, key, malformed] of [
    ['重复检查', 'duplicate', {}],
    ['冷却期', 'cooling', { ok: null }],
    ['当日配额', 'quota', { status: 'unknown' }],
    ['发送方就绪', 'readiness', { ok: 'true', reasons: [] }],
    ['重复检查', 'duplicate', { ok: true, reasons: [null] }],
    ['发送方就绪', 'readiness', { ok: true, hardFailures: [false, '', '   '] }],
    ['国家/渠道政策', 'policy', { ok: true, hard_failures: [0] }],
    ['冷却期', 'cooling', { ok: true, reasons: ['valid_reason', { code: 'malformed' }] }],
    ['当日配额', 'quota', { ok: true, reasons: ['x'.repeat(257)] }]
  ]) {
    previewOverride = {
      allowed: true, work_item_version: 4, version: currentVersion,
      quality: JSON.parse(currentVersion.quality_json), reasons: [],
      ...trustedGates, [key]: malformed
    };
    await handlers.get('mx.preview')({ evt, value: { ...confirmValue, a: 'mx.preview' } });
    const malformedCard = sent.at(-1);
    assert.ok(visibleText(malformedCard).includes(`${label}：提交时复核`), `${key} malformed projection must be unknown`);
    assert.ok(!buttons(malformedCard).some(item => item.value?.a === 'mx.confirm'), `${key} malformed projection must fail closed`);
  }

  previewOverride = {
    allowed: true, work_item_version: 4, version: currentVersion,
    quality: JSON.parse(currentVersion.quality_json), reasons: [],
    ...trustedGates,
    readiness: { ok: false, hardFailures: ['missing_dkim'] }
  };
  await handlers.get('mx.preview')({ evt, value: { ...confirmValue, a: 'mx.preview' } });
  const contradictoryCard = sent.at(-1);
  assert.ok(visibleText(contradictoryCard).includes('发送方就绪：阻断 missing_dkim'));
  assert.ok(!buttons(contradictoryCard).some(item => item.value?.a === 'mx.confirm'), 'allowed true plus blocked gate must fail closed');

  previewOverride = {
    allowed: true, work_item_version: 4, version: currentVersion,
    quality: JSON.parse(currentVersion.quality_json), reasons: [],
    ...trustedGates,
    policy: { ok: false, reasons: 'malformed_reason_container' }
  };
  await handlers.get('mx.preview')({ evt, value: { ...confirmValue, a: 'mx.preview' } });
  const explicitFalseCard = sent.at(-1);
  assert.ok(visibleText(explicitFalseCard).includes('国家/渠道政策：阻断'), 'explicit false must remain blocked even if its reason container is malformed');
  assert.ok(!buttons(explicitFalseCard).some(item => item.value?.a === 'mx.confirm'));

  for (const [label, topLevelReasons] of [
    ['string container', { reasons: 'malformed' }],
    ['object container', { hardFailures: { code: 'malformed' } }],
    ['null element', { reasons: [null] }],
    ['boolean and empty elements', { hardFailures: [false, '', '   '] }],
    ['number element', { hard_failures: [0] }],
    ['mixed malformed elements', { reasons: ['valid_reason', { code: 'malformed' }] }],
    ['overlong element', { reasons: ['x'.repeat(257)] }]
  ]) {
    previewOverride = {
      allowed: true, work_item_version: 4, version: currentVersion,
      quality: JSON.parse(currentVersion.quality_json),
      ...trustedGates, ...topLevelReasons
    };
    await handlers.get('mx.preview')({ evt, value: { ...confirmValue, a: 'mx.preview' } });
    const malformedTopLevelCard = sent.at(-1);
    assert.ok(!buttons(malformedTopLevelCard).some(item => item.value?.a === 'mx.confirm'), `${label} top-level reasons must fail closed`);
    assert.ok(!visibleText(malformedTopLevelCard).includes('[object Object]'), `${label} must not stringify malformed reason objects`);
  }
  previewOverride = null;

  await handlers.get('mx.revise')({ evt, value: { a: 'mx.revise', w: 91, x: 302, v: 4, h: 'b'.repeat(64) } });
  assert.strictEqual(await registered.onMessage({ msg: { ...msg, content: '取消' } }), true);
  assert.strictEqual(await registered.onMessage({ msg: { ...msg, content: '修改：不应继续' } }), false);
  await handlers.get('mx.revise')({ evt, value: { a: 'mx.revise', w: 91, x: 302, v: 4, h: 'b'.repeat(64) } });
  await handlers.get('mx.review')({ evt, value: { a: 'mx.review', w: 91, x: 302, v: 4, h: 'b'.repeat(64) } });
  assert.strictEqual(await registered.onMessage({ msg: { ...msg, content: '修改：暂缓后不应继续' } }), false);
  await handlers.get('mx.revise')({ evt, value: { a: 'mx.revise', w: 91, x: 302, v: 4, h: 'b'.repeat(64) } });
  now += 10 * 60 * 1000 + 1;
  assert.strictEqual(await registered.onMessage({ msg: { ...msg, content: '修改：已过期' } }), false);
  registered.dispose();
}

async function testReadOnlyWatcher() {
  const watcher = require('../scripts/matrix-watch.js');
  const calls = [];
  const deliveries = [];
  const readOnlyClient = {
    today: async (openId, filters) => {
      calls.push({ openId, filters });
      return { rows: Array.from({ length: 7 }, (_, index) => ({ id: index + 1, company_name: `Watch ${index + 1}`, country_code: 'US', priority: 'P1', stage_code: index === 4 ? 'recommendation_ready' : 'observed', assessment_cn: '公开理由', categories: ['coffee'], size_signals: index === 0 ? ['250g', 'own factory'] : [], next_action_cn: '核实公开信息' })) };
    }
  };
  const first = await watcher.runDue({
    now: new Date('2026-07-17T01:00:00.000Z'),
    state: {},
    client: readOnlyClient,
    ownerOpenId: 'ou-owner',
    chatId: 'chat-watch',
    send: async card => { deliveries.push(card); return 'message-watch-1'; }
  });
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], { openId: 'ou-owner', filters: { page_size: 5 } });
  assert.strictEqual(deliveries.length, 1);
  const watchText = visibleText(deliveries[0]);
  assert.ok(watchText.includes('Watch 1'));
  assert.ok(watchText.includes('Watch 5'));
  assert.ok(!watchText.includes('Watch 6'));
  assert.ok(watchText.includes('阶段：已观察'));
  assert.ok(watchText.includes('阶段：推荐就绪'));
  assert.ok(watchText.includes('已确认规格：250g'));
  assert.ok(watchText.includes('已确认公开信号：own factory'));
  assert.deepStrictEqual(first, { last_success_date: '2026-07-17', last_message_id: 'message-watch-1' });
  const second = await watcher.runDue({
    now: new Date('2026-07-17T01:05:00.000Z'), state: first, client: readOnlyClient,
    ownerOpenId: 'ou-owner', chatId: 'chat-watch', send: async () => { throw new Error('must not resend'); }
  });
  assert.deepStrictEqual(second, first);
  assert.strictEqual(calls.length, 1);

  const emptyDeliveries = [];
  await watcher.runDue({
    now: new Date('2026-07-18T01:00:00.000Z'), state: {},
    client: { today: async () => ({ rows: [] }) }, ownerOpenId: 'ou-owner', chatId: 'chat-watch',
    send: async card => { emptyDeliveries.push(card); return 'empty-message'; }
  });
  assert.ok(visibleText(emptyDeliveries[0]).includes('今日没有达到证据标准的候选'));

  assert.strictEqual(typeof watcher.queueReminder, 'function');
  assert.strictEqual(typeof watcher.deliveryId, 'function');
  assert.strictEqual(typeof extension.deliverQueuedReminder, 'function');
  const spoolRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-reminder-spool-'));
  try {
    const spoolPath = path.join(spoolRoot, 'pending.json');
    const inflightPath = path.join(spoolRoot, 'inflight.json');
    const receiptPath = path.join(spoolRoot, 'receipt.json');
    const date = '2026-07-18';
    fs.writeFileSync(`${spoolPath}.${process.pid}.tmp`, 'stale');
    const queuedId = watcher.queueReminder({ schema: '2.0', body: { elements: [] } }, 'chat-watch', { date, spoolPath, inflightPath, receiptPath });
    assert.match(queuedId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.strictEqual(watcher.deliveryId(date, 'chat-watch'), queuedId);
    assert.strictEqual(watcher.queueReminder({ schema: '2.0', body: { elements: [] } }, 'chat-watch', { date, spoolPath, inflightPath, receiptPath }), queuedId);
    assert.strictEqual(JSON.parse(fs.readFileSync(spoolPath, 'utf8')).date, date);
    const sentFromSpool = [];
    fs.writeFileSync(`${receiptPath}.${process.pid}.tmp`, 'stale');
    assert.deepStrictEqual(await extension.deliverQueuedReminder({
      spoolPath, inflightPath, expectedChatId: 'chat-watch', channel: {}, receiptPath,
      sendManagedCard: async (_channel, chatId, card, _reply, _thread, _receiveType, uuid) => sentFromSpool.push({ chatId, card, uuid })
    }), { status: 'delivered', id: queuedId });
    assert.deepStrictEqual(sentFromSpool, [{ chatId: 'chat-watch', card: { schema: '2.0', body: { elements: [] } }, uuid: queuedId }]);
    assert.strictEqual(fs.existsSync(spoolPath), false);
    assert.strictEqual(JSON.parse(fs.readFileSync(receiptPath, 'utf8')).id, queuedId);
    assert.strictEqual(await extension.deliverQueuedReminder({ spoolPath, inflightPath, receiptPath, expectedChatId: 'chat-watch', channel: {}, sendManagedCard: async () => {} }), false);
  } finally {
    fs.rmSync(spoolRoot, { recursive: true, force: true });
  }
}

async function testReplyNotificationCardAndDraftAction() {
  const watcher = require('../scripts/matrix-watch.js');
  const ready = watcher.replyNotificationCard({
    id: 41,
    work_item_id: 91,
    job_id: 71,
    kind: 'reply',
    original_preview: 'Please send the current specifications.',
    translation_status: 'ready',
    translation_cn: '请发送当前规格。',
    requirements_cn: '需要当前规格',
    work_item_state: 'replied'
  });
  const readyText = visibleText(ready);
  for (const expected of ['原文预览', 'Please send the current specifications.', '中文翻译', '请发送当前规格。', '需求摘要', '需要当前规格', '工作项状态', 'replied', 'View reply draft']) {
    assert.ok(readyText.includes(expected), `reply notification missing ${expected}`);
  }
  assert.ok(JSON.stringify(ready).includes('"a":"mx.reply_draft"'));
  assert.ok(JSON.stringify(ready).includes('"n":41'));
  assert.ok(!JSON.stringify(ready).includes('credential'));
  assert.ok([...readyText].length <= 900);

  const pending = watcher.replyNotificationCard({
    id: 42, work_item_id: 92, job_id: 72, kind: 'reply',
    original_preview: 'Hello', translation_status: 'pending', translation_cn: '',
    requirements_cn: '', work_item_state: 'replied'
  });
  const pendingText = visibleText(pending);
  assert.ok(pendingText.includes('翻译待处理'));
  assert.ok(!pendingText.includes('请发送当前规格。'));
  assert.ok(JSON.stringify(pending).includes('"a":"mx.retry_translation"'));
  assert.ok(!JSON.stringify(pending).includes('"a":"mx.reply_draft"'));

  const handlers = new Map();
  const sent = [];
  const draftCalls = [];
  const registered = extension.register({
    channel: {},
    dispatcher: { on: (name, handler) => handlers.set(name, handler) },
    card: helpers(),
    client: {
      startReplyDraft: async (openId, notificationId) => {
        draftCalls.push({ openId, notificationId });
        return { notification_id: notificationId, work_item_id: 91, state: 'draft_pending' };
      },
      retryTranslation: async (openId, notificationId) => ({ notification_id: notificationId, translation_status: 'ready', retry_available: false }),
      confirmSend: async () => { throw new Error('must never send'); }
    },
    sendManagedCard: async (_channel, _chatId, card) => sent.push(card),
    scheduleReminderPoll: () => ({ unref() {} }),
    clearReminderPoll: () => undefined
  });
  assert.strictEqual(typeof handlers.get('mx.reply_draft'), 'function');
  await handlers.get('mx.reply_draft')({
    evt: { operator: { openId: 'ou-reply' }, chatId: 'chat-reply', threadId: '', messageId: 'evt-reply' },
    value: { a: 'mx.reply_draft', n: 41 }
  });
  assert.deepStrictEqual(draftCalls, [{ openId: 'ou-reply', notificationId: 41 }]);
  assert.ok(visibleText(sent.at(-1)).includes('draft_pending'));
  assert.ok(visibleText(sent.at(-1)).includes('尚未发送'));
  assert.strictEqual(typeof handlers.get('mx.retry_translation'), 'function');
  await handlers.get('mx.retry_translation')({
    evt: { operator: { openId: 'ou-reply' }, chatId: 'chat-reply', threadId: '', messageId: 'evt-retry' },
    value: { a: 'mx.retry_translation', n: 42 }
  });
  assert.ok(visibleText(sent.at(-1)).includes('translation_status=ready'));
  registered.dispose();

  assert.strictEqual(typeof watcher.claimAndQueueReply, 'function');
  assert.strictEqual(typeof watcher.readProcessIdentity, 'function');
  const actualIdentity = watcher.readProcessIdentity();
  assert.strictEqual(actualIdentity.pid, process.pid);
  assert.match(actualIdentity.boot_id, /^[0-9a-f-]{8,}$/i);
  assert.match(actualIdentity.start_time, /^\d+$/);
  assert.strictEqual(typeof extension.deliverQueuedReply, 'function');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-reply-spool-'));
  const spoolPath = path.join(root, 'pending.json');
  const inflightPath = path.join(root, 'inflight.json');
  const claimedRow = {
    id: 51, notification_key: '00000000-0000-4000-8000-000000000051',
    claim_token: '00000000-0000-4000-8000-000000000052', delivery_state: 'inflight',
    work_item_id: 91, job_id: 71, kind: 'reply', original_preview: 'Hello',
    translation_status: 'pending', translation_cn: '', requirements_cn: '',
    work_item_state: 'replied', attempt_count: 1
  };
  try {
    let releaseFirst;
    let firstClaimStarted;
    const started = new Promise(resolve => { firstClaimStarted = resolve; });
    const held = new Promise(resolve => { releaseFirst = resolve; });
    let claimCalls = 0;
    const racingClient = {
      claimNotification: async () => {
        claimCalls += 1;
        if (claimCalls === 1) { firstClaimStarted(); await held; }
        return { notification: { ...claimedRow, id: 50 + claimCalls, notification_key: `00000000-0000-4000-8000-00000000005${claimCalls}` } };
      },
      nackNotification: async () => undefined
    };
    const firstQueue = watcher.claimAndQueueReply({
      client: racingClient, ownerOpenId: 'ou-reply', chatId: 'chat-reply', spoolPath, inflightPath
    });
    await started;
    const lockPath = `${spoolPath}.lock`;
    assert.strictEqual(fs.statSync(lockPath).mode & 0o777, 0o600, 'relay lock must be private');
    const secondQueue = await watcher.claimAndQueueReply({
      client: racingClient, ownerOpenId: 'ou-reply', chatId: 'chat-reply', spoolPath, inflightPath
    });
    releaseFirst();
    assert.deepStrictEqual(await firstQueue, { status: 'queued', id: 51 });
    assert.deepStrictEqual(secondQueue, { status: 'busy' });
    assert.strictEqual(claimCalls, 1, 'watcher without the filesystem lock must not call claim API');
    assert.strictEqual(fs.existsSync(lockPath), false, 'relay lock must be cleaned');
    fs.unlinkSync(spoolPath);
    const liveIdentity = { pid: process.pid, boot_id: 'boot-a', start_time: '100' };
    fs.writeFileSync(lockPath, `${JSON.stringify({ ...liveIdentity, created_at: '2020-01-01T00:00:00Z' })}\n`, { mode: 0o600, flag: 'wx' });
    fs.utimesSync(lockPath, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
    assert.deepStrictEqual(await watcher.claimAndQueueReply({
      client: { claimNotification: async () => { throw new Error('live lock must prevent claim'); } },
      ownerOpenId: 'ou-reply', chatId: 'chat-reply', spoolPath, inflightPath, lockStaleMs: 1000,
      identityReader: () => liveIdentity
    }), { status: 'busy' });
    fs.unlinkSync(lockPath);
    for (const [recorded, current, label] of [
      [liveIdentity, { ...liveIdentity, start_time: '101' }, 'reused pid'],
      [liveIdentity, { ...liveIdentity, boot_id: 'boot-b' }, 'new boot']
    ]) {
      fs.writeFileSync(lockPath, `${JSON.stringify({ ...recorded, created_at: '2020-01-01T00:00:00Z' })}\n`, { mode: 0o600, flag: 'wx' });
      fs.utimesSync(lockPath, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
      assert.deepStrictEqual(await watcher.claimAndQueueReply({
        client: { claimNotification: async () => ({ notification: null }) },
        ownerOpenId: 'ou-reply', chatId: 'chat-reply', spoolPath, inflightPath, lockStaleMs: 1000,
        identityReader: () => current
      }), { status: 'empty' }, `${label} lock must be recoverable`);
      assert.strictEqual(fs.existsSync(lockPath), false);
    }
    fs.writeFileSync(lockPath, 'stale', { mode: 0o600, flag: 'wx' });
    fs.utimesSync(lockPath, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
    assert.deepStrictEqual(await watcher.claimAndQueueReply({
      client: { claimNotification: async () => ({ notification: null }) },
      ownerOpenId: 'ou-reply', chatId: 'chat-reply', spoolPath, inflightPath, lockStaleMs: 1000
    }), { status: 'empty' }, 'stale watcher lock must not wedge the relay');
    assert.strictEqual(fs.existsSync(lockPath), false);

    assert.deepStrictEqual(await watcher.claimAndQueueReply({
      client: { claimNotification: async () => ({ notification: claimedRow }), nackNotification: async () => { throw new Error('must not nack'); } },
      ownerOpenId: 'ou-reply', chatId: 'chat-reply', spoolPath, inflightPath
    }), { status: 'queued', id: 51 });
    const acknowledgements = [];
    let sends = 0;
    assert.deepStrictEqual(await extension.deliverQueuedReply({
      client: {
        notificationStatus: async () => ({ notification_id: 51, delivery_state: 'inflight', can_deliver: true }),
        ackNotification: async (...args) => { acknowledgements.push(args); return { notification_id: 51, delivery_state: 'delivered' }; },
        nackNotification: async () => { throw new Error('must not nack'); }
      },
      openId: 'ou-reply', expectedChatId: 'chat-reply', spoolPath, inflightPath,
      channel: {}, sendManagedCard: async (_channel, _chat, _card, _reply, _thread, _receiveType, uuid) => { sends += 1; return { messageId: `message-${uuid}` }; }
    }), { status: 'delivered', id: 51 });
    assert.strictEqual(sends, 1);
    assert.strictEqual(acknowledgements.length, 1);
    assert.strictEqual(await extension.deliverQueuedReply({
      client: {}, openId: 'ou-reply', expectedChatId: 'chat-reply', spoolPath, inflightPath,
      channel: {}, sendManagedCard: async () => { throw new Error('must not resend'); }
    }), false);

    await watcher.claimAndQueueReply({
      client: { claimNotification: async () => ({ notification: { ...claimedRow, id: 57, notification_key: '00000000-0000-4000-8000-000000000058' } }) },
      ownerOpenId: 'ou-reply', chatId: 'chat-reply', spoolPath, inflightPath
    });
    let ackCommitted = false;
    await assert.rejects(() => extension.deliverQueuedReply({
      client: {
        notificationStatus: async () => ({ notification_id: 57, delivery_state: 'inflight', can_deliver: true }),
        ackNotification: async () => { ackCommitted = true; throw new Error('ack response lost'); }
      },
      openId: 'ou-reply', expectedChatId: 'chat-reply', spoolPath, inflightPath,
      channel: {}, sendManagedCard: async () => ({ messageId: 'message-57' })
    }), /ack response lost/);
    assert.strictEqual(ackCommitted, true);
    assert.strictEqual(fs.existsSync(inflightPath), true, 'ack uncertainty must retain recovery file');
    assert.deepStrictEqual(await extension.deliverQueuedReply({
      client: { notificationStatus: async () => ({ notification_id: 57, delivery_state: 'delivered', can_deliver: false }) },
      openId: 'ou-reply', expectedChatId: 'chat-reply', spoolPath, inflightPath,
      channel: {}, sendManagedCard: async () => { throw new Error('ack recovery must not resend'); }
    }), { status: 'delivered', id: 57 });

    await watcher.claimAndQueueReply({
      client: { claimNotification: async () => ({ notification: { ...claimedRow, id: 52, notification_key: '00000000-0000-4000-8000-000000000053' } }) },
      ownerOpenId: 'ou-reply', chatId: 'chat-reply', spoolPath, inflightPath
    });
    fs.renameSync(spoolPath, inflightPath);
    const crashNacks = [];
    assert.deepStrictEqual(await extension.deliverQueuedReply({
      client: {
        notificationStatus: async () => ({ notification_id: 52, delivery_state: 'inflight', can_deliver: true }),
        nackNotification: async (...args) => { crashNacks.push(args); return { notification_id: 52, delivery_state: 'manual_review' }; }
      },
      openId: 'ou-reply', expectedChatId: 'chat-reply', spoolPath, inflightPath,
      channel: {}, sendManagedCard: async () => { throw new Error('crash recovery must not resend'); }
    }), { status: 'manual_review', id: 52 });
    assert.strictEqual(crashNacks[0][2].outcome, 'ambiguous');

    const recovered = { ...claimedRow, id: 53, notification_key: '00000000-0000-4000-8000-000000000054' };
    fs.writeFileSync(inflightPath, `${JSON.stringify({ version: 1, id: recovered.id, notification_key: recovered.notification_key, claim_token: recovered.claim_token, chat_id: 'chat-reply', card: watcher.replyNotificationCard(recovered) })}\n`, { mode: 0o600, flag: 'wx' });
    assert.deepStrictEqual(await extension.deliverQueuedReply({
      client: { notificationStatus: async () => ({ notification_id: 53, delivery_state: 'delivered', can_deliver: false }) },
      openId: 'ou-reply', expectedChatId: 'chat-reply', spoolPath, inflightPath,
      channel: {}, sendManagedCard: async () => { throw new Error('ack recovery must not resend'); }
    }), { status: 'delivered', id: 53 });
    assert.strictEqual(fs.existsSync(inflightPath), false);

    fs.writeFileSync(inflightPath, `${JSON.stringify({ version: 1, id: 54, notification_key: '00000000-0000-4000-8000-000000000055', claim_token: recovered.claim_token, chat_id: 'chat-reply', card: watcher.replyNotificationCard(recovered) })}\n`, { mode: 0o600, flag: 'wx' });
    assert.deepStrictEqual(await extension.deliverQueuedReply({
      client: { notificationStatus: async () => ({ notification_id: 54, delivery_state: 'pending', can_deliver: false }) },
      openId: 'ou-reply', expectedChatId: 'chat-reply', spoolPath, inflightPath,
      channel: {}, sendManagedCard: async () => { throw new Error('nack recovery must not resend'); }
    }), { status: 'retry_pending', id: 54 });

    fs.writeFileSync(spoolPath, `${JSON.stringify({ version: 1, id: 55, notification_key: '00000000-0000-4000-8000-000000000056', claim_token: recovered.claim_token, chat_id: 'chat-reply', card: watcher.replyNotificationCard(recovered) })}\n`, { mode: 0o600, flag: 'wx' });
    assert.deepStrictEqual(await extension.deliverQueuedReply({
      client: { notificationStatus: async () => ({ notification_id: 55, delivery_state: 'manual_review', can_deliver: false }) },
      openId: 'ou-reply', expectedChatId: 'chat-reply', spoolPath, inflightPath,
      channel: {}, sendManagedCard: async () => { throw new Error('cancelled notification must not send'); }
    }), { status: 'manual_review', id: 55 });

    fs.writeFileSync(inflightPath, `${JSON.stringify({ version: 1, id: 56, notification_key: '00000000-0000-4000-8000-000000000057', claim_token: recovered.claim_token, chat_id: 'chat-reply', card: watcher.replyNotificationCard(recovered) })}\n`, { mode: 0o600, flag: 'wx' });
    await assert.rejects(() => extension.deliverQueuedReply({
      client: { notificationStatus: async () => { throw new Error('status unavailable'); } },
      openId: 'ou-reply', expectedChatId: 'chat-reply', spoolPath, inflightPath,
      channel: {}, sendManagedCard: async () => { throw new Error('must not send'); }
    }), /status unavailable/);
    assert.strictEqual(fs.existsSync(inflightPath), true, 'unknown DB state must retain relay file');
    fs.unlinkSync(inflightPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testWatcherWholeCardBudget() {
  const watcher = require('../scripts/matrix-watch.js');
  const long = '😀极限公开信息'.repeat(90);
  const rows = Array.from({ length: 5 }, (_, index) => ({
    id: 700 + index,
    company_name: `定时公司${index + 1}${long}`,
    country_code: 'US',
    priority: 'P0',
    stage_code: index === 4 ? 'recommendation_ready' : 'observed',
    assessment_cn: index === 0 ? `ISO22000认证明确，产品匹配${long}` : `理由${index + 1}${long}`,
    categories: [`品类${index + 1}${long}`, long],
    size_signals: [`250g ${long}`, `own factory ${long}`, 'ISO22000/GMP/BRC认证'],
    next_action_cn: `下一步${index + 1}${long}`,
    supplier_signal: index === 0 ? { confidence: 'confirmed', supplier_name: '公开供应方' } : null,
    strategy_signal: { differentiation_angle: `切入策略${index + 1}${long}` }
  }));
  const card = watcher.reminderCard(rows);
  const text = visibleText(card);
  assert.ok([...text].length <= 3500, `watcher reminder uses ${[...text].length} code points`);
  for (let index = 0; index < 5; index += 1) {
    assert.ok(text.includes(`${String.fromCharCode(65 + index)}｜定时公司${index + 1}`));
  }
  for (const required of ['推荐理由：', '主营类目：', '阶段：已观察', '已确认规格：', '已确认公开信号：', '供应商：已确认', '供应商：未知', '切入策略：', '待核实：', '下一步：', '引用本卡回复 A-E']) {
    assert.ok(text.includes(required), `watcher reminder missing ${required}`);
  }
  const quick = buttons(card).filter(item => item.behaviors?.[0]?.value?.a === 'mx.quick');
  assert.deepStrictEqual(quick.map(item => item.behaviors[0].value.i), [0, 1, 2, 3, 4]);
  assert.deepStrictEqual(quick.map(item => item.text.content), ['查看 A', '查看 B', '查看 C', '查看 D', '查看 E']);
  assert.ok(!/ISO22000|GMP|BRC|认证/.test(text), 'scheduled card must hide qualification commentary');
}

async function testFreshQuickChoiceRecovery() {
  const rows = Array.from({ length: 5 }, (_, index) => ({
    id: 900 + index, company_name: `Quick ${index + 1}`, country_code: 'VN', priority: 'P1',
    categories: ['fruit'], format_signals: ['roll film'], size_signals: [], status: 'valid',
    stage_code: 'observed', assessment_cn: '公开产品证据', next_action_cn: '确认结构', contacts: {}
  }));
  for (const input of ['候选A', '候选 a', '开发客户 A']) {
    const calls = [];
    const sent = [];
    const registered = extension.register({
      channel: {}, dispatcher: { on: () => undefined }, card: helpers(),
      now: () => Date.parse('2026-07-17T00:00:00Z'),
      sendManagedCard: async (_channel, _chat, card) => sent.push(card),
      client: {
        rehydrateSession: async () => { const error = new Error('matrix API HTTP 409'); error.status = 409; throw error; },
        today: async openId => { calls.push(['today', openId]); return { rows, snapshot_key: 'q'.repeat(64) }; },
        createSession: async (openId, value) => { calls.push(['createSession', openId, value]); return { id: 901, chat_id: value.chat_id, thread_id: value.thread_id, filters: value.filters, page: 1, version: 1, expires_at: value.expires_at }; },
        candidateDetail: async (openId, id) => { calls.push(['candidateDetail', openId, id]); return { ...rows[id - 900], discovery: {}, official_evidence: [] }; },
        selectCandidate: async () => { calls.push(['selectCandidate']); throw new Error('quick choice must not select'); }
      }
    });
    assert.strictEqual(await registered.onMessage({ msg: { content: input, chatId: 'chat-quick', threadId: 'thread-quick', senderId: 'ou-quick' } }), true);
    assert.deepStrictEqual(calls.map(item => item[0]), ['today', 'createSession', 'candidateDetail']);
    assert.ok(visibleText(sent.at(-1)).includes('Quick 1'));
    registered.dispose();
  }

  const handlers = new Map();
  const created = [];
  const details = [];
  const registered = extension.register({
    channel: {}, dispatcher: { on: (name, handler) => handlers.set(name, handler) }, card: helpers(),
    now: () => Date.parse('2026-07-17T00:00:00Z'), sendManagedCard: async () => undefined,
    client: {
      rehydrateSession: async () => { const error = new Error('matrix API HTTP 409'); error.status = 409; throw error; },
      today: async () => ({ rows, snapshot_key: 'q'.repeat(64) }),
      createSession: async (openId, value) => { created.push([openId, value.chat_id, value.thread_id]); return { id: created.length, chat_id: value.chat_id, thread_id: value.thread_id, filters: value.filters, page: 1, version: 1, expires_at: value.expires_at }; },
      candidateDetail: async (openId, id) => { details.push([openId, id]); return { ...rows[id - 900], discovery: {}, official_evidence: [] }; }
    }
  });
  const base = { chatId: 'chat-shared', threadId: 'thread-shared', messageId: 'evt' };
  await handlers.get('mx.quick')({ evt: { ...base, operator: { openId: 'ou-one' } }, value: { a: 'mx.quick', i: 1 } });
  await handlers.get('mx.quick')({ evt: { ...base, operator: { openId: 'ou-two' } }, value: { a: 'mx.quick', i: 1 } });
  assert.deepStrictEqual(created, [['ou-one', 'chat-shared', 'thread-shared'], ['ou-two', 'chat-shared', 'thread-shared']]);
  assert.deepStrictEqual(details, [['ou-one', 901], ['ou-two', 901]]);
  registered.dispose();
}

async function testReminderPollingAndRetry() {
  const watcher = require('../scripts/matrix-watch.js');
  const spoolRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-reminder-poll-'));
  const spoolPath = path.join(spoolRoot, 'pending.json');
  const inflightPath = path.join(spoolRoot, 'inflight.json');
  const receiptPath = path.join(spoolRoot, 'receipt.json');
  let poll;
  let attempts = 0;
  let releaseFirstSend;
  let failReceiptOnce = true;
  let failRemoveOnce = false;
  let activeTimers = 0;
  const reminderLogs = [];
  try {
    process.env.STREAM_CHAT_ID = 'chat-poll';
    const registered = extension.register({
      channel: {}, dispatcher: { on: () => undefined }, card: helpers(), client: {},
      reminderSpoolPath: spoolPath,
      reminderInflightPath: inflightPath,
      reminderReceiptPath: receiptPath,
      logReminder: message => reminderLogs.push(message),
      scheduleReminderPoll: callback => { poll = callback; activeTimers += 1; return { unref() {} }; },
      clearReminderPoll: () => { activeTimers -= 1; },
      writeReminderReceipt: (receiptPath, receipt) => {
        if (failReceiptOnce) { failReceiptOnce = false; throw new Error('crash before local receipt'); }
        fs.writeFileSync(receiptPath, JSON.stringify(receipt));
      },
      removeReminderInflight: pendingPath => {
        if (failRemoveOnce) { failRemoveOnce = false; throw new Error('crash after receipt before pending cleanup'); }
        fs.unlinkSync(pendingPath);
      },
      sendManagedCard: async (_channel, _chatId, _card, _reply, _thread, _receiveType, uuid) => {
        attempts += 1;
        if (attempts === 1) await new Promise(resolve => { releaseFirstSend = resolve; });
        return { messageId: `message-${uuid}`, cardId: 'card-1' };
      }
    });
    assert.strictEqual(typeof poll, 'function', 'extension registration must schedule spool polling');
    const deliveryId = watcher.queueReminder({ schema: '2.0', body: { elements: [] } }, 'chat-poll', {
      date: '2026-07-18', spoolPath, inflightPath, receiptPath
    });
    const firstPoll = poll();
    await new Promise(resolve => setImmediate(resolve));
    const overlappingPoll = poll();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(attempts, 1, 'overlapping timer ticks must not duplicate delivery');
    releaseFirstSend();
    await Promise.all([firstPoll, overlappingPoll]);
    assert.strictEqual(fs.existsSync(spoolPath), false);
    assert.strictEqual(fs.existsSync(inflightPath), true, 'post-send receipt crash must remain inflight');
    const inflight = JSON.parse(fs.readFileSync(inflightPath, 'utf8'));
    assert.strictEqual(inflight.id, deliveryId);
    assert.ok(Date.parse(inflight.attempted_at));
    assert.strictEqual(await registered.onMessage({ msg: { content: '普通消息', chatId: 'chat-poll', senderId: 'ou-poll' } }), false);
    assert.strictEqual(attempts, 1, 'ordinary messages must not consume or duplicate a reminder');
    inflight.attempted_at = '2026-07-18T00:00:00.000Z';
    fs.writeFileSync(inflightPath, JSON.stringify(inflight));
    await poll();
    assert.strictEqual(attempts, 1, 'ambiguous inflight must never resend, including after one hour');
    assert.match(reminderLogs.at(-1), /ambiguous.*manual reconciliation required/i);
    fs.writeFileSync(receiptPath, JSON.stringify({ version: 1, date: inflight.date, id: inflight.id, chat_id: inflight.chat_id }));
    await poll();
    assert.strictEqual(fs.existsSync(inflightPath), false, 'manual receipt reconciliation permits cleanup');
    watcher.queueReminder({ schema: '2.0', body: { elements: [] } }, 'chat-poll', {
      date: '2026-07-19', spoolPath, inflightPath, receiptPath
    });
    failRemoveOnce = true;
    await poll();
    assert.strictEqual(fs.existsSync(inflightPath), true, 'post-receipt cleanup crash must retain inflight evidence');
    const attemptsBeforeReceiptRecovery = attempts;
    await poll();
    assert.strictEqual(attempts, attemptsBeforeReceiptRecovery, 'matching receipt must suppress remote resend');
    assert.strictEqual(fs.existsSync(inflightPath), false);
    watcher.queueReminder({ schema: '2.0', body: { elements: [] } }, 'chat-poll', {
      date: '2026-07-20', spoolPath, inflightPath, receiptPath
    });
    const sendFailure = new Error('single send attempt failed');
    await assert.rejects(() => extension.deliverQueuedReminder({
      spoolPath, inflightPath, receiptPath, expectedChatId: 'chat-poll', channel: {},
      sendManagedCard: async () => { attempts += 1; throw sendFailure; }
    }), /single send attempt failed/);
    const failedAttempts = attempts;
    assert.throws(() => watcher.queueReminder({ schema: '2.0', body: { elements: [] } }, 'chat-poll', {
      date: '2026-07-21', spoolPath, inflightPath, receiptPath
    }), /ambiguous.*manual reconciliation/i, 'next-day queue must not overwrite ambiguous inflight evidence');
    assert.deepStrictEqual(await extension.deliverQueuedReminder({
      spoolPath, inflightPath, receiptPath, expectedChatId: 'chat-poll', channel: {},
      sendManagedCard: async () => { attempts += 1; }
    }), { status: 'ambiguous', id: watcher.deliveryId('2026-07-20', 'chat-poll'), manual_reconciliation: true });
    assert.strictEqual(attempts, failedAttempts, 'send failure inflight must not automatically retry');
    assert.strictEqual(typeof registered.dispose, 'function');
    assert.strictEqual(activeTimers, 1);
    registered.dispose();
    assert.strictEqual(activeTimers, 0, 'dispose must clear exactly one registration timer');
    const registeredAgain = extension.register({
      channel: {}, dispatcher: { on: () => undefined }, card: helpers(), client: {},
      reminderSpoolPath: spoolPath,
      scheduleReminderPoll: () => { activeTimers += 1; return { unref() {} }; },
      clearReminderPoll: () => { activeTimers -= 1; },
      sendManagedCard: async () => ({ messageId: 'unused' })
    });
    assert.strictEqual(activeTimers, 1, 're-registration must create only its own timer');
    registeredAgain.dispose();
    assert.strictEqual(activeTimers, 0, 're-registration cleanup must not accumulate timers');
  } finally {
    delete process.env.STREAM_CHAT_ID;
    fs.rmSync(spoolRoot, { recursive: true, force: true });
  }
}

function testSanitizedCompose() {
  const composePath = path.resolve(__dirname, '../../compose.yaml');
  const source = fs.readFileSync(composePath, 'utf8');
  const dockerfile = fs.readFileSync(path.resolve(__dirname, '../../Dockerfile'), 'utf8');
  for (const expected of [
    'STREAM_CARD_EXTENSION: /workspace/extensions/stream-card.cjs',
    'MATRIX_API_BASE_URL: http://host.docker.internal:${MATRIX_API_HOST_PORT:-8080}/api/matrix',
    'MATRIX_BRIDGE_TOKEN: ${MATRIX_BRIDGE_TOKEN:?MATRIX_BRIDGE_TOKEN must be set}',
    'MATRIX_DELIVERY_ENABLED: "0"',
    'MATRIX_RECOMMEND_HOUR: "9"',
    'MATRIX_RECOMMEND_MINUTE: "0"',
    'host.docker.internal:host-gateway',
    './workspace/extensions:/workspace/extensions:ro',
    './workspace/scripts:/workspace/scripts:ro',
    '/home/admin/work/packaging-system/data/matrix-stream.db:/refs/matrix-stream.db:ro'
  ]) assert.ok(source.includes(expected), `compose missing ${expected}`);
  assert.ok(!source.includes('./workspace:/workspace:ro'), 'read-only parent mount must not hide the prepared store mountpoint');
  assert.ok(!/SMTP_|IMAP_|WHATSAPP/i.test(source));
  assert.ok(!/(app_secret|tenant_access_token)/i.test(source));
  const prepareStore = dockerfile.indexOf('mkdir -p /refs /workspace/store');
  const ownStore = dockerfile.indexOf('chown node:node /refs /workspace /workspace/store');
  const nodeUser = dockerfile.indexOf('USER node');
  assert.ok(prepareStore >= 0 && ownStore > prepareStore && nodeUser > ownStore, 'Dockerfile must prepare the watcher store for node before USER');
}

function helpers() {
  return {
    card: (elements, options = {}) => ({ elements, options }),
    md: content => ({ tag: 'md', content }),
    note: content => ({ tag: 'note', content }),
    hr: () => ({ tag: 'hr' }),
    actions: items => ({ tag: 'actions', items }),
    button: (label, value, type = 'default') => ({ tag: 'button', label, value, type }),
    linkButton: (label, url) => ({ tag: 'link', label, url })
  };
}

function visibleText(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach(item => visibleText(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => visibleText(item, output));
  return output.join('\n');
}

function buttons(value, output = []) {
  if (Array.isArray(value)) value.forEach(item => buttons(item, output));
  else if (value && typeof value === 'object') {
    if (value.tag === 'button') output.push(value);
    Object.values(value).forEach(item => buttons(item, output));
  }
  return output;
}

async function testWholeCardBudget() {
  const sent = [];
  const long = '很长的公开信息'.repeat(80);
  const rows = Array.from({ length: 5 }, (_, index) => ({
    id: 100 + index, company_name: `极限公司${index + 1}${long}`, country_code: 'US', region: 'americas', city: '',
    official_domain: `long-${index + 1}.test`, official_url: `https://long-${index + 1}.test/`,
    categories: [long, long], format_signals: [long], size_signals: [long], scale_tier: 'large',
    priority: 'P0', fit_score: 99, demand_fit_score: 99, access_score: 99, confidence: 0.99,
    status: index === 1 ? 'needs_review' : 'valid', stage_code: 'observed', audit_state: 'audited',
    assessment_cn: long, next_action_cn: long, updated_at: '2026-07-17T00:00:00.000Z',
    contacts: { email: '', phone: '', whatsapp: '', contact_page: '[available]' }
  }));
  const now = Date.parse('2026-07-17T00:00:00.000Z');
  const registered = extension.register({
    channel: {}, dispatcher: { on: () => undefined }, card: helpers(), now: () => now,
    sendManagedCard: async (_channel, _chatId, card) => { sent.push(card); },
    client: {
      today: async () => ({ rows, snapshot_key: 'long-snapshot', page: 1, page_size: 5 }),
      createSession: async (_openId, input) => ({
        id: 99, actor_user_id: 7, chat_id: input.chat_id, thread_id: input.thread_id,
        filters: input.filters, page: 1, version: 1, expires_at: input.expires_at,
        created_at: '2026-07-17T00:00:00.000Z', updated_at: '2026-07-17T00:00:00.000Z'
      })
    }
  });
  await registered.onMessage({ msg: { content: '开发客户', chatId: 'chat-long', threadId: '', senderId: 'ou-long' } });
  const text = visibleText(sent[0]);
  assert.ok([...text].length <= 3500, `whole card uses ${[...text].length} code points`);
  for (let index = 0; index < 5; index += 1) assert.ok(text.includes(`${String.fromCharCode(65 + index)}｜极限公司${index + 1}`));
  for (const core of ['推荐理由：', '待核实：', '下一步：']) assert.ok(text.includes(core));
}

async function testExpiredSessionRecovery() {
  let now = Date.parse('2026-07-17T00:00:00.000Z');
  let failRefresh = false;
  let failDetail = false;
  const sent = [];
  const handlers = new Map();
  const row = {
    id: 501, company_name: 'Expiry Company', country_code: 'US', region: 'americas', city: '',
    official_domain: 'expiry.test', official_url: 'https://expiry.test/', categories: ['coffee'],
    format_signals: ['pouch'], size_signals: [], scale_tier: 'medium', priority: 'P1',
    fit_score: 80, demand_fit_score: 80, access_score: 70, confidence: 0.9, status: 'valid',
    stage_code: 'observed', audit_state: 'audited', assessment_cn: '官网公开证据', next_action_cn: '核实公开联系入口',
    updated_at: '2026-07-17T00:00:00.000Z', contacts: { email: '', phone: '', whatsapp: '', contact_page: '[available]' }
  };
  const client = {
    today: async () => ({ rows: [row], snapshot_key: 'expiry-snapshot', page: 1, page_size: 5 }),
    createSession: async (_openId, input) => {
      if (input.session_id && failRefresh) {
        const error = new Error('matrix API HTTP 409');
        error.status = 409;
        throw error;
      }
      return {
        id: 51, actor_user_id: 7, chat_id: input.chat_id || 'chat-expiry', thread_id: input.thread_id || '',
        filters: input.filters || { page_size: 5 }, page: input.page || 1,
        version: input.session_id ? input.expected_version + 1 : 1,
        expires_at: input.expires_at || '2026-07-17T00:30:00.000Z',
        created_at: '2026-07-17T00:00:00.000Z', updated_at: '2026-07-17T00:00:00.000Z'
      };
    },
    rehydrateSession: async () => { const error = new Error('matrix API HTTP 400'); error.status = 400; throw error; },
    candidateDetail: async () => {
      if (failDetail) {
        const error = new Error('matrix API HTTP 400');
        error.status = 400;
        throw error;
      }
      return { ...row, discovery: null, official_evidence: [] };
    }
  };
  const registered = extension.register({
    channel: {}, dispatcher: { on: (name, handler) => handlers.set(name, handler) }, card: helpers(), now: () => now,
    sendManagedCard: async (_channel, _chatId, card) => { sent.push(card); }, client
  });
  const message = { content: '开发客户', chatId: 'chat-expiry', threadId: '', senderId: 'ou-expiry' };
  await registered.onMessage({ msg: message });
  now += 30 * 60 * 1000 + 1;
  assert.strictEqual(await registered.onMessage({ msg: { ...message, content: '候选A' } }), true);
  assert.ok(visibleText(sent.at(-1)).includes('Expiry Company'));
  assert.strictEqual(await registered.onMessage({ msg: { ...message, content: '候选A' } }), true);
  assert.ok(visibleText(sent.at(-1)).includes('Expiry Company'));

  await registered.onMessage({ msg: message });
  const locallyExpiredButton = buttons(sent.at(-1)).find(item => item.value?.a === 'mx.detail');
  now += 30 * 60 * 1000 + 1;
  await handlers.get('mx.detail')({
    evt: { operator: { openId: 'ou-expiry' }, chatId: 'chat-expiry', threadId: '', messageId: 'evt-local-expiry' },
    value: locallyExpiredButton.value
  });
  assert.ok(visibleText(sent.at(-1)).includes('开发客户'));

  now = Date.parse('2026-07-17T01:00:00.000Z');
  await registered.onMessage({ msg: message });
  failRefresh = true;
  assert.strictEqual(await registered.onMessage({ msg: { ...message, content: '候选A' } }), true);
  assert.ok(visibleText(sent.at(-1)).includes('Expiry Company'));
  failRefresh = false;

  await registered.onMessage({ msg: message });
  const detailButton = buttons(sent.at(-1)).find(item => item.value?.a === 'mx.detail');
  failDetail = true;
  await handlers.get('mx.detail')({
    evt: { operator: { openId: 'ou-expiry' }, chatId: 'chat-expiry', threadId: '', messageId: 'evt-expiry' },
    value: detailButton.value
  });
  assert.ok(visibleText(sent.at(-1)).includes('开发客户'));
  failDetail = false;
  await handlers.get('mx.detail')({
    evt: { operator: { openId: 'ou-expiry' }, chatId: 'chat-expiry', threadId: '', messageId: 'evt-expiry-2' },
    value: detailButton.value
  });
  assert.ok(visibleText(sent.at(-1)).includes('开发客户'));
}

async function testConcurrentCallbacksFreezeDisplayedVersion() {
  const handlers = new Map();
  const sent = [];
  const patchVersions = [];
  const pendingReads = [];
  let serverVersion = 1;
  const row = { id: 701, company_name: 'Concurrent Company', country_code: 'US', region: 'americas', official_domain: 'concurrent.test', official_url: 'https://concurrent.test/', categories: ['coffee'], format_signals: [], size_signals: [], scale_tier: 'medium', priority: 'P1', fit_score: 80, demand_fit_score: 80, access_score: 70, confidence: 0.9, status: 'valid', stage_code: 'observed', audit_state: 'audited', assessment_cn: '公开证据', next_action_cn: '核实公开入口', updated_at: '2026-07-17T00:00:00Z' };
  const client = {
    today: async (_openId, filters) => filters.region ? new Promise(resolve => pendingReads.push(resolve)) : ({ rows: [row], snapshot_key: '7'.repeat(64) }),
    createSession: async (_openId, input) => {
      if (!input.session_id) return { id: 71, chat_id: 'chat-concurrent', thread_id: '', filters: { page_size: 5 }, page: 1, version: 1, expires_at: '2026-07-17T00:30:00Z' };
      patchVersions.push(input.expected_version);
      if (input.expected_version !== serverVersion) { const error = new Error('matrix API HTTP 409'); error.status = 409; throw error; }
      serverVersion += 1;
      return { id: 71, chat_id: 'chat-concurrent', thread_id: '', filters: input.filters, snapshot_key: input.snapshot_key, candidate_ids: input.candidate_ids, page: input.page, version: serverVersion, expires_at: '2026-07-17T00:30:00Z' };
    },
    listCandidates: async () => { throw new Error('ordinary list must not feed recommendations'); }
  };
  const registered = extension.register({
    channel: {}, dispatcher: { on: (name, handler) => handlers.set(name, handler) }, card: helpers(), client,
    now: () => Date.parse('2026-07-17T00:00:00Z'), sendManagedCard: async (_channel, _chat, card) => sent.push(card)
  });
  await registered.onMessage({ msg: { content: '开发客户', chatId: 'chat-concurrent', threadId: '', senderId: 'ou-concurrent' } });
  const evt = { operator: { openId: 'ou-concurrent' }, chatId: 'chat-concurrent', threadId: '', messageId: 'evt-concurrent' };
  const value = { a: 'mx.region', s: 71, v: 1, r: 'americas' };
  const first = handlers.get('mx.region')({ evt, value });
  const second = handlers.get('mx.region')({ evt, value });
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(pendingReads.length, 2);
  pendingReads[0]({ rows: [row], snapshot_key: '8'.repeat(64) });
  await new Promise(resolve => setImmediate(resolve));
  pendingReads[1]({ rows: [row], snapshot_key: '9'.repeat(64) });
  await Promise.all([first, second]);
  assert.deepStrictEqual(patchVersions, [1, 1]);
  assert.strictEqual(serverVersion, 2);
  assert.ok(sent.some(card => visibleText(card).includes('开发客户')));
  registered.dispose();
}

async function testSelectionReplayAfterRestart() {
  const row = { id: 801, company_name: 'Replay Company', country_code: 'US', region: 'americas', official_domain: 'replay.test', official_url: 'https://replay.test/', categories: ['coffee'], format_signals: [], size_signals: [], scale_tier: 'medium', priority: 'P1', fit_score: 80, demand_fit_score: 80, access_score: 70, confidence: 0.9, status: 'valid', stage_code: 'observed', audit_state: 'audited', assessment_cn: '公开证据', next_action_cn: '核实公开入口', updated_at: '2026-07-17T00:00:00Z' };
  const persisted = new Map(); let version = 1; let workItems = 0; const sent = [];
  const client = {
    today: async () => ({ rows: [row], snapshot_key: '8'.repeat(64) }),
    createSession: async () => ({ id: 81, chat_id: 'chat-replay', thread_id: '', filters: { page_size: 5 }, snapshot_key: '8'.repeat(64), candidate_ids: [801], page: 1, version, expires_at: '2026-07-17T00:30:00Z' }),
    rehydrateSession: async () => ({ id: 81, chat_id: 'chat-replay', thread_id: '', filters: { page_size: 5 }, snapshot_key: '8'.repeat(64), candidate_ids: [801], candidates: [row], page: 1, version, expires_at: '2026-07-17T00:30:00Z' }),
    candidateDetail: async () => ({ ...row, discovery: {}, official_evidence: [], contacts: {} }),
    selectCandidate: async (_openId, input) => {
      if (persisted.has(input.idempotency_key)) return persisted.get(input.idempotency_key);
      if (input.expected_version !== version) { const error = new Error('matrix API HTTP 409'); error.status = 409; throw error; }
      version += 1; workItems += 1;
      const result = { work_item_id: 1, candidate_id: input.candidate_id, session_id: 81, session_version: version, next_action: input.next_action };
      persisted.set(input.idempotency_key, result); return result;
    },
    createVersion: async () => ({
      id: 1, work_item_id: 1, revision: 1, recipient_email: 'sales@replay.test',
      subject: 'Proposal for Replay Company', body_en: 'Dear Replay team,\nCould you share requirements?',
      body_cn: '您好，请提供需求。', content_hash: '8'.repeat(64), status: 'draft',
      quality_score: 90, quality_json: '{"score":90,"passed":true,"components":{},"hardFailures":[]}', work_item_version: 2
    })
  };
  const firstHandlers = new Map();
  const first = extension.register({ channel: {}, dispatcher: { on: (n, h) => firstHandlers.set(n, h) }, card: helpers(), client, now: () => Date.parse('2026-07-17T00:00:00Z'), sendManagedCard: async (_c, _id, card) => sent.push(card) });
  await first.onMessage({ msg: { content: '开发客户', chatId: 'chat-replay', threadId: '', senderId: 'ou-replay' } });
  const detailValue = buttons(sent.at(-1)).find(item => item.value?.a === 'mx.detail').value;
  const evt = { operator: { openId: 'ou-replay' }, chatId: 'chat-replay', threadId: '', messageId: 'evt-replay' };
  await firstHandlers.get('mx.detail')({ evt, value: detailValue });
  const oldSelect = buttons(sent.at(-1)).find(item => item.value?.a === 'mx.select').value;
  await firstHandlers.get('mx.select')({ evt, value: oldSelect });
  for (const expected of ['sales@replay.test', 'Proposal for Replay Company', '英文草稿', '中文翻译', '尚未发送', '确认采用']) {
    assert.ok(visibleText(sent.at(-1)).includes(expected), `selection follow-up missing ${expected}`);
  }
  first.dispose();
  const freshHandlers = new Map();
  const fresh = extension.register({ channel: {}, dispatcher: { on: (n, h) => freshHandlers.set(n, h) }, card: helpers(), client, now: () => Date.parse('2026-07-17T00:00:00Z'), sendManagedCard: async (_c, _id, card) => sent.push(card) });
  await freshHandlers.get('mx.select')({ evt, value: oldSelect });
  assert.strictEqual(workItems, 1);
  assert.ok(visibleText(sent.at(-1)).includes('sales@replay.test'));
  await freshHandlers.get('mx.select')({ evt, value: { ...oldSelect, e: 'unseen-stale-event' } });
  assert.strictEqual(workItems, 1);
  assert.ok(visibleText(sent.at(-1)).includes('开发客户'));
  fresh.dispose();
}

async function testInteractiveZeroRecommendations() {
  const sent = []; let created;
  const registered = extension.register({
    channel: {}, dispatcher: { on: () => undefined }, card: helpers(), now: () => Date.parse('2026-07-17T00:00:00Z'),
    client: {
      today: async () => ({ rows: [], snapshot_key: 'f'.repeat(64), page: 1, page_size: 5, total: 0, total_pages: 0 }),
      createSession: async (_openId, input) => { created = input; return { id: 91, chat_id: 'chat-zero', thread_id: '', filters: input.filters, snapshot_key: input.snapshot_key, candidate_ids: input.candidate_ids, page: 1, version: 1, expires_at: input.expires_at }; }
    },
    sendManagedCard: async (_c, _id, card) => sent.push(card)
  });
  await registered.onMessage({ msg: { content: '开发客户', chatId: 'chat-zero', threadId: '', senderId: 'ou-zero' } });
  assert.strictEqual(created.snapshot_key, '');
  assert.deepStrictEqual(created.candidate_ids, []);
  assert.ok(visibleText(sent[0]).includes('没有达到公开证据标准'));
  assert.strictEqual(buttons(sent[0]).length, 0);
  registered.dispose();
}

async function testRecommendationSnapshotTransitions() {
  const rows = Array.from({ length: 10 }, (_, index) => ({ id: index + 1, company_name: `Snapshot ${index + 1}`, country_code: 'US', region: 'americas', official_domain: `snapshot-${index + 1}.test`, official_url: `https://snapshot-${index + 1}.test/`, categories: ['coffee'], format_signals: [], size_signals: [], scale_tier: 'medium', priority: 'P1', fit_score: 80, demand_fit_score: 80, access_score: 70, confidence: 0.9, status: 'valid', stage_code: 'observed', audit_state: 'audited', assessment_cn: '公开证据', next_action_cn: '核实公开入口', updated_at: '2026-07-17T00:00:00Z' }));
  async function scenario({ drift = false, filterChange = false }) {
    const handlers = new Map(); const sent = []; const patches = []; const snapshot = 'a'.repeat(64);
    const client = {
      today: async (_openId, filters) => {
        if (filters.region) return { rows: rows.slice(0, 5), snapshot_key: 'c'.repeat(64), page: 1, page_size: 5 };
        if (filters.page === 2) return { rows: rows.slice(5, 10), snapshot_key: drift ? 'b'.repeat(64) : snapshot, page: 2, page_size: 5 };
        return { rows: rows.slice(0, 5), snapshot_key: snapshot, page: 1, page_size: 5 };
      },
      createSession: async (_openId, input) => {
        if (input.session_id) patches.push(input);
        return { id: 101, chat_id: 'chat-snapshot', thread_id: '', filters: input.filters || { page_size: 5 }, snapshot_key: input.snapshot_key, candidate_ids: input.candidate_ids, page: input.page || 1, version: input.session_id ? input.expected_version + 1 : 1, expires_at: input.expires_at || '2026-07-17T00:30:00Z' };
      }
    };
    const registered = extension.register({ channel: {}, dispatcher: { on: (n, h) => handlers.set(n, h) }, card: helpers(), client, now: () => Date.parse('2026-07-17T00:00:00Z'), sendManagedCard: async (_c, _id, card) => sent.push(card) });
    await registered.onMessage({ msg: { content: '开发客户', chatId: 'chat-snapshot', threadId: '', senderId: 'ou-snapshot' } });
    const evt = { operator: { openId: 'ou-snapshot' }, chatId: 'chat-snapshot', threadId: '', messageId: 'evt-snapshot' };
    if (filterChange) await handlers.get('mx.region')({ evt, value: { a: 'mx.region', s: 101, v: 1, r: 'americas' } });
    else await handlers.get('mx.page')({ evt, value: { a: 'mx.page', s: 101, v: 1 } });
    registered.dispose();
    return { sent, patches };
  }
  const stable = await scenario({});
  assert.strictEqual(stable.patches.length, 1);
  assert.deepStrictEqual(stable.patches[0].candidate_ids, [6, 7, 8, 9, 10]);
  assert.ok(!stable.patches[0].candidate_ids.some(id => [1, 2, 3, 4, 5].includes(id)));
  const drifted = await scenario({ drift: true });
  assert.strictEqual(drifted.patches.length, 0);
  assert.ok(visibleText(drifted.sent.at(-1)).includes('开发客户'));
  const filtered = await scenario({ filterChange: true });
  assert.strictEqual(filtered.patches.length, 1);
  assert.strictEqual(filtered.patches[0].snapshot_key, 'c'.repeat(64));
}

(async () => {
  await testNarrowClient();
  await testAuthoritativeContextInjection();
  await testShortImageConfirmationUsesBoundContext();
  await testImageConfirmationReportsReadFailure();
  await testOneShotUnmentionedFollowupWindow();
  await testTwoConfirmationReviewFlow();
  await testReadOnlyWatcher();
  await testReplyNotificationCardAndDraftAction();
  testWatcherWholeCardBudget();
  await testFreshQuickChoiceRecovery();
  await testReminderPollingAndRetry();
  await testWholeCardBudget();
  await testExpiredSessionRecovery();
  await testConcurrentCallbacksFreezeDisplayedVersion();
  await testSelectionReplayAfterRestart();
  await testInteractiveZeroRecommendations();
  await testRecommendationSnapshotTransitions();
  testSanitizedCompose();
  process.env.MATRIX_DELIVERY_ENABLED = '1';
  assert.throws(() => extension.register({}), /MATRIX_DELIVERY_ENABLED/);
  process.env.MATRIX_DELIVERY_ENABLED = '0';
  const calls = [];
  const sent = [];
  const handlers = new Map();
  const candidates = Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    company_name: `Company ${index + 1}`,
    country_code: index % 2 ? 'GB' : 'US',
    region: index % 2 ? 'europe' : 'americas',
    city: '',
    official_domain: `company-${index + 1}.test`,
    official_url: `https://company-${index + 1}.test/`,
    priority: `P${Math.min(index, 3)}`,
    categories: ['coffee'],
    assessment_cn: index === 0 ? 'ISO22000认证明确，公开产品证据理由 1' : `公开证据理由 ${index + 1}`,
    next_action_cn: '核实公开联系入口',
    format_signals: ['stand-up pouch'],
    size_signals: index === 0 ? ['250g', 'own factory', 'ISO22000/GMP/BRC认证'] : [],
    scale_tier: 'medium',
    fit_score: 80,
    demand_fit_score: 80,
    access_score: 70,
    confidence: 0.9,
    status: index === 1 ? 'needs_review' : 'valid',
    stage_code: index === 4 ? 'recommendation_ready' : 'observed',
    audit_state: 'audited',
    updated_at: '2026-07-17T00:00:00.000Z',
    contacts: { email: '', phone: '', whatsapp: '', contact_page: '[available]' },
    internal_formula: index === 0 ? 'SENTINEL-INTERNAL-FORMULA' : '',
    internal_cost: index === 0 ? 'SENTINEL-INTERNAL-COST' : ''
  }));
  let sessionExpiry = '';
  let failNextList = false;
  let currentStreamVersionId = 0;
  const draftVersion = workItemId => ({
    id: 301, work_item_id: workItemId, revision: 1, recipient_email: 'public@company.test',
    recipient_source_url: 'https://company.test/contact', subject: 'laminated roll film for Company 1',
    body_en: 'Dear Company 1 team,\nCould you confirm structure and annual volume?\nBest regards',
    body_cn: '您好，请确认当前结构和年用量。', content_hash: '3'.repeat(64), status: 'draft',
    quality_score: 92, quality_json: '{"score":92,"passed":true,"components":{},"hardFailures":[]}', work_item_version: 2
  });
  const client = {
    today: async (openId, filters) => {
      calls.push(['today', openId, filters]);
      if (failNextList) {
        const failure = failNextList; failNextList = false;
        const error = failure === 'timeout' ? new Error('request timed out') : new Error('matrix API HTTP 500');
        if (failure === 'timeout') error.name = 'TimeoutError'; else error.status = 500;
        throw error;
      }
      return { rows: candidates.slice(0, 5), snapshot_key: `snap-${filters.page || 1}`, page: filters.page || 1, page_size: 5 };
    },
    createSession: async (openId, input) => {
      calls.push(['createSession', openId, input]);
      if (input.expires_at) sessionExpiry = input.expires_at;
      return {
        id: 11, actor_user_id: 7, chat_id: 'chat-1', thread_id: 'thread-1',
        filters: input.filters || { page_size: 5 }, page: input.page || 1,
        version: input.session_id ? input.expected_version + 1 : 1,
        expires_at: sessionExpiry,
        created_at: '2026-07-17T00:00:00.000Z', updated_at: '2026-07-17T00:00:00.000Z'
      };
    },
    rehydrateSession: async (openId, input) => {
      calls.push(['rehydrateSession', openId, input]);
      return { id: 11, actor_user_id: 7, chat_id: 'chat-1', thread_id: 'thread-1', filters: { page_size: 5 }, snapshot_key: 'snap-1', candidate_ids: [1, 2, 3, 4, 5], candidates: candidates.slice(0, 5), page: 1, version: 1, expires_at: sessionExpiry };
    },
    candidateDetail: async (openId, id) => {
      calls.push(['candidateDetail', openId, id]);
      return {
        ...candidates[id - 1],
        official_url: 'https://company.test/',
        discovery: { discovered_via: 'official_association_directory', discovery_url: 'https://association.test/member' },
        official_evidence: [{ source_url: 'https://company.test/products', page_title: 'Products' }],
        supplier_signal: id === 1 ? {
          supplier_name: 'Verified Supplier', supplier_country_code: 'CN', supplied_category: 'laminated roll film',
          confidence: 'confirmed', source_url: 'https://trade.test/public-record', source_type: 'public_trade_record',
          observed_at: '2026-07-17T00:00:00Z', excerpt: 'Named public relationship'
        } : null,
        strategy_signal: id === 1 ? {
          entry_product: 'laminated roll film', differentiation_angle: 'stable repeat print control',
          first_contact_goal: 'confirm structure and annual volume', questions: ['Current structure?', 'Annual volume?'],
          risks: ['Relationship may have changed'], source_url: 'https://trade.test/public-record', observed_at: '2026-07-17T00:00:00Z'
        } : null,
        contacts: { email: 'public@company.test', phone: '', whatsapp: '', contact_page: 'https://company.test/contact' }
      };
    },
    facets: async openId => {
      calls.push(['facets', openId]);
      return {
        regions: [{ value: 'americas', count: 2 }, { value: 'europe', count: 2 }],
        countries: [{ value: 'US', count: 2 }, { value: 'GB', count: 2 }, { value: 'CN', count: 99 }],
        categories: [{ value: 'coffee', count: 3 }, { value: 'tea', count: 2 }],
        cities: [{ value: '广州', count: 99 }]
      };
    },
    listCandidates: async () => { throw new Error('ordinary list must not feed recommendations'); },
    selectCandidate: async (openId, input) => {
      calls.push(['selectCandidate', openId, input]);
      if (input.idempotency_key === 'stale-event') { const error = new Error('matrix API HTTP 409'); error.status = 409; throw error; }
      return { work_item_id: 91, work_item_version: 4, candidate_id: input.candidate_id, session_id: input.session_id, session_version: input.expected_version + 1, next_action: input.next_action };
    },
    createVersion: async (openId, workItemId, input) => {
      calls.push(['createVersion', openId, workItemId, input]);
      currentStreamVersionId = 301;
      return draftVersion(workItemId);
    },
    getVersion: async (openId, workItemId, versionId) => {
      calls.push(['getVersion', openId, workItemId, versionId]);
      return draftVersion(workItemId);
    },
    workItems: async openId => { calls.push(['workItems', openId]); return { rows: [{ id: 91, candidate_id: 1, stage: 'selected', current_stream_version_id: currentStreamVersionId || null, next_action: '核实公开联系入口' }] }; }
  };
  const registered = extension.register({
    channel: {},
    dispatcher: { on: (name, handler) => { handlers.set(name, handler); } },
    sendManagedCard: async (_channel, chatId, card) => { sent.push({ chatId, card }); return 'message-1'; },
    updateManagedCard: async () => true,
    card: helpers(),
    client,
    now: () => Date.parse('2026-07-17T00:00:00.000Z')
  });

  assert.strictEqual(await registered.onMessage({ msg: { content: 'unrelated', chatId: 'chat-1', threadId: 'thread-1', senderId: 'ou-1' }, project: {} }), false);
  assert.strictEqual(await registered.onMessage({ msg: { content: '  开发客户  ', chatId: 'chat-1', threadId: 'thread-1', senderId: 'ou-1' }, project: {} }), true);
  assert.deepStrictEqual(calls.map(item => item[0]).slice(0, 2), ['today', 'createSession']);
  assert.strictEqual(sent.length, 1);
  const text = visibleText(sent[0].card);
  for (const label of ['A｜Company 1', 'B｜Company 2', 'C｜Company 3', 'D｜Company 4', 'E｜Company 5']) assert.ok(text.includes(label));
  assert.ok(!text.includes('Company 6'));
  assert.ok(!/地区|城市|广州/.test(text));
  assert.ok(text.length < 1500);
  assert.ok(!text.includes('|'));
  assert.ok(!text.includes('SENTINEL-INTERNAL'));
  assert.ok(!/ISO22000|GMP|BRC|认证/.test(text));
  assert.ok(text.includes('数据状态：有效'));
  assert.ok(text.includes('数据状态：待核实'));
  assert.ok(text.includes('阶段：已观察'));
  assert.ok(text.includes('阶段：推荐就绪'));
  assert.ok(text.includes('已确认规格：250g'));
  assert.ok(text.includes('已确认公开信号：own factory'));
  assert.ok(!text.includes('已确认规格：own factory'));
  assert.ok(!text.includes('待核实：250g'));
  assert.strictEqual(await registered.onMessage({ msg: { content: 'A', chatId: 'chat-1', threadId: 'thread-1', senderId: 'ou-1' }, project: {} }), false);
  assert.strictEqual(await registered.onMessage({ msg: { content: 'A', chatId: 'chat-1', threadId: 'thread-1', senderId: 'ou-1', replyToMessageId: 'non-candidate-card' }, project: {} }), false);
  assert.strictEqual(await registered.onMessage({ msg: { content: 'A', chatId: 'chat-1', threadId: 'thread-1', senderId: 'ou-1', replyToMessageId: 'message-1' }, project: {} }), true);
  assert.ok(calls.some(item => item[0] === 'candidateDetail' && item[2] === 1));
  const detailText = visibleText(sent.at(-1).card);
  for (const expected of ['official_association_directory', 'https://association.test/member', 'https://company.test/', 'https://company.test/products', '为什么推荐', '产品结构', '供应链线索', '开发策略', 'Verified Supplier', '已确认', 'stable repeat print control', 'https://trade.test/public-record']) assert.ok(detailText.includes(expected));
  assert.ok(detailText.includes('阶段：已观察'));
  assert.ok(detailText.includes('规格：250g'));
  assert.ok(detailText.includes('公开信号：own factory'));
  assert.ok(!detailText.includes('规格：own factory'));
  assert.ok(!detailText.includes('待核实：规格 250g'));
  assert.ok(!detailText.includes('public@company.test'));
  assert.ok(!/ISO22000|GMP|BRC|认证/.test(detailText));

  const callbackEvent = { operator: { openId: 'ou-1' }, chatId: 'chat-1', threadId: 'thread-1', messageId: 'callback-1' };
  const detailButtons = buttons(sent.at(-1).card);
  const filterSource = detailButtons.find(item => item.value?.a === 'mx.back')?.value || { a: 'mx.filters', s: 11, v: 2 };
  await handlers.get('mx.filters')({ evt: callbackEvent, value: { a: 'mx.filters', s: filterSource.s, v: filterSource.v } });
  const filterText = visibleText(sent.at(-1).card);
  for (const expected of ['海外地区', 'americas', 'europe', 'US', 'GB', 'coffee', 'tea']) assert.ok(filterText.includes(expected));
  assert.ok(!/广州|国内城市|\bCN\b/.test(filterText));
  const regionButton = buttons(sent.at(-1).card).find(item => item.value?.a === 'mx.region' && item.value?.r === 'americas');
  assert.ok(regionButton);
  const patchesBeforeFailure = calls.filter(item => item[0] === 'createSession').length;
  failNextList = true;
  await handlers.get('mx.region')({ evt: callbackEvent, value: regionButton.value });
  assert.strictEqual(calls.filter(item => item[0] === 'createSession').length, patchesBeforeFailure);
  assert.ok(visibleText(sent.at(-1).card).includes('稍后重试'));
  await handlers.get('mx.region')({ evt: callbackEvent, value: regionButton.value });
  const regionPatch = calls.filter(item => item[0] === 'createSession').at(-1)[2];
  assert.strictEqual(regionPatch.session_id, 11);
  assert.strictEqual(regionPatch.expected_version, regionButton.value.v);
  assert.strictEqual(calls.filter(item => item[0] === 'today').at(-1)[2].region, 'americas');

  const nextFilterButton = buttons(sent.at(-1).card).find(item => item.value?.a === 'mx.filters');
  await handlers.get('mx.filters')({ evt: callbackEvent, value: nextFilterButton.value });
  const categoryButton = buttons(sent.at(-1).card).find(item => item.value?.a === 'mx.category' && item.value?.k === 'coffee');
  assert.ok(categoryButton);
  const patchesBeforeTimeout = calls.filter(item => item[0] === 'createSession').length;
  failNextList = 'timeout';
  await handlers.get('mx.category')({ evt: callbackEvent, value: categoryButton.value });
  assert.strictEqual(calls.filter(item => item[0] === 'createSession').length, patchesBeforeTimeout);
  assert.ok(visibleText(sent.at(-1).card).includes('稍后重试'));
  await handlers.get('mx.category')({ evt: callbackEvent, value: categoryButton.value });
  const categoryPatch = calls.filter(item => item[0] === 'createSession').at(-1)[2];
  assert.strictEqual(categoryPatch.session_id, 11);
  assert.strictEqual(categoryPatch.expected_version, categoryButton.value.v);
  assert.strictEqual(calls.filter(item => item[0] === 'today').at(-1)[2].category, 'coffee');
  assert.strictEqual(calls.some(item => item[0] === 'listCandidates'), false);

  const selectButton = buttons(sent.slice().reverse().find(item => buttons(item.card).some(button => button.value?.a === 'mx.select'))?.card).find(item => item.value?.a === 'mx.select');
  assert.ok(selectButton);
  await handlers.get('mx.select')({ evt: callbackEvent, value: selectButton.value });
  await handlers.get('mx.select')({ evt: callbackEvent, value: selectButton.value });
  const selectionCalls = calls.filter(item => item[0] === 'selectCandidate').slice(-2);
  assert.strictEqual(selectionCalls.length, 2);
  assert.strictEqual(selectionCalls[0][2].idempotency_key, selectionCalls[1][2].idempotency_key);
  assert.strictEqual(selectionCalls[0][2].idempotency_key, selectButton.value.e);
  const selectedVersionCalls = calls.filter(item => item[0] === 'createVersion').slice(-2);
  assert.strictEqual(selectedVersionCalls.length, 1);
  assert.strictEqual(selectedVersionCalls[0][3].expected_work_version, 4);
  assert.ok(calls.some(item => item[0] === 'getVersion' && item[2] === 91 && item[3] === 301));
  const selectedText = visibleText(sent.at(-1).card);
  for (const expected of ['public@company.test', '英文草稿', '中文翻译', '尚未发送', '质量评分', '确认采用']) {
    assert.ok(selectedText.includes(expected), `selection follow-up missing ${expected}`);
  }
  assert.ok([...selectedText].length <= 1500, `selection draft card uses ${[...selectedText].length} code points`);

  const selectBeforeStale = calls.filter(item => item[0] === 'selectCandidate').length;
  await handlers.get('mx.select')({ evt: callbackEvent, value: { a: 'mx.select', s: 11, v: 999, c: 1, e: 'stale-event' } });
  assert.strictEqual(calls.filter(item => item[0] === 'selectCandidate').length, selectBeforeStale + 1);
  assert.ok(visibleText(sent.at(-1).card).includes('开发客户'));

  const freshSent = [];
  const freshHandlers = new Map();
  const fresh = extension.register({
    channel: {},
    dispatcher: { on: (name, handler) => freshHandlers.set(name, handler) },
    sendManagedCard: async (_channel, chatId, card) => { freshSent.push({ chatId, card }); },
    updateManagedCard: async () => true,
    card: helpers(),
    client,
    now: () => Date.parse('2026-07-17T00:00:00.000Z')
  });
  assert.strictEqual(await fresh.onMessage({ msg: { content: '候选A', chatId: 'chat-1', threadId: 'thread-1', senderId: 'ou-1' }, project: {} }), true);
  assert.ok(calls.some(item => item[0] === 'rehydrateSession'));
  assert.ok(visibleText(freshSent[0].card).includes('Company 1'));
  const callbackFresh = extension.register({
    channel: {}, dispatcher: { on: (name, handler) => freshHandlers.set(name, handler) },
    sendManagedCard: async (_channel, chatId, card) => { freshSent.push({ chatId, card }); }, updateManagedCard: async () => true,
    card: helpers(), client, now: () => Date.parse('2026-07-17T00:00:00.000Z')
  });
  await freshHandlers.get('mx.detail')({ evt: callbackEvent, value: { a: 'mx.detail', s: 11, v: 1, c: 1 } });
  assert.ok(calls.some(item => item[0] === 'rehydrateSession' && item[2].session_id === 11));
  assert.ok(visibleText(freshSent.at(-1).card).includes('Company 1'));
  callbackFresh.dispose();
  const incompleteSent = [];
  const incompleteHandlers = new Map();
  const incompleteClient = { ...client, rehydrateSession: async () => { const error = new Error('matrix API HTTP 409'); error.status = 409; throw error; } };
  const incomplete = extension.register({
    channel: {}, dispatcher: { on: (name, handler) => incompleteHandlers.set(name, handler) }, card: helpers(), client: incompleteClient,
    now: () => Date.parse('2026-07-17T00:00:00.000Z'), sendManagedCard: async (_channel, _chat, card) => incompleteSent.push(card)
  });
  await incomplete.onMessage({ msg: { content: '候选A', chatId: 'chat-1', threadId: 'thread-1', senderId: 'ou-1' } });
  assert.ok(visibleText(incompleteSent.at(-1)).includes('Company 1'));
  await incompleteHandlers.get('mx.detail')({ evt: callbackEvent, value: { a: 'mx.detail', s: 999, v: 1, c: 1 } });
  assert.ok(visibleText(incompleteSent.at(-1)).includes('开发客户'));
  incomplete.dispose();
  assert.strictEqual(await registered.onMessage({ msg: { content: '开发客户!', chatId: 'chat-1', senderId: 'ou-1' }, project: {} }), false);
  assert.deepStrictEqual([...handlers.keys()].sort(), ['mx.approve', 'mx.back', 'mx.category', 'mx.confirm', 'mx.detail', 'mx.filters', 'mx.page', 'mx.pick', 'mx.preview', 'mx.quick', 'mx.region', 'mx.reply_draft', 'mx.retry_translation', 'mx.review', 'mx.revise', 'mx.select', 'mx.thread_approve', 'mx.thread_confirm', 'mx.thread_preview', 'mx.today', 'mx.work']);

  console.log('stream card extension tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

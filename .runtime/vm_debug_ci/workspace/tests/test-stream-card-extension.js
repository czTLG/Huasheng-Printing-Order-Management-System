'use strict';

const assert = require('assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.MATRIX_DELIVERY_ENABLED = '0';
const extension = require('../extensions/stream-card.cjs');

async function testNarrowClient() {
  process.env.MATRIX_API_BASE_URL = 'https://matrix.test/api/matrix';
  process.env.MATRIX_BRIDGE_TOKEN = 'test-bridge-token';
  const clientPath = require.resolve('../scripts/matrix-client.js');
  delete require.cache[clientPath];
  const client = require(clientPath);
  assert.deepStrictEqual(Object.keys(client).sort(), ['candidateDetail', 'createSession', 'facets', 'listCandidates', 'selectCandidate', 'today', 'workItems']);
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
    await client.listCandidates('ou-client', { region: 'europe', page: 1, page_size: 5 });
    await client.candidateDetail('ou-client', 4);
    await client.today('ou-client', { page_size: 5 });
    await client.selectCandidate('ou-client', { candidate_id: 4, session_id: 7, expected_version: 2, idempotency_key: 'evt', next_action: 'verify' });
    await client.workItems('ou-client', { stage: 'selected' });
    assert.ok(requests.every(item => new URL(item.url).origin === 'https://matrix.test'));
    assert.ok(requests.every(item => new URL(item.url).pathname.startsWith('/api/matrix/')));
    assert.ok(requests.every(item => item.options.redirect === 'manual'));
    assert.ok(requests.every(item => item.options.signal));
    assert.ok(requests.every(item => item.options.headers['x-matrix-bridge-token'] === 'test-bridge-token'));
    assert.ok(requests.every(item => item.options.headers['x-feishu-open-id'] === 'ou-client'));
    assert.strictEqual(requests[1].options.method, 'POST');
    assert.strictEqual(requests[2].options.method, 'PATCH');
    assert.ok(requests[2].url.endsWith('/sessions/7'));
    assert.throws(() => client.candidateDetail('ou-client', '../outside'), /candidate id/);

    global.fetch = async () => ({ ok: false, status: 302, headers: { get: () => 'application/json' }, json: async () => ({}) });
    await assert.rejects(() => client.facets('ou-client'), /redirect|HTTP 302/);
    global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'text/html' }, json: async () => ({}) });
    await assert.rejects(() => client.facets('ou-client'), /JSON/);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testReadOnlyWatcher() {
  const watcher = require('../scripts/matrix-watch.js');
  const calls = [];
  const deliveries = [];
  const readOnlyClient = {
    today: async (openId, filters) => {
      calls.push({ openId, filters });
      return { rows: Array.from({ length: 7 }, (_, index) => ({ id: index + 1, company_name: `Watch ${index + 1}`, country_code: 'US', priority: 'P1', assessment_cn: '公开理由', categories: ['coffee'], next_action_cn: '核实公开信息' })) };
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
  assert.strictEqual(typeof extension.deliverQueuedReminder, 'function');
  const spoolRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-reminder-spool-'));
  try {
    const spoolPath = path.join(spoolRoot, 'pending.json');
    const queuedId = watcher.queueReminder({ schema: '2.0', body: { elements: [] } }, 'chat-watch', spoolPath);
    assert.ok(queuedId);
    const sentFromSpool = [];
    assert.strictEqual(await extension.deliverQueuedReminder({
      spoolPath, expectedChatId: 'chat-watch', channel: {},
      sendManagedCard: async (_channel, chatId, card) => sentFromSpool.push({ chatId, card })
    }), true);
    assert.deepStrictEqual(sentFromSpool, [{ chatId: 'chat-watch', card: { schema: '2.0', body: { elements: [] } } }]);
    assert.strictEqual(fs.existsSync(spoolPath), false);
    assert.strictEqual(await extension.deliverQueuedReminder({ spoolPath, expectedChatId: 'chat-watch', channel: {}, sendManagedCard: async () => {} }), false);
  } finally {
    fs.rmSync(spoolRoot, { recursive: true, force: true });
  }
}

async function testReminderPollingAndRetry() {
  const watcher = require('../scripts/matrix-watch.js');
  const spoolRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-reminder-poll-'));
  const spoolPath = path.join(spoolRoot, 'pending.json');
  let poll;
  let attempts = 0;
  let releaseSlowSend;
  try {
    process.env.STREAM_CHAT_ID = 'chat-poll';
    const registered = extension.register({
      channel: {}, dispatcher: { on: () => undefined }, card: helpers(), client: {},
      reminderSpoolPath: spoolPath,
      scheduleReminderPoll: callback => { poll = callback; return { unref() {} }; },
      sendManagedCard: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary send failure');
        if (attempts >= 3) await new Promise(resolve => { releaseSlowSend = resolve; });
      }
    });
    assert.strictEqual(typeof poll, 'function', 'extension registration must schedule spool polling');
    watcher.queueReminder({ schema: '2.0', body: { elements: [] } }, 'chat-poll', spoolPath);
    await poll();
    assert.strictEqual(fs.existsSync(spoolPath), true, 'failed delivery must remain pending for retry');
    assert.strictEqual(await registered.onMessage({ msg: { content: '普通消息', chatId: 'chat-poll', senderId: 'ou-poll' } }), false);
    assert.strictEqual(attempts, 1, 'ordinary messages must not consume or duplicate a reminder');
    await poll();
    assert.strictEqual(attempts, 2);
    assert.strictEqual(fs.existsSync(spoolPath), false, 'successful delivery must acknowledge the pending file');
    watcher.queueReminder({ schema: '2.0', body: { elements: [] } }, 'chat-poll', spoolPath);
    const slowPoll = poll();
    await new Promise(resolve => setImmediate(resolve));
    const overlappingPoll = poll();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(attempts, 3, 'overlapping timer ticks must not duplicate delivery');
    releaseSlowSend();
    await Promise.all([slowPoll, overlappingPoll]);
    assert.strictEqual(fs.existsSync(spoolPath), false);
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
    status: index === 1 ? 'needs_review' : 'valid', audit_state: 'audited',
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
  assert.ok([...text].length <= 1500, `whole card uses ${[...text].length} code points`);
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
    audit_state: 'audited', assessment_cn: '官网公开证据', next_action_cn: '核实公开联系入口',
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
  assert.strictEqual(await registered.onMessage({ msg: { ...message, content: 'A' } }), true);
  assert.ok(visibleText(sent.at(-1)).includes('开发客户'));
  assert.strictEqual(await registered.onMessage({ msg: { ...message, content: 'A' } }), true);
  assert.ok(visibleText(sent.at(-1)).includes('开发客户'));

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
  assert.strictEqual(await registered.onMessage({ msg: { ...message, content: 'A' } }), true);
  assert.ok(visibleText(sent.at(-1)).includes('开发客户'));
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

(async () => {
  await testNarrowClient();
  await testReadOnlyWatcher();
  await testReminderPollingAndRetry();
  await testWholeCardBudget();
  await testExpiredSessionRecovery();
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
    assessment_cn: `公开证据理由 ${index + 1}`,
    next_action_cn: '核实公开联系入口',
    format_signals: ['stand-up pouch'],
    size_signals: [],
    scale_tier: 'medium',
    fit_score: 80,
    demand_fit_score: 80,
    access_score: 70,
    confidence: 0.9,
    status: index === 1 ? 'needs_review' : 'valid',
    audit_state: 'audited',
    updated_at: '2026-07-17T00:00:00.000Z',
    contacts: { email: '', phone: '', whatsapp: '', contact_page: '[available]' },
    internal_formula: index === 0 ? 'SENTINEL-INTERNAL-FORMULA' : '',
    internal_cost: index === 0 ? 'SENTINEL-INTERNAL-COST' : ''
  }));
  let sessionExpiry = '';
  const client = {
    today: async (openId, filters) => { calls.push(['today', openId, filters]); return { rows: candidates, snapshot_key: 'snap-1', page: 1, page_size: 5 }; },
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
    candidateDetail: async (openId, id) => {
      calls.push(['candidateDetail', openId, id]);
      return {
        ...candidates[id - 1],
        official_url: 'https://company.test/',
        discovery: { discovered_via: 'official_association_directory', discovery_url: 'https://association.test/member' },
        official_evidence: [{ source_url: 'https://company.test/products', page_title: 'Products' }],
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
    listCandidates: async (openId, filters) => { calls.push(['listCandidates', openId, filters]); return { rows: candidates.slice(0, 5), snapshot_key: `snap-${filters.page || 1}`, page: filters.page || 1, page_size: 5 }; },
    selectCandidate: async (openId, input) => { calls.push(['selectCandidate', openId, input]); return { work_item_id: 91, candidate_id: input.candidate_id, session_id: input.session_id, session_version: input.expected_version + 1, next_action: input.next_action }; },
    workItems: async openId => { calls.push(['workItems', openId]); return { rows: [{ id: 91, candidate_id: 1, stage: 'selected', next_action: '核实公开联系入口' }] }; }
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
  assert.ok(text.includes('数据状态：有效'));
  assert.ok(text.includes('数据状态：待核实'));
  assert.ok(!text.includes('阶段：valid'));
  assert.ok(!text.includes('阶段：needs_review'));
  assert.strictEqual(await registered.onMessage({ msg: { content: 'A', chatId: 'chat-1', threadId: 'thread-1', senderId: 'ou-1' }, project: {} }), true);
  assert.ok(calls.some(item => item[0] === 'candidateDetail' && item[2] === 1));
  const detailText = visibleText(sent.at(-1).card);
  for (const expected of ['official_association_directory', 'https://association.test/member', 'https://company.test/', 'https://company.test/products', '已确认', '待核实']) assert.ok(detailText.includes(expected));
  assert.ok(!detailText.includes('public@company.test'));

  const callbackEvent = { operator: { openId: 'ou-1' }, chatId: 'chat-1', threadId: 'thread-1', messageId: 'callback-1' };
  const detailButtons = buttons(sent.at(-1).card);
  const filterSource = detailButtons.find(item => item.value?.a === 'mx.back')?.value || { a: 'mx.filters', s: 11, v: 2 };
  await handlers.get('mx.filters')({ evt: callbackEvent, value: { a: 'mx.filters', s: filterSource.s, v: filterSource.v } });
  const filterText = visibleText(sent.at(-1).card);
  for (const expected of ['海外地区', 'americas', 'europe', 'US', 'GB', 'coffee', 'tea']) assert.ok(filterText.includes(expected));
  assert.ok(!/广州|国内城市|\bCN\b/.test(filterText));
  const regionButton = buttons(sent.at(-1).card).find(item => item.value?.a === 'mx.region' && item.value?.r === 'americas');
  assert.ok(regionButton);
  await handlers.get('mx.region')({ evt: callbackEvent, value: regionButton.value });
  const regionPatch = calls.filter(item => item[0] === 'createSession').at(-1)[2];
  assert.strictEqual(regionPatch.session_id, 11);
  assert.strictEqual(regionPatch.expected_version, regionButton.value.v);
  assert.strictEqual(calls.filter(item => item[0] === 'listCandidates').at(-1)[2].region, 'americas');

  const nextFilterButton = buttons(sent.at(-1).card).find(item => item.value?.a === 'mx.filters');
  await handlers.get('mx.filters')({ evt: callbackEvent, value: nextFilterButton.value });
  const categoryButton = buttons(sent.at(-1).card).find(item => item.value?.a === 'mx.category' && item.value?.k === 'coffee');
  assert.ok(categoryButton);
  await handlers.get('mx.category')({ evt: callbackEvent, value: categoryButton.value });
  const categoryPatch = calls.filter(item => item[0] === 'createSession').at(-1)[2];
  assert.strictEqual(categoryPatch.session_id, 11);
  assert.strictEqual(categoryPatch.expected_version, categoryButton.value.v);
  assert.strictEqual(calls.filter(item => item[0] === 'listCandidates').at(-1)[2].category, 'coffee');

  const selectButton = buttons(sent.slice().reverse().find(item => buttons(item.card).some(button => button.value?.a === 'mx.select'))?.card).find(item => item.value?.a === 'mx.select');
  assert.ok(selectButton);
  await handlers.get('mx.select')({ evt: callbackEvent, value: selectButton.value });
  await handlers.get('mx.select')({ evt: callbackEvent, value: selectButton.value });
  const selectionCalls = calls.filter(item => item[0] === 'selectCandidate').slice(-2);
  assert.strictEqual(selectionCalls.length, 2);
  assert.strictEqual(selectionCalls[0][2].idempotency_key, selectionCalls[1][2].idempotency_key);
  assert.strictEqual(selectionCalls[0][2].idempotency_key, selectButton.value.e);

  const selectBeforeStale = calls.filter(item => item[0] === 'selectCandidate').length;
  await handlers.get('mx.select')({ evt: callbackEvent, value: { a: 'mx.select', s: 11, v: 999, c: 1, e: 'stale-event' } });
  assert.strictEqual(calls.filter(item => item[0] === 'selectCandidate').length, selectBeforeStale);
  assert.ok(visibleText(sent.at(-1).card).includes('开发客户'));

  const freshSent = [];
  const fresh = extension.register({
    channel: {},
    dispatcher: { on: () => undefined },
    sendManagedCard: async (_channel, chatId, card) => { freshSent.push({ chatId, card }); },
    updateManagedCard: async () => true,
    card: helpers(),
    client,
    now: () => Date.parse('2026-07-17T00:00:00.000Z')
  });
  assert.strictEqual(await fresh.onMessage({ msg: { content: 'A', chatId: 'chat-1', threadId: 'thread-1', senderId: 'ou-1' }, project: {} }), true);
  assert.ok(visibleText(freshSent[0].card).includes('开发客户'));
  assert.strictEqual(await registered.onMessage({ msg: { content: '开发客户!', chatId: 'chat-1', senderId: 'ou-1' }, project: {} }), false);
  assert.deepStrictEqual([...handlers.keys()].sort(), ['mx.back', 'mx.category', 'mx.detail', 'mx.filters', 'mx.page', 'mx.pick', 'mx.region', 'mx.select', 'mx.today', 'mx.work']);

  console.log('stream card extension tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

'use strict';

const assert = require('assert');
const fs = require('node:fs');
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
}

function testSanitizedCompose() {
  const composePath = path.resolve(__dirname, '../../compose.yaml');
  const source = fs.readFileSync(composePath, 'utf8');
  for (const expected of [
    'STREAM_CARD_EXTENSION: /workspace/extensions/stream-card.cjs',
    'MATRIX_API_BASE_URL: http://host.docker.internal:3333/api/matrix',
    'MATRIX_BRIDGE_TOKEN: ${MATRIX_BRIDGE_TOKEN:?MATRIX_BRIDGE_TOKEN must be set}',
    'MATRIX_DELIVERY_ENABLED: "0"',
    'MATRIX_RECOMMEND_HOUR: "9"',
    'MATRIX_RECOMMEND_MINUTE: "0"',
    'host.docker.internal:host-gateway',
    '/home/admin/work/packaging-system/data/matrix-stream.db:/refs/matrix-stream.db:ro'
  ]) assert.ok(source.includes(expected), `compose missing ${expected}`);
  assert.ok(!/SMTP_|IMAP_|WHATSAPP/i.test(source));
  assert.ok(!/(app_secret|tenant_access_token)/i.test(source));
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

(async () => {
  await testNarrowClient();
  await testReadOnlyWatcher();
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
    priority: `P${Math.min(index, 3)}`,
    categories: ['coffee'],
    assessment_cn: `公开证据理由 ${index + 1}`,
    stage_code: 'observed',
    next_action_cn: '核实公开联系入口',
    format_signals: ['stand-up pouch'],
    size_signals: [],
    status: 'valid',
    internal_formula: index === 0 ? 'SENTINEL-INTERNAL-FORMULA' : '',
    internal_cost: index === 0 ? 'SENTINEL-INTERNAL-COST' : ''
  }));
  const client = {
    today: async (openId, filters) => { calls.push(['today', openId, filters]); return { rows: candidates, snapshot_key: 'snap-1', page: 1, page_size: 5 }; },
    createSession: async (openId, input) => {
      calls.push(['createSession', openId, input]);
      return { id: 11, chat_id: 'chat-1', thread_id: 'thread-1', filters: input.filters || { page_size: 5 }, page: input.page || 1, version: input.session_id ? input.expected_version + 1 : 1 };
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
    client
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

  const selectBeforeStale = calls.filter(item => item[0] === 'selectCandidate').length;
  await handlers.get('mx.select')({ evt: callbackEvent, value: { a: 'mx.select', s: 11, v: 999, c: 1, e: 'stale-event' } });
  assert.strictEqual(calls.filter(item => item[0] === 'selectCandidate').length, selectBeforeStale);
  assert.ok(/已过期|刷新/.test(visibleText(sent.at(-1).card)));

  const selectButton = buttons(sent.slice().reverse().find(item => buttons(item.card).some(button => button.value?.a === 'mx.select'))?.card).find(item => item.value?.a === 'mx.select');
  assert.ok(selectButton);
  await handlers.get('mx.select')({ evt: callbackEvent, value: selectButton.value });
  await handlers.get('mx.select')({ evt: callbackEvent, value: selectButton.value });
  const selectionCalls = calls.filter(item => item[0] === 'selectCandidate').slice(-2);
  assert.strictEqual(selectionCalls.length, 2);
  assert.strictEqual(selectionCalls[0][2].idempotency_key, selectionCalls[1][2].idempotency_key);
  assert.strictEqual(selectionCalls[0][2].idempotency_key, selectButton.value.e);

  const freshSent = [];
  const fresh = extension.register({
    channel: {},
    dispatcher: { on: () => undefined },
    sendManagedCard: async (_channel, chatId, card) => { freshSent.push({ chatId, card }); },
    updateManagedCard: async () => true,
    card: helpers(),
    client
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

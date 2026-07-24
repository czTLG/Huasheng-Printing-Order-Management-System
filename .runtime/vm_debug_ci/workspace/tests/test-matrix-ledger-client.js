'use strict';

const assert = require('node:assert');

process.env.MATRIX_API_BASE_URL = 'https://matrix.test/api/matrix';
process.env.MATRIX_BRIDGE_TOKEN = 'test-bridge-token';
process.env.MATRIX_DELIVERY_ENABLED = '0';

function helpers() {
  return {
    card: (elements, options) => ({ elements, ...options }),
    md: content => ({ tag: 'markdown', content }),
    note: content => ({ tag: 'note', content }),
    actions: actions => ({ tag: 'action', actions }),
    button: (text, value, type) => ({ tag: 'button', text, value, type })
  };
}

function flatten(value, output = []) {
  if (value == null) return output;
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach(item => flatten(item, output));
  else if (typeof value === 'object') Object.values(value).forEach(item => flatten(item, output));
  return output;
}

(async () => {
  const clientPath = require.resolve('../scripts/matrix-client.js');
  delete require.cache[clientPath];
  const client = require(clientPath);
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({
        customer_id: 115,
        stage: 'waiting_customer',
        last_delivery_state: 'accepted',
        pending_task: { type: 'check_reply', due_at: '2026-07-26T11:32:16.000Z' },
        next_action: '等待客户回复'
      })
    };
  };
  try {
    const expected = {
      customer_id: 115,
      stage: 'waiting_customer',
      last_delivery_state: 'accepted',
      pending_task: { type: 'check_reply', due_at: '2026-07-26T11:32:16.000Z' },
      next_action: '等待客户回复'
    };
    assert.deepStrictEqual(await client.customerGet('ou-ledger', 115), expected);
    await client.finalPreview('ou-ledger', 115);
    await client.threadList('ou-ledger', 115);
    await client.taskList('ou-ledger', 115);
    await client.confirmDelivery('ou-ledger', 115, 902, {
      expected_content_hash: 'a'.repeat(64),
      confirmation_text: '确认发送 UNITEA Kazakhstan',
      chat_id: 'chat-ledger',
      card_event_id: 'card-ledger',
      idempotency_key: 'confirm-ledger-902'
    });
    assert.deepStrictEqual(requests.map(item => new URL(item.url).pathname), [
      '/api/matrix/customers/115',
      '/api/matrix/customers/115/final-preview',
      '/api/matrix/customers/115/threads',
      '/api/matrix/customers/115/tasks',
      '/api/matrix/customers/115/final-preview/902/confirm'
    ]);
    assert.strictEqual(requests[4].options.method, 'POST');
    assert.ok(requests.every(item => item.options.headers['x-feishu-open-id'] === 'ou-ledger'));
  } finally {
    global.fetch = originalFetch;
  }

  const extension = require('../extensions/stream-card.cjs');
  const bodyEn = `Dear team,\n\n${'Full English line. '.repeat(300)}\n\nBest regards`;
  const bodyCn = `您好，\n\n${'完整中文内容。'.repeat(300)}\n\n此致`;
  const preview = {
    customer_id: 115,
    customer_name: 'UNITEA Kazakhstan',
    contact_id: 81,
    recipient: 'callcenter@ordatradeastana.kz',
    subject: 'Tea pouch review',
    body_en: bodyEn,
    body_cn: bodyCn,
    attachments: [{ filename: 'specification.pdf' }],
    version_id: 902,
    content_hash: 'a'.repeat(64),
    allowed: true,
    blockers: []
  };
  const rendered = extension.renderCanonicalPreview(preview, helpers());
  const text = flatten(rendered).join('\n');
  assert.ok(text.includes('callcenter@ordatradeastana.kz'));
  assert.ok(text.includes('Tea pouch review'));
  assert.ok(text.includes(bodyEn));
  assert.ok(text.includes(bodyCn));
  assert.ok(text.includes('specification.pdf'));
  assert.ok(text.includes('版本 ID：902'));
  const buttons = rendered.elements.flatMap(element => element.actions || []);
  assert.deepStrictEqual(buttons.map(button => button.text), ['确认发送 UNITEA Kazakhstan']);
  assert.deepStrictEqual(buttons[0].value, {
    a: 'mx.ledger_confirm',
    c: 115,
    x: 902,
    h: 'a'.repeat(64)
  });

  let confirmations = 0;
  const registered = extension.register({
    channel: {},
    dispatcher: { on: () => undefined },
    card: helpers(),
    client: { confirmDelivery: async () => { confirmations += 1; } },
    scheduleReminderPoll: () => ({ unref() {} }),
    clearReminderPoll: () => undefined,
    sendManagedCard: async () => undefined
  });
  for (const content of ['确认', 'A', '确认采用']) {
    await registered.onMessage({
      msg: { content, chatId: 'chat-ledger', senderId: 'ou-ledger', messageId: `message-${content}` }
    });
  }
  assert.strictEqual(confirmations, 0);
  registered.dispose();

  console.log('matrix ledger client tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

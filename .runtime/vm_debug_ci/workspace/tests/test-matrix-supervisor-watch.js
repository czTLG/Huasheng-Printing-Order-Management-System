'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const watcher = require('../scripts/matrix-supervisor-watch.js');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-supervisor-watch-'));
  try {
    const bridgeRoot = path.join(root, 'bridge');
    const projectRoot = path.join(bridgeRoot, 'bots', 'app-test');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'projects.json'), JSON.stringify({
      version: 1,
      projects: [{ name: 'build', chatId: 'bill-chat' }, { name: 'vmci', chatId: 'vmci-chat' }]
    }), { mode: 0o600 });
    const digest = {
      ok: true, date: '2026-07-31', generated_at: '2026-07-31T02:00:00.000Z', digest_id: 'a'.repeat(32),
      channels: [
        { channel: 'bill', title: '客户推进主管', counts: { actionable: 1, overdue: 1, blocked: 0 }, items: [{ customer: '示例客户', priority: 'P0', state: 'overdue', summary_cn: '待跟进', next_action_cn: '检查回复' }] },
        { channel: 'vmci', title: '报价与核价主管', counts: { actionable: 0, overdue: 0, blocked: 0 }, items: [] }
      ]
    };
    const sends = [];
    const input = {
      enabled: true, hour: 9, stateRoot: path.join(root, 'state'), bridgeRoot, appId: 'app-test',
      openId: 'owner', client: { supervisorDigest: async () => digest }, channel: {},
      sendManagedCard: async (...args) => { sends.push(args); return { messageId: 'm-1' }; },
      clock: () => new Date('2026-07-31T02:00:00.000Z')
    };
    const first = await watcher.deliverDailyDigest(input);
    assert.strictEqual(first.status, 'complete');
    assert.strictEqual(sends.length, 1);
    assert.strictEqual(sends[0][1], 'bill-chat');
    assert.ok(JSON.stringify(sends[0][2]).includes('示例客户'));
    const receipt = path.join(root, 'state', '2026-07-31', 'bill.json');
    assert.strictEqual(fs.statSync(receipt).mode & 0o777, 0o600);
    assert.deepStrictEqual(await watcher.deliverDailyDigest(input), { status: 'delivered', date: '2026-07-31' });
    assert.strictEqual(sends.length, 1);
    assert.deepStrictEqual(await watcher.deliverDailyDigest({ ...input, enabled: false }), { status: 'disabled' });
    assert.deepStrictEqual(await watcher.deliverDailyDigest({ ...input, clock: () => new Date('2026-07-30T23:00:00.000Z') }), { status: 'early', date: '2026-07-31' });
    assert.strictEqual(watcher.resolveChatId({ bridgeRoot, appId: 'app-test', target: 'bill' }), 'bill-chat');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('matrix supervisor watcher tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

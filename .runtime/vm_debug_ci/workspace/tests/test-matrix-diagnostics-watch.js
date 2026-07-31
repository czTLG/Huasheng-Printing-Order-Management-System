'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const watcher = require('../scripts/matrix-diagnostics-watch.js');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-diagnostics-watch-'));
  try {
    const spoolRoot = path.join(root, 'spool');
    const bridgeRoot = path.join(root, 'bridge');
    const projectsDir = path.join(bridgeRoot, 'bots', 'app-test');
    fs.mkdirSync(path.join(spoolRoot, 'pending'), { recursive: true });
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.writeFileSync(path.join(projectsDir, 'projects.json'), JSON.stringify({
      version: 1,
      projects: [
        { name: 'vm_debug_ci', chatId: 'vm-chat' },
        { name: 'build', chatId: 'build-chat' }
      ]
    }), { mode: 0o600 });
    const event = {
      version: 1,
      id: 'a'.repeat(32),
      kind: 'disk_warning',
      severity: 'warning',
      component: '/',
      observed: 91,
      threshold: 90,
      at: '2026-07-20T03:00:00.000Z',
      incident_started_at: '2026-07-20T03:00:00.000Z',
      next_action_cn: '检查磁盘增长来源并安全释放空间。'
    };
    fs.writeFileSync(path.join(spoolRoot, 'pending', `${event.id}.json`), `${JSON.stringify(event)}\n`, { mode: 0o600 });
    const sends = [];
    const delivered = await watcher.deliverNextAlert({
      spoolRoot, bridgeRoot, appId: 'app-test', channel: {},
      sendManagedCard: async (...args) => {
        sends.push(args);
        return { messageId: 'message-test' };
      }
    });
    assert.deepStrictEqual(delivered, { status: 'delivered', id: event.id });
    assert.strictEqual(sends.length, 1);
    assert.strictEqual(sends[0][1], 'build-chat');
    assert.match(sends[0][6], /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.strictEqual(sends[0][6], watcher.uuidFromSeed(`matrix-diagnostics:${event.id}`));
    assert.ok(JSON.stringify(sends[0][2]).includes('磁盘'));
    assert.ok(!JSON.stringify(sends[0][2]).includes('vm-chat'));
    const receipt = path.join(spoolRoot, 'receipts', `${event.id}.json`);
    assert.strictEqual(fs.statSync(receipt).mode & 0o777, 0o600);
    assert.strictEqual(fs.readdirSync(path.join(spoolRoot, 'inflight')).length, 0);

    fs.writeFileSync(path.join(spoolRoot, 'pending', `${event.id}.json`), `${JSON.stringify(event)}\n`, { mode: 0o600 });
    const replay = await watcher.deliverNextAlert({ spoolRoot, bridgeRoot, appId: 'app-test', channel: {}, sendManagedCard: async () => { throw new Error('must not resend'); } });
    assert.deepStrictEqual(replay, { status: 'delivered', id: event.id });

    const ambiguousEvent = { ...event, id: 'b'.repeat(32), kind: 'restart_warning', component: 'packaging-system.service', observed: 3, threshold: 3 };
    fs.writeFileSync(path.join(spoolRoot, 'inflight', `${ambiguousEvent.id}.json`), `${JSON.stringify(ambiguousEvent)}\n`, { mode: 0o600 });
    const ambiguous = await watcher.deliverNextAlert({ spoolRoot, bridgeRoot, appId: 'app-test', channel: {}, sendManagedCard: async () => { throw new Error('must not resend ambiguous'); } });
    assert.deepStrictEqual(ambiguous, { status: 'ambiguous', id: ambiguousEvent.id, manual_reconciliation: true });

    assert.throws(() => watcher.validateEvent({ ...event, secret: 'forbidden' }), /event fields/);
    assert.throws(() => watcher.resolveBuildChatId({ bridgeRoot, appId: '../escape' }), /app id/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('matrix diagnostics watcher tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

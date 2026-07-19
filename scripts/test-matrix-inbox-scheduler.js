'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-inbox-scheduler-'));
process.env.DB_PATH = path.join(root, 'app.db');

const { db, initDb, now } = require('../src/db');
const { createInboxScheduler, getInboxHealth } = require('../src/services/matrixInboxScheduler');

(async () => {
  try {
    const originalLog = console.log;
    console.log = () => {};
    try { initDb(); } finally { console.log = originalLog; }

    const scheduled = [];
    const calls = [];
    let release = null;
    const sync = async input => {
      calls.push(input);
      if (input.syncType === 'scheduled-blocked' && input.folder === 'INBOX') await new Promise(resolve => { release = resolve; });
      return { id: calls.length, status: 'completed', scanned_count: 0, inserted_count: 0, skipped_count: 0, error_count: 0 };
    };
    const scheduler = createInboxScheduler({
      db,
      sync,
      enabled: true,
      clock: () => new Date('2026-07-19T03:00:00.000Z'),
      cronImpl: { schedule: (expression, callback, options) => { scheduled.push({ expression, callback, options }); return { stop() {} }; } }
    });

    const startup = await scheduler.start();
    assert.strictEqual(startup.status, 'completed');
    assert.strictEqual(calls[0].syncType, 'startup');
    assert.strictEqual(calls[0].days, 7);
    assert.deepStrictEqual(calls.slice(0, 2).map(item => item.folder), ['INBOX', 'Sent']);
    assert.strictEqual(scheduled.length, 1);
    assert.strictEqual(scheduled[0].expression, '*/5 * * * *');
    assert.deepStrictEqual(scheduled[0].options, { timezone: 'Asia/Shanghai' });

    const first = scheduler.runCycle({ syncType: 'scheduled-blocked', days: 2, limit: 200 });
    await new Promise(resolve => setImmediate(resolve));
    const second = await scheduler.runCycle({ syncType: 'scheduled', days: 2, limit: 200 });
    assert.strictEqual(second.status, 'skipped');
    assert.strictEqual(second.reason, 'already_running');
    release();
    await first;

    const ts = now();
    db.prepare(`
      INSERT INTO email_sync_runs (
        mailbox, folder, sync_type, status, started_at, finished_at,
        scanned_count, inserted_count, skipped_count, error_count, created_by, created_at
      ) VALUES ('masked', 'INBOX', 'scheduled', 'completed', ?, ?, 0, 0, 0, 0, 'system', ?)
    `).run(ts, ts, ts);
    const health = getInboxHealth(db, { configured: true, verified: true, clock: () => new Date() });
    assert.strictEqual(health.configured, true);
    assert.strictEqual(health.verified, true);
    assert.strictEqual(health.pending_jobs, 0);
    assert.strictEqual('mailbox' in health, false);
    assert.strictEqual('password' in health, false);

    const disabledSchedules = [];
    const disabled = createInboxScheduler({
      db, sync, enabled: false,
      cronImpl: { schedule: (...args) => disabledSchedules.push(args) }
    });
    assert.deepStrictEqual(await disabled.start(), { status: 'disabled' });
    assert.strictEqual(disabledSchedules.length, 0);

    console.log('PASS matrix inbox scheduler');
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

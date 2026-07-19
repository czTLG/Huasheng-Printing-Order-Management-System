'use strict';

const crypto = require('node:crypto');

const LEASE_KEY = 'inbox-poll';
const LEASE_MS = 10 * 60 * 1000;

function asDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid inbox scheduler clock');
  return date;
}

function acquireLease(db, owner, clock) {
  const current = asDate(clock()).getTime();
  const nowIso = new Date(current).toISOString();
  const expiresIso = new Date(current + LEASE_MS).toISOString();
  return db.transaction(() => {
    db.prepare('DELETE FROM matrix_inbox_leases WHERE lease_key = ? AND expires_at <= ?').run(LEASE_KEY, nowIso);
    const inserted = db.prepare(`
      INSERT OR IGNORE INTO matrix_inbox_leases (lease_key, owner_token, expires_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(LEASE_KEY, owner, expiresIso, nowIso);
    return inserted.changes === 1;
  }).immediate();
}

function releaseLease(db, owner) {
  db.prepare('DELETE FROM matrix_inbox_leases WHERE lease_key = ? AND owner_token = ?').run(LEASE_KEY, owner);
}

function createInboxScheduler({ db, sync, cronImpl, clock = () => new Date(), enabled = false, log = () => {} }) {
  if (!db || typeof sync !== 'function') throw new Error('database and inbox sync are required');
  if (!cronImpl || typeof cronImpl.schedule !== 'function') throw new Error('cron implementation is required');
  let inFlight = false;
  let timer = null;

  async function runCycle({ syncType = 'scheduled', days = 2, limit = 200 } = {}) {
    if (!enabled) return { status: 'disabled' };
    if (inFlight) return { status: 'skipped', reason: 'already_running' };
    const owner = crypto.randomUUID();
    if (!acquireLease(db, owner, clock)) return { status: 'skipped', reason: 'lease_held' };
    inFlight = true;
    try {
      const results = [];
      for (const folder of ['INBOX', 'Sent']) {
        results.push(await sync({ folder, syncType, days, limit, operator: `matrix-${syncType}` }));
      }
      return {
        status: results.every(item => item.status === 'completed') ? 'completed' : 'partial',
        folders: results.map(item => ({ folder: item.folder, run_id: item.id, status: item.status })),
        scanned_count: results.reduce((sum, item) => sum + Number(item.scanned_count || 0), 0),
        inserted_count: results.reduce((sum, item) => sum + Number(item.inserted_count || 0), 0),
        skipped_count: results.reduce((sum, item) => sum + Number(item.skipped_count || 0), 0),
        error_count: results.reduce((sum, item) => sum + Number(item.error_count || 0), 0)
      };
    } finally {
      inFlight = false;
      releaseLease(db, owner);
    }
  }

  async function start() {
    if (!enabled) return { status: 'disabled' };
    timer = cronImpl.schedule('*/5 * * * *', () => {
      void runCycle({ syncType: 'scheduled', days: 2, limit: 200 })
        .catch(error => log(`inbox scheduled cycle failed: ${error?.code || error?.name || 'error'}`));
    }, { timezone: 'Asia/Shanghai' });
    return runCycle({ syncType: 'startup', days: 7, limit: 500 });
  }

  function stop() {
    timer?.stop?.();
    timer = null;
  }

  return { start, stop, runCycle };
}

function getInboxHealth(db, { configured = false, verified = false, clock = () => new Date() } = {}) {
  const latestSuccess = db.prepare(`
    SELECT finished_at FROM email_sync_runs
    WHERE status = 'completed' ORDER BY id DESC LIMIT 1
  `).get();
  const recentRuns = db.prepare(`
    SELECT status FROM email_sync_runs ORDER BY id DESC LIMIT 100
  `).all();
  let consecutiveFailures = 0;
  for (const run of recentRuns) {
    if (run.status !== 'failed') break;
    consecutiveFailures += 1;
  }
  const pending = db.prepare(`
    SELECT COUNT(*) total, MIN(created_at) oldest
    FROM matrix_inbox_jobs
    WHERE delivery_state IN ('pending', 'retry')
  `).get();
  const quarantined = db.prepare(`
    SELECT COUNT(*) total FROM matrix_inbox_attachments
    WHERE availability_state = 'quarantined'
  `).get();
  const lastSuccessAt = latestSuccess?.finished_at || null;
  const parsedLast = lastSuccessAt ? Date.parse(lastSuccessAt.includes('T') ? lastSuccessAt : `${lastSuccessAt.replace(' ', 'T')}+08:00`) : NaN;
  const age = Number.isFinite(parsedLast)
    ? Math.max(0, Math.floor((asDate(clock()).getTime() - parsedLast) / 1000))
    : null;
  return {
    configured: Boolean(configured),
    verified: Boolean(verified),
    last_success_at: lastSuccessAt,
    last_success_age_seconds: age,
    consecutive_failures: consecutiveFailures,
    pending_jobs: Number(pending?.total || 0),
    oldest_pending_at: pending?.oldest || null,
    quarantined_attachments: Number(quarantined?.total || 0)
  };
}

module.exports = { createInboxScheduler, getInboxHealth, acquireLease, releaseLease, LEASE_KEY, LEASE_MS };

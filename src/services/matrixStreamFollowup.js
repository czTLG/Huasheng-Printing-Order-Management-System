'use strict';

const TERMINAL_REASONS = new Set(['reply', 'bounce', 'refusal', 'unsubscribe', 'manual_stop']);

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} required`);
  return number;
}

function boundedToken(value, label, fallback) {
  const token = String(value || fallback || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(token)) throw new Error(`valid ${label} required`);
  return token;
}

function thirdCalendarDayAtTen(sentAt) {
  const timestamp = Date.parse(String(sentAt || ''));
  if (!Number.isFinite(timestamp)) throw new Error('valid accepted timestamp required');
  const shanghai = new Date(timestamp + 8 * 3600000);
  let year = shanghai.getUTCFullYear();
  let month = shanghai.getUTCMonth();
  let day = shanghai.getUTCDate();
  let calendarDays = 0;
  while (calendarDays < 3) {
    const next = new Date(Date.UTC(year, month, day + 1));
    year = next.getUTCFullYear();
    month = next.getUTCMonth();
    day = next.getUTCDate();
    calendarDays += 1;
  }
  const yyyy = String(year).padStart(4, '0');
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T10:00:00+08:00`;
}

function syncWorkItemDue(db, workItemId, updatedAt) {
  const next = db.prepare(`
    SELECT MIN(due_at) AS due_at FROM matrix_stream_reply_checks
    WHERE work_item_id = ? AND state = 'active' AND due_at IS NOT NULL
  `).get(workItemId);
  const dueAt = next?.due_at || null;
  db.prepare(`
    UPDATE matrix_work_items SET next_action = ?, next_followup_at = ?, updated_at = ? WHERE id = ?
  `).run(dueAt ? 'reply_check' : '', dueAt, updatedAt, workItemId);
}

function scheduleReplyCheck(db, input = {}) {
  const jobId = positiveInteger(input.jobId, 'job id');
  const channel = boundedToken(input.channel, 'channel', 'email');
  const priority = boundedToken(input.priority, 'priority', 'normal');
  const schedule = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM matrix_stream_reply_checks WHERE originating_job_id = ?').get(jobId);
    if (existing) return existing;
    const job = db.prepare('SELECT * FROM matrix_stream_jobs WHERE id = ?').get(jobId);
    if (!job || job.state !== 'accepted') throw new Error('accepted delivery job required');
    const workItem = db.prepare('SELECT id FROM matrix_work_items WHERE id = ?').get(job.work_item_id);
    if (!workItem) throw new Error('work item required');
    const dueAt = thirdCalendarDayAtTen(job.updated_at || job.created_at);
    const createdAt = new Date(Date.parse(job.updated_at || job.created_at)).toISOString();
    const result = db.prepare(`
      INSERT INTO matrix_stream_reply_checks (
        work_item_id, originating_job_id, purpose, channel, priority, due_at,
        state, terminal_reason, created_at, closed_at
      ) VALUES (?, ?, 'reply_check', ?, ?, ?, 'active', '', ?, NULL)
    `).run(job.work_item_id, jobId, channel, priority, dueAt, createdAt);
    syncWorkItemDue(db, job.work_item_id, createdAt);
    return db.prepare('SELECT * FROM matrix_stream_reply_checks WHERE id = ?').get(Number(result.lastInsertRowid));
  });
  return schedule.immediate();
}

function closeReplyCheck(db, input = {}) {
  const jobId = positiveInteger(input.jobId, 'job id');
  const reason = String(input.reason || '').trim().toLowerCase();
  if (!TERMINAL_REASONS.has(reason)) throw new Error('valid terminal reason required');
  const closedAtMs = Date.parse(String(input.closedAt || new Date().toISOString()));
  if (!Number.isFinite(closedAtMs)) throw new Error('valid close timestamp required');
  const closedAt = new Date(closedAtMs).toISOString();
  const close = db.transaction(() => {
    const row = db.prepare('SELECT * FROM matrix_stream_reply_checks WHERE originating_job_id = ?').get(jobId);
    if (!row) throw new Error('reply check not found');
    if (row.state === 'active') {
      db.prepare(`
        UPDATE matrix_stream_reply_checks
        SET due_at = NULL, state = 'closed', terminal_reason = ?, closed_at = ?
        WHERE id = ? AND state = 'active'
      `).run(reason, closedAt, row.id);
      syncWorkItemDue(db, row.work_item_id, closedAt);
    }
    return db.prepare('SELECT * FROM matrix_stream_reply_checks WHERE id = ?').get(row.id);
  });
  return close.immediate();
}

module.exports = { thirdCalendarDayAtTen, scheduleReplyCheck, closeReplyCheck };

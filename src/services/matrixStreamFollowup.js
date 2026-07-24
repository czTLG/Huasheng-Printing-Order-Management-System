'use strict';

const { createMatrixLedgerStore } = require('./matrixLedgerStore');

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
  const due = new Date(Date.UTC(shanghai.getUTCFullYear(), shanghai.getUTCMonth(), shanghai.getUTCDate() + 3));
  const yyyy = String(due.getUTCFullYear()).padStart(4, '0');
  const mm = String(due.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(due.getUTCDate()).padStart(2, '0');
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

function scheduleCanonicalReplyTask(db, job, dueAt, createdAt) {
  const rows = db.prepare(`
    SELECT l.canonical_customer_id
    FROM matrix_work_items w
    JOIN matrix_customer_links l
      ON l.source_kind = 'candidate' AND l.source_id = CAST(w.candidate_id AS TEXT)
    JOIN customers c ON c.id = l.canonical_customer_id AND c.active = 1
    WHERE w.id = ?
  `).all(job.work_item_id);
  const customerIds = [...new Set(rows.map(row => Number(row.canonical_customer_id)).filter(Number.isInteger))];
  if (customerIds.length > 1) throw new Error('canonical delivery customer is ambiguous');
  if (customerIds.length !== 1) return null;
  const store = createMatrixLedgerStore({ db, clock: () => new Date(createdAt) });
  return store.createTask({
    customerId: customerIds[0],
    sourceKind: 'delivery_job',
    sourceId: String(job.id),
    taskType: 'check_reply',
    dueAt,
    priority: 'normal',
    nextAction: 'check reply'
  });
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
    scheduleCanonicalReplyTask(db, job, dueAt, createdAt);
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

function followupReadiness(db, input = {}) {
  const jobId = positiveInteger(input.jobId, 'job id');
  const nowMs = Date.parse(String(input.now || new Date().toISOString()));
  if (!Number.isFinite(nowMs)) throw new Error('valid follow-up clock required');
  const job = db.prepare(`
    SELECT j.*, w.candidate_id, w.stage, w.stream_state, v.recipient_email
    FROM matrix_stream_jobs j
    JOIN matrix_work_items w ON w.id = j.work_item_id
    JOIN matrix_stream_versions v ON v.id = j.version_id
    WHERE j.id = ?
  `).get(jobId);
  if (!job || job.state !== 'accepted') throw new Error('accepted delivery job required');
  const customerIds = [...new Set(db.prepare(`
    SELECT canonical_customer_id FROM matrix_customer_links
    WHERE source_kind = 'candidate' AND source_id = ?
  `).all(String(job.candidate_id)).map(row => Number(row.canonical_customer_id)).filter(Number.isInteger))];
  if (customerIds.length !== 1) return { allowed: false, blockers: ['canonical_customer_unresolved'] };
  const customerId = customerIds[0];
  const blockers = [];
  const pendingTypes = new Set(db.prepare(`
    SELECT task_type FROM matrix_tasks
    WHERE canonical_customer_id = ? AND state = 'pending'
  `).all(customerId).map(row => row.task_type));
  if (pendingTypes.has('review_reply')) blockers.push('customer_reply');
  if (pendingTypes.has('replace_contact')) blockers.push('permanent_bounce');
  const automatic = db.prepare(`
    SELECT 1
    FROM matrix_thread_messages m
    JOIN matrix_threads t ON t.id = m.thread_id
    WHERE t.canonical_customer_id = ? AND m.classification = 'automatic_reply'
      AND m.occurred_at >= ?
    LIMIT 1
  `).get(customerId, job.updated_at || job.created_at);
  const futureCheck = db.prepare(`
    SELECT 1 FROM matrix_tasks
    WHERE canonical_customer_id = ? AND task_type = 'check_reply' AND state = 'pending' AND due_at > ?
    LIMIT 1
  `).get(customerId, new Date(nowMs).toISOString());
  if (automatic && futureCheck) blockers.push('automatic_reply_wait');
  const contact = db.prepare(`
    SELECT status FROM matrix_contacts
    WHERE canonical_customer_id = ? AND channel = 'email' AND address = ?
  `).get(customerId, String(job.recipient_email || '').trim().toLowerCase());
  if (!contact || contact.status !== 'active') blockers.push('inactive_contact');
  if (job.stage === 'suppressed' || job.stream_state === 'suppressed') blockers.push('suppressed');
  const laterDelivery = db.prepare(`
    SELECT 1 FROM matrix_stream_jobs
    WHERE work_item_id = ? AND id <> ? AND state IN ('accepted','ambiguous')
    LIMIT 1
  `).get(job.work_item_id, jobId);
  if (laterDelivery) blockers.push('existing_followup_delivery');
  if (pendingTypes.has('delivery_review')) blockers.push('temporary_delay');
  return { allowed: blockers.length === 0, blockers };
}

module.exports = {
  thirdCalendarDayAtTen,
  scheduleReplyCheck,
  closeReplyCheck,
  followupReadiness
};

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-stream-correlation-'));
process.env.DB_PATH = path.join(root, 'app.db');

const { db, initDb } = require('../src/db');
const { correlateInbound, startReplyDraft, retryInboundTranslation } = require('../src/services/matrixStreamCorrelation');
const { importAndCorrelateEmailMessage } = require('../src/lib/imapSync');

initDb();

const NOW = '2026-07-18T02:00:00.000Z';
const SENT_AT = '2026-07-17T01:00:00.000Z';

function seedAccepted(index, {
  recipient = 'sales@alpha.test',
  sender = 'sales@sender.test',
  subject = 'A focused proposal',
  sentAt = SENT_AT
} = {}) {
  const userId = 8100 + index;
  db.prepare(`
    INSERT INTO users (id, username, password, role, status, created_at)
    VALUES (?, ?, 'test-only', 'foreign_trade_crm_admin', 'active', ?)
  `).run(userId, `correlation-${index}`, NOW);
  const workItemId = Number(db.prepare(`
    INSERT INTO matrix_work_items (
      candidate_id, stage, owner_user_id, current_summary, next_action,
      version, created_at, updated_at, stream_state
    ) VALUES (?, 'review_pending', ?, '', 'reply_check', 3, ?, ?, 'sent')
  `).run(8800 + index, userId, sentAt, sentAt).lastInsertRowid);
  const versionId = Number(db.prepare(`
    INSERT INTO matrix_stream_versions (
      work_item_id, revision, recipient_email, recipient_source_url,
      recipient_verified_at, subject, body_en, body_cn, strategy_summary,
      source_snapshot_json, content_hash, quality_score, quality_json, status,
      created_by, approved_by, approved_at, created_at, updated_at
    ) VALUES (?, 1, ?, 'https://alpha.test/contact', ?, ?, 'Dear team', '您好', '',
      '{}', ?, 90, '{}', 'approved', ?, ?, ?, ?, ?)
  `).run(workItemId, recipient, sentAt, subject, `hash-${index}`, userId, userId,
    sentAt, sentAt, sentAt).lastInsertRowid);
  db.prepare('UPDATE matrix_work_items SET current_stream_version_id = ? WHERE id = ?').run(versionId, workItemId);
  const messageId = `<matrix-stream-${index}@sender.test>`;
  const jobId = Number(db.prepare(`
    INSERT INTO matrix_stream_jobs (
      work_item_id, version_id, idempotency_key, content_hash, message_id,
      state, attempt_count, created_by, sender_email, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'accepted', 1, ?, ?, ?, ?)
  `).run(workItemId, versionId, `job-${index}`, `hash-${index}`, messageId,
    userId, sender, sentAt, sentAt).lastInsertRowid);
  db.prepare(`
    INSERT INTO matrix_stream_reply_checks (
      work_item_id, originating_job_id, purpose, channel, priority, due_at,
      state, terminal_reason, created_at
    ) VALUES (?, ?, 'reply_check', 'email', 'normal', '2026-07-22T10:00:00+08:00',
      'active', '', ?)
  `).run(workItemId, jobId, sentAt);
  return { workItemId, versionId, jobId, messageId, recipient, sender, subject };
}

async function main() {
  for (const table of ['matrix_stream_inbound_links', 'matrix_stream_notification_spool']) {
    assert(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} missing`);
  }
  const jobColumns = db.prepare('PRAGMA table_info(matrix_stream_jobs)').all().map(row => row.name);
  assert(jobColumns.includes('sender_email'), 'matrix_stream_jobs.sender_email missing');

  const exactJob = seedAccepted(1);
  const translated = [];
  const exact = await correlateInbound(db, {
    message_id: '<reply-1@test>',
    in_reply_to: exactJob.messageId,
    references_header: `<older@test> ${exactJob.messageId}`,
    from_email: ' SALES@ALPHA.TEST ',
    to_emails: 'Sales <sales@sender.test>',
    subject: 'Re: A focused proposal',
    cleaned_text: 'Please send specifications.'
  }, {
    clock: () => new Date(NOW),
    translateInbound: async input => {
      translated.push(input);
      return {
        translation_cn: '请发送规格。',
        requirements_cn: '需要规格资料',
        suggested_subject: 'Re: A focused proposal',
        suggested_body_en: 'Thank you. Please find the requested information.',
        suggested_body_cn: '谢谢。请查收所需资料。'
      };
    }
  });
  assert.deepStrictEqual(exact, { status: 'matched', workItemId: exactJob.workItemId, jobId: exactJob.jobId, kind: 'reply' });
  assert.strictEqual(translated.length, 1);
  assert.strictEqual(db.prepare('SELECT stream_state FROM matrix_work_items WHERE id = ?').get(exactJob.workItemId).stream_state, 'replied');
  assert.deepStrictEqual(
    db.prepare('SELECT state, terminal_reason, due_at FROM matrix_stream_reply_checks WHERE originating_job_id = ?').get(exactJob.jobId),
    { state: 'closed', terminal_reason: 'reply', due_at: null }
  );
  const spool = db.prepare('SELECT * FROM matrix_stream_notification_spool WHERE inbound_message_id = ?').get('<reply-1@test>');
  assert.strictEqual(spool.translation_status, 'ready');
  assert.strictEqual(spool.original_preview, 'Please send specifications.');
  assert.strictEqual(spool.translation_cn, '请发送规格。');
  assert.strictEqual(spool.requirements_cn, '需要规格资料');
  assert.ok(!JSON.stringify(spool).includes('password'));
  assert.ok(!JSON.stringify(spool).includes('source_snapshot'));
  const jobsBeforeDraft = db.prepare('SELECT COUNT(*) AS count FROM matrix_stream_jobs').get().count;
  const draft = startReplyDraft(db, { actorUserId: 8101, notificationId: spool.id, clock: () => new Date(NOW) });
  assert.deepStrictEqual(draft, { notification_id: spool.id, work_item_id: exactJob.workItemId, state: 'draft_pending' });
  assert.deepStrictEqual(startReplyDraft(db, { actorUserId: 8101, notificationId: spool.id, clock: () => new Date(NOW) }), draft);
  const storedDraft = db.prepare('SELECT * FROM crm_reply_drafts WHERE id = ?').get(
    db.prepare('SELECT reply_draft_id FROM matrix_stream_notification_spool WHERE id = ?').get(spool.id).reply_draft_id
  );
  assert.strictEqual(storedDraft.status, 'draft_pending');
  assert.strictEqual(storedDraft.matrix_work_item_id, exactJob.workItemId);
  assert.strictEqual(storedDraft.draft_text_en, 'Thank you. Please find the requested information.');
  assert.strictEqual(db.prepare('SELECT stage FROM matrix_work_items WHERE id = ?').get(exactJob.workItemId).stage, 'draft_pending');
  assert.strictEqual(db.prepare('SELECT stream_state FROM matrix_work_items WHERE id = ?').get(exactJob.workItemId).stream_state, 'replied');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM matrix_stream_jobs').get().count, jobsBeforeDraft, 'draft action must never create a delivery job');

  const beforeReplay = {
    events: db.prepare('SELECT COUNT(*) AS count FROM matrix_stream_events').get().count,
    spool: db.prepare('SELECT COUNT(*) AS count FROM matrix_stream_notification_spool').get().count,
    links: db.prepare('SELECT COUNT(*) AS count FROM matrix_stream_inbound_links').get().count
  };
  assert.deepStrictEqual(await correlateInbound(db, {
    message_id: '<reply-1@test>', in_reply_to: exactJob.messageId,
    from_email: exactJob.recipient, to_emails: exactJob.sender,
    subject: `Re: ${exactJob.subject}`, cleaned_text: 'changed replay body'
  }, { clock: () => new Date(NOW), translateInbound: async () => { throw new Error('must not run'); } }), exact);
  assert.deepStrictEqual({
    events: db.prepare('SELECT COUNT(*) AS count FROM matrix_stream_events').get().count,
    spool: db.prepare('SELECT COUNT(*) AS count FROM matrix_stream_notification_spool').get().count,
    links: db.prepare('SELECT COUNT(*) AS count FROM matrix_stream_inbound_links').get().count
  }, beforeReplay, 'message-id replay must not mutate');

  const fallbackJob = seedAccepted(2, { recipient: 'hello@beta.test', subject: 'Beta launch plan' });
  const fallback = await correlateInbound(db, {
    message_id: '<reply-fallback@test>', from_email: 'Hello <hello@beta.test>',
    to_emails: 'sales@sender.test', subject: 'RE:  Beta   launch plan ', cleaned_text: 'Hello'
  }, { clock: () => new Date(NOW), translateInbound: async () => ({ ok: false, reason: 'text_provider_unavailable' }) });
  assert.deepStrictEqual(fallback, { status: 'matched', workItemId: fallbackJob.workItemId, jobId: fallbackJob.jobId, kind: 'reply' });
  const pending = db.prepare('SELECT * FROM matrix_stream_notification_spool WHERE inbound_message_id = ?').get('<reply-fallback@test>');
  assert.strictEqual(pending.translation_status, 'pending');
  assert.strictEqual(pending.translation_cn, '');
  assert.strictEqual(pending.requirements_cn, '');
  assert.strictEqual(pending.retry_available, 1);
  assert.throws(
    () => startReplyDraft(db, { actorUserId: 8102, notificationId: pending.id, clock: () => new Date(NOW) }),
    /translation pending/i
  );
  const retryResult = await retryInboundTranslation(db, {
    actorUserId: 8102,
    notificationId: pending.id,
    clock: () => new Date(NOW),
    translateInbound: async () => ({
      translation_cn: '您好。', requirements_cn: '待确认具体需求',
      suggested_subject: 'Re: Beta launch plan',
      suggested_body_en: 'Thank you. Could you share more detail?',
      suggested_body_cn: '谢谢。请问能否提供更多细节？'
    })
  });
  assert.deepStrictEqual(retryResult, { notification_id: pending.id, translation_status: 'ready', retry_available: false });
  assert.deepStrictEqual(db.prepare(`
    SELECT translation_status, translation_cn, requirements_cn, retry_available
    FROM matrix_stream_notification_spool WHERE id = ?
  `).get(pending.id), {
    translation_status: 'ready', translation_cn: '您好。', requirements_cn: '待确认具体需求', retry_available: 0
  });

  const ambiguousOne = seedAccepted(3, { recipient: 'team@gamma.test', subject: 'Gamma plan' });
  const ambiguousTwo = seedAccepted(4, { recipient: 'team@gamma.test', subject: 'Gamma plan', sentAt: '2026-07-16T01:00:00.000Z' });
  const beforeAmbiguous = [ambiguousOne, ambiguousTwo].map(row => db.prepare('SELECT * FROM matrix_work_items WHERE id = ?').get(row.workItemId));
  const ambiguous = await correlateInbound(db, {
    message_id: '<reply-ambiguous@test>', from_email: 'team@gamma.test',
    to_emails: 'sales@sender.test', subject: 'Re: Gamma plan', cleaned_text: 'Hello'
  }, { clock: () => new Date(NOW) });
  assert.deepStrictEqual(ambiguous, { status: 'needs_review' });
  assert.deepStrictEqual([ambiguousOne, ambiguousTwo].map(row => db.prepare('SELECT * FROM matrix_work_items WHERE id = ?').get(row.workItemId)), beforeAmbiguous);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM matrix_stream_events WHERE action = 'inbound_needs_review'").get().count, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM matrix_stream_notification_spool WHERE inbound_message_id = ?').get('<reply-ambiguous@test>').count, 0);

  const old = seedAccepted(5, { recipient: 'old@delta.test', subject: 'Old plan', sentAt: '2026-01-01T00:00:00.000Z' });
  assert.deepStrictEqual(await correlateInbound(db, {
    message_id: '<reply-old@test>', from_email: old.recipient, to_emails: old.sender,
    subject: `Re: ${old.subject}`, cleaned_text: 'late'
  }, { clock: () => new Date(NOW) }), { status: 'unmatched' });

  for (const fixture of [
    { index: 6, event_kind: 'bounce', state: 'bounced', reason: 'bounce', text: 'Delivery Status Notification' },
    { index: 7, event_kind: 'refusal', state: 'refused', reason: 'refusal', text: 'No thank you.' },
    { index: 8, event_kind: 'unsubscribe', state: 'suppressed', reason: 'unsubscribe', text: 'Please unsubscribe.' },
    { index: 9, event_kind: 'manual_stop', state: 'suppressed', reason: 'manual_stop', text: 'operator stop' }
  ]) {
    const job = seedAccepted(fixture.index, { recipient: `team${fixture.index}@terminal.test`, subject: `Terminal ${fixture.index}` });
    const result = await correlateInbound(db, {
      message_id: `<terminal-${fixture.index}@test>`, in_reply_to: job.messageId,
      from_email: job.recipient, to_emails: job.sender, subject: `Re: ${job.subject}`,
      cleaned_text: fixture.text, event_kind: fixture.event_kind
    }, {
      clock: () => new Date(NOW),
      translateInbound: async () => ({ ok: false, reason: 'text_provider_unavailable' })
    });
    assert.deepStrictEqual(result, { status: 'matched', workItemId: job.workItemId, jobId: job.jobId, kind: fixture.event_kind });
    assert.strictEqual(db.prepare('SELECT stream_state FROM matrix_work_items WHERE id = ?').get(job.workItemId).stream_state, fixture.state);
    assert.strictEqual(db.prepare('SELECT terminal_reason FROM matrix_stream_reply_checks WHERE originating_job_id = ?').get(job.jobId).terminal_reason, fixture.reason);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM matrix_stream_notification_spool WHERE inbound_message_id = ?').get(`<terminal-${fixture.index}@test>`).count, fixture.event_kind === 'refusal' ? 1 : 0);
  }

  let observedDurable = false;
  const imported = await importAndCorrelateEmailMessage('sales@sender.test', 'INBOX', {
    message_uid: 'imap-1', message_id: '<imap-durable@test>', from_email: 'outside@test',
    to_emails: 'sales@sender.test', subject: 'A durable inbound', text_body: 'hello',
    received_at: NOW
  }, {
    database: db,
    correlate: async (_database, message) => {
      observedDurable = Boolean(db.prepare('SELECT id FROM email_messages WHERE message_id = ?').get(message.message_id));
      throw new Error('provider password=do-not-leak');
    }
  });
  assert.strictEqual(observedDurable, true, 'correlation must run after durable email commit');
  assert.strictEqual(imported.imported.inserted, true);
  assert.strictEqual(imported.correlation_error.code, 'MATRIX_INBOUND_CORRELATION_FAILED');
  assert.strictEqual(imported.correlation_error.message, 'Inbound correlation failed.');
  assert(db.prepare('SELECT id FROM email_messages WHERE message_id = ?').get('<imap-durable@test>'), 'correlation failure rolled back email');
  assert.ok(!JSON.stringify(imported).includes('do-not-leak'));

  console.log('matrix stream correlation tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  try { db.close(); } catch (_) {}
  fs.rmSync(root, { recursive: true, force: true });
});

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-stream-correlation-'));
process.env.DB_PATH = path.join(root, 'app.db');

const { db, initDb } = require('../src/db');
const {
  correlateInbound, startReplyDraft, retryInboundTranslation,
  claimNotification, ackNotification, nackNotification, notificationStatus,
  classifyKind, safePreview
} = require('../src/services/matrixStreamCorrelation');
const { importAndCorrelateEmailMessage, upsertEmailMessage } = require('../src/lib/imapSync');

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
  const bindingId = Number(db.prepare(`
    INSERT INTO matrix_actor_bindings (feishu_open_id, user_id, status, bound_by, bound_at)
    VALUES (?, ?, 'active', ?, ?)
  `).run(`ou-correlation-${index}`, userId, userId, sentAt).lastInsertRowid);
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
  return { userId, bindingId, workItemId, versionId, jobId, messageId, recipient, sender, subject };
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
  for (const secret of ['very secret value', 'bearer-secret', 'basic-secret', 'url-secret', 'query-secret', 'PRIVATE-BODY']) {
    assert.ok(!safePreview([
      'password = very secret value',
      'Authorization: Bearer bearer-secret',
      'Authorization: Basic basic-secret',
      'smtp://user:url-secret@host.test/path?api_key=query-secret',
      '-----BEGIN PRIVATE KEY-----\nPRIVATE-BODY\n-----END PRIVATE KEY-----'
    ].join('\n')).includes(secret), `safe preview leaked ${secret}`);
  }
  for (const sensitive of [
    'cost+margin', 'resin+conversion', 'very secret', 'topsecret',
    'internal formula', 'private cost'
  ]) {
    assert.ok(!safePreview([
      'internal formula=cost+margin',
      'private cost: resin+conversion',
      'note: password = very secret',
      'credentials password: topsecret'
    ].join('\n')).toLowerCase().includes(sensitive), `safe preview leaked ${sensitive}`);
  }

  const claimed = claimNotification(db, {
    actorUserId: exactJob.userId, bindingId: exactJob.bindingId,
    clock: () => new Date(NOW), leaseMs: 1000
  });
  assert.strictEqual(claimed.id, spool.id);
  assert.strictEqual(claimed.delivery_state, 'inflight');
  assert.match(claimed.notification_key, /^[0-9a-f-]{36}$/);
  assert.match(claimed.claim_token, /^[0-9a-f-]{36}$/);
  const db2 = new Database(process.env.DB_PATH);
  db2.pragma('foreign_keys = ON');
  assert.strictEqual(claimNotification(db2, {
    actorUserId: exactJob.userId, bindingId: exactJob.bindingId,
    clock: () => new Date(NOW), leaseMs: 1000
  }), null, 'second watcher must not claim an inflight notification');
  assert.throws(() => ackNotification(db, {
    actorUserId: exactJob.userId, bindingId: exactJob.bindingId, notificationId: spool.id,
    claimToken: '00000000-0000-4000-8000-000000000000', receiptId: 'receipt-wrong', clock: () => new Date(NOW)
  }), /claim/i);
  assert.deepStrictEqual(ackNotification(db, {
    actorUserId: exactJob.userId, bindingId: exactJob.bindingId, notificationId: spool.id,
    claimToken: claimed.claim_token, receiptId: 'receipt-1', clock: () => new Date(NOW)
  }), { notification_id: spool.id, delivery_state: 'delivered' });
  assert.deepStrictEqual(ackNotification(db, {
    actorUserId: exactJob.userId, bindingId: exactJob.bindingId, notificationId: spool.id,
    claimToken: claimed.claim_token, receiptId: 'receipt-1', clock: () => new Date(NOW)
  }), { notification_id: spool.id, delivery_state: 'delivered' }, 'ack replay must be stable');
  assert.deepStrictEqual(notificationStatus(db, {
    actorUserId: exactJob.userId, bindingId: exactJob.bindingId, notificationId: spool.id,
    claimToken: claimed.claim_token, clock: () => new Date(NOW)
  }), { notification_id: spool.id, delivery_state: 'delivered', can_deliver: false });
  assert.strictEqual(claimNotification(db2, {
    actorUserId: exactJob.userId, bindingId: exactJob.bindingId,
    clock: () => new Date('2026-07-18T02:00:02.000Z'), leaseMs: 1000
  }), null, 'delivered notification must never be reclaimed');
  db2.close();
  db.prepare(`
    INSERT INTO matrix_stream_events (work_item_id, action, idempotency_key, created_at)
    VALUES (?, 'client_collision_fixture', ?, ?)
  `).run(exactJob.workItemId, `reply-draft-notification-${spool.id}`, NOW);
  const jobsBeforeDraft = db.prepare('SELECT COUNT(*) AS count FROM matrix_stream_jobs').get().count;
  const draft = startReplyDraft(db, { actorUserId: 8101, bindingId: exactJob.bindingId, notificationId: spool.id, clock: () => new Date(NOW) });
  assert.deepStrictEqual(draft, { notification_id: spool.id, work_item_id: exactJob.workItemId, state: 'draft_pending' });
  assert.deepStrictEqual(startReplyDraft(db, { actorUserId: 8101, bindingId: exactJob.bindingId, notificationId: spool.id, clock: () => new Date(NOW) }), draft);
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
  const longInbound = `${'A'.repeat(900)} END-MARKER`;
  upsertEmailMessage('sales@sender.test', 'INBOX', {
    message_uid: 'fallback-uid', message_id: '<reply-fallback@test>',
    from_email: 'hello@beta.test', to_emails: 'sales@sender.test',
    subject: 'RE: Beta launch plan', text_body: longInbound, cleaned_text: longInbound, received_at: NOW
  });
  const fallback = await correlateInbound(db, {
    message_id: '<reply-fallback@test>', from_email: 'Hello <hello@beta.test>',
    to_emails: 'sales@sender.test', subject: 'RE:  Beta   launch plan ', cleaned_text: longInbound
  }, { clock: () => new Date(NOW), translateInbound: async () => ({ ok: false, reason: 'text_provider_unavailable' }) });
  assert.deepStrictEqual(fallback, { status: 'matched', workItemId: fallbackJob.workItemId, jobId: fallbackJob.jobId, kind: 'reply' });
  const pending = db.prepare('SELECT * FROM matrix_stream_notification_spool WHERE inbound_message_id = ?').get('<reply-fallback@test>');
  assert.strictEqual(pending.translation_status, 'pending');
  assert.strictEqual(pending.translation_cn, '');
  assert.strictEqual(pending.requirements_cn, '');
  assert.strictEqual(pending.retry_available, 1);
  await assert.rejects(() => retryInboundTranslation(db, {
    actorUserId: fallbackJob.userId, bindingId: fallbackJob.bindingId,
    notificationId: pending.id, clock: () => new Date(NOW),
    translateInbound: async () => { throw new Error('unpublished pending card must not invoke provider'); }
  }), /delivery eligible/i);
  const pendingClaim = claimNotification(db, {
    actorUserId: fallbackJob.userId, bindingId: fallbackJob.bindingId, clock: () => new Date(NOW)
  });
  ackNotification(db, {
    actorUserId: fallbackJob.userId, bindingId: fallbackJob.bindingId,
    notificationId: pending.id, claimToken: pendingClaim.claim_token,
    receiptId: 'pending-card', clock: () => new Date(NOW)
  });
  assert.throws(
    () => startReplyDraft(db, { actorUserId: 8102, bindingId: fallbackJob.bindingId, notificationId: pending.id, clock: () => new Date(NOW) }),
    /translation pending/i
  );
  db.prepare(`
    INSERT INTO matrix_stream_events (work_item_id, action, idempotency_key, created_at)
    VALUES (?, 'client_collision_fixture', ?, ?)
  `).run(fallbackJob.workItemId, `inbound-translation-ready-${pending.id}`, NOW);
  const retryResult = await retryInboundTranslation(db, {
    actorUserId: fallbackJob.userId,
    bindingId: fallbackJob.bindingId,
    notificationId: pending.id,
    clock: () => new Date(NOW),
    translateInbound: async input => {
      assert.ok(input.inboundText.includes('END-MARKER'), 'retry must use full durable inbound text');
      return ({
      translation_cn: '您好。', requirements_cn: '待确认具体需求',
      suggested_subject: 'Re: Beta launch plan',
      suggested_body_en: 'Thank you. Could you share more detail?',
      suggested_body_cn: '谢谢。请问能否提供更多细节？'
      });
    }
  });
  assert.deepStrictEqual(retryResult, { notification_id: pending.id, translation_status: 'ready', retry_available: false });
  assert.deepStrictEqual(db.prepare(`
    SELECT translation_status, delivery_state, notification_key
    FROM matrix_stream_notification_spool WHERE id = ?
  `).get(pending.id), {
    translation_status: 'pending', delivery_state: 'delivered', notification_key: pending.notification_key
  }, 'retry must not mutate the delivered notification generation');
  const readyGeneration = db.prepare(`
    SELECT * FROM matrix_stream_notification_spool
    WHERE inbound_message_id = ? AND generation = 2
  `).get('<reply-fallback@test>');
  assert.ok(readyGeneration);
  assert.strictEqual(readyGeneration.supersedes_notification_id, pending.id);
  assert.notStrictEqual(readyGeneration.notification_key, pending.notification_key);
  assert.deepStrictEqual({
    translation_status: readyGeneration.translation_status,
    translation_cn: readyGeneration.translation_cn,
    requirements_cn: readyGeneration.requirements_cn,
    retry_available: readyGeneration.retry_available,
    delivery_state: readyGeneration.delivery_state
  }, {
    translation_status: 'ready', translation_cn: '您好。', requirements_cn: '待确认具体需求', retry_available: 0,
    delivery_state: 'pending'
  });
  const readyClaim = claimNotification(db, {
    actorUserId: fallbackJob.userId, bindingId: fallbackJob.bindingId, clock: () => new Date(NOW)
  });
  assert.strictEqual(readyClaim.id, readyGeneration.id);
  assert.strictEqual(readyClaim.translation_status, 'ready', 'successful retry must queue one ready card');

  const direct = seedAccepted(10, { recipient: 'direct@header.test', subject: 'Direct parent' });
  const older = seedAccepted(11, { recipient: 'older@header.test', subject: 'Older parent' });
  const directResult = await correlateInbound(db, {
    message_id: '<direct-precedence@test>', in_reply_to: direct.messageId,
    references_header: `${older.messageId} ${direct.messageId}`,
    from_email: direct.recipient, to_emails: direct.sender,
    subject: `Re: ${direct.subject}`, cleaned_text: 'Current reply'
  }, { clock: () => new Date(NOW), translateInbound: async () => ({ ok: false, reason: 'text_provider_unavailable' }) });
  assert.strictEqual(directResult.jobId, direct.jobId, 'unique In-Reply-To must ignore other References matches');
  assert.deepStrictEqual(await correlateInbound(db, {
    message_id: '<references-ambiguous@test>', references_header: `${older.messageId} ${direct.messageId}`,
    from_email: direct.recipient, to_emails: direct.sender,
    subject: `Re: ${direct.subject}`, cleaned_text: 'No direct parent header'
  }, { clock: () => new Date(NOW) }), { status: 'needs_review' });

  const quoted = [
    'Yes, please send the details.', '', 'Best regards,', 'Alex', '',
    '-----Original Message-----', 'From: Sales <sales@sender.test>',
    'Subject: Earlier note', 'Please unsubscribe if this is not relevant.'
  ].join('\n');
  assert.strictEqual(classifyKind({ subject: 'Re: Current', cleaned_text: quoted }), 'reply');
  assert.strictEqual(classifyKind({ subject: 'Re: Current', cleaned_text: 'Please unsubscribe me.' }), 'unsubscribe');

  const evolving = seedAccepted(12, { recipient: 'state@evolve.test', subject: 'State evolution' });
  assert.strictEqual((await correlateInbound(db, {
    message_id: '<state-reply@test>', in_reply_to: evolving.messageId,
    from_email: evolving.recipient, to_emails: evolving.sender,
    subject: `Re: ${evolving.subject}`, cleaned_text: 'Yes, please continue.'
  }, { clock: () => new Date(NOW), translateInbound: async () => ({ ok: false, reason: 'text_provider_unavailable' }) })).kind, 'reply');
  assert.strictEqual((await correlateInbound(db, {
    message_id: '<state-unsubscribe@test>', in_reply_to: evolving.messageId,
    from_email: evolving.recipient, to_emails: evolving.sender,
    subject: `Re: ${evolving.subject}`, cleaned_text: 'Please unsubscribe me.'
  }, { clock: () => new Date('2026-07-18T02:01:00.000Z') })).kind, 'unsubscribe');
  assert.strictEqual(db.prepare('SELECT stream_state FROM matrix_work_items WHERE id = ?').get(evolving.workItemId).stream_state, 'suppressed');
  assert.deepStrictEqual(db.prepare('SELECT delivery_state, last_error_class FROM matrix_stream_notification_spool WHERE inbound_message_id = ?').get('<state-reply@test>'), {
    delivery_state: 'manual_review', last_error_class: 'terminal_cancelled'
  }, 'higher-priority terminal event must retire a stale reply card');
  assert.strictEqual(claimNotification(db, {
    actorUserId: evolving.userId, bindingId: evolving.bindingId, clock: () => new Date(NOW)
  }), null);
  await assert.rejects(() => retryInboundTranslation(db, {
    actorUserId: evolving.userId, bindingId: evolving.bindingId,
    notificationId: db.prepare('SELECT id FROM matrix_stream_notification_spool WHERE inbound_message_id = ?').get('<state-reply@test>').id,
    clock: () => new Date(NOW), translateInbound: async () => { throw new Error('must not translate'); }
  }), /eligible|state/i);
  assert.strictEqual(db.prepare('SELECT terminal_reason FROM matrix_stream_reply_checks WHERE originating_job_id = ?').get(evolving.jobId).terminal_reason, 'reply', 'reply check closes exactly once');
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM matrix_stream_events WHERE job_id = ? AND action IN ('inbound_reply','inbound_unsubscribe')").get(evolving.jobId).count, 2);
  await correlateInbound(db, {
    message_id: '<state-late-reply@test>', in_reply_to: evolving.messageId,
    from_email: evolving.recipient, to_emails: evolving.sender,
    subject: `Re: ${evolving.subject}`, cleaned_text: 'Actually, one more note.'
  }, { clock: () => new Date('2026-07-18T02:02:00.000Z'), translateInbound: async () => ({
    translation_cn: '补充说明。', requirements_cn: '无', suggested_subject: 'Re: State evolution',
    suggested_body_en: 'Thank you.', suggested_body_cn: '谢谢。'
  }) });
  assert.strictEqual(db.prepare('SELECT stream_state FROM matrix_work_items WHERE id = ?').get(evolving.workItemId).stream_state, 'suppressed');
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM matrix_stream_notification_spool WHERE inbound_message_id = '<state-late-reply@test>'").get().count, 0, 'suppressed work must not reopen reply drafting');

  const retryDelivery = seedAccepted(13, { recipient: 'notify@retry.test', subject: 'Notification retry' });
  await correlateInbound(db, {
    message_id: '<notify-retry@test>', in_reply_to: retryDelivery.messageId,
    from_email: retryDelivery.recipient, to_emails: retryDelivery.sender,
    subject: `Re: ${retryDelivery.subject}`, cleaned_text: 'Reply for notification retry'
  }, { clock: () => new Date(NOW), translateInbound: async () => ({ ok: false, reason: 'text_provider_unavailable' }) });
  const retryClaim1 = claimNotification(db, {
    actorUserId: retryDelivery.userId, bindingId: retryDelivery.bindingId,
    clock: () => new Date(NOW), leaseMs: 1000
  });
  assert.deepStrictEqual(nackNotification(db, {
    actorUserId: retryDelivery.userId, bindingId: retryDelivery.bindingId,
    notificationId: retryClaim1.id, claimToken: retryClaim1.claim_token,
    outcome: 'failed', clock: () => new Date(NOW)
  }), { notification_id: retryClaim1.id, delivery_state: 'pending' });
  const retryClaim2 = claimNotification(db, {
    actorUserId: retryDelivery.userId, bindingId: retryDelivery.bindingId,
    clock: () => new Date(NOW), leaseMs: 1000
  });
  assert.strictEqual(retryClaim2.attempt_count, 2);
  assert.deepStrictEqual(nackNotification(db, {
    actorUserId: retryDelivery.userId, bindingId: retryDelivery.bindingId,
    notificationId: retryClaim2.id, claimToken: retryClaim2.claim_token,
    outcome: 'ambiguous', clock: () => new Date(NOW)
  }), { notification_id: retryClaim2.id, delivery_state: 'manual_review' });
  assert.strictEqual(claimNotification(db, {
    actorUserId: retryDelivery.userId, bindingId: retryDelivery.bindingId,
    clock: () => new Date(NOW), leaseMs: 1000
  }), null);

  const crashDelivery = seedAccepted(14, { recipient: 'notify@crash.test', subject: 'Notification crash' });
  await correlateInbound(db, {
    message_id: '<notify-crash@test>', in_reply_to: crashDelivery.messageId,
    from_email: crashDelivery.recipient, to_emails: crashDelivery.sender,
    subject: `Re: ${crashDelivery.subject}`, cleaned_text: 'Reply before watcher crash'
  }, { clock: () => new Date(NOW), translateInbound: async () => ({ ok: false, reason: 'text_provider_unavailable' }) });
  const crashClaim = claimNotification(db, {
    actorUserId: crashDelivery.userId, bindingId: crashDelivery.bindingId,
    clock: () => new Date(NOW), leaseMs: 1000
  });
  assert.ok(crashClaim);
  assert.deepStrictEqual(ackNotification(db, {
    actorUserId: crashDelivery.userId, bindingId: crashDelivery.bindingId,
    notificationId: crashClaim.id, claimToken: crashClaim.claim_token,
    receiptId: 'too-late', clock: () => new Date('2026-07-18T02:00:02.000Z')
  }), { notification_id: crashClaim.id, delivery_state: 'manual_review' }, 'expired ack must fail closed');
  assert.strictEqual(claimNotification(db, {
    actorUserId: crashDelivery.userId, bindingId: crashDelivery.bindingId,
    clock: () => new Date('2026-07-18T02:00:02.000Z'), leaseMs: 1000
  }), null, 'expired inflight delivery must not be automatically resent');
  assert.strictEqual(db.prepare('SELECT delivery_state FROM matrix_stream_notification_spool WHERE id = ?').get(crashClaim.id).delivery_state, 'manual_review');

  const scavengedDelivery = seedAccepted(16, { recipient: 'notify@scavenge.test', subject: 'Notification scavenger' });
  await correlateInbound(db, {
    message_id: '<notify-scavenge@test>', in_reply_to: scavengedDelivery.messageId,
    from_email: scavengedDelivery.recipient, to_emails: scavengedDelivery.sender,
    subject: `Re: ${scavengedDelivery.subject}`, cleaned_text: 'Reply before lease scavenging'
  }, { clock: () => new Date(NOW), translateInbound: async () => ({ ok: false, reason: 'text_provider_unavailable' }) });
  const scavengedClaim = claimNotification(db, {
    actorUserId: scavengedDelivery.userId, bindingId: scavengedDelivery.bindingId,
    clock: () => new Date(NOW), leaseMs: 1000
  });
  const db3 = new Database(process.env.DB_PATH);
  db3.pragma('foreign_keys = ON');
  assert.strictEqual(claimNotification(db3, {
    actorUserId: scavengedDelivery.userId, bindingId: scavengedDelivery.bindingId,
    clock: () => new Date('2026-07-18T02:00:02.000Z'), leaseMs: 1000
  }), null);
  assert.deepStrictEqual(nackNotification(db, {
    actorUserId: scavengedDelivery.userId, bindingId: scavengedDelivery.bindingId,
    notificationId: scavengedClaim.id, claimToken: scavengedClaim.claim_token,
    outcome: 'ambiguous', clock: () => new Date('2026-07-18T02:00:02.000Z')
  }), { notification_id: scavengedClaim.id, delivery_state: 'manual_review' }, 'scavenger-first finalize must replay safely');
  db3.close();

  const inflightRetry = seedAccepted(18, { recipient: 'notify@inflight-retry.test', subject: 'Inflight translation retry' });
  const inflightText = 'Visible pending reply before acknowledgement';
  upsertEmailMessage('sales@sender.test', 'INBOX', {
    message_uid: 'inflight-retry-uid', message_id: '<inflight-retry@test>', from_email: inflightRetry.recipient,
    to_emails: inflightRetry.sender, subject: `Re: ${inflightRetry.subject}`, text_body: inflightText,
    cleaned_text: inflightText, received_at: NOW
  });
  await correlateInbound(db, {
    message_id: '<inflight-retry@test>', in_reply_to: inflightRetry.messageId,
    from_email: inflightRetry.recipient, to_emails: inflightRetry.sender,
    subject: `Re: ${inflightRetry.subject}`, cleaned_text: inflightText
  }, { clock: () => new Date(NOW), translateInbound: async () => ({ ok: false, reason: 'text_provider_unavailable' }) });
  const inflightOld = db.prepare('SELECT * FROM matrix_stream_notification_spool WHERE inbound_message_id = ? AND generation = 1').get('<inflight-retry@test>');
  const inflightClaim = claimNotification(db, {
    actorUserId: inflightRetry.userId, bindingId: inflightRetry.bindingId, clock: () => new Date(NOW)
  });
  const readyValue = {
    translation_cn: '可见回复', requirements_cn: '待处理', suggested_subject: `Re: ${inflightRetry.subject}`,
    suggested_body_en: 'Thank you.', suggested_body_cn: '谢谢。'
  };
  let repeatProviderCalls = 0;
  await retryInboundTranslation(db, {
    actorUserId: inflightRetry.userId, bindingId: inflightRetry.bindingId,
    notificationId: inflightOld.id, clock: () => new Date(NOW),
    translateInbound: async () => { repeatProviderCalls += 1; return readyValue; }
  });
  assert.deepStrictEqual(db.prepare(`
    SELECT delivery_state, owner_token, notification_key FROM matrix_stream_notification_spool WHERE id = ?
  `).get(inflightOld.id), {
    delivery_state: 'inflight', owner_token: inflightClaim.claim_token, notification_key: inflightOld.notification_key
  }, 'retry-before-ack must preserve the old inflight identity');
  assert.deepStrictEqual(ackNotification(db, {
    actorUserId: inflightRetry.userId, bindingId: inflightRetry.bindingId,
    notificationId: inflightOld.id, claimToken: inflightClaim.claim_token,
    receiptId: 'inflight-old-receipt', clock: () => new Date(NOW)
  }), { notification_id: inflightOld.id, delivery_state: 'delivered' });
  await retryInboundTranslation(db, {
    actorUserId: inflightRetry.userId, bindingId: inflightRetry.bindingId,
    notificationId: inflightOld.id, clock: () => new Date(NOW),
    translateInbound: async () => { repeatProviderCalls += 1; throw new Error('response-loss replay must not call provider'); }
  });
  assert.strictEqual(repeatProviderCalls, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM matrix_stream_notification_spool WHERE inbound_message_id = ?').get('<inflight-retry@test>').count, 2, 'retry replay must create one generation');
  const inflightReadyClaim = claimNotification(db, {
    actorUserId: inflightRetry.userId, bindingId: inflightRetry.bindingId, clock: () => new Date(NOW)
  });
  assert.strictEqual(inflightReadyClaim.translation_status, 'ready');
  assert.strictEqual(db.prepare('SELECT supersedes_notification_id FROM matrix_stream_notification_spool WHERE id = ?').get(inflightReadyClaim.id).supersedes_notification_id, inflightOld.id);

  const concurrentRetry = seedAccepted(19, { recipient: 'notify@concurrent-retry.test', subject: 'Concurrent translation retry' });
  const concurrentText = 'Concurrent pending reply';
  upsertEmailMessage('sales@sender.test', 'INBOX', {
    message_uid: 'concurrent-retry-uid', message_id: '<concurrent-retry@test>', from_email: concurrentRetry.recipient,
    to_emails: concurrentRetry.sender, subject: `Re: ${concurrentRetry.subject}`, text_body: concurrentText,
    cleaned_text: concurrentText, received_at: NOW
  });
  await correlateInbound(db, {
    message_id: '<concurrent-retry@test>', in_reply_to: concurrentRetry.messageId,
    from_email: concurrentRetry.recipient, to_emails: concurrentRetry.sender,
    subject: `Re: ${concurrentRetry.subject}`, cleaned_text: concurrentText
  }, { clock: () => new Date(NOW), translateInbound: async () => ({ ok: false, reason: 'text_provider_unavailable' }) });
  const concurrentOld = db.prepare('SELECT * FROM matrix_stream_notification_spool WHERE inbound_message_id = ?').get('<concurrent-retry@test>');
  const concurrentClaim = claimNotification(db, {
    actorUserId: concurrentRetry.userId, bindingId: concurrentRetry.bindingId, clock: () => new Date(NOW)
  });
  ackNotification(db, {
    actorUserId: concurrentRetry.userId, bindingId: concurrentRetry.bindingId,
    notificationId: concurrentOld.id, claimToken: concurrentClaim.claim_token,
    receiptId: 'concurrent-pending-card', clock: () => new Date(NOW)
  });
  const db4 = new Database(process.env.DB_PATH);
  const db5 = new Database(process.env.DB_PATH);
  db4.pragma('foreign_keys = ON'); db5.pragma('foreign_keys = ON');
  let concurrentStarted = 0;
  let releaseConcurrent;
  const concurrentGate = new Promise(resolve => { releaseConcurrent = resolve; });
  const concurrentProvider = async () => {
    concurrentStarted += 1;
    if (concurrentStarted === 2) releaseConcurrent();
    await concurrentGate;
    return readyValue;
  };
  await Promise.all([db4, db5].map(connection => retryInboundTranslation(connection, {
    actorUserId: concurrentRetry.userId, bindingId: concurrentRetry.bindingId,
    notificationId: concurrentOld.id, clock: () => new Date(NOW), translateInbound: concurrentProvider
  })));
  assert.strictEqual(concurrentStarted, 2);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM matrix_stream_notification_spool WHERE inbound_message_id = ? AND generation = 2').get('<concurrent-retry@test>').count, 1);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM matrix_stream_events WHERE action = 'inbound_translation_ready' AND work_item_id = ?").get(concurrentRetry.workItemId).count, 1);
  db4.close(); db5.close();

  const redactedDelivery = seedAccepted(17, { recipient: 'notify@redact.test', subject: 'Notification redaction' });
  await correlateInbound(db, {
    message_id: '<notify-redact@test>', in_reply_to: redactedDelivery.messageId,
    from_email: redactedDelivery.recipient, to_emails: redactedDelivery.sender,
    subject: `Re: ${redactedDelivery.subject}`,
    cleaned_text: 'Public reply line\ninternal formula=cost+margin\nnote: password = very secret'
  }, { clock: () => new Date(NOW), translateInbound: async () => ({ ok: false, reason: 'text_provider_unavailable' }) });
  const redactedSpool = db.prepare('SELECT original_preview FROM matrix_stream_notification_spool WHERE inbound_message_id = ?').get('<notify-redact@test>');
  assert.ok(redactedSpool.original_preview.includes('Public reply line'));
  for (const excluded of ['internal formula', 'cost+margin', 'password', 'very secret']) {
    assert.ok(!redactedSpool.original_preview.toLowerCase().includes(excluded), `spool leaked ${excluded}`);
  }

  const authRetry = seedAccepted(15, { recipient: 'retry@auth.test', subject: 'Authorization retry' });
  const authText = 'Authoritative retry body';
  upsertEmailMessage('sales@sender.test', 'INBOX', {
    message_uid: 'auth-retry-uid', message_id: '<auth-retry@test>', from_email: authRetry.recipient,
    to_emails: authRetry.sender, subject: `Re: ${authRetry.subject}`, text_body: authText,
    cleaned_text: authText, received_at: NOW
  });
  await correlateInbound(db, {
    message_id: '<auth-retry@test>', in_reply_to: authRetry.messageId,
    from_email: authRetry.recipient, to_emails: authRetry.sender,
    subject: `Re: ${authRetry.subject}`, cleaned_text: authText
  }, { clock: () => new Date(NOW), translateInbound: async () => ({ ok: false, reason: 'text_provider_unavailable' }) });
  const authNotification = db.prepare("SELECT * FROM matrix_stream_notification_spool WHERE inbound_message_id = '<auth-retry@test>'").get();
  const authClaim = claimNotification(db, {
    actorUserId: authRetry.userId, bindingId: authRetry.bindingId, clock: () => new Date(NOW)
  });
  assert.strictEqual(authClaim.id, authNotification.id);
  await assert.rejects(() => retryInboundTranslation(db, {
    actorUserId: authRetry.userId, bindingId: authRetry.bindingId,
    notificationId: authNotification.id, clock: () => new Date(NOW),
    translateInbound: async () => {
      db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(authRetry.userId);
      return {
        translation_cn: '正文', requirements_cn: '无', suggested_subject: 'Re: Authorization retry',
        suggested_body_en: 'Thank you.', suggested_body_cn: '谢谢。'
      };
    }
  }), /authorized/i);
  assert.strictEqual(db.prepare('SELECT translation_status FROM matrix_stream_notification_spool WHERE id = ?').get(authNotification.id).translation_status, 'pending');
  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(authRetry.userId);

  const ambiguousOne = seedAccepted(3, { recipient: 'team@gamma.test', subject: 'Gamma plan' });
  const ambiguousTwo = seedAccepted(4, { recipient: 'team@gamma.test', subject: 'Gamma plan', sentAt: '2026-07-16T01:00:00.000Z' });
  const beforeAmbiguous = [ambiguousOne, ambiguousTwo].map(row => db.prepare('SELECT * FROM matrix_work_items WHERE id = ?').get(row.workItemId));
  const ambiguous = await correlateInbound(db, {
    message_id: '<reply-ambiguous@test>', from_email: 'team@gamma.test',
    to_emails: 'sales@sender.test', subject: 'Re: Gamma plan', cleaned_text: 'Hello'
  }, { clock: () => new Date(NOW) });
  assert.deepStrictEqual(ambiguous, { status: 'needs_review' });
  assert.deepStrictEqual([ambiguousOne, ambiguousTwo].map(row => db.prepare('SELECT * FROM matrix_work_items WHERE id = ?').get(row.workItemId)), beforeAmbiguous);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM matrix_stream_events WHERE action = 'inbound_needs_review'").get().count, 2);
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
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM matrix_stream_notification_spool WHERE inbound_message_id = ?').get(`<terminal-${fixture.index}@test>`).count, 0);
    if (fixture.event_kind !== 'reply') {
      assert.throws(() => startReplyDraft(db, {
        actorUserId: job.userId, bindingId: job.bindingId, notificationId: 999999, clock: () => new Date(NOW)
      }), /not found/i);
    }
  }

  const refusalJob = db.prepare("SELECT * FROM matrix_stream_jobs WHERE idempotency_key = 'job-7'").get();
  db.prepare(`
    INSERT INTO matrix_stream_notification_spool (
      inbound_message_id, work_item_id, job_id, kind, original_preview,
      translation_status, work_item_state, retry_available, notification_key,
      delivery_state, created_at
    ) VALUES ('<terminal-7@test>', ?, ?, 'refusal', 'No thank you.', 'pending',
      'refused', 1, '00000000-0000-4000-8000-000000000077', 'pending', ?)
  `).run(refusalJob.work_item_id, refusalJob.id, NOW);
  const refusalNotification = db.prepare("SELECT id FROM matrix_stream_notification_spool WHERE inbound_message_id = '<terminal-7@test>'").get();
  assert.throws(() => startReplyDraft(db, {
    actorUserId: 8107, bindingId: db.prepare("SELECT id FROM matrix_actor_bindings WHERE user_id = 8107").get().id, notificationId: refusalNotification.id, clock: () => new Date(NOW)
  }), /reply notification/i);

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

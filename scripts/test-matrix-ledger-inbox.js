'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-ledger-inbox-'));
process.env.DB_PATH = path.join(root, 'app.db');

const { db, initDb } = require('../src/db');
const { createMatrixLedgerStore } = require('../src/services/matrixLedgerStore');
const { createMatrixLedgerReconciler } = require('../src/services/matrixStreamCorrelation');
const { followupReadiness } = require('../src/services/matrixStreamFollowup');
const { buildThreadContext } = require('../src/services/matrixThreadContext');

const NOW = '2026-07-24T02:00:00.000Z';
const SENT_AT = '2026-07-21T02:00:00.000Z';

function insertEmail({
  uid,
  messageId,
  direction = 'inbound',
  from = 'buyer@alpha.test',
  to = 'sales@gdhspack.com',
  subject = 'Re: Alpha review',
  body = 'Thank you. Please continue.',
  inReplyTo = '',
  references = '',
  contact = from,
  domain = from.split('@')[1] || '',
  signals = {},
  noiseLevel = 'low',
  relevance = 'high'
}) {
  const result = db.prepare(`
    INSERT INTO email_messages (
      mailbox, folder, message_uid, message_id, in_reply_to, references_header,
      from_email, to_emails, subject, text_body, cleaned_text, received_at, sent_at,
      direction, processing_status, normalized_subject, conversation_key,
      email_domain, contact_email, noise_level, business_relevance,
      detected_signals_json, raw_headers_json, created_at, updated_at
    ) VALUES (
      'sales@gdhspack.com', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, 'new', 'alpha review', 'subject-contact:alpha review::buyer@alpha.test',
      ?, ?, ?, ?, ?, '{}', ?, ?
    )
  `).run(
    direction === 'outbound' ? 'Sent' : 'INBOX', uid, messageId, inReplyTo, references,
    from, to, subject, body, body, direction === 'inbound' ? NOW : null,
    direction === 'outbound' ? NOW : null, direction, domain, contact, noiseLevel,
    relevance, JSON.stringify(signals), NOW, NOW
  );
  return Number(result.lastInsertRowid);
}

function seedCustomer(index, email, domain) {
  const store = createMatrixLedgerStore({ db, clock: () => new Date(NOW) });
  const candidateId = String(7000 + index);
  const customerId = store.resolveCustomer({
    candidateId,
    companyName: `Canonical ${index}`,
    normalizedDomain: domain
  }).canonical_customer_id;
  const contact = store.upsertContact({
    customerId,
    channel: 'email',
    address: email,
    sourceUrl: `https://${domain}/contact`,
    verifiedAt: SENT_AT,
    status: 'active'
  });
  const userId = 9200 + index;
  db.prepare(`
    INSERT INTO users (id, username, password, role, status, created_at)
    VALUES (?, ?, 'test-only', 'foreign_trade_crm_admin', 'active', ?)
  `).run(userId, `ledger-inbox-${index}`, NOW);
  const workItemId = Number(db.prepare(`
    INSERT INTO matrix_work_items (
      candidate_id, stage, owner_user_id, current_summary, next_action,
      version, created_at, updated_at, stream_state
    ) VALUES (?, 'review_pending', ?, '', 'reply_check', 1, ?, ?, 'sent')
  `).run(Number(candidateId), userId, SENT_AT, SENT_AT).lastInsertRowid);
  const versionId = Number(db.prepare(`
    INSERT INTO matrix_stream_versions (
      work_item_id, revision, recipient_email, recipient_source_url,
      recipient_verified_at, subject, body_en, body_cn, strategy_summary,
      source_snapshot_json, content_hash, quality_score, quality_json, status,
      created_by, approved_by, approved_at, created_at, updated_at
    ) VALUES (?, 1, ?, ?, ?, 'Alpha review', 'Hello', '您好', '', '{}', ?, 100, '{}',
      'approved', ?, ?, ?, ?, ?)
  `).run(
    workItemId, email, `https://${domain}/contact`, SENT_AT, `hash-${index}`,
    userId, userId, SENT_AT, SENT_AT, SENT_AT
  ).lastInsertRowid);
  const outboundMessageId = `<outbound-${index}@gdhspack.com>`;
  const jobId = Number(db.prepare(`
    INSERT INTO matrix_stream_jobs (
      work_item_id, version_id, idempotency_key, content_hash, message_id,
      state, attempt_count, created_by, sender_email, recipient_domain,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'accepted', 1, ?, 'sales@gdhspack.com', ?, ?, ?)
  `).run(
    workItemId, versionId, `ledger-inbox-job-${index}`, `hash-${index}`,
    outboundMessageId, userId, domain, SENT_AT, SENT_AT
  ).lastInsertRowid);
  store.createTask({
    customerId,
    sourceKind: 'delivery_job',
    sourceId: String(jobId),
    taskType: 'check_reply',
    dueAt: '2026-07-24T02:00:00.000Z',
    nextAction: 'check reply'
  });
  store.recordThreadMessage({
    customerId,
    channel: 'email',
    conversationKey: `message:${outboundMessageId}`,
    sourceKind: 'legacy_delivery',
    sourceId: String(jobId),
    direction: 'outbound',
    classification: 'delivery',
    messageId: outboundMessageId,
    contentHash: `hash-${index}`,
    occurredAt: SENT_AT,
    state: 'waiting_customer'
  });
  return { store, customerId, contact, workItemId, versionId, jobId, outboundMessageId };
}

function pending(customerId, type) {
  return db.prepare(`
    SELECT * FROM matrix_tasks
    WHERE canonical_customer_id = ? AND task_type = ? AND state = 'pending'
    ORDER BY id
  `).all(customerId, type);
}

(async () => {
  try {
    const originalLog = console.log;
    console.log = () => {};
    try { initDb(); } finally { console.log = originalLog; }

    const alpha = seedCustomer(1, 'buyer@alpha.test', 'alpha.test');
    const beta = seedCustomer(2, 'buyer@beta.test', 'beta.test');
    const reconciler = createMatrixLedgerReconciler({
      db,
      store: alpha.store,
      clock: () => new Date(NOW)
    });

    const replyId = insertEmail({
      uid: 'reply-1',
      messageId: '<reply-1@alpha.test>',
      inReplyTo: alpha.outboundMessageId
    });
    const realReply = reconciler.reconcileLifecycle({ emailMessageId: replyId });
    assert.strictEqual(realReply.classification, 'customer_reply');
    assert.strictEqual(realReply.customer_id, alpha.customerId);
    assert.strictEqual(pending(alpha.customerId, 'check_reply').length, 0);
    assert.strictEqual(pending(alpha.customerId, 'review_reply').length, 1);
    assert.deepStrictEqual(
      followupReadiness(db, { jobId: alpha.jobId, now: NOW }),
      { allowed: false, blockers: ['customer_reply'] }
    );

    const attachmentId = Number(db.prepare(`
      INSERT INTO matrix_inbox_attachments (
        email_message_id, media_order, original_file_name, storage_key,
        detected_mime_type, declared_mime_type, file_size, sha256,
        availability_state, quarantine_reason, created_at, updated_at
      ) VALUES (?, 0, 'unsafe.bin', '', 'application/octet-stream',
        'application/octet-stream', 4, 'abcd', 'quarantined', 'unsupported', ?, ?)
    `).run(replyId, NOW, NOW).lastInsertRowid);
    const replay = reconciler.reconcileLifecycle({ emailMessageId: replyId });
    assert.strictEqual(replay.thread_id, realReply.thread_id);
    const boundAttachment = db.prepare(`
      SELECT canonical_thread_id, canonical_customer_id, availability_state
      FROM matrix_inbox_attachments WHERE id = ?
    `).get(attachmentId);
    assert.deepStrictEqual(boundAttachment, {
      canonical_thread_id: realReply.thread_id,
      canonical_customer_id: alpha.customerId,
      availability_state: 'quarantined'
    });
    const context = buildThreadContext(db, replyId);
    assert.strictEqual(context.customer.id, alpha.customerId);
    const attachment = context.attachments.find(item => item.filename === 'unsafe.bin');
    assert.strictEqual(attachment.canonical_thread_id, realReply.thread_id);
    assert.strictEqual(attachment.reusable_externally, false);
    assert.strictEqual(attachment.local_path, '');

    alpha.store.createTask({
      customerId: alpha.customerId,
      sourceKind: 'delivery_job',
      sourceId: String(alpha.jobId),
      taskType: 'check_reply',
      dueAt: '2026-07-27T02:00:00.000Z'
    });
    const bounceId = insertEmail({
      uid: 'bounce-1',
      messageId: '<bounce-1@gdhspack.com>',
      from: 'mailer-daemon@gdhspack.com',
      contact: 'buyer@alpha.test',
      domain: 'alpha.test',
      subject: 'Undeliverable: Alpha review',
      body: 'Status: 5.1.1 permanent failure',
      inReplyTo: alpha.outboundMessageId,
      signals: { lifecycle_classification: 'permanent_bounce' }
    });
    const permanentBounce = reconciler.reconcileLifecycle({ emailMessageId: bounceId });
    assert.strictEqual(permanentBounce.classification, 'permanent_bounce');
    assert.strictEqual(
      db.prepare('SELECT status FROM matrix_contacts WHERE id = ?').get(alpha.contact.id).status,
      'revoked'
    );
    assert.strictEqual(pending(alpha.customerId, 'replace_contact').length, 1);

    const delayId = insertEmail({
      uid: 'delay-1',
      messageId: '<delay-1@gdhspack.com>',
      from: 'mailer-daemon@gdhspack.com',
      contact: 'buyer@beta.test',
      domain: 'beta.test',
      subject: 'Delivery delayed',
      body: 'Status: 4.2.0 temporary delay',
      inReplyTo: beta.outboundMessageId,
      signals: { lifecycle_classification: 'temporary_delay' }
    });
    const temporaryDelay = reconciler.reconcileLifecycle({ emailMessageId: delayId });
    assert.strictEqual(temporaryDelay.classification, 'temporary_delay');
    assert.strictEqual(pending(beta.customerId, 'delivery_review').length, 1);

    const autoId = insertEmail({
      uid: 'auto-1',
      messageId: '<auto-1@beta.test>',
      from: 'buyer@beta.test',
      contact: 'buyer@beta.test',
      domain: 'beta.test',
      subject: 'Automatic reply: Alpha review',
      body: 'I am out of office and will return on 2026-08-04.',
      inReplyTo: beta.outboundMessageId,
      signals: { lifecycle_classification: 'automatic_reply' }
    });
    const automaticReply = reconciler.reconcileLifecycle({ emailMessageId: autoId });
    assert.strictEqual(automaticReply.classification, 'automatic_reply');
    assert.strictEqual(pending(beta.customerId, 'check_reply')[0].due_at, '2026-08-04T02:00:00.000Z');
    assert.deepStrictEqual(
      followupReadiness(db, { jobId: beta.jobId, now: NOW }),
      { allowed: false, blockers: ['automatic_reply_wait', 'temporary_delay'] }
    );

    const ambiguousId = insertEmail({
      uid: 'ambiguous-1',
      messageId: '<ambiguous-1@test>',
      from: 'buyer@alpha.test',
      contact: 'buyer@alpha.test',
      references: `${alpha.outboundMessageId} ${beta.outboundMessageId}`
    });
    const unresolved = reconciler.reconcileLifecycle({ emailMessageId: ambiguousId });
    assert.strictEqual(unresolved.customer_id, null);
    assert.strictEqual(unresolved.classification, 'unresolved');
    assert.strictEqual(
      db.prepare("SELECT COUNT(*) AS total FROM matrix_unresolved_records WHERE source_kind = 'email_message' AND source_id = ?").get(String(ambiguousId)).total,
      1
    );
    assert.strictEqual(pending(alpha.customerId, 'review_unresolved').length, 1);
    assert.strictEqual(pending(beta.customerId, 'review_unresolved').length, 1);

    const sentId = insertEmail({
      uid: 'sent-1',
      messageId: beta.outboundMessageId,
      direction: 'outbound',
      from: 'sales@gdhspack.com',
      to: 'buyer@beta.test',
      contact: 'buyer@beta.test',
      domain: 'beta.test',
      body: 'Outbound authoritative copy'
    });
    const sent = reconciler.reconcileLifecycle({ emailMessageId: sentId });
    assert.strictEqual(sent.classification, 'outbound_delivery');
    assert.strictEqual(sent.customer_id, beta.customerId);
    assert.strictEqual(
      db.prepare("SELECT COUNT(*) AS total FROM matrix_thread_messages WHERE source_kind = 'email_message' AND source_id = ?").get(String(sentId)).total,
      1
    );

    console.log('matrix ledger inbox tests passed');
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

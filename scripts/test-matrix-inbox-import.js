'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-inbox-import-'));
process.env.DB_PATH = path.join(root, 'app.db');

const { db, initDb, now } = require('../src/db');
const { createAttachmentStore } = require('../src/lib/matrixInboxStore');
const { persistParsedAttachments } = require('../src/lib/imapSync');
const { processInboundEmail } = require('../src/services/matrixInbox');
const { applyAiTriageResult } = require('../src/services/matrixInboxAi');
const { interpretCrmMessage } = require('../src/services/crmMessageInterpreter');

function insertEmail(overrides = {}) {
  const ts = now();
  const row = {
    mailbox: 'sales@example.test', folder: 'INBOX', message_uid: String(Math.random()),
    message_id: '', in_reply_to: '', references_header: '', from_email: '', to_emails: '',
    subject: '', cleaned_text: '', attachments_json: '[]', received_at: ts,
    direction: 'inbound', processing_status: 'new', normalized_subject: '',
    conversation_key: '', contact_email: '', matched_customer_id: null, matched_inquiry_id: null,
    ...overrides
  };
  return Number(db.prepare(`
    INSERT INTO email_messages (
      mailbox, folder, message_uid, message_id, in_reply_to, references_header,
      from_email, to_emails, subject, cleaned_text, attachments_json, received_at,
      direction, processing_status, normalized_subject, conversation_key, contact_email,
      matched_customer_id, matched_inquiry_id, created_at, updated_at
    ) VALUES (
      @mailbox, @folder, @message_uid, @message_id, @in_reply_to, @references_header,
      @from_email, @to_emails, @subject, @cleaned_text, @attachments_json, @received_at,
      @direction, @processing_status, @normalized_subject, @conversation_key, @contact_email,
      @matched_customer_id, @matched_inquiry_id, @created_at, @updated_at
    )
  `).run({ ...row, created_at: ts, updated_at: ts }).lastInsertRowid);
}

try {
  const originalLog = console.log;
  console.log = () => {};
  try { initDb(); } finally { console.log = originalLog; }
  assert.strictEqual(interpretCrmMessage({ message_text: 'Please quote FOB for PET/PE laminated pouches with high barrier.', direction: 'inbound' }).message_type, 'quote_request');

  const ts = now();
  const customerId = Number(db.prepare(`
    INSERT INTO customers (name, company_name, email, created_at, updated_at)
    VALUES ('Fixture', 'Fixture Ltd.', 'buyer@example.test', ?, ?)
  `).run(ts, ts).lastInsertRowid);
  const inquiryId = Number(db.prepare(`
    INSERT INTO inquiries (customer_id, inquiry_title, created_at, updated_at)
    VALUES (?, 'Coffee pouch', ?, ?)
  `).run(customerId, ts, ts).lastInsertRowid);

  insertEmail({
    folder: 'Sent', message_uid: 'sent-1', message_id: '<out-1@example.test>',
    from_email: 'sales@example.test', to_emails: 'buyer@example.test',
    subject: 'Coffee pouch quotation', normalized_subject: 'coffee pouch quotation',
    conversation_key: 'subject-contact:coffee pouch quotation::buyer@example.test',
    contact_email: 'buyer@example.test', direction: 'outbound',
    matched_customer_id: customerId, matched_inquiry_id: inquiryId
  });
  const inboundId = insertEmail({
    message_uid: 'in-1', message_id: '<in-1@example.test>',
    in_reply_to: '<out-1@example.test>', references_header: '<out-1@example.test>',
    from_email: 'buyer@example.test', to_emails: 'sales@example.test',
    subject: 'Re: Coffee pouch quotation', normalized_subject: 'coffee pouch quotation',
    conversation_key: 'ref:<out-1@example.test>', contact_email: 'buyer@example.test',
    cleaned_text: 'We need 20,000 pcs 250g stand up pouches with zipper. Please quote FOB.'
  });

  const attachmentRoot = path.join(root, 'attachments');
  const attachmentStore = createAttachmentStore({ root: attachmentRoot, dbHandle: db });
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('product-image')
  ]);
  const stored = persistParsedAttachments(inboundId, [{
    filename: 'product.png', contentType: 'image/png', content: png
  }], { attachmentStore });
  assert.strictEqual(stored.length, 1);
  assert.strictEqual(fs.readFileSync(stored[0].absolute_path).equals(png), true);

  const processed = processInboundEmail(db, inboundId);
  assert.strictEqual(processed.inserted, true);
  assert.strictEqual(processed.correlation_state, 'exact_header');
  assert.strictEqual(processed.matched_customer_id, customerId);
  assert.strictEqual(processed.matched_inquiry_id, inquiryId);
  const job = db.prepare('SELECT * FROM matrix_inbox_jobs WHERE id = ?').get(processed.job_id);
  const analysis = JSON.parse(job.analysis_json);
  assert.match(analysis.summary_cn, /自立.*袋|包装/);
  assert.match(analysis.suggested_customer_reply_en, /Thank you/);
  assert.strictEqual(job.analysis_state, 'ready');
  assert.strictEqual(job.message_class, 'quote_request');
  assert.strictEqual(job.workflow_state, 'quote_required');
  assert.strictEqual(job.delivery_state, 'triage_hold');
  assert.strictEqual(analysis.translation_state, 'pending_ai');
  assert.deepStrictEqual(analysis.line_translation_cn, []);
  assert.strictEqual(db.prepare("SELECT COUNT(*) count FROM matrix_inbox_actions WHERE job_id = ? AND action_type = 'quote_review' AND state = 'pending'").get(job.id).count, 1);
  applyAiTriageResult(db, job.id, {
    message_class: 'quote_request', subject_cn: '咖啡袋报价请求',
    line_translation_cn: ['客户需要 20,000 个 250 克自立拉链袋，并请求 FOB 报价。'],
    full_translation_cn: '客户需要 20,000 个 250 克自立拉链袋，并请求 FOB 报价。',
    summary_cn: '客户请求自立拉链袋 FOB 报价。', extracted: { quantity_text: '20,000 pcs' },
    missing_information: ['尺寸'], quote_required: true, quote_readiness: 'needs_information',
    suggested_next_action_cn: '核对附件和尺寸后继续现有核价任务。'
  }, { release: false });
  assert.strictEqual(processInboundEmail(db, inboundId).inserted, false);
  const preserved = db.prepare('SELECT analysis_json, delivery_state FROM matrix_inbox_jobs WHERE id = ?').get(job.id);
  assert.strictEqual(JSON.parse(preserved.analysis_json).translation_state, 'complete');
  assert.strictEqual(JSON.parse(preserved.analysis_json).summary_cn, '客户请求自立拉链袋 FOB 报价。');
  assert.strictEqual(preserved.delivery_state, 'triage_hold');
  db.prepare("UPDATE matrix_inbox_jobs SET analysis_json = ?, analysis_state = 'ready', message_class = 'technical_question', workflow_state = 'information_required' WHERE id = ?")
    .run(JSON.stringify({ ...analysis, translation_state: 'pending_ai', summary_cn: '低质量工作副本。' }), job.id);
  const healed = processInboundEmail(db, inboundId);
  const healedJob = db.prepare('SELECT analysis_json, message_class, workflow_state FROM matrix_inbox_jobs WHERE id = ?').get(job.id);
  assert.strictEqual(healed.restored_best_analysis, true);
  assert.strictEqual(JSON.parse(healedJob.analysis_json).summary_cn, '客户请求自立拉链袋 FOB 报价。');
  assert.strictEqual(healedJob.message_class, 'quote_request');
  assert.strictEqual(healedJob.workflow_state, 'quote_required');
  assert.strictEqual(db.prepare("SELECT COUNT(*) count FROM matrix_inbox_actions WHERE job_id = ? AND action_type = 'quote_review'").get(job.id).count, 1);

  const historicalId = insertEmail({
    message_uid: 'historical-1', message_id: '<historical-1@example.test>',
    from_email: 'buyer@example.test', to_emails: 'sales@example.test',
    received_at: '2026-06-30T15:59:59.000Z', subject: 'Old quotation request',
    cleaned_text: 'Please quote 10,000 pcs stand up pouches.'
  });
  const historical = processInboundEmail(db, historicalId);
  const historicalJob = db.prepare('SELECT * FROM matrix_inbox_jobs WHERE id = ?').get(historical.job_id);
  assert.strictEqual(historicalJob.delivery_state, 'suppressed');
  assert.strictEqual(historicalJob.workflow_state, 'historical_cutoff');

  const advertisingId = insertEmail({
    message_uid: 'advertising-1', message_id: '<advertising-1@example.test>',
    from_email: 'agency@example.test', to_emails: 'sales@example.test',
    received_at: '2026-07-18T08:00:00.000Z', subject: 'SEO and WhatsApp marketing services',
    cleaned_text: 'We can improve your website SEO ranking and send WhatsApp marketing campaigns. Book a call.'
  });
  const advertising = processInboundEmail(db, advertisingId);
  const advertisingJob = db.prepare('SELECT * FROM matrix_inbox_jobs WHERE id = ?').get(advertising.job_id);
  assert.strictEqual(advertisingJob.message_class, 'advertising');
  assert.strictEqual(advertisingJob.delivery_state, 'suppressed');
  assert.strictEqual(advertisingJob.workflow_state, 'filtered_advertising');
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM matrix_inbox_actions WHERE job_id = ?').get(advertisingJob.id).count, 0);

  const internalReportId = insertEmail({
    message_uid: 'internal-report-1', message_id: '<internal-report-1@example.test>',
    from_email: 'system@example.test', to_emails: 'sales@example.test',
    received_at: '2026-07-18T09:00:00.000Z', subject: 'Huasheng Packaging Weekly Website Report',
    cleaned_text: 'Automated weekly report.'
  });
  const internalReport = processInboundEmail(db, internalReportId);
  const internalReportJob = db.prepare('SELECT * FROM matrix_inbox_jobs WHERE id = ?').get(internalReport.job_id);
  assert.strictEqual(internalReportJob.message_class, 'internal_report');
  assert.strictEqual(internalReportJob.delivery_state, 'suppressed');
  assert.strictEqual(internalReportJob.workflow_state, 'filtered_internal_report');

  insertEmail({
    folder: 'Sent', message_uid: 'sent-2', message_id: '<out-2@example.test>',
    from_email: 'sales@example.test', to_emails: 'ambiguous@example.test',
    subject: 'Same subject', normalized_subject: 'same subject', contact_email: 'ambiguous@example.test',
    direction: 'outbound', matched_customer_id: customerId, matched_inquiry_id: inquiryId
  });
  insertEmail({
    folder: 'Sent', message_uid: 'sent-3', message_id: '<out-3@example.test>',
    from_email: 'sales@example.test', to_emails: 'ambiguous@example.test',
    subject: 'Same subject', normalized_subject: 'same subject', contact_email: 'ambiguous@example.test',
    direction: 'outbound', matched_customer_id: customerId, matched_inquiry_id: inquiryId
  });
  const ambiguousId = insertEmail({
    message_uid: 'in-2', message_id: '<in-2@example.test>',
    from_email: 'ambiguous@example.test', to_emails: 'sales@example.test',
    subject: 'Re: Same subject', normalized_subject: 'same subject', contact_email: 'ambiguous@example.test',
    cleaned_text: 'Please review the attached product.'
  });
  const ambiguous = processInboundEmail(db, ambiguousId);
  assert.strictEqual(ambiguous.correlation_state, 'needs_review');
  assert.strictEqual(ambiguous.matched_customer_id, null);
  assert.strictEqual(ambiguous.matched_inquiry_id, null);

  const failingId = insertEmail({
    message_uid: 'in-3', message_id: '<in-3@example.test>',
    from_email: 'new@example.test', to_emails: 'sales@example.test',
    subject: 'New inquiry', normalized_subject: 'new inquiry', contact_email: 'new@example.test',
    cleaned_text: 'Need bags.'
  });
  assert.throws(() => processInboundEmail(db, failingId, { interpret: () => { throw new Error('analysis unavailable'); } }), /analysis unavailable/);
  assert.ok(db.prepare('SELECT id FROM email_messages WHERE id = ?').get(failingId));
  assert.ok(db.prepare('SELECT id FROM matrix_inbox_jobs WHERE email_message_id = ?').get(failingId));

  console.log('PASS matrix inbox import');
} finally {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

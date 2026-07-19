'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-inbox-ai-'));
process.env.DB_PATH = path.join(root, 'app.db');
const { db, initDb, now } = require('../src/db');
const { processInboundEmail } = require('../src/services/matrixInbox');
const { applyAiTriageResult, validateAiTriageResult, runPendingAiTriage } = require('../src/services/matrixInboxAi');

try {
  const originalLog = console.log;
  console.log = () => {};
  try { initDb(); } finally { console.log = originalLog; }
  const ts = now();
  const emailId = Number(db.prepare(`
    INSERT INTO email_messages (
      mailbox, folder, message_uid, message_id, from_email, to_emails, subject,
      cleaned_text, received_at, direction, processing_status, created_at, updated_at
    ) VALUES ('sales@example.test', 'INBOX', 'ai-1', '<ai-1@example.test>',
      'buyer@example.test', 'sales@example.test', 'Quotation request', ?, ?, 'inbound', 'new', ?, ?)
  `).run('Hello\nPlease quote 20,000 pcs stand up zipper pouches FOB Shenzhen.\nThank you.', '2026-07-19T02:00:00.000Z', ts, ts).lastInsertRowid);
  const processed = processInboundEmail(db, emailId);
  assert.strictEqual(db.prepare('SELECT delivery_state FROM matrix_inbox_jobs WHERE id = ?').get(processed.job_id).delivery_state, 'triage_hold');

  const result = {
    message_class: 'quote_request',
    subject_cn: '报价请求',
    line_translation_cn: ['您好。', '请报深圳 FOB 价：20,000 个自立拉链袋。', '谢谢。'],
    full_translation_cn: '您好。\n请报深圳 FOB 价：20,000 个自立拉链袋。\n谢谢。',
    summary_cn: '客户询问 20,000 个自立拉链袋的深圳 FOB 报价。',
    extracted: { bag_type: 'stand_zipper_bag', quantity_text: '20,000 pcs', trade_term: 'FOB', destination_text: 'Shenzhen' },
    missing_information: ['袋子尺寸', '材料结构', '印刷颜色'],
    quote_required: true,
    quote_readiness: 'needs_information',
    suggested_next_action_cn: '先确认尺寸、材料结构和印刷颜色，再进入内部核价。'
  };
  assert.strictEqual(validateAiTriageResult(result, 3).line_translation_cn.length, 3);
  assert.throws(() => validateAiTriageResult({ ...result, line_translation_cn: ['只有一行'] }, 3), /translation line count/i);
  applyAiTriageResult(db, processed.job_id, result);
  const job = db.prepare('SELECT * FROM matrix_inbox_jobs WHERE id = ?').get(processed.job_id);
  const analysis = JSON.parse(job.analysis_json);
  assert.strictEqual(job.delivery_state, 'pending');
  assert.strictEqual(job.workflow_state, 'quote_required');
  assert.strictEqual(analysis.translation_state, 'complete');
  assert.strictEqual(analysis.line_translation_cn.length, 3);
  assert.strictEqual(db.prepare("SELECT COUNT(*) count FROM matrix_inbox_actions WHERE job_id = ? AND action_type = 'quote_review' AND state = 'pending'").get(job.id).count, 1);
  db.prepare("UPDATE matrix_inbox_jobs SET delivery_state = 'triage_hold' WHERE id = ?").run(job.id);
  applyAiTriageResult(db, processed.job_id, result, { release: false });
  assert.strictEqual(db.prepare('SELECT delivery_state FROM matrix_inbox_jobs WHERE id = ?').get(job.id).delivery_state, 'triage_hold');
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM matrix_inbox_analysis_versions WHERE job_id = ?').get(job.id).count, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM matrix_thread_reviews').get().count, 1);
  applyAiTriageResult(db, processed.job_id, { ...result, summary_cn: '人工已确认的线程摘要。' }, { release: false, source: 'human_verified' });
  const downgraded = applyAiTriageResult(db, processed.job_id, { ...result, summary_cn: '较低质量结果不应覆盖。' }, { release: false, source: 'ai' });
  assert.strictEqual(downgraded.preserved_higher_quality, true);
  assert.strictEqual(JSON.parse(db.prepare('SELECT analysis_json FROM matrix_inbox_jobs WHERE id = ?').get(job.id).analysis_json).summary_cn, '人工已确认的线程摘要。');
  const secondId = Number(db.prepare(`
    INSERT INTO email_messages (
      mailbox, folder, message_uid, message_id, from_email, to_emails, subject,
      cleaned_text, received_at, direction, processing_status, created_at, updated_at
    ) VALUES ('sales@example.test', 'INBOX', 'ai-2', '<ai-2@example.test>',
      'buyer2@example.test', 'sales@example.test', 'Product question', 'Please send a sample.',
      '2026-07-19T03:00:00.000Z', 'inbound', 'new', ?, ?)
  `).run(ts, ts).lastInsertRowid);
  const second = processInboundEmail(db, secondId);
  const batchSummary = runPendingAiTriage(db, {
    limit: 5,
    analyze: input => ({
      message_class: 'sample_request', subject_cn: '样品请求',
      line_translation_cn: ['请寄送一个样品。'], full_translation_cn: '请寄送一个样品。',
      summary_cn: '客户请求样品。', extracted: {}, missing_information: ['收件地址'],
      quote_required: false, quote_readiness: 'not_applicable', suggested_next_action_cn: '确认样品规格和收件地址。'
    })
  });
  assert.strictEqual(batchSummary.selected, 1);
  assert.strictEqual(batchSummary.completed, 1);
  assert.strictEqual(batchSummary.failed, 0);
  assert.strictEqual(db.prepare('SELECT delivery_state FROM matrix_inbox_jobs WHERE id = ?').get(second.job_id).delivery_state, 'pending');
  console.log('PASS matrix inbox AI triage');
} finally {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

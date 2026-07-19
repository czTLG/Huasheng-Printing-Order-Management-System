'use strict';

const crypto = require('node:crypto');
const { triageFor, upsertAction } = require('./matrixInbox');
const { buildThreadContext } = require('./matrixThreadContext');
const { saveThreadReview } = require('./matrixThreadReview');

const MESSAGE_CLASSES = new Set([
  'quote_request', 'customer_reply', 'sample_request', 'technical_question',
  'logistics_question', 'payment_question', 'delivery_notice', 'supplier_service',
  'advertising', 'system_notice', 'internal_report'
]);
const QUOTE_READINESS = new Set(['ready_for_internal_review', 'needs_information', 'not_applicable']);
const THREAD_STATES = new Set(['first_contact_unanswered', 'awaiting_our_reply', 'waiting_customer', 'quote_required', 'quote_in_progress', 'archive_review', 'outreach_reply']);
const RESPONSIBLE_PARTIES = new Set(['our_team', 'customer', 'internal_review', 'archive']);
const TASK_ACTIONS = new Set(['continue_existing', 'create_one', 'no_quote_task']);

function text(value) {
  return String(value == null ? '' : value).trim();
}

function sourceLines(value) {
  return String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 80);
}

function validateAiTriageResult(value, expectedLineCount) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI triage result must be an object');
  if (!MESSAGE_CLASSES.has(text(value.message_class))) throw new Error('invalid AI message class');
  if (!Array.isArray(value.line_translation_cn) || value.line_translation_cn.length !== expectedLineCount) {
    throw new Error('translation line count mismatch');
  }
  const translations = value.line_translation_cn.map(text);
  if (translations.some(line => !line || !/[\u3400-\u9fff]/u.test(line))) throw new Error('every translation line must contain Chinese');
  if (!text(value.full_translation_cn) || !/[\u3400-\u9fff]/u.test(value.full_translation_cn)) throw new Error('complete Chinese translation required');
  if (!text(value.summary_cn) || !text(value.suggested_next_action_cn)) throw new Error('Chinese summary and next action required');
  if (!QUOTE_READINESS.has(text(value.quote_readiness))) throw new Error('invalid quote readiness');
  const threadState = THREAD_STATES.has(text(value.thread_state)) ? text(value.thread_state) : (value.quote_required === true ? 'quote_required' : 'awaiting_our_reply');
  const responsibleParty = RESPONSIBLE_PARTIES.has(text(value.responsible_party)) ? text(value.responsible_party) : 'our_team';
  const taskAction = TASK_ACTIONS.has(text(value.existing_task_action)) ? text(value.existing_task_action) : (value.quote_required === true ? 'create_one' : 'no_quote_task');
  return {
    message_class: text(value.message_class),
    subject_cn: text(value.subject_cn),
    line_translation_cn: translations,
    full_translation_cn: text(value.full_translation_cn),
    summary_cn: text(value.summary_cn),
    extracted: value.extracted && typeof value.extracted === 'object' && !Array.isArray(value.extracted) ? value.extracted : {},
    missing_information: Array.isArray(value.missing_information) ? value.missing_information.map(text).filter(Boolean) : [],
    quote_required: value.quote_required === true,
    quote_readiness: text(value.quote_readiness),
    suggested_next_action_cn: text(value.suggested_next_action_cn),
    thread_summary_cn: text(value.thread_summary_cn || value.summary_cn),
    thread_state: threadState,
    responsible_party: responsibleParty,
    background_summary_cn: text(value.background_summary_cn),
    existing_task_action: taskAction
  };
}

function applyAiTriageResult(db, jobId, input, { release = true, source = 'ai', saveThread = true } = {}) {
  const row = db.prepare(`
    SELECT j.*, em.cleaned_text, em.text_body, em.received_at, em.created_at AS email_created_at
    FROM matrix_inbox_jobs j JOIN email_messages em ON em.id = j.email_message_id
    WHERE j.id = ?
  `).get(Number(jobId));
  if (!row) throw new Error('inbox job not found');
  const lines = sourceLines(row.cleaned_text || row.text_body || '');
  const result = validateAiTriageResult(input, lines.length);
  const previous = (() => { try { return JSON.parse(row.analysis_json || '{}'); } catch (_) { return {}; } })();
  const analysis = {
    ...previous,
    ...result.extracted,
    ...result,
    translation_state: 'complete',
    translated_line_count: lines.length
  };
  const triage = triageFor({ received_at: row.received_at, created_at: row.email_created_at }, analysis, result.message_class, { translationComplete: true });
  if (!release && triage.deliveryState === 'pending') triage.deliveryState = 'triage_hold';
  const ts = new Date().toISOString();
  const serialized = JSON.stringify(analysis);
  const analysisHash = crypto.createHash('sha256').update(serialized).digest('hex');
  const sourceName = ['ai', 'human_verified', 'imported'].includes(text(source)) ? text(source) : 'ai';
  const qualityRank = sourceName === 'human_verified' ? 100 : sourceName === 'ai' ? 80 : 60;
  const existingTop = db.prepare(`
    SELECT quality_rank FROM matrix_inbox_analysis_versions
    WHERE job_id = ? ORDER BY quality_rank DESC, id DESC LIMIT 1
  `).get(row.id);
  const threadContext = buildThreadContext(db, row.email_message_id);
  const saveReview = () => saveThreadReview(db, {
    thread_key: threadContext.thread_key, source: sourceName,
    thread_state: result.thread_state, responsible_party: result.responsible_party,
    summary_cn: result.thread_summary_cn, background_summary_cn: result.background_summary_cn,
    next_action_cn: result.suggested_next_action_cn,
    evidence: threadContext.messages.map(item => ({ email_message_id: item.email_message_id, direction: item.direction, occurred_at: item.occurred_at }))
  });
  if (Number(existingTop?.quality_rank || 0) > qualityRank) {
    db.prepare(`
      INSERT INTO matrix_inbox_analysis_versions (job_id, analysis_hash, analysis_source, quality_rank, analysis_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_id, analysis_hash) DO NOTHING
    `).run(row.id, analysisHash, sourceName, qualityRank, serialized, ts);
    if (saveThread) saveReview();
    return {
      job_id: Number(row.id), message_class: text(row.message_class), workflow_state: text(row.workflow_state),
      delivery_state: text(row.delivery_state), preserved_higher_quality: true
    };
  }
  db.transaction(() => {
    if (saveThread) saveReview();
    db.prepare(`
      INSERT INTO matrix_inbox_analysis_versions (job_id, analysis_hash, analysis_source, quality_rank, analysis_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_id, analysis_hash) DO NOTHING
    `).run(row.id, analysisHash, sourceName, qualityRank, serialized, ts);
    db.prepare(`
      UPDATE matrix_inbox_jobs
      SET analysis_json = ?, analysis_state = 'ready', message_class = ?, workflow_state = ?,
          delivery_state = ?, lease_token = NULL, lease_expires_at = NULL, last_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(serialized, result.message_class, triage.workflowState, triage.deliveryState, ts, row.id);
    db.prepare("DELETE FROM matrix_inbox_actions WHERE job_id = ? AND state = 'pending' AND action_type <> ?")
      .run(row.id, triage.actionType || '');
    upsertAction(db, row.id, triage.actionType, analysis);
  })();
  return { job_id: Number(row.id), message_class: result.message_class, workflow_state: triage.workflowState, delivery_state: triage.deliveryState };
}

function runPendingAiTriage(db, { analyze, limit = 3, release = true, emailMessageIds = [] } = {}) {
  if (typeof analyze !== 'function') throw new Error('AI triage analyzer required');
  const boundedLimit = Math.max(1, Math.min(10, Number(limit) || 3));
  const targetIds = [...new Set((Array.isArray(emailMessageIds) ? emailMessageIds : []).map(Number).filter(id => Number.isInteger(id) && id > 0))];
  const targetClause = targetIds.length ? `AND em.id IN (${targetIds.map(() => '?').join(',')})` : '';
  const deliveryClause = targetIds.length ? '' : `
      AND j.delivery_state = 'triage_hold'
      AND COALESCE(json_extract(j.analysis_json, '$.translation_state'), '') <> 'complete'`;
  const rows = db.prepare(`
    SELECT j.id AS job_id, em.id AS email_message_id, em.subject, COALESCE(em.cleaned_text, em.text_body, '') AS source_text,
           em.received_at
    FROM matrix_inbox_jobs j
    JOIN email_messages em ON em.id = j.email_message_id
    WHERE 1 = 1
      ${deliveryClause}
      AND j.workflow_state <> 'historical_cutoff'
      AND j.message_class <> 'advertising'
      AND datetime(COALESCE(em.received_at, em.created_at)) >= datetime('2026-06-30T16:00:00.000Z')
      ${targetClause}
    ORDER BY COALESCE(em.received_at, em.created_at) DESC, j.id DESC
    LIMIT ?
  `).all(...targetIds, boundedLimit);
  const summary = { selected: rows.length, completed: 0, failed: 0 };
  for (const row of rows) {
    try {
      const lines = sourceLines(row.source_text);
      const result = analyze({ subject: text(row.subject), lines, received_at: text(row.received_at), thread_context: buildThreadContext(db, row.email_message_id) });
      applyAiTriageResult(db, row.job_id, result, { release });
      summary.completed += 1;
    } catch (_) {
      db.prepare(`
        UPDATE matrix_inbox_jobs
        SET analysis_state = 'translation_failed', last_error = 'translation_failed', updated_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), row.job_id);
      summary.failed += 1;
    }
  }
  return summary;
}

module.exports = { MESSAGE_CLASSES, sourceLines, validateAiTriageResult, applyAiTriageResult, runPendingAiTriage };

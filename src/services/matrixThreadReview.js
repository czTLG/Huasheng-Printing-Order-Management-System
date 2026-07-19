'use strict';

const crypto = require('node:crypto');

function text(value) { return String(value == null ? '' : value).trim(); }

const SOURCES = Object.freeze({ imported: 60, ai: 80, human_verified: 100 });

function saveThreadReview(db, input = {}, { clock = () => new Date() } = {}) {
  const threadKey = text(input.thread_key).toLowerCase();
  const summary = text(input.summary_cn);
  const nextAction = text(input.next_action_cn);
  const source = Object.prototype.hasOwnProperty.call(SOURCES, text(input.source)) ? text(input.source) : 'ai';
  if (!threadKey || !summary || !nextAction) throw new Error('thread key, summary and next action required');
  const payload = {
    thread_state: text(input.thread_state), responsible_party: text(input.responsible_party),
    summary_cn: summary, background_summary_cn: text(input.background_summary_cn),
    next_action_cn: nextAction, evidence: Array.isArray(input.evidence) ? input.evidence : []
  };
  const serialized = JSON.stringify(payload);
  const hash = crypto.createHash('sha256').update(serialized).digest('hex');
  const ts = clock().toISOString();
  db.prepare(`
    INSERT INTO matrix_thread_reviews (
      thread_key, analysis_hash, analysis_source, quality_rank, thread_state, responsible_party,
      summary_cn, background_summary_cn, next_action_cn, evidence_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_key, analysis_hash) DO NOTHING
  `).run(threadKey, hash, source, SOURCES[source], payload.thread_state, payload.responsible_party,
    payload.summary_cn, payload.background_summary_cn, payload.next_action_cn, JSON.stringify(payload.evidence), ts);
  return bestThreadReview(db, threadKey);
}

function bestThreadReview(db, threadKey) {
  return db.prepare(`
    SELECT thread_key, analysis_source, quality_rank, thread_state, responsible_party,
           summary_cn, background_summary_cn, next_action_cn, evidence_json, created_at
    FROM matrix_thread_reviews WHERE thread_key = ?
    ORDER BY quality_rank DESC, id DESC LIMIT 1
  `).get(text(threadKey).toLowerCase()) || null;
}

module.exports = { saveThreadReview, bestThreadReview };

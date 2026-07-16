'use strict';

const { createRun } = require('./signalCache');
const { importDiscoveryBatch } = require('./matrixStream');

function timestamp() {
  return new Date().toISOString();
}

function auditRun(db, runId, actor, action, detail) {
  db.prepare(`
    INSERT INTO audit_logs (role, user_name, action, resource_type, resource_id, detail, created_at)
    VALUES ('foreign_trade_crm_admin', ?, ?, 'matrix_run', ?, ?, ?)
  `).run(actor, action, String(runId), JSON.stringify(detail || {}), timestamp());
}

async function runCampaign(db, campaign, records, options = {}) {
  if (!campaign || typeof campaign.actor !== 'string' || !campaign.actor.trim()) {
    throw new Error('authenticated local actor is required');
  }
  const run = createRun(db, campaign);
  auditRun(db, run.id, campaign.actor, 'matrix_run_started', { input: records.length });
  try {
    const summary = await importDiscoveryBatch(db, run.id, records, options);
    const counters = { ...summary, resume_cursor: null };
    db.transaction(() => {
      auditRun(db, run.id, campaign.actor, 'matrix_discovery_recorded', { input: summary.input, excluded: summary.excluded });
      auditRun(db, run.id, campaign.actor, 'matrix_evidence_recorded', {
        count: db.prepare('SELECT COUNT(*) AS count FROM matrix_evidence WHERE run_id = ?').get(run.id).count
      });
      auditRun(db, run.id, campaign.actor, 'matrix_classification_recorded', {
        count: db.prepare('SELECT COUNT(*) AS count FROM matrix_classifications WHERE run_id = ?').get(run.id).count
      });
      db.prepare(`
        UPDATE matrix_runs SET status = 'completed', counters_json = ?, completed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'running'
      `).run(JSON.stringify(counters), timestamp(), timestamp(), run.id);
      auditRun(db, run.id, campaign.actor, 'matrix_run_completed', counters);
    })();
    return { run_id: Number(run.id), summary };
  } catch (error) {
    const counters = { errors: 1, resume_cursor: 0, error: error.message };
    db.transaction(() => {
      db.prepare(`UPDATE matrix_runs SET status = 'failed', counters_json = ?, completed_at = ?, updated_at = ? WHERE id = ?`)
        .run(JSON.stringify(counters), timestamp(), timestamp(), run.id);
      auditRun(db, run.id, campaign.actor, 'matrix_run_failed', counters);
    })();
    throw error;
  }
}

module.exports = { runCampaign };

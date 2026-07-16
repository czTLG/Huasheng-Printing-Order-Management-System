'use strict';

const { deleteRun } = require('./signalCache');

const ROLES = new Set(['super_admin', 'foreign_trade_crm_admin']);

function rollbackRun(db, runId, actor) {
  const id = Number(runId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('valid run ID is required');
  if (!actor || !actor.username || !ROLES.has(actor.role)) throw new Error('authorized rollback actor is required');
  return db.transaction(() => {
    const run = db.prepare('SELECT id, status FROM matrix_runs WHERE id = ?').get(id);
    if (!run) throw new Error('run not found');
    const counts = {
      classifications: db.prepare('SELECT COUNT(*) count FROM matrix_classifications WHERE run_id = ?').get(id).count,
      evidence: db.prepare('SELECT COUNT(*) count FROM matrix_evidence WHERE run_id = ?').get(id).count,
      snapshots: db.prepare('SELECT COUNT(*) count FROM matrix_entity_snapshots WHERE run_id = ?').get(id).count
    };
    const deleted = deleteRun(db, id);
    db.prepare(`
      INSERT INTO audit_logs (role, user_name, action, resource_type, resource_id, detail, created_at)
      VALUES (?, ?, 'matrix_run_rolled_back', 'matrix_run', ?, ?, ?)
    `).run(actor.role, actor.username, String(id), JSON.stringify({ previous_status: run.status, ...counts }), new Date().toISOString());
    return { run_id: id, deleted, counts };
  })();
}

module.exports = { rollbackRun };

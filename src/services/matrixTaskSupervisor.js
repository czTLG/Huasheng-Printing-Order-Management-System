'use strict';

const crypto = require('node:crypto');

function token(value, label, maximum = 500) {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(`${label} required`);
  if (result.length > maximum) throw new Error(`${label} too long`);
  return result;
}

function positiveInteger(value, label) {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0) throw new Error(`${label} required`);
  return result;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function hash(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function nowIso(clock) {
  const value = typeof clock === 'function' ? clock() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('clock returned invalid time');
  return date.toISOString();
}

function parse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function taskResult(row) {
  return {
    id: row.id,
    taskType: row.task_type,
    ownerRole: row.owner_role,
    channel: row.channel,
    dueAt: row.due_at,
    state: row.state,
    version: row.version,
    bindingId: row.binding_id,
    bindings: parse(row.bindings_json, {}),
    blocker: row.blocker,
    nextAction: row.next_action,
    evidenceIds: parse(row.evidence_json, []),
    followupCount: row.followup_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function decisionResult(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    version: row.version,
    state: row.state,
    bindingId: row.binding_id,
    affectedItemIds: parse(row.affected_item_ids_json, []),
    question: row.question,
    recommendedOption: row.recommended_option,
    options: parse(row.options_json, []),
    selectedOption: row.selected_option,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function createMatrixTaskSupervisor({ db, clock = () => new Date() } = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('db required');

  function command(idempotencyKey, request, operation) {
    const key = token(idempotencyKey, 'idempotency key', 200);
    const requestFingerprint = hash(request);
    return db.transaction(() => {
      const replay = db.prepare('SELECT * FROM matrix_task_commands WHERE idempotency_key=?').get(key);
      if (replay) {
        if (replay.request_fingerprint !== requestFingerprint) throw new Error('matrix task idempotency conflict');
        return parse(replay.result_json, null);
      }
      const result = operation(key);
      db.prepare('INSERT INTO matrix_task_commands (idempotency_key,request_fingerprint,result_json,created_at) VALUES (?,?,?,?)')
        .run(key, requestFingerprint, canonicalJson(result), nowIso(clock));
      return result;
    })();
  }

  function getTask(taskId) {
    const row = db.prepare('SELECT * FROM matrix_tasks WHERE id=?').get(positiveInteger(taskId, 'task id'));
    return row ? taskResult(row) : null;
  }

  function getDecision(decisionId) {
    const row = db.prepare('SELECT * FROM matrix_decisions WHERE id=?').get(positiveInteger(decisionId, 'decision id'));
    return row ? decisionResult(row) : null;
  }

  function appendTaskEvent(row, eventType, payload, actorUserId, context, idempotencyKey) {
    db.prepare(`INSERT INTO matrix_task_events (task_id,task_version,event_type,payload_json,actor_user_id,binding_id,channel,chat_id,card_event_id,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(row.id, row.version, eventType, canonicalJson(payload), actorUserId || null, row.binding_id, row.channel,
        String(context?.chatId || ''), String(context?.cardEventId || ''), idempotencyKey, nowIso(clock));
  }

  function ensureTask(input = {}) {
    const bindings = input.bindings && typeof input.bindings === 'object' && !Array.isArray(input.bindings) ? input.bindings : {};
    const evidenceIds = Array.isArray(input.evidenceIds) ? [...new Set(input.evidenceIds.map(String))].sort() : [];
    const request = {
      operation: 'ensure_task',
      taskType: token(input.taskType, 'task type', 100),
      ownerRole: token(input.ownerRole, 'owner role', 100),
      channel: token(input.channel, 'channel', 20),
      dueAt: token(input.dueAt, 'due at', 50),
      bindings,
      blocker: String(input.blocker || '').trim().slice(0, 500),
      nextAction: token(input.nextAction, 'next action', 500),
      evidenceIds
    };
    if (!['bill', 'vmci'].includes(request.channel)) throw new Error('invalid task channel');
    return command(input.idempotencyKey, request, (key) => {
      const createdAt = nowIso(clock);
      const bindingId = `mtb_${hash({ key, bindings }).slice(0, 32)}`;
      const info = db.prepare(`INSERT INTO matrix_tasks (task_type,owner_role,channel,due_at,binding_id,bindings_json,blocker,next_action,evidence_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(request.taskType, request.ownerRole, request.channel, request.dueAt, bindingId, canonicalJson(bindings), request.blocker, request.nextAction, canonicalJson(evidenceIds), createdAt, createdAt);
      const row = db.prepare('SELECT * FROM matrix_tasks WHERE id=?').get(info.lastInsertRowid);
      appendTaskEvent(row, 'created', request, null, {}, key);
      return taskResult(row);
    });
  }

  function transition(input = {}) {
    const request = {
      operation: 'transition', taskId: positiveInteger(input.taskId, 'task id'),
      expectedVersion: positiveInteger(input.expectedVersion, 'expected version'),
      action: token(input.action, 'action', 50), actorUserId: positiveInteger(input.actorUserId, 'actor user id'),
      bindingId: token(input.bindingId, 'binding id', 100), channel: token(input.channel, 'channel', 20),
      chatId: token(input.chatId, 'chat id', 200), cardEventId: token(input.cardEventId, 'card event id', 200),
      evidence: Array.isArray(input.evidence) ? [...new Set(input.evidence.map(String))].sort() : []
    };
    const transitions = { start: 'open', block: 'blocked', wait_decision: 'waiting_decision', complete: 'completed', cancel: 'cancelled', reopen: 'open' };
    if (!transitions[request.action]) throw new Error('invalid task action');
    return command(input.idempotencyKey, request, (key) => {
      const row = db.prepare('SELECT * FROM matrix_tasks WHERE id=?').get(request.taskId);
      if (!row) throw new Error('task not found');
      if (row.version !== request.expectedVersion) throw new Error('stale task version');
      if (row.binding_id !== request.bindingId) throw new Error('task binding mismatch');
      if (row.channel !== request.channel) throw new Error('task channel mismatch');
      const nextVersion = row.version + 1;
      db.prepare('UPDATE matrix_tasks SET state=?,version=?,evidence_json=?,updated_at=? WHERE id=? AND version=?')
        .run(transitions[request.action], nextVersion, canonicalJson(request.evidence.length ? request.evidence : parse(row.evidence_json, [])), nowIso(clock), row.id, row.version);
      const updated = db.prepare('SELECT * FROM matrix_tasks WHERE id=?').get(row.id);
      appendTaskEvent(updated, request.action, request, request.actorUserId, request, key);
      return taskResult(updated);
    });
  }

  function createDecision(input = {}) {
    const affectedItemIds = Array.isArray(input.affectedItemIds) ? [...new Set(input.affectedItemIds.map(Number))].filter(Number.isInteger).sort((a, b) => a - b) : [];
    const options = Array.isArray(input.options) ? input.options.map(option => ({ key: token(option.key, 'option key', 20), label: token(option.label, 'option label', 200) })) : [];
    const request = {
      operation: 'create_decision', taskId: positiveInteger(input.taskId, 'task id'),
      expectedTaskVersion: positiveInteger(input.expectedTaskVersion, 'expected task version'), affectedItemIds,
      question: token(input.question, 'question', 1000), recommendedOption: token(input.recommendedOption, 'recommended option', 20), options
    };
    if (!options.length || !options.some(option => option.key === request.recommendedOption)) throw new Error('recommended option must exist');
    return command(input.idempotencyKey, request, (key) => {
      const task = db.prepare('SELECT * FROM matrix_tasks WHERE id=?').get(request.taskId);
      if (!task) throw new Error('task not found');
      if (task.version !== request.expectedTaskVersion) throw new Error('stale task version');
      const boundItemIds = parse(task.bindings_json, {}).itemIds || [];
      if (request.affectedItemIds.some(id => !boundItemIds.map(Number).includes(id))) throw new Error('affected item outside task binding');
      const createdAt = nowIso(clock);
      const bindingId = `mdb_${hash({ taskId: task.id, key }).slice(0, 32)}`;
      const info = db.prepare(`INSERT INTO matrix_decisions (task_id,binding_id,affected_item_ids_json,question,recommended_option,options_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(task.id, bindingId, canonicalJson(request.affectedItemIds), request.question, request.recommendedOption, canonicalJson(options), createdAt, createdAt);
      db.prepare("UPDATE matrix_tasks SET state='waiting_decision',version=version+1,updated_at=? WHERE id=? AND version=?").run(createdAt, task.id, task.version);
      const updatedTask = db.prepare('SELECT * FROM matrix_tasks WHERE id=?').get(task.id);
      const decision = db.prepare('SELECT * FROM matrix_decisions WHERE id=?').get(info.lastInsertRowid);
      appendTaskEvent(updatedTask, 'decision_created', { decisionId: decision.id }, null, {}, `${key}:task`);
      db.prepare(`INSERT INTO matrix_decision_events (decision_id,decision_version,event_type,payload_json,actor_user_id,idempotency_key,created_at) VALUES (?,1,'created',?,NULL,?,?)`)
        .run(decision.id, canonicalJson(request), `${key}:decision`, createdAt);
      return { kind: 'created', decision: decisionResult(decision), task: taskResult(updatedTask) };
    });
  }

  function resumeDependents(blockingTaskId, timestamp, actorUserId, idempotencyKey) {
    const dependencies = db.prepare("SELECT * FROM matrix_task_dependencies WHERE blocking_task_id=? AND state='active' ORDER BY id").all(blockingTaskId);
    const resumedTaskIds = [];
    for (const dependency of dependencies) {
      const blocked = db.prepare('SELECT * FROM matrix_tasks WHERE id=?').get(dependency.blocked_task_id);
      if (!blocked) throw new Error('dependent task missing');
      db.prepare("UPDATE matrix_task_dependencies SET state='resolved',resolved_at=? WHERE id=? AND state='active'").run(timestamp, dependency.id);
      db.prepare("UPDATE matrix_tasks SET state='open',version=version+1,blocker='',next_action=?,updated_at=? WHERE id=?")
        .run(dependency.resume_action, timestamp, blocked.id);
      const resumed = db.prepare('SELECT * FROM matrix_tasks WHERE id=?').get(blocked.id);
      appendTaskEvent(resumed, 'dependency_resumed', { blockingTaskId, dependencyId: dependency.id }, actorUserId, {}, `${idempotencyKey}:resume:${dependency.id}`);
      resumedTaskIds.push(blocked.id);
    }
    return resumedTaskIds;
  }

  function resolveDecision(input = {}) {
    const request = {
      operation: 'resolve_decision', decisionId: positiveInteger(input.decisionId, 'decision id'),
      expectedDecisionVersion: positiveInteger(input.expectedDecisionVersion, 'expected decision version'),
      option: token(input.option, 'option', 20), actorUserId: positiveInteger(input.actorUserId, 'actor user id'),
      bindingId: token(input.bindingId, 'binding id', 100), channel: token(input.channel, 'channel', 20),
      chatId: token(input.chatId, 'chat id', 200), cardEventId: token(input.cardEventId, 'card event id', 200)
    };
    return command(input.idempotencyKey, request, (key) => {
      const decision = db.prepare('SELECT * FROM matrix_decisions WHERE id=?').get(request.decisionId);
      if (!decision) throw new Error('decision not found');
      if (decision.version !== request.expectedDecisionVersion || decision.state !== 'pending') throw new Error('stale decision version');
      if (decision.binding_id !== request.bindingId) throw new Error('decision binding mismatch');
      const task = db.prepare('SELECT * FROM matrix_tasks WHERE id=?').get(decision.task_id);
      if (!task || task.channel !== request.channel) throw new Error('decision channel mismatch');
      const options = parse(decision.options_json, []);
      if (!options.some(option => option.key === request.option)) throw new Error('invalid decision option');
      const timestamp = nowIso(clock);
      db.prepare(`UPDATE matrix_decisions SET state='resolved',version=version+1,selected_option=?,resolved_by=?,resolved_at=?,updated_at=? WHERE id=? AND version=?`)
        .run(request.option, request.actorUserId, timestamp, timestamp, decision.id, decision.version);
      db.prepare("UPDATE matrix_tasks SET state='completed',version=version+1,updated_at=? WHERE id=?").run(timestamp, task.id);
      const updatedDecision = db.prepare('SELECT * FROM matrix_decisions WHERE id=?').get(decision.id);
      const updatedTask = db.prepare('SELECT * FROM matrix_tasks WHERE id=?').get(task.id);
      db.prepare(`INSERT INTO matrix_decision_events (decision_id,decision_version,event_type,payload_json,actor_user_id,idempotency_key,created_at) VALUES (?,?, 'resolved',?,?,?,?)`)
        .run(updatedDecision.id, updatedDecision.version, canonicalJson(request), request.actorUserId, `${key}:decision`, timestamp);
      appendTaskEvent(updatedTask, 'decision_resolved', { decisionId: decision.id, option: request.option }, request.actorUserId, request, `${key}:task`);
      const resumedTaskIds = resumeDependents(task.id, timestamp, request.actorUserId, key);
      return { decision: decisionResult(updatedDecision), task: taskResult(updatedTask), resumedTaskIds };
    });
  }

  function linkDependency(input = {}) {
    const request = {
      operation: 'link_dependency', blockedTaskId: positiveInteger(input.blockedTaskId, 'blocked task id'),
      blockingTaskId: positiveInteger(input.blockingTaskId, 'blocking task id'), resumeAction: token(input.resumeAction, 'resume action', 500)
    };
    if (request.blockedTaskId === request.blockingTaskId) throw new Error('task cannot depend on itself');
    return command(input.idempotencyKey, request, (key) => {
      const blocked = db.prepare('SELECT * FROM matrix_tasks WHERE id=?').get(request.blockedTaskId);
      const blocking = db.prepare('SELECT * FROM matrix_tasks WHERE id=?').get(request.blockingTaskId);
      if (!blocked || !blocking) throw new Error('dependency task not found');
      const createdAt = nowIso(clock);
      const info = db.prepare(`INSERT INTO matrix_task_dependencies (blocked_task_id,blocking_task_id,resume_action,idempotency_key,created_at) VALUES (?,?,?,?,?)`)
        .run(blocked.id, blocking.id, request.resumeAction, key, createdAt);
      db.prepare("UPDATE matrix_tasks SET state='blocked',version=version+1,blocker=?,updated_at=? WHERE id=?")
        .run(`task:${blocking.id}`, createdAt, blocked.id);
      const updated = db.prepare('SELECT * FROM matrix_tasks WHERE id=?').get(blocked.id);
      appendTaskEvent(updated, 'dependency_linked', request, null, {}, `${key}:event`);
      return { id: info.lastInsertRowid, ...request, state: 'active', createdAt };
    });
  }

  function consumeMigrationProjection(projection = {}, options = {}) {
    if (projection.status !== 'needs_migration_review') throw new Error('migration review projection required');
    return ensureTask({
      taskType: 'migration_review', ownerRole: options.ownerRole, channel: options.channel,
      dueAt: options.dueAt || nowIso(clock), bindings: { projection }, blocker: projection.reason || 'legacy_binding',
      nextAction: 'Review and bind the legacy record to one exact item', evidenceIds: [], idempotencyKey: options.idempotencyKey
    });
  }

  function createReviewTask(input = {}) {
    return ensureTask({
      taskType: input.kind || 'identity_review', ownerRole: 'foreign_trade_crm_admin', channel: 'bill',
      dueAt: input.createdAt || nowIso(clock), bindings: { sourceEventId: input.sourceEventId, candidates: input.candidates },
      blocker: 'identity_ambiguous', nextAction: 'Select the exact organization record', evidenceIds: [], idempotencyKey: input.idempotencyKey
    });
  }

  return { ensureTask, transition, createDecision, resolveDecision, linkDependency, consumeMigrationProjection, createReviewTask, getTask, getDecision };
}

module.exports = { createMatrixTaskSupervisor };

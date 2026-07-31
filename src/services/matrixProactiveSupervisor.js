'use strict';

const crypto = require('node:crypto');
const { buildMatrixOverview } = require('./matrixOverview');

function iso(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} invalid`);
  return date.toISOString();
}

function text(value) {
  return String(value == null ? '' : value).trim();
}

function localDate(isoValue, timeZone = 'Asia/Shanghai') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(isoValue));
}

function digestId(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
}

function priorityValue(value) {
  return ({ urgent: 5, high: 4, P0: 4, P1: 3, normal: 2, P2: 2, low: 1, P3: 1 })[text(value)] || 0;
}

function createMatrixProactiveSupervisor({
  db,
  clock = () => new Date(),
  backlogItems = () => []
} = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('database required');

  function dueTasks(now) {
    return db.prepare(`
      SELECT t.id,t.canonical_customer_id,t.task_type,t.due_at,t.state,t.priority,t.next_action,
             COALESCE(NULLIF(c.company_name,''),NULLIF(c.name,''),'') AS company_name,
             COALESCE(c.country,'') AS country_code
      FROM matrix_tasks t
      JOIN customers c ON c.id=t.canonical_customer_id
      WHERE t.state IN ('pending','blocked') AND datetime(t.due_at) <= datetime(?)
      ORDER BY datetime(t.due_at), t.id
      LIMIT 100
    `).all(now);
  }

  function prepare() {
    const generatedAt = iso(clock(), 'supervisor clock');
    const date = localDate(generatedAt);
    const overview = buildMatrixOverview(db, { backlogItems: backlogItems() });
    const tasks = dueTasks(generatedAt);
    const salesStates = new Set(['awaiting_our_reply', 'first_contact_unanswered', 'outreach_waiting']);
    const costingStates = new Set(['quote_required', 'quote_in_progress']);
    const sales = overview.items.filter(item => salesStates.has(item.state)).map(item => ({
      kind: 'thread',
      priority: text(item.priority || 'C'),
      customer: text(item.customer_name || '待关联客户'),
      state: text(item.state),
      summary_cn: text(item.summary_cn),
      next_action_cn: text(item.next_action_cn || item.next_actions?.[0])
    }));
    const costing = overview.items.filter(item => costingStates.has(item.state)).map(item => ({
      kind: 'quote',
      priority: text(item.priority || 'C'),
      customer: text(item.customer_name || '待关联客户'),
      state: text(item.state),
      summary_cn: text(item.summary_cn),
      next_action_cn: text(item.next_action_cn || item.next_actions?.[0])
    }));
    for (const task of tasks) {
      const target = /(?:quote|cost|pricing)/i.test(task.task_type) ? costing : sales;
      target.push({
        kind: 'task',
        priority: text(task.priority),
        customer: text(task.company_name),
        state: task.state === 'blocked' ? 'blocked' : 'overdue',
        summary_cn: `${text(task.task_type)}｜截止 ${text(task.due_at)}`,
        next_action_cn: text(task.next_action)
      });
    }
    const rank = rows => rows.sort((a, b) => priorityValue(b.priority) - priorityValue(a.priority)
      || a.customer.localeCompare(b.customer)).slice(0, 12);
    const channels = [
      { channel: 'bill', title: `${date} 每日推进总览`, items: rank(sales) },
      { channel: 'vmci', title: `${date} 技术进度总览`, items: rank(costing) }
    ].map(row => ({
      ...row,
      counts: {
        actionable: row.items.length,
        blocked: row.items.filter(item => item.state === 'blocked').length,
        overdue: row.items.filter(item => item.state === 'overdue').length
      }
    }));
    const payload = { date, generated_at: generatedAt, channels };
    return { ...payload, digest_id: digestId(payload) };
  }

  return { prepare };
}

module.exports = { createMatrixProactiveSupervisor, digestId, localDate };

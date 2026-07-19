#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = '/refs/cache-index.db';
const STATE_PATH = '/workspace/store/stream-watch-state.json';
const SUPERVISOR_BACKLOG_PATH = '/workspace/outputs/matrix-supervisor-backlog.json';
const APP_ID = process.env.STREAM_APP_ID || '';
const ORDER_PROJECT = process.env.STREAM_ORDER_PROJECT || 'vm_debug_ci';
const BRIDGE_ROOT = process.env.FEISHU_CODEX_BRIDGE_HOME || '/home/node/.feishu-codex-bridge';
const POLL_MS = Math.max(60000, Number(process.env.STREAM_POLL_MS || 3600000));
const DAY_START_HOUR = Number(process.env.STREAM_DAY_START_HOUR || 8);
const DAY_END_HOUR = Number(process.env.STREAM_DAY_END_HOUR || 20);
const SUMMARY_HOUR = Number(process.env.STREAM_SUMMARY_HOUR || 17);
const SUMMARY_MINUTE = Number(process.env.STREAM_SUMMARY_MINUTE || 40);
const WEEKLY_DAY = Number(process.env.STREAM_WEEKLY_DAY || 1);
const WEEKLY_HOUR = Number(process.env.STREAM_WEEKLY_HOUR || 8);
const WEEKLY_MINUTE = Number(process.env.STREAM_WEEKLY_MINUTE || 20);
const BASE_URL = 'https://open.feishu.cn/open-apis';

function resolveOrderChatId({
  explicitChatId = '',
  appId = APP_ID,
  projectName = ORDER_PROJECT,
  bridgeRoot = BRIDGE_ROOT
} = {}) {
  if (explicitChatId) return explicitChatId;
  if (!appId) throw new Error('STREAM_APP_ID is required');
  if (!projectName) throw new Error('STREAM_ORDER_PROJECT is required');

  const projectsPath = path.join(bridgeRoot, 'bots', appId, 'projects.json');
  const parsed = JSON.parse(fs.readFileSync(projectsPath, 'utf8'));
  const projects = Array.isArray(parsed) ? parsed : parsed.projects;
  if (!Array.isArray(projects)) throw new Error('invalid bot projects registry');

  const matches = projects.filter(project => project?.name === projectName && project?.chatId);
  if (matches.length === 0) throw new Error(`order project not found: ${projectName}`);
  if (matches.length > 1) throw new Error(`multiple order projects found: ${projectName}`);
  return matches[0].chatId;
}

let cachedOrderChatId = '';
function orderChatId() {
  if (!cachedOrderChatId) {
    cachedOrderChatId = resolveOrderChatId({ explicitChatId: process.env.STREAM_ORDER_CHAT_ID || '' });
  }
  return cachedOrderChatId;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = (level, message, detail = '') => {
  const suffix = detail ? ` ${detail}` : '';
  process.stdout.write(`[stream-watch] ${new Date().toISOString()} ${level} ${message}${suffix}\n`);
};

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return {
      statuses: parsed.statuses || {},
      last_work_order_id: Number(parsed.last_work_order_id || 0),
      last_summary_date: parsed.last_summary_date || null,
      last_week_summary_key: parsed.last_week_summary_key || null,
      initialized_at: parsed.initialized_at || null
    };
  } catch {
    return {
      statuses: {}, last_work_order_id: 0, last_summary_date: null,
      last_week_summary_key: null, initialized_at: null
    };
  }
}

function saveState(state) {
  const temp = `${STATE_PATH}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state));
  fs.renameSync(temp, STATE_PATH);
}

function readSecret() {
  const id = `app-${APP_ID}`;
  const output = execFileSync('feishu-codex-bridge', ['secrets', 'get'], {
    input: JSON.stringify({ ids: [id] }),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const parsed = JSON.parse(output);
  const value = parsed.values?.[id];
  if (!value) throw new Error('app secret unavailable');
  return value;
}

async function tenantToken() {
  const response = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: readSecret() })
  });
  const body = await response.json();
  if (!response.ok || body.code !== 0 || !body.tenant_access_token) {
    throw new Error(`token request failed: ${body.code || response.status} ${body.msg || ''}`.trim());
  }
  return body.tenant_access_token;
}

function text(value) {
  return String(value == null || value === '' ? '-' : value);
}

function cardFor(order, previousStatus) {
  const urgent = Number(order.urgency || 0) === 1;
  const statusLine = `${text(previousStatus)}  ->  ${text(order.status)}`;
  const worker = order.status === '印刷' ? order.assigned_print_worker
    : order.status === '复膜' ? order.assigned_lamination_worker
      : order.status === '制袋' ? order.assigned_bagging_worker
        : order.status === '发货' ? order.assigned_shipping_worker : '';
  return {
    config: { wide_screen_mode: true },
    header: {
      template: urgent ? 'red' : order.status === '完成' ? 'green' : 'blue',
      title: { tag: 'plain_text', content: `${urgent ? '【加急】' : ''}订单状态变更` }
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `**${statusLine}**` } },
      {
        tag: 'div',
        fields: [
          { is_short: true, text: { tag: 'lark_md', content: `**订单编号**\n#${text(order.id)}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**客户**\n${text(order.customer_name)}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**品类**\n${text(order.bag_type)}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**数量**\n${text(order.order_qty)}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**规格**\n${text(order.order_spec)}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**当前负责人**\n${text(worker)}` } }
        ]
      },
      { tag: 'hr' },
      { tag: 'note', elements: [{ tag: 'plain_text', content: `更新时间：${text(order.updated_at)}` }] }
    ]
  };
}

function workCardFor(row) {
  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'turquoise',
      title: { tag: 'plain_text', content: '新开单' }
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `**${text(row.work_no)}｜${text(row.product_name)}**` } },
      {
        tag: 'div',
        fields: [
          { is_short: true, text: { tag: 'lark_md', content: `**客户**\n${text(row.customer_name)}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**业务员**\n${text(row.salesperson_name)}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**袋型**\n${text(row.bag_type)}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**数量**\n${text(row.quantity)}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**规格**\n${text(row.spec)}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**交期**\n${text(row.delivery_date)}` } }
        ]
      },
      { tag: 'hr' },
      { tag: 'note', elements: [{ tag: 'plain_text', content: `创建人：${text(row.created_by)}｜创建时间：${text(row.created_at)}` }] }
    ]
  };
}

function summaryCardFor(summary) {
  const stageLine = summary.stage_counts.length
    ? summary.stage_counts.map(row => `${row.status} ${row.total}`).join('｜')
    : '暂无在制订单';
  const transitionLine = summary.transition_counts.length
    ? summary.transition_counts.map(row => `${row.stage} ${row.total}次`).join('｜')
    : '今日无工序完成记录';
  const changedList = summary.changed_orders.length
    ? summary.changed_orders.map(row => `• #${row.id} ${text(row.customer_name)}：${text(row.status)}`).join('\n')
    : '• 今日无状态变化订单';
  const newWorkList = summary.new_work_orders.length
    ? summary.new_work_orders.map(row => `• ${text(row.work_no)} ${text(row.customer_name)}｜${text(row.product_name)}`).join('\n')
    : '• 今日无新开单';
  const supervisorList = (summary.supervisor_items || []).length
    ? summary.supervisor_items.slice(0, 3).map(row => `• ${text(row.priority)}｜${text(row.company)}｜${text(row.state)}\n  下一步：${text((row.next_actions || [])[0])}`).join('\n')
    : '• 当前没有登记的P0/P1主管待办';

  return {
    config: { wide_screen_mode: true },
    header: {
      template: summary.urgent_active > 0 || summary.stale_active > 0 ? 'orange' : 'green',
      title: { tag: 'plain_text', content: `${summary.date} 今日生产摘要` }
    },
    elements: [
      {
        tag: 'div',
        fields: [
          { is_short: true, text: { tag: 'lark_md', content: `**今日新订单**\n${summary.new_orders}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**今日新开单**\n${summary.new_work_order_count}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**状态推进**\n${summary.advances}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**今日完成**\n${summary.completed}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**当前加急在制**\n${summary.urgent_active}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**停滞超过3天**\n${summary.stale_active}` } }
        ]
      },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: `**当前工序分布**\n${stageLine}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**今日完成工序**\n${transitionLine}${summary.rollbacks ? `｜回退 ${summary.rollbacks}次` : ''}` } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: `**今日有变化的订单（最多10条）**\n${changedList}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**今日新开单（最多10条）**\n${newWorkList}` } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: `**主管待办（P0/P1）**\n${supervisorList}` } },
      { tag: 'note', elements: [{ tag: 'plain_text', content: '数据截至北京时间17:40；统计来源：订单系统数据库。' }] }
    ]
  };
}

function weeklyCardFor(summary) {
  const stageLine = summary.stage_counts.length
    ? summary.stage_counts.map(row => `${row.stage} ${row.total}次`).join('｜')
    : '上周无工序完成记录';
  const salespersonLine = summary.salesperson_counts.length
    ? summary.salesperson_counts.map(row => `${text(row.salesperson_name)} ${row.total}单`).join('｜')
    : '上周无业务员开单记录';
  const completedList = summary.recent_completed.length
    ? summary.recent_completed.map(row => `• #${row.id} ${text(row.customer_name)}｜${text(row.bag_type)}`).join('\n')
    : '• 上周无完成订单';

  return {
    config: { wide_screen_mode: true },
    header: {
      template: summary.rollbacks > 0 || summary.stale_active > 0 ? 'orange' : 'green',
      title: { tag: 'plain_text', content: `${summary.start_date} 至 ${summary.end_date} 周经营摘要` }
    },
    elements: [
      {
        tag: 'div',
        fields: [
          { is_short: true, text: { tag: 'lark_md', content: `**新增订单**\n${summary.new_orders}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**新增开单**\n${summary.new_work_orders}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**完成订单**\n${summary.completed}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**状态推进**\n${summary.advances}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**平均生产周期**\n${summary.avg_cycle_days == null ? '-' : `${summary.avg_cycle_days}天`}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**工序回退**\n${summary.rollbacks}` } }
        ]
      },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: `**上周工序完成量**\n${stageLine}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**业务员开单分布**\n${salespersonLine}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**当前生产风险**\n加急在制 ${summary.urgent_active}单｜停滞超过3天 ${summary.stale_active}单` } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: `**最近完成订单（最多10条）**\n${completedList}` } },
      { tag: 'note', elements: [{ tag: 'plain_text', content: '统计周期为上周一00:00至本周一00:00；数据来源：订单系统数据库。' }] }
    ]
  };
}

async function sendInteractiveCard(card) {
  const token = await tenantToken();
  const response = await fetch(`${BASE_URL}/im/v1/messages?receive_id_type=chat_id`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify({
      receive_id: orderChatId(),
      msg_type: 'interactive',
      content: JSON.stringify(card)
    })
  });
  const body = await response.json();
  if (!response.ok || body.code !== 0) {
    throw new Error(`message send failed: ${body.code || response.status} ${body.msg || ''}`.trim());
  }
}

async function sendTextMessage(content) {
  const message = String(content || '').trim();
  if (!message) throw new Error('message content required');
  const token = await tenantToken();
  const response = await fetch(`${BASE_URL}/im/v1/messages?receive_id_type=chat_id`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ receive_id: orderChatId(), msg_type: 'text', content: JSON.stringify({ text: message }) })
  });
  const body = await response.json();
  if (!response.ok || body.code !== 0) throw new Error(`text message send failed: ${body.code || response.status} ${body.msg || ''}`.trim());
  return body.data?.message_id || '';
}

const sendOrderCard = (order, previousStatus) => sendInteractiveCard(cardFor(order, previousStatus));
const sendWorkCard = row => sendInteractiveCard(workCardFor(row));
const sendSummaryCard = summary => sendInteractiveCard(summaryCardFor(summary));
const sendWeeklyCard = summary => sendInteractiveCard(weeklyCardFor(summary));

function readOrders(db) {
  return db.prepare(`
    SELECT id, customer_name, bag_type, order_qty, order_spec, status, urgency,
           assigned_print_worker, assigned_lamination_worker,
           assigned_bagging_worker, assigned_shipping_worker, updated_at
    FROM orders
  `).all();
}

function latestWorkOrderId(db) {
  return Number(db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM work_orders').get()?.id || 0);
}

function readNewWorkOrders(db, afterId) {
  return db.prepare(`
    SELECT id, work_no, salesperson_name, customer_name, product_name, bag_type,
           spec, quantity, delivery_date, created_by, created_at
    FROM work_orders
    WHERE id > ?
    ORDER BY id ASC
  `).all(afterId);
}

function shanghaiHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false
  }).format(now));
}

function isDaytime() {
  const hour = shanghaiHour();
  return hour >= DAY_START_HOUR && hour < DAY_END_HOUR;
}

function shanghaiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function previousWeekRange(now = new Date()) {
  const today = shanghaiDate(now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const thisMonday = addDate(today, -daysSinceMonday);
  const start = addDate(thisMonday, -7);
  const endExclusive = thisMonday;
  return { start, end_exclusive: endExclusive, end_date: addDate(endExclusive, -1), key: start };
}

function buildDailySummary(db, date) {
  const scalar = (sql, ...params) => Number(db.prepare(sql).get(...params)?.total || 0);
  const newOrders = scalar("SELECT COUNT(*) AS total FROM orders WHERE substr(created_at,1,10)=?", date);
  const newWorkOrderCount = scalar("SELECT COUNT(*) AS total FROM work_orders WHERE substr(created_at,1,10)=?", date);
  const advances = scalar("SELECT COUNT(*) AS total FROM audit_logs WHERE action='advance_order_status' AND substr(created_at,1,10)=?", date);
  const rollbacks = scalar("SELECT COUNT(*) AS total FROM audit_logs WHERE action='rollback_order_stage_complete' AND substr(created_at,1,10)=?", date);
  const completed = scalar("SELECT COUNT(*) AS total FROM audit_logs WHERE action='advance_order_status' AND detail LIKE '%-> 完成%' AND substr(created_at,1,10)=?", date);
  const urgentActive = scalar("SELECT COUNT(*) AS total FROM orders WHERE urgency=1 AND status<>'完成'");
  const staleActive = scalar("SELECT COUNT(*) AS total FROM orders WHERE status<>'完成' AND datetime(updated_at)<datetime('now','-3 day')");
  const stageCounts = db.prepare("SELECT status, COUNT(*) AS total FROM orders WHERE status<>'完成' GROUP BY status ORDER BY total DESC").all();
  const transitionCounts = db.prepare(`
    SELECT stage, COUNT(*) AS total
    FROM order_stage_logs
    WHERE event_type='COMPLETE' AND rolled_back=0 AND substr(created_at,1,10)=?
    GROUP BY stage ORDER BY total DESC
  `).all(date);
  const changedOrders = db.prepare(`
    SELECT o.id, o.customer_name, o.status, MAX(a.created_at) AS changed_at
    FROM audit_logs a JOIN orders o ON o.id=CAST(a.resource_id AS INTEGER)
    WHERE a.resource_type='order'
      AND a.action IN ('advance_order_status','rollback_order_stage_complete','edit_order','edit_order_full')
      AND substr(a.created_at,1,10)=?
    GROUP BY o.id, o.customer_name, o.status
    ORDER BY changed_at DESC LIMIT 10
  `).all(date);
  const newWorkOrders = db.prepare(`
    SELECT work_no, customer_name, product_name
    FROM work_orders WHERE substr(created_at,1,10)=?
    ORDER BY id DESC LIMIT 10
  `).all(date);
  let supervisorItems = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(SUPERVISOR_BACKLOG_PATH, 'utf8'));
    supervisorItems = (Array.isArray(parsed.items) ? parsed.items : []).filter(row => row && ['P0', 'P1'].includes(String(row.priority)));
  } catch (error) {
    if (error?.code !== 'ENOENT') log('error', `supervisor backlog unavailable: ${error.message}`);
  }
  return {
    date,
    new_orders: newOrders,
    new_work_order_count: newWorkOrderCount,
    advances,
    rollbacks,
    completed,
    urgent_active: urgentActive,
    stale_active: staleActive,
    stage_counts: stageCounts,
    transition_counts: transitionCounts,
    changed_orders: changedOrders,
    new_work_orders: newWorkOrders,
    supervisor_items: supervisorItems
  };
}

function buildWeeklySummary(db, range) {
  const scalar = (sql, ...params) => Number(db.prepare(sql).get(...params)?.total || 0);
  const between = 'substr(created_at,1,10)>=? AND substr(created_at,1,10)<?';
  const newOrders = scalar(`SELECT COUNT(*) AS total FROM orders WHERE ${between}`, range.start, range.end_exclusive);
  const newWorkOrders = scalar(`SELECT COUNT(*) AS total FROM work_orders WHERE ${between}`, range.start, range.end_exclusive);
  const advances = scalar(`SELECT COUNT(*) AS total FROM audit_logs WHERE action='advance_order_status' AND ${between}`, range.start, range.end_exclusive);
  const rollbacks = scalar(`SELECT COUNT(*) AS total FROM audit_logs WHERE action='rollback_order_stage_complete' AND ${between}`, range.start, range.end_exclusive);
  const completed = scalar(`SELECT COUNT(*) AS total FROM audit_logs WHERE action='advance_order_status' AND detail LIKE '%-> 完成%' AND ${between}`, range.start, range.end_exclusive);
  const cycle = db.prepare(`
    SELECT ROUND(AVG(julianday(a.created_at)-julianday(COALESCE(o.start_time,o.created_at))),1) AS days
    FROM audit_logs a JOIN orders o ON o.id=CAST(a.resource_id AS INTEGER)
    WHERE a.action='advance_order_status' AND a.detail LIKE '%-> 完成%'
      AND substr(a.created_at,1,10)>=? AND substr(a.created_at,1,10)<?
  `).get(range.start, range.end_exclusive);
  const stageCounts = db.prepare(`
    SELECT stage, COUNT(*) AS total FROM order_stage_logs
    WHERE event_type='COMPLETE' AND rolled_back=0
      AND substr(created_at,1,10)>=? AND substr(created_at,1,10)<?
    GROUP BY stage ORDER BY total DESC
  `).all(range.start, range.end_exclusive);
  const salespersonCounts = db.prepare(`
    SELECT salesperson_name, COUNT(*) AS total FROM work_orders
    WHERE substr(created_at,1,10)>=? AND substr(created_at,1,10)<?
    GROUP BY salesperson_name ORDER BY total DESC LIMIT 8
  `).all(range.start, range.end_exclusive);
  const recentCompleted = db.prepare(`
    SELECT o.id, o.customer_name, o.bag_type, MAX(a.created_at) AS completed_at
    FROM audit_logs a JOIN orders o ON o.id=CAST(a.resource_id AS INTEGER)
    WHERE a.action='advance_order_status' AND a.detail LIKE '%-> 完成%'
      AND substr(a.created_at,1,10)>=? AND substr(a.created_at,1,10)<?
    GROUP BY o.id, o.customer_name, o.bag_type
    ORDER BY completed_at DESC LIMIT 10
  `).all(range.start, range.end_exclusive);
  return {
    start_date: range.start,
    end_date: range.end_date,
    key: range.key,
    new_orders: newOrders,
    new_work_orders: newWorkOrders,
    advances,
    rollbacks,
    completed,
    avg_cycle_days: cycle?.days == null ? null : Number(cycle.days),
    urgent_active: scalar("SELECT COUNT(*) AS total FROM orders WHERE urgency=1 AND status<>'完成'"),
    stale_active: scalar("SELECT COUNT(*) AS total FROM orders WHERE status<>'完成' AND datetime(updated_at)<datetime('now','-3 day')"),
    stage_counts: stageCounts,
    salesperson_counts: salespersonCounts,
    recent_completed: recentCompleted
  };
}

function msUntilSummary(state) {
  const now = new Date();
  const date = shanghaiDate(now);
  const shanghaiNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const targetPassed = shanghaiNow.getHours() > SUMMARY_HOUR
    || (shanghaiNow.getHours() === SUMMARY_HOUR && shanghaiNow.getMinutes() >= SUMMARY_MINUTE);
  if (targetPassed && state.last_summary_date !== date) return 1000;
  const target = new Date(shanghaiNow);
  target.setHours(SUMMARY_HOUR, SUMMARY_MINUTE, 0, 0);
  if (target <= shanghaiNow) target.setDate(target.getDate() + 1);
  return Math.max(1000, target.getTime() - shanghaiNow.getTime());
}

async function summaryLoop(db, state) {
  while (true) {
    await sleep(msUntilSummary(state));
    const date = shanghaiDate();
    if (state.last_summary_date === date) continue;
    try {
      const summary = buildDailySummary(db, date);
      await sendSummaryCard(summary);
      state.last_summary_date = date;
      saveState(state);
      log('info', `daily summary sent for ${date}`);
    } catch (error) {
      log('error', `daily summary failed: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(300000);
    }
  }
}

function msUntilWeekly(state) {
  const now = new Date();
  const shanghaiNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const range = previousWeekRange(now);
  const isTargetDay = shanghaiNow.getDay() === WEEKLY_DAY;
  const targetPassed = shanghaiNow.getHours() > WEEKLY_HOUR
    || (shanghaiNow.getHours() === WEEKLY_HOUR && shanghaiNow.getMinutes() >= WEEKLY_MINUTE);
  if (isTargetDay && targetPassed && state.last_week_summary_key !== range.key) return 1000;
  let daysAhead = (WEEKLY_DAY - shanghaiNow.getDay() + 7) % 7;
  if (daysAhead === 0 && targetPassed) daysAhead = 7;
  const target = new Date(shanghaiNow);
  target.setDate(target.getDate() + daysAhead);
  target.setHours(WEEKLY_HOUR, WEEKLY_MINUTE, 0, 0);
  return Math.max(1000, target.getTime() - shanghaiNow.getTime());
}

async function weeklyLoop(db, state) {
  while (true) {
    await sleep(msUntilWeekly(state));
    const range = previousWeekRange();
    if (state.last_week_summary_key === range.key) continue;
    try {
      const summary = buildWeeklySummary(db, range);
      await sendWeeklyCard(summary);
      state.last_week_summary_key = range.key;
      saveState(state);
      log('info', `weekly summary sent for ${range.start}..${range.end_date}`);
    } catch (error) {
      log('error', `weekly summary failed: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(300000);
    }
  }
}

async function main() {
  if (!APP_ID) throw new Error('STREAM_APP_ID is required');
  orderChatId();
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const state = loadState();
  const initial = readOrders(db);
  if (!state.initialized_at) {
    for (const order of initial) state.statuses[order.id] = order.status;
    state.last_work_order_id = latestWorkOrderId(db);
    state.initialized_at = new Date().toISOString();
    saveState(state);
    log('info', `baseline ready; ${initial.length} orders indexed; work order #${state.last_work_order_id}`);
  } else if (!state.last_work_order_id) {
    state.last_work_order_id = latestWorkOrderId(db);
    saveState(state);
    log('info', `work-order baseline ready at #${state.last_work_order_id}`);
  }

  void summaryLoop(db, state);
  void weeklyLoop(db, state);

  while (true) {
    if (!isDaytime()) {
      await sleep(POLL_MS);
      continue;
    }
    try {
      for (const order of readOrders(db)) {
        const previous = state.statuses[order.id];
        if (previous != null && previous !== order.status) {
          await sendOrderCard(order, previous);
          log('info', `notified order #${order.id}: ${previous} -> ${order.status}`);
        }
        state.statuses[order.id] = order.status;
      }
      for (const row of readNewWorkOrders(db, state.last_work_order_id)) {
        await sendWorkCard(row);
        state.last_work_order_id = Number(row.id);
        log('info', `notified work order #${row.id}: ${row.work_no}`);
      }
      saveState(state);
    } catch (error) {
      log('error', error instanceof Error ? error.message : String(error));
    }
    await sleep(POLL_MS);
  }
}

if (require.main === module) {
  main().catch(error => {
    log('fatal', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  resolveOrderChatId,
  sendInteractiveCard,
  sendTextMessage,
  summaryCardFor,
  cardFor,
  workCardFor,
  buildDailySummary
};

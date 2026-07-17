#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

const STATE_PATH = '/workspace/store/matrix-watch-state.json';
const REMINDER_SPOOL_PATH = '/workspace/store/matrix-reminder-pending.json';
const REMINDER_INFLIGHT_PATH = '/workspace/store/matrix-reminder-inflight.json';
const REMINDER_RECEIPT_PATH = '/workspace/store/matrix-reminder-receipt.json';
const QUALIFICATION_PATTERN = /(?:\b(?:ISO\s*\d*|GMP|HACCP|BRC|HALAL|SMETA|BSCI|FSSC|FDA|QS)\b|认证|资质|certificat)/i;

function shanghaiParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, hour: Number(values.hour), minute: Number(values.minute) };
}

function normalizedState(value) {
  return {
    ...(value?.last_success_date ? { last_success_date: String(value.last_success_date) } : {}),
    ...(value?.last_message_id ? { last_message_id: String(value.last_message_id) } : {})
  };
}

function loadState() {
  try { return normalizedState(JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))); }
  catch (_) { return {}; }
}

function saveState(state) {
  const clean = normalizedState(state);
  const temporary = `${STATE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(clean), { mode: 0o600 });
  fs.renameSync(temporary, STATE_PATH);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

function deliveryId(date, chatId) {
  const day = String(date || '');
  const chat = String(chatId || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !chat) throw new Error('valid reminder date and chat required');
  const bytes = crypto.createHash('sha256').update(`matrix-reminder\0${day}\0${chat}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function queueReminder(card, chatId, {
  date,
  spoolPath = REMINDER_SPOOL_PATH,
  inflightPath = REMINDER_INFLIGHT_PATH,
  receiptPath = REMINDER_RECEIPT_PATH
} = {}) {
  const targetChat = String(chatId || '').trim();
  if (!targetChat || !card || typeof card !== 'object' || Array.isArray(card)) throw new Error('valid reminder card and chat required');
  const id = deliveryId(date, targetChat);
  const receipt = readJson(receiptPath);
  const inflight = readJson(inflightPath);
  if (inflight) {
    if (receipt?.id !== inflight.id) throw new Error(`ambiguous reminder delivery ${inflight.id}; manual reconciliation required`);
    throw new Error(`previous reminder ${inflight.id} awaits inflight cleanup`);
  }
  if (receipt?.id === id) return id;
  const pending = readJson(spoolPath);
  if (pending?.id === id) return id;
  if (pending) throw new Error('previous reminder is still pending delivery');
  const temporary = `${spoolPath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, date, id, chat_id: targetChat, card, attempted_at: null })}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, spoolPath);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  return id;
}

function clip(value, maximum = 80) {
  const text = String(value == null || value === '' ? '待核实' : value).replace(/[\r\n]+/g, ' ').trim();
  const points = [...text];
  return points.length > maximum ? `${points.slice(0, maximum - 1).join('')}…` : text;
}

function stageLabel(value) {
  return ({ observed: '已观察', recommendation_ready: '推荐就绪', selected: '已选择', draft_pending: '草稿待处理', review_pending: '审核待处理', suppressed: '已抑制' })[value] || '待核实';
}

function confirmedSignals(values) {
  const signals = Array.isArray(values) ? values.map(value => String(value || '').trim()).filter(value => value && !QUALIFICATION_PATTERN.test(value)) : [];
  const isSpecification = value => /\d+(?:[.,]\d+)?\s*(?:μm|um|microns?|mm|cm|kg|mg|g|ml|cl|l|oz|lbs?|inches?|inch)\b/i.test(value)
    || /\d+(?:[.,]\d+)?\s*["”]/.test(value)
    || /\d+(?:[.,]\d+)?\s*[x×*]\s*\d+(?:[.,]\d+)?/i.test(value);
  return {
    specifications: signals.filter(isSpecification),
    observations: signals.filter(value => !isSpecification(value))
  };
}

function withoutQualification(value) {
  const segments = String(value || '').split(/[，,；;。]/).map(item => item.trim()).filter(Boolean);
  const visible = segments.filter(item => !QUALIFICATION_PATTERN.test(item));
  return visible.join('，') || '产品与规模依据见公开来源';
}

function supplierLabel(signal) {
  return ({ confirmed: '已确认', public_lead: '公开线索' })[signal?.confidence] || '未知';
}

function renderReminderContent(selected, budgets) {
  return selected.map((row, index) => {
    const signals = confirmedSignals(row.size_signals);
    return [
      `${String.fromCharCode(65 + index)}｜${clip(row.company_name, budgets.company)}｜${clip(row.country_code, 8)}｜${clip(row.priority, 4)}`,
      `推荐理由：${clip(withoutQualification(row.assessment_cn), budgets.reason)}`,
      `品类：${clip((row.categories || []).join('、'), budgets.categories)}`,
      `阶段：${stageLabel(row.stage_code)}`,
      `供应商：${supplierLabel(row.supplier_signal)}`,
      `切入策略：${clip(row.strategy_signal?.differentiation_angle || row.next_action_cn, budgets.strategy)}`,
      ...(signals.specifications.length ? [`已确认规格：${clip(signals.specifications.join('、'), budgets.specifications)}`] : []),
      ...(signals.observations.length ? [`已确认公开信号：${clip(signals.observations.join('、'), budgets.observations)}`] : []),
      `待核实：${signals.specifications.length ? '联系人角色' : '规格与联系人角色'}`,
      `下一步：${clip(row.next_action_cn, budgets.nextAction)}`
    ].join('\n');
  }).join('\n\n');
}

function boundedReminderContent(selected) {
  if (!selected.length) return '今日没有达到证据标准的候选';
  const maximumContentPoints = 1000;
  const budgets = { company: 36, reason: 64, categories: 42, strategy: 52, specifications: 30, observations: 30, nextAction: 45 };
  const minimums = { company: 14, reason: 16, categories: 8, strategy: 16, specifications: 8, observations: 8, nextAction: 16 };
  let content = renderReminderContent(selected, budgets);
  while ([...content].length > maximumContentPoints) {
    let changed = false;
    for (const key of ['observations', 'specifications', 'categories', 'reason', 'strategy', 'nextAction', 'company']) {
      if (budgets[key] > minimums[key]) {
        budgets[key] -= 1;
        changed = true;
      }
    }
    if (!changed) throw new Error('reminder card core fields exceed Unicode budget');
    content = renderReminderContent(selected, budgets);
  }
  return content;
}

function quickButton(index) {
  const letter = String.fromCharCode(65 + index);
  return {
    tag: 'button', text: { tag: 'plain_text', content: `查看 ${letter}` }, type: 'default',
    behaviors: [{ type: 'callback', value: { a: 'mx.quick', i: index } }]
  };
}

function quickActions(indexes) {
  return {
    tag: 'column_set', flex_mode: 'flow', horizontal_spacing: 'small',
    columns: indexes.map(index => ({ tag: 'column', width: 'auto', elements: [quickButton(index)] }))
  };
}

function reminderCard(rows) {
  const selected = (rows || []).slice(0, 5);
  const content = boundedReminderContent(selected);
  const quickRows = [[0, 1, 2], [3, 4]]
    .map(indexes => indexes.filter(index => index < selected.length))
    .filter(indexes => indexes.length)
    .map(quickActions);
  return {
    schema: '2.0',
    config: { update_multi: true },
    header: { template: selected.length ? 'blue' : 'grey', title: { tag: 'plain_text', content: '今日优先候选' } },
    body: { elements: [
      { tag: 'markdown', content },
      ...quickRows,
      ...(selected.length ? [{ tag: 'markdown', content: '也可 @智能桓 回复 A-E' }] : [])
    ] }
  };
}

async function runDue({ now = new Date(), state = {}, client, ownerOpenId, chatId, send, hour = 9, minute = 0 }) {
  if (!client || typeof client.today !== 'function') throw new Error('read-only matrix client required');
  if (!ownerOpenId || !chatId || typeof send !== 'function') throw new Error('watcher binding and sender required');
  const current = shanghaiParts(now);
  const clean = normalizedState(state);
  const passed = current.hour > hour || (current.hour === hour && current.minute >= minute);
  if (!passed || clean.last_success_date === current.date) return clean;
  const result = await client.today(ownerOpenId, { page_size: 5 });
  const messageId = await send(reminderCard((result.rows || []).slice(0, 5)), chatId, current.date);
  return { last_success_date: current.date, last_message_id: String(messageId || '') };
}

async function main() {
  const pollMs = Math.max(60000, Number(process.env.MATRIX_RECOMMEND_POLL_MS || 60000));
  if (String(process.env.MATRIX_DELIVERY_ENABLED || '0') !== '0') {
    throw new Error('watcher delivery capability is not installed');
  }
  const ownerOpenId = String(process.env.MATRIX_OWNER_OPEN_ID || '').trim();
  const chatId = String(process.env.STREAM_CHAT_ID || '').trim();
  if (!ownerOpenId || !chatId) throw new Error('watcher environment incomplete');
  const client = require('./matrix-client.js');
  const hour = Number(process.env.MATRIX_RECOMMEND_HOUR || 9);
  const minute = Number(process.env.MATRIX_RECOMMEND_MINUTE || 0);
  let state = loadState();
  while (true) {
    try {
      const next = await runDue({
        now: new Date(), state, client, ownerOpenId, chatId, hour, minute,
        send: (card, _chat, date) => queueReminder(card, chatId, { date })
      });
      if (next.last_success_date !== state.last_success_date) {
        state = next;
        saveState(state);
        process.stdout.write(`[matrix-watch] reminder queued for ${state.last_success_date}\n`);
      }
    } catch (error) {
      process.stderr.write(`[matrix-watch] reminder queue failed: ${error?.message || 'unknown error'}\n`);
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`[matrix-watch] fatal: ${error?.message || 'unknown error'}\n`);
  process.exit(1);
});

module.exports = { runDue, reminderCard, shanghaiParts, queueReminder, deliveryId };

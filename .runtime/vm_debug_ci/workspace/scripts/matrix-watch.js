#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const STATE_PATH = '/workspace/store/matrix-watch-state.json';
const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

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

function clip(value, maximum = 80) {
  const text = String(value == null || value === '' ? '待核实' : value).replace(/[\r\n]+/g, ' ').trim();
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}

function reminderCard(rows) {
  const selected = (rows || []).slice(0, 5);
  const content = selected.length
    ? selected.map((row, index) => `${String.fromCharCode(65 + index)}｜${clip(row.company_name, 42)}｜${clip(row.country_code, 8)}｜${clip(row.priority, 4)}\n推荐理由：${clip(row.assessment_cn, 90)}\n品类：${clip((row.categories || []).join('、'), 60)}\n下一步：${clip(row.next_action_cn, 70)}`).join('\n\n')
    : '今日没有达到证据标准的候选';
  return {
    schema: '2.0',
    config: { update_multi: true },
    header: { template: selected.length ? 'blue' : 'grey', title: { tag: 'plain_text', content: '每日候选提醒' } },
    body: { elements: [{ tag: 'markdown', content }] }
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
  const messageId = await send(reminderCard((result.rows || []).slice(0, 5)), chatId);
  return { last_success_date: current.date, last_message_id: String(messageId || '') };
}

function readSecret(appId) {
  const id = `app-${appId}`;
  const output = execFileSync('feishu-codex-bridge', ['secrets', 'get'], {
    input: JSON.stringify({ ids: [id] }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
  });
  const value = JSON.parse(output).values?.[id];
  if (!value) throw new Error('Feishu application secret unavailable');
  return value;
}

async function jsonCall(url, options) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
  const type = String(response.headers.get('content-type') || '');
  if (!type.includes('application/json')) throw new Error('Feishu API returned non-JSON response');
  const body = await response.json();
  if (!response.ok || body.code !== 0) throw new Error(`Feishu API request failed (${response.status})`);
  return body;
}

async function tenantToken(appId) {
  const body = await jsonCall(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: readSecret(appId) })
  });
  if (!body.tenant_access_token) throw new Error('Feishu tenant token unavailable');
  return body.tenant_access_token;
}

async function sendCard(appId, chatId, card) {
  const token = await tenantToken(appId);
  const body = await jsonCall(`${FEISHU_BASE}/im/v1/messages?receive_id_type=chat_id`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ receive_id: chatId, msg_type: 'interactive', content: JSON.stringify(card) })
  });
  return body.data?.message_id || '';
}

async function main() {
  const appId = String(process.env.STREAM_APP_ID || '');
  const chatId = String(process.env.STREAM_CHAT_ID || '');
  const ownerOpenId = String(process.env.MATRIX_OWNER_OPEN_ID || '');
  if (!appId || !chatId || !ownerOpenId) throw new Error('watcher environment incomplete');
  const client = require('./matrix-client.js');
  const hour = Number(process.env.MATRIX_RECOMMEND_HOUR || 9);
  const minute = Number(process.env.MATRIX_RECOMMEND_MINUTE || 0);
  const pollMs = Math.max(60000, Number(process.env.MATRIX_RECOMMEND_POLL_MS || 60000));
  let state = loadState();
  while (true) {
    try {
      const next = await runDue({ now: new Date(), state, client, ownerOpenId, chatId, hour, minute, send: card => sendCard(appId, chatId, card) });
      if (next.last_success_date !== state.last_success_date) {
        state = next;
        saveState(state);
        process.stdout.write(`[matrix-watch] reminder sent for ${state.last_success_date}\n`);
      }
    } catch (error) {
      process.stderr.write(`[matrix-watch] reminder failed: ${error?.message || 'unknown error'}\n`);
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`[matrix-watch] fatal: ${error?.message || 'unknown error'}\n`);
  process.exit(1);
});

module.exports = { runDue, reminderCard, shanghaiParts };

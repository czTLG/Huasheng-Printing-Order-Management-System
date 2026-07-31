#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STATE_ROOT = '/workspace/store/matrix-supervisor';
const DEFAULT_BRIDGE_ROOT = '/home/node/.feishu-codex-bridge';

function uuidFromSeed(value) {
  const hex = crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = '8';
  const normalized = hex.join('');
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`;
}

function safeName(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(text)) throw new Error('supervisor channel invalid');
  return text;
}

function resolveChatId({ bridgeRoot = DEFAULT_BRIDGE_ROOT, appId, target }) {
  const id = String(appId || '').trim();
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(id)) throw new Error('app id invalid');
  const channel = safeName(target);
  const payload = JSON.parse(fs.readFileSync(path.join(bridgeRoot, 'bots', id, 'projects.json'), 'utf8'));
  if (payload?.version !== 1 || !Array.isArray(payload.projects)) throw new Error('project mapping invalid');
  const exact = payload.projects.filter(item => String(item?.name || '').trim().toLowerCase() === channel && String(item?.chatId || '').trim());
  if (exact.length === 1) return String(exact[0].chatId);
  if (channel === 'bill' && exact.length === 0) {
    const legacy = payload.projects.filter(item => String(item?.name || '').trim().toLowerCase() === 'build' && String(item?.chatId || '').trim());
    if (legacy.length === 1) return String(legacy[0].chatId);
  }
  if (channel === 'vmci' && exact.length === 0) {
    const legacy = payload.projects.filter(item => String(item?.name || '').trim().toLowerCase() === 'vm_debug_ci' && String(item?.chatId || '').trim());
    if (legacy.length === 1) return String(legacy[0].chatId);
  }
  throw new Error(`${channel} project binding must be unique`);
}

function localParts(value, timeZone = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(value).reduce((out, item) => ({ ...out, [item.type]: item.value }), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function supervisorCard(channel) {
  const rows = channel.items.slice(0, 12).map((item, index) =>
    `${index + 1}. **${item.customer || '待关联客户'}**｜${item.priority || 'C'}｜${item.state}\n${item.summary_cn || '待整理'}\n下一步：${item.next_action_cn || '待确认'}`
  );
  return {
    schema: '2.0',
    config: { update_multi: true },
    header: { template: channel.channel === 'vmci' ? 'orange' : 'blue', title: { tag: 'plain_text', content: channel.title } },
    body: { elements: [
      { tag: 'markdown', content: `待推进 ${channel.counts.actionable}｜逾期 ${channel.counts.overdue}｜阻塞 ${channel.counts.blocked}` },
      { tag: 'markdown', content: rows.join('\n\n') || '今天暂无需要主动推进的事项。' }
    ] }
  };
}

function atomicReceipt(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(target), 0o700);
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
}

async function deliverDailyDigest({
  enabled = process.env.MATRIX_SUPERVISOR_ENABLED === '1',
  hour = Number(process.env.MATRIX_SUPERVISOR_HOUR || 9),
  timeZone = process.env.MATRIX_SUPERVISOR_TIMEZONE || 'Asia/Shanghai',
  stateRoot = DEFAULT_STATE_ROOT,
  bridgeRoot = DEFAULT_BRIDGE_ROOT,
  appId = process.env.STREAM_APP_ID,
  openId = process.env.MATRIX_OWNER_OPEN_ID,
  client,
  channel,
  sendManagedCard,
  clock = () => new Date()
} = {}) {
  if (!enabled) return { status: 'disabled' };
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('supervisor hour invalid');
  if (!client || typeof client.supervisorDigest !== 'function' || typeof sendManagedCard !== 'function') throw new Error('supervisor dependencies required');
  const now = clock();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('supervisor clock invalid');
  const local = localParts(now, timeZone);
  if (local.hour < hour) return { status: 'early', date: local.date };
  const completionPath = path.join(stateRoot, local.date, 'complete.json');
  if (fs.existsSync(completionPath)) return { status: 'delivered', date: local.date };
  const digest = await client.supervisorDigest(openId);
  if (digest.date !== local.date || !/^[a-f0-9]{32}$/.test(String(digest.digest_id || ''))) throw new Error('supervisor digest invalid');
  const results = [];
  for (const item of digest.channels || []) {
    const target = safeName(item.channel);
    if (!['bill', 'vmci'].includes(target) || !item.counts || !Array.isArray(item.items)) throw new Error('supervisor channel payload invalid');
    if (item.counts.actionable < 1) {
      results.push({ channel: target, status: 'empty' });
      continue;
    }
    const receiptPath = path.join(stateRoot, local.date, `${target}.json`);
    if (fs.existsSync(receiptPath)) {
      results.push({ channel: target, status: 'delivered' });
      continue;
    }
    const chatId = resolveChatId({ bridgeRoot, appId, target });
    const idempotencyKey = uuidFromSeed(`matrix-supervisor:${digest.digest_id}:${target}`);
    const sent = await sendManagedCard(channel, chatId, supervisorCard(item), '', false, 'chat_id', idempotencyKey);
    atomicReceipt(receiptPath, {
      version: 1, date: local.date, channel: target, digest_id: digest.digest_id,
      message_id: String(sent?.messageId || ''), delivered_at: now.toISOString()
    });
    results.push({ channel: target, status: 'delivered' });
  }
  atomicReceipt(completionPath, {
    version: 1, date: local.date, digest_id: digest.digest_id, completed_at: now.toISOString()
  });
  return { status: 'complete', date: local.date, results };
}

module.exports = { deliverDailyDigest, resolveChatId, localParts, supervisorCard, uuidFromSeed };

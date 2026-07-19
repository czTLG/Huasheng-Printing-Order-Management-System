#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SPOOL_ROOT = '/workspace/store/matrix-diagnostics';
const DEFAULT_BRIDGE_ROOT = '/home/node/.feishu-codex-bridge';
const KINDS = new Set(['disk_warning', 'disk_recovery', 'restart_warning', 'restart_recovery', 'service_warning', 'service_recovery']);

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} required`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label} fields invalid`);
}

function validateEvent(value) {
  exactKeys(value, ['version', 'id', 'kind', 'severity', 'component', 'observed', 'threshold', 'at', 'incident_started_at', 'next_action_cn'], 'event');
  if (value.version !== 1 || !/^[a-f0-9]{32}$/.test(String(value.id || '')) || !KINDS.has(value.kind)) throw new Error('event identity invalid');
  const expectedSeverity = value.kind.endsWith('_warning') ? 'warning' : 'recovery';
  if (value.severity !== expectedSeverity || !String(value.component || '').trim()) throw new Error('event binding invalid');
  if (!Number.isFinite(Date.parse(value.at)) || !Number.isFinite(Date.parse(value.incident_started_at))) throw new Error('event time invalid');
  if (!['number', 'string'].includes(typeof value.observed) || !['number', 'string'].includes(typeof value.threshold)) throw new Error('event metric invalid');
  if (!String(value.next_action_cn || '').trim() || String(value.next_action_cn).length > 240) throw new Error('event action invalid');
  return value;
}

function resolveBuildChatId({ bridgeRoot = DEFAULT_BRIDGE_ROOT, appId }) {
  const id = String(appId || '').trim();
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(id)) throw new Error('app id invalid');
  const target = path.join(bridgeRoot, 'bots', id, 'projects.json');
  const payload = JSON.parse(fs.readFileSync(target, 'utf8'));
  if (payload?.version !== 1 || !Array.isArray(payload.projects)) throw new Error('project mapping invalid');
  const matches = payload.projects.filter(project => project?.name === 'build' && String(project.chatId || '').trim());
  if (matches.length !== 1) throw new Error('build project binding must be unique');
  return String(matches[0].chatId);
}

function atomicJson(target, value) {
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

function readEvent(target) {
  return validateEvent(JSON.parse(fs.readFileSync(target, 'utf8')));
}

function files(directory) {
  try { return fs.readdirSync(directory).filter(name => /^[a-f0-9]{32}\.json$/.test(name)).sort(); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
}

function componentLabel(value) {
  if (value === '/') return '根磁盘';
  return String(value).replace(/\.service$/, '');
}

function kindLabel(value) {
  return ({
    disk_warning: '磁盘使用率告警', disk_recovery: '磁盘使用率恢复',
    restart_warning: '重启频率告警', restart_recovery: '重启频率恢复',
    service_warning: '服务状态告警', service_recovery: '服务状态恢复'
  })[value];
}

function alertCard(value) {
  const warning = value.severity === 'warning';
  return {
    schema: '2.0',
    config: { update_multi: true },
    header: { template: warning ? 'red' : 'green', title: { tag: 'plain_text', content: kindLabel(value.kind) } },
    body: { elements: [{
      tag: 'markdown',
      content: `**组件**：${componentLabel(value.component)}\n**观测值**：${String(value.observed)}\n**阈值**：${String(value.threshold)}\n**首次发现**：${value.incident_started_at}\n**建议动作**：${value.next_action_cn}`
    }, { tag: 'markdown', content: `事件编号：${value.id}` }] }
  };
}

async function deliverNextAlert({
  spoolRoot = DEFAULT_SPOOL_ROOT,
  bridgeRoot = DEFAULT_BRIDGE_ROOT,
  appId = process.env.STREAM_APP_ID,
  channel,
  sendManagedCard,
  clock = () => new Date()
} = {}) {
  if (!channel || typeof sendManagedCard !== 'function') throw new Error('managed card sender required');
  const pendingDir = path.join(spoolRoot, 'pending');
  const inflightDir = path.join(spoolRoot, 'inflight');
  const receiptDir = path.join(spoolRoot, 'receipts');
  fs.mkdirSync(pendingDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(inflightDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(receiptDir, { recursive: true, mode: 0o700 });
  for (const directory of [spoolRoot, pendingDir, inflightDir, receiptDir]) fs.chmodSync(directory, 0o700);

  const inflightNames = files(inflightDir);
  if (inflightNames.length > 1) throw new Error('multiple inflight diagnostics alerts');
  if (inflightNames.length === 1) {
    const target = path.join(inflightDir, inflightNames[0]);
    const value = readEvent(target);
    const receipt = path.join(receiptDir, `${value.id}.json`);
    if (fs.existsSync(receipt)) {
      fs.unlinkSync(target);
      return { status: 'delivered', id: value.id };
    }
    return { status: 'ambiguous', id: value.id, manual_reconciliation: true };
  }

  const pendingNames = files(pendingDir);
  if (!pendingNames.length) return false;
  const pending = path.join(pendingDir, pendingNames[0]);
  const value = readEvent(pending);
  const receipt = path.join(receiptDir, `${value.id}.json`);
  if (fs.existsSync(receipt)) {
    fs.unlinkSync(pending);
    return { status: 'delivered', id: value.id };
  }
  const inflight = path.join(inflightDir, pendingNames[0]);
  fs.renameSync(pending, inflight);
  const buildChatId = resolveBuildChatId({ bridgeRoot, appId });
  await sendManagedCard(channel, buildChatId, alertCard(value), '', false, 'chat_id', value.id);
  const at = clock();
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw new Error('delivery clock invalid');
  atomicJson(receipt, { version: 1, id: value.id, delivered_at: at.toISOString() });
  fs.unlinkSync(inflight);
  return { status: 'delivered', id: value.id };
}

module.exports = { deliverNextAlert, validateEvent, resolveBuildChatId, alertCard };

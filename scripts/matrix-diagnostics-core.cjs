'use strict';

const crypto = require('node:crypto');

const DEFAULT_CONFIG = Object.freeze({
  diskWarning: 90,
  diskRecovery: 88,
  restartThreshold: 3,
  restartWindowMs: 10 * 60 * 1000,
  restartRecoveryMs: 15 * 60 * 1000,
  cooldownMs: 60 * 60 * 1000
});

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} required`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label} fields invalid`);
}

function parseTime(value, label) {
  const millis = Date.parse(String(value || ''));
  if (!Number.isFinite(millis)) throw new Error(`${label} invalid`);
  return millis;
}

function validateSnapshot(snapshot) {
  exactKeys(snapshot, ['at', 'boot_id', 'disk_percent', 'components'], 'snapshot');
  parseTime(snapshot.at, 'snapshot time');
  if (!/^[A-Za-z0-9-]{4,128}$/.test(String(snapshot.boot_id || ''))) throw new Error('boot id invalid');
  if (!Number.isFinite(snapshot.disk_percent) || snapshot.disk_percent < 0 || snapshot.disk_percent > 100) throw new Error('disk percent invalid');
  if (!snapshot.components || typeof snapshot.components !== 'object' || Array.isArray(snapshot.components)) throw new Error('components invalid');
  for (const [name, component] of Object.entries(snapshot.components)) {
    if (!/^[A-Za-z0-9_.@-]{1,128}$/.test(name)) throw new Error('component name invalid');
    exactKeys(component, ['active', 'restart_count'], 'component');
    if (typeof component.active !== 'boolean') throw new Error('component active invalid');
    if (!Number.isInteger(component.restart_count) || component.restart_count < 0) throw new Error('component restart count invalid');
  }
  return snapshot;
}

function event(kind, component, observed, threshold, at, incidentStartedAt) {
  const warning = kind.endsWith('_warning');
  const actions = {
    disk_warning: '检查磁盘增长来源并安全释放空间。',
    disk_recovery: '磁盘占用已恢复，继续观察增长趋势。',
    restart_warning: '检查该组件最近错误日志和依赖状态。',
    restart_recovery: '该组件已稳定运行，继续观察。',
    service_warning: '检查该组件状态，未经批准不要自动重启。',
    service_recovery: '该组件已恢复运行，继续观察。'
  };
  return Object.freeze({
    kind,
    severity: warning ? 'warning' : 'recovery',
    component,
    observed,
    threshold,
    at,
    incident_started_at: incidentStartedAt,
    next_action_cn: actions[kind]
  });
}

function eventId(value) {
  if (!value || typeof value !== 'object') throw new Error('event required');
  const material = [value.kind, value.component, value.incident_started_at].map(item => String(item || '')).join('\0');
  if (!material.replace(/\0/g, '')) throw new Error('event identity invalid');
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 32);
}

function emptyComponent(restartCount) {
  return {
    last_restart_count: restartCount,
    restart_times: [],
    incident_open: false,
    incident_started_at: null,
    last_restart_at: null,
    last_alert_at: null,
    service_open: false,
    service_started_at: null,
    service_last_alert_at: null
  };
}

function evaluateSnapshot(previous, current, overrides = {}) {
  validateSnapshot(current);
  const config = { ...DEFAULT_CONFIG, ...overrides };
  const now = parseTime(current.at, 'snapshot time');
  const bootReset = !previous || previous.version !== 1 || previous.boot_id !== current.boot_id;
  const priorDisk = bootReset ? { incident_open: false, incident_started_at: null, last_alert_at: null } : previous.disk;
  const events = [];
  const disk = { ...priorDisk };

  if (!disk.incident_open && current.disk_percent >= config.diskWarning) {
    disk.incident_open = true;
    disk.incident_started_at = current.at;
    disk.last_alert_at = current.at;
    events.push(event('disk_warning', '/', current.disk_percent, config.diskWarning, current.at, disk.incident_started_at));
  } else if (disk.incident_open && current.disk_percent < config.diskRecovery) {
    events.push(event('disk_recovery', '/', current.disk_percent, config.diskRecovery, current.at, disk.incident_started_at));
    disk.incident_open = false;
    disk.incident_started_at = null;
    disk.last_alert_at = null;
  } else if (disk.incident_open && now - parseTime(disk.last_alert_at, 'disk alert time') >= config.cooldownMs) {
    disk.last_alert_at = current.at;
    events.push(event('disk_warning', '/', current.disk_percent, config.diskWarning, current.at, disk.incident_started_at));
  }

  const components = {};
  for (const [name, metric] of Object.entries(current.components)) {
    const prior = bootReset || !previous.components?.[name]
      ? emptyComponent(metric.restart_count)
      : { ...emptyComponent(metric.restart_count), ...previous.components[name] };
    const next = { ...prior, restart_times: Array.isArray(prior.restart_times) ? [...prior.restart_times] : [] };

    if (!metric.active && !next.service_open) {
      next.service_open = true;
      next.service_started_at = current.at;
      next.service_last_alert_at = current.at;
      events.push(event('service_warning', name, 'inactive', 'active', current.at, next.service_started_at));
    } else if (metric.active && next.service_open) {
      events.push(event('service_recovery', name, 'active', 'active', current.at, next.service_started_at));
      next.service_open = false;
      next.service_started_at = null;
      next.service_last_alert_at = null;
    } else if (!metric.active && next.service_open && now - parseTime(next.service_last_alert_at, 'service alert time') >= config.cooldownMs) {
      next.service_last_alert_at = current.at;
      events.push(event('service_warning', name, 'inactive', 'active', current.at, next.service_started_at));
    }

    let delta = metric.restart_count - Number(next.last_restart_count || 0);
    if (bootReset || delta < 0) delta = 0;
    if (delta > 0) {
      for (let index = 0; index < delta; index += 1) next.restart_times.push(current.at);
      next.last_restart_at = current.at;
    }
    next.restart_times = next.restart_times.filter(value => now - parseTime(value, 'restart time') <= config.restartWindowMs);
    next.last_restart_count = metric.restart_count;

    if (!next.incident_open && next.restart_times.length >= config.restartThreshold) {
      next.incident_open = true;
      next.incident_started_at = next.restart_times[0];
      next.last_alert_at = current.at;
      events.push(event('restart_warning', name, next.restart_times.length, config.restartThreshold, current.at, next.incident_started_at));
    } else if (next.incident_open && next.last_restart_at
        && now - parseTime(next.last_restart_at, 'last restart time') >= config.restartRecoveryMs
        && metric.active) {
      events.push(event('restart_recovery', name, 0, config.restartThreshold, current.at, next.incident_started_at));
      next.incident_open = false;
      next.incident_started_at = null;
      next.last_alert_at = null;
      next.restart_times = [];
    } else if (next.incident_open && next.last_alert_at
        && now - parseTime(next.last_alert_at, 'restart alert time') >= config.cooldownMs) {
      next.last_alert_at = current.at;
      events.push(event('restart_warning', name, next.restart_times.length, config.restartThreshold, current.at, next.incident_started_at));
    }
    components[name] = next;
  }

  return {
    state: { version: 1, boot_id: current.boot_id, disk, components, updated_at: current.at },
    events
  };
}

module.exports = { DEFAULT_CONFIG, evaluateSnapshot, eventId, validateSnapshot };

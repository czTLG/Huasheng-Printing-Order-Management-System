#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { evaluateSnapshot, eventId } = require('./matrix-diagnostics-core.cjs');

const CURRENT_CONTAINER = 'vm_debug_ci';
const CURRENT_IMAGE = 'matrix_runtime_8acd6e9-stream-node';
const ROLLBACK_CONTAINER = 'vm_debug_ci_pre_8acd6e9';
const ROLLBACK_IMAGE = 'matrix_runtime_16d70d1-stream-node';
const DEFAULT_STATE_PATH = '/var/lib/matrix-diagnostics/state.json';
const DEFAULT_SPOOL_ROOT = '/home/admin/work/packaging-system/.runtime/vm_debug_ci/workspace/store/matrix-diagnostics';
const SERVICE_NAMES = Object.freeze([
  'packaging-system.service', 'huasheng-packing.service', 'nginx.service', 'docker.service'
]);
const CONTAINER_NAMES = Object.freeze([
  'vm_debug_ci', 'stream-publisher-app', 'stream-publisher-flow', 'stream-publisher-flow-ui',
  'stream-publisher-flow-db', 'stream-publisher-db', 'stream-publisher-cache', 'stream-publisher-index'
]);
const REQUIRED_CONTAINERS = Object.freeze(new Set(['vm_debug_ci']));

function output(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function exactObject(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} required`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label} fields invalid`);
}

function atomicJson(target, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(target), 0o700);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', mode);
    fs.writeFileSync(descriptor, `${JSON.stringify(value)}\n`);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, target);
    fs.chmodSync(target, mode);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
}

function parseSystemd(text) {
  const values = Object.fromEntries(String(text || '').trim().split(/\r?\n/).filter(Boolean).map(line => {
    const index = line.indexOf('=');
    return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : ['', ''];
  }).filter(pair => pair[0]));
  const restarts = Number(values.NRestarts);
  if (!['active', 'inactive', 'failed', 'activating', 'deactivating'].includes(values.ActiveState)
      || !Number.isInteger(restarts) || restarts < 0) throw new Error('systemd metric invalid');
  return { active: values.ActiveState === 'active', restart_count: restarts };
}

function parseContainer(text) {
  const rows = JSON.parse(String(text || ''));
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('container metric invalid');
  const row = rows[0];
  const running = row?.State?.Running === true;
  const health = String(row?.State?.Health?.Status || '');
  const restartCount = Number(row?.RestartCount);
  if (!Number.isInteger(restartCount) || restartCount < 0) throw new Error('container restart count invalid');
  return { active: running && (!health || health === 'healthy'), restart_count: restartCount };
}

function collectSnapshot({
  execFile = output,
  statfs = fs.statfsSync,
  readFile = fs.readFileSync,
  clock = () => new Date(),
  serviceNames = SERVICE_NAMES,
  containerNames = CONTAINER_NAMES
} = {}) {
  const allowedServices = new Set(SERVICE_NAMES);
  const allowedContainers = new Set(CONTAINER_NAMES);
  for (const name of serviceNames) if (!allowedServices.has(name)) throw new Error('service allowlist violation');
  for (const name of containerNames) if (!allowedContainers.has(name)) throw new Error('container allowlist violation');
  const stats = statfs('/');
  const blocks = Number(stats.blocks);
  const free = Number(stats.bfree);
  const available = Number(stats.bavail);
  const used = blocks - free;
  if (![blocks, free, available, used].every(Number.isFinite) || blocks <= 0 || used < 0 || available < 0) throw new Error('filesystem metric invalid');
  const diskPercent = Math.ceil((used / (used + available)) * 100);
  const bootId = String(readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  const atDate = clock();
  if (!(atDate instanceof Date) || !Number.isFinite(atDate.getTime())) throw new Error('collector clock invalid');
  const components = {};
  for (const name of serviceNames) {
    components[name] = parseSystemd(execFile('systemctl', ['show', name, '--property=ActiveState,NRestarts', '--no-pager']));
  }
  for (const name of containerNames) {
    try {
      components[name] = parseContainer(execFile('docker', ['inspect', name]));
    } catch (error) {
      if (REQUIRED_CONTAINERS.has(name)) throw error;
    }
  }
  return { at: atDate.toISOString(), boot_id: bootId, disk_percent: diskPercent, components };
}

function validatedEvent(value) {
  exactObject(value, ['kind', 'severity', 'component', 'observed', 'threshold', 'at', 'incident_started_at', 'next_action_cn'], 'event');
  if (!['disk_warning', 'disk_recovery', 'restart_warning', 'restart_recovery', 'service_warning', 'service_recovery'].includes(value.kind)) throw new Error('event kind invalid');
  if (!['warning', 'recovery'].includes(value.severity)) throw new Error('event severity invalid');
  if (!String(value.component || '') || !Number.isFinite(Date.parse(value.at)) || !Number.isFinite(Date.parse(value.incident_started_at))) throw new Error('event binding invalid');
  if (!String(value.next_action_cn || '').trim()) throw new Error('event action invalid');
  return value;
}

function writeEvent(value, { spoolRoot = DEFAULT_SPOOL_ROOT } = {}) {
  const clean = validatedEvent(value);
  const id = eventId(clean);
  const target = path.join(spoolRoot, 'pending', `${id}.json`);
  const record = { version: 1, id, ...clean };
  if (fs.existsSync(target)) return record;
  atomicJson(target, record);
  return record;
}

function readState(statePath) {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      const quarantine = `${statePath}.corrupt.${Date.now()}`;
      fs.renameSync(statePath, quarantine);
      return null;
    }
    throw error;
  }
}

function runCheck({
  statePath = DEFAULT_STATE_PATH,
  spoolRoot = DEFAULT_SPOOL_ROOT,
  collect = () => collectSnapshot()
} = {}) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  const lockPath = `${statePath}.lock`;
  let lock;
  try {
    lock = fs.openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('matrix diagnostics check already running');
    throw error;
  }
  try {
    const current = collect();
    const result = evaluateSnapshot(readState(statePath), current);
    for (const alert of result.events) writeEvent(alert, { spoolRoot });
    atomicJson(statePath, result.state);
    return { events: result.events.length, disk_percent: current.disk_percent, checked_at: current.at };
  } finally {
    fs.closeSync(lock);
    try { fs.unlinkSync(lockPath); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
}

function runtimeFamily(value) {
  return /^(?:matrix_runtime_[A-Za-z0-9]+-stream-node|vm_debug_ci(?:-stream-node|-vm_debug_ci)?)$/.test(String(value || ''));
}

function buildCleanupPlan(value) {
  exactObject(value, ['containers', 'images', 'volumes'], 'inventory');
  if (![value.containers, value.images, value.volumes].every(Array.isArray)) throw new Error('inventory lists required');
  const byName = new Map(value.containers.map(row => [row.name, row]));
  const current = byName.get(CURRENT_CONTAINER);
  const rollback = byName.get(ROLLBACK_CONTAINER);
  if (!current || current.image !== CURRENT_IMAGE || current.running !== true || current.healthy !== true) throw new Error('current image binding invalid');
  if (!rollback || rollback.image !== ROLLBACK_IMAGE || rollback.running !== false) throw new Error('rollback container binding invalid');
  const obsoleteContainers = value.containers.filter(row => /^vm_debug_ci_pre_/.test(row.name) && row.name !== ROLLBACK_CONTAINER);
  if (obsoleteContainers.some(row => row.running)) throw new Error('obsolete container is running');
  const removeNames = new Set(obsoleteContainers.map(row => row.name));
  const removeImages = [];
  for (const image of value.images) {
    if (!runtimeFamily(image.name) || [CURRENT_IMAGE, ROLLBACK_IMAGE].includes(image.name)) continue;
    const references = Array.isArray(image.used_by) ? image.used_by : [];
    if (references.some(name => !removeNames.has(name))) throw new Error('obsolete image still referenced');
    removeImages.push(image.name);
  }
  return {
    keep: {
      current_container: CURRENT_CONTAINER, current_image: CURRENT_IMAGE,
      rollback_container: ROLLBACK_CONTAINER, rollback_image: ROLLBACK_IMAGE
    },
    remove_containers: [...removeNames].sort(),
    remove_images: removeImages.sort(),
    volume_count: value.volumes.length
  };
}

function verifyRetention({ inventory, beforeVolumes, diskPercent, serviceHealth = {}, containerHealth = {} }) {
  const plan = buildCleanupPlan(inventory);
  if (plan.remove_containers.length || plan.remove_images.length) throw new Error('obsolete runtime assets remain');
  if (JSON.stringify([...inventory.volumes].sort()) !== JSON.stringify([...beforeVolumes].sort())) throw new Error('volume inventory changed');
  if (!Number.isFinite(diskPercent) || diskPercent >= 85) throw new Error('disk target not reached');
  if (Object.values(serviceHealth).some(value => value !== true)) throw new Error('service health failed');
  if (containerHealth.vm_debug_ci !== true || Object.values(containerHealth).some(value => value !== true)) throw new Error('container health failed');
  return { ok: true, disk_percent: diskPercent, retained: plan.keep };
}

function listInventory({ execFile = output } = {}) {
  const names = String(execFile('docker', ['ps', '-a', '--format', '{{.Names}}'])).trim().split(/\r?\n/).filter(Boolean);
  const containers = names.map(name => {
    const rows = JSON.parse(execFile('docker', ['inspect', name]));
    const row = rows[0];
    return {
      name,
      image: String(row?.Config?.Image || ''),
      running: row?.State?.Running === true,
      healthy: row?.State?.Running === true && (!row?.State?.Health || row.State.Health.Status === 'healthy')
    };
  });
  const imageNames = String(execFile('docker', ['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}'])).trim().split(/\r?\n/).filter(Boolean);
  const images = [...new Set(imageNames)].map(name => ({
    name,
    used_by: containers.filter(row => row.image === name).map(row => row.name)
  }));
  const volumes = String(execFile('docker', ['volume', 'ls', '--format', '{{.Name}}'])).trim().split(/\r?\n/).filter(Boolean).sort();
  return { containers, images, volumes };
}

function main() {
  const command = process.argv[2] || 'check';
  if (command === 'check') {
    process.stdout.write(`${JSON.stringify(runCheck())}\n`);
    return;
  }
  if (command === 'cleanup-plan') {
    process.stdout.write(`${JSON.stringify(buildCleanupPlan(listInventory()))}\n`);
    return;
  }
  throw new Error('usage: matrix-diagnostics check|cleanup-plan');
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`matrix-diagnostics: ${error?.message || 'failed'}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  SERVICE_NAMES, CONTAINER_NAMES, REQUIRED_CONTAINERS, collectSnapshot, writeEvent, runCheck,
  buildCleanupPlan, verifyRetention, listInventory, runtimeFamily
};

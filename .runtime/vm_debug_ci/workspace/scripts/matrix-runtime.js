#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEFAULT_STATE_PATH = '/workspace/store/matrix-runtime-state.json';

function healthUrl(baseUrl) {
  const base = new URL(String(baseUrl || ''));
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('HTTP MATRIX_API_BASE_URL is required');
  }
  return new URL('/health', base.origin).href;
}

async function probeApi(baseUrl, fetchImpl = fetch) {
  const url = healthUrl(baseUrl);
  let response;
  try {
    response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(3000) });
  } catch (error) {
    throw new Error(`matrix API unreachable: ${error?.message || 'request failed'}`);
  }
  if (!response?.ok) throw new Error(`matrix API unreachable: HTTP ${response?.status || 'unknown'}`);
  const type = String(response.headers?.get?.('content-type') || '').toLowerCase();
  if (!type.includes('application/json')) throw new Error('matrix API health returned non-JSON response');
  const body = await response.json().catch(() => null);
  if (!body?.ok) throw new Error('matrix API health response is not ok');
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

async function assertHealthy({
  baseUrl = process.env.MATRIX_API_BASE_URL,
  statePath = process.env.MATRIX_RUNTIME_STATE_PATH || DEFAULT_STATE_PATH,
  fetchImpl = fetch,
  isAlive = processAlive
} = {}) {
  let state;
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); }
  catch (error) { throw new Error(`runtime state unavailable: ${error?.message || 'read failed'}`); }
  if (!isAlive(state.watcherPid)) throw new Error('watcher is not running');
  if (!isAlive(state.bridgePid)) throw new Error('bridge is not running');
  await probeApi(baseUrl, fetchImpl);
}

function writeState(statePath, state) {
  const temporary = `${statePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, statePath);
}

async function waitForApi(baseUrl) {
  const attempts = Number(process.env.MATRIX_API_STARTUP_ATTEMPTS || 15);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 300) {
    throw new Error('MATRIX_API_STARTUP_ATTEMPTS must be an integer from 1 to 300');
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { await probeApi(baseUrl); return; }
    catch (error) {
      process.stderr.write(`[matrix-runtime] API startup check ${attempt}/${attempts} failed: ${error.message}\n`);
      if (attempt === attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

async function run() {
  const baseUrl = process.env.MATRIX_API_BASE_URL;
  const statePath = process.env.MATRIX_RUNTIME_STATE_PATH || DEFAULT_STATE_PATH;
  await waitForApi(baseUrl);

  const watcher = spawn(process.execPath, ['/workspace/scripts/matrix-watch.js'], { stdio: 'inherit', env: process.env });
  const bridge = spawn('feishu-codex-bridge', ['run', '--bot', 'stream-node'], { stdio: 'inherit', env: process.env });
  const children = [watcher, bridge];
  writeState(statePath, { watcherPid: watcher.pid, bridgePid: bridge.pid, startedAt: new Date().toISOString() });

  let stopping = false;
  const stop = (exitCode, reason) => {
    if (stopping) return;
    stopping = true;
    process.stderr.write(`[matrix-runtime] ${reason}\n`);
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    }
    try { fs.unlinkSync(statePath); } catch (error) { if (error?.code !== 'ENOENT') process.stderr.write(`[matrix-runtime] state cleanup failed: ${error.message}\n`); }
    setTimeout(() => {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
      process.exit(exitCode);
    }, 5000).unref();
    Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve))))
      .then(() => process.exit(exitCode));
  };

  watcher.once('exit', (code, signal) => stop(code && code > 0 ? code : 1, `watcher exited (${code ?? signal ?? 'unknown'})`));
  bridge.once('exit', (code, signal) => stop(code && code > 0 ? code : 1, `bridge exited (${code ?? signal ?? 'unknown'})`));
  watcher.once('error', error => stop(1, `watcher failed: ${error.message}`));
  bridge.once('error', error => stop(1, `bridge failed: ${error.message}`));
  process.once('SIGTERM', () => stop(0, 'received SIGTERM'));
  process.once('SIGINT', () => stop(0, 'received SIGINT'));
}

async function main() {
  if (process.argv[2] === 'health') {
    await assertHealthy();
    process.stdout.write('matrix runtime healthy\n');
    return;
  }
  if (process.argv.length > 2) throw new Error('usage: matrix-runtime.js [health]');
  await run();
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`[matrix-runtime] fatal: ${error?.message || 'unknown error'}\n`);
  process.exitCode = 1;
});

module.exports = { healthUrl, probeApi, assertHealthy, processAlive };

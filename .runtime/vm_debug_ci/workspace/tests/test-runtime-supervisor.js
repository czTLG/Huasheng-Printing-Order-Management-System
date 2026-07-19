'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const scriptPath = path.resolve(__dirname, '..', 'scripts', 'matrix-runtime.js');
const composePath = path.resolve(__dirname, '..', '..', 'compose.yaml');
const runtime = require(scriptPath);

assert.strictEqual(runtime.healthUrl('http://host.docker.internal:8080/api/matrix'), 'http://host.docker.internal:8080/api/matrix/ready');
assert.throws(() => runtime.healthUrl('ftp://host.invalid/api/matrix'), /http/i);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-runtime-'));
(async () => {
  try {
    const statePath = path.join(root, 'runtime.json');
    fs.writeFileSync(statePath, JSON.stringify({ watcherPid: 101, orderWatcherPid: 102, inboxWatcherPid: 103, bridgePid: 104 }), { mode: 0o600 });
    process.env.MATRIX_BRIDGE_TOKEN = 'runtime-test-token';
    process.env.MATRIX_OWNER_OPEN_ID = 'ou-runtime-owner';
    const fetchOk = async (url, options) => {
      assert.ok(String(url).endsWith('/api/matrix/ready'));
      assert.strictEqual(options.headers['x-matrix-bridge-token'], 'runtime-test-token');
      assert.strictEqual(options.headers['x-feishu-open-id'], 'ou-runtime-owner');
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true, service: 'matrix' }) };
    };
    await runtime.assertHealthy({
      baseUrl: 'http://host.docker.internal:8080/api/matrix', statePath,
      fetchImpl: fetchOk, isAlive: pid => [101, 102, 103, 104].includes(pid)
    });
    await assert.rejects(() => runtime.assertHealthy({
      baseUrl: 'http://host.docker.internal:8080/api/matrix', statePath,
      fetchImpl: fetchOk, isAlive: pid => pid !== 101
    }), /watcher.*not running/i);
    await assert.rejects(() => runtime.assertHealthy({
      baseUrl: 'http://host.docker.internal:8080/api/matrix', statePath,
      fetchImpl: fetchOk, isAlive: pid => pid !== 103
    }), /inbox watcher.*not running/i);
    await assert.rejects(() => runtime.assertHealthy({
      baseUrl: 'http://host.docker.internal:8080/api/matrix', statePath,
      fetchImpl: async () => { throw new Error('connection refused'); },
      isAlive: () => true
    }), /API.*unreachable/i);
    await assert.rejects(() => runtime.probeApi('http://host.docker.internal:8080/api/matrix', async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }) })), /readiness/i);

    const compose = fs.readFileSync(composePath, 'utf8');
    assert.ok(compose.includes('MATRIX_API_BASE_URL: http://host.docker.internal:${MATRIX_API_HOST_PORT:-8080}/api/matrix'));
    assert.ok(compose.includes('host.docker.internal:host-gateway'));
    assert.ok(compose.includes('command:\n      - node\n      - /workspace/scripts/matrix-runtime.js'));
    assert.ok(compose.includes('test: ["CMD", "node", "/workspace/scripts/matrix-runtime.js", "health"]'));
    assert.ok(compose.includes('MATRIX_INBOX_ATTACHMENT_ROOT: /refs/matrix-inbox-attachments'));
    assert.ok(compose.includes(':/refs/matrix-inbox-attachments:ro'));
    assert.ok(!compose.includes('matrix-watch.js &'));
    console.log('runtime supervisor tests passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

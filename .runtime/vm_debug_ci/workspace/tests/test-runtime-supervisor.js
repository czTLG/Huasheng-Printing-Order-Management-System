'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const scriptPath = path.resolve(__dirname, '..', 'scripts', 'matrix-runtime.js');
const composePath = path.resolve(__dirname, '..', '..', 'compose.yaml');
const runtime = require(scriptPath);

assert.strictEqual(runtime.healthUrl('http://host.docker.internal:8080/api/matrix'), 'http://host.docker.internal:8080/health');
assert.throws(() => runtime.healthUrl('ftp://host.invalid/api/matrix'), /http/i);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-runtime-'));
(async () => {
  try {
    const statePath = path.join(root, 'runtime.json');
    fs.writeFileSync(statePath, JSON.stringify({ watcherPid: 101, bridgePid: 102 }), { mode: 0o600 });
    const fetchOk = async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }) });
    await runtime.assertHealthy({
      baseUrl: 'http://host.docker.internal:8080/api/matrix', statePath,
      fetchImpl: fetchOk, isAlive: pid => pid === 101 || pid === 102
    });
    await assert.rejects(() => runtime.assertHealthy({
      baseUrl: 'http://host.docker.internal:8080/api/matrix', statePath,
      fetchImpl: fetchOk, isAlive: pid => pid === 102
    }), /watcher.*not running/i);
    await assert.rejects(() => runtime.assertHealthy({
      baseUrl: 'http://host.docker.internal:8080/api/matrix', statePath,
      fetchImpl: async () => { throw new Error('connection refused'); },
      isAlive: () => true
    }), /API.*unreachable/i);

    const compose = fs.readFileSync(composePath, 'utf8');
    assert.ok(compose.includes('MATRIX_API_BASE_URL: http://host.docker.internal:${MATRIX_API_HOST_PORT:-8080}/api/matrix'));
    assert.ok(compose.includes('host.docker.internal:host-gateway'));
    assert.ok(compose.includes('command:\n      - node\n      - /workspace/scripts/matrix-runtime.js'));
    assert.ok(compose.includes('test: ["CMD", "node", "/workspace/scripts/matrix-runtime.js", "health"]'));
    assert.ok(!compose.includes('matrix-watch.js &'));
    console.log('runtime supervisor tests passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

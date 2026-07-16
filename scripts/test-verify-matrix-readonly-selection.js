'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const verifier = require('./verify-matrix-readonly-selection');

assert.strictEqual(typeof verifier.recommendFromView, 'function');
let received;
const rows = verifier.recommendFromView({
  recommend: options => {
    received = options;
    return Array.from({ length: 5 }, (_, index) => ({ id: index + 1 }));
  },
  list: () => { throw new Error('ordinary paginated list must not verify recommendation clamp'); }
});
assert.deepStrictEqual(received, { limit: Number.MAX_SAFE_INTEGER, excludeIds: [] });
assert.strictEqual(rows.length, 5);

assert.strictEqual(typeof verifier.candidateInput, 'function');
assert.strictEqual(typeof verifier.inspectCandidates, 'function');
assert.strictEqual(typeof verifier.runtimeSurfaceFiles, 'function');
assert.strictEqual(typeof verifier.outboundAdapterFiles, 'function');
assert.strictEqual(typeof verifier.validateComposeConfig, 'function');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-verifier-input-'));
try {
  const temporary = path.join(root, 'temporary');
  fs.mkdirSync(temporary);
  const defaultInput = verifier.candidateInput({ root, temporary, env: {} });
  assert.deepStrictEqual(defaultInput, {
    dbPath: path.join(root, 'data', 'matrix-stream.db'),
    source: 'default-readonly-database'
  });
  assert.throws(() => verifier.inspectCandidates(defaultInput.dbPath), /no such|not found|open/i);

  const badPath = path.join(root, 'bad.db');
  fs.writeFileSync(badPath, 'not a sqlite database', { mode: 0o600 });
  assert.throws(() => verifier.inspectCandidates(badPath), /database|file is not/i);

  const fixtureInput = verifier.candidateInput({ root, temporary, env: { MATRIX_VERIFY_FIXTURE: '1' } });
  assert.strictEqual(fixtureInput.source, 'explicit-fixture');
  assert.strictEqual(verifier.inspectCandidates(fixtureInput.dbPath).candidateIntegrity, 'ok');
  assert.throws(() => verifier.candidateInput({
    root, temporary,
    env: { MATRIX_VERIFY_FIXTURE: '1', MATRIX_STREAM_DB_PATH: '/tmp/ambiguous.db' }
  }), /cannot be combined|ambiguous/i);

  const runtimeRoot = path.join(root, 'runtime');
  fs.mkdirSync(path.join(runtimeRoot, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, 'safe.js'), "module.exports = true;\n");
  fs.writeFileSync(path.join(runtimeRoot, 'nested', 'adapter.cjs'), "require('nodemailer');\n");
  const surface = verifier.runtimeSurfaceFiles([runtimeRoot]);
  assert.strictEqual(surface.length, 2);
  assert.deepStrictEqual(verifier.outboundAdapterFiles(surface), [path.join(runtimeRoot, 'nested', 'adapter.cjs')]);

  verifier.validateComposeConfig({ runCompose: () => ({
    status: 0,
    stdout: 'MATRIX_API_BASE_URL: http://host.docker.internal:8080/api/matrix\nhealthcheck:\n  test: node /workspace/scripts/matrix-runtime.js health\nextra_hosts:\n  host.docker.internal: host-gateway\n',
    stderr: ''
  }) });
  assert.throws(() => verifier.validateComposeConfig({ runCompose: () => ({ status: 1, stdout: '', stderr: 'invalid compose' }) }), /invalid compose/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('matrix read-only verifier tests passed');

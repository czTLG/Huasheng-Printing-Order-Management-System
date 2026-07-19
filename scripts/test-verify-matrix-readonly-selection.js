'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
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
assert.strictEqual(typeof verifier.approvedCapabilitySource, 'function');
assert.strictEqual(typeof verifier.validateRuntimeManifest, 'function');
assert.strictEqual(typeof verifier.runtimeManifest, 'function');
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
  const fixtureMetrics = verifier.inspectCandidates(fixtureInput.dbPath);
  assert.strictEqual(fixtureMetrics.candidateIntegrity, 'ok');
  assert.strictEqual(fixtureMetrics.recommendationEligibleCount, 1);
  assert.strictEqual(fixtureMetrics.recommendationMissingOfficialEvidence, 0);
  assert.strictEqual(fixtureMetrics.recommendationMissingDiscovery, 0);
  assert.strictEqual(fixtureMetrics.recommendationMissingContact, 0);
  assert.strictEqual(fixtureMetrics.recommendationStaleReview, 0);
  assert.strictEqual(fixtureMetrics.recommendationOutsideNearby, 0);
  assert.strictEqual(fixtureMetrics.supplierSignalCount, 1);
  assert.strictEqual(fixtureMetrics.supplierSignalProvenanceGaps, 0);
  assert.deepStrictEqual(verifier.recommendations(fixtureInput.dbPath).map(row => row.country_code), ['VN']);
  const broaderDb = new Database(fixtureInput.dbPath);
  broaderDb.prepare('DELETE FROM cache_evidence WHERE record_id = 2').run();
  broaderDb.close();
  const broaderMetrics = verifier.inspectCandidates(fixtureInput.dbPath);
  assert.strictEqual(broaderMetrics.candidateCount, 1, 'strict recommendation count must exclude a broad-list row without official evidence');
  assert.strictEqual(broaderMetrics.missingEvidence, 1, 'ordinary-list quality gaps remain visible as statistics');
  assert.strictEqual(broaderMetrics.recommendationMissingOfficialEvidence, 0, 'strict recommendation set itself has no evidence gaps');
  assert.throws(() => verifier.candidateInput({
    root, temporary,
    env: { MATRIX_VERIFY_FIXTURE: '1', MATRIX_STREAM_DB_PATH: '/tmp/ambiguous.db' }
  }), /cannot be combined|ambiguous/i);

  const runtimeRoot = path.join(root, 'runtime');
  fs.mkdirSync(path.join(runtimeRoot, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, 'safe.js'), "module.exports = true;\n");
  const rejectedCapabilities = {
    'external-fetch.js': "fetch('https://outside.invalid/data');\n",
    'axios.cjs': "require('axios').get('https://outside.invalid/data');\n",
    'undici.cjs': "require('undici').request('https://outside.invalid/data');\n",
    'http-request.cjs': "require('node:http').request('http://outside.invalid/data');\n",
    'https-get.cjs': "require('node:https').get('https://outside.invalid/data');\n",
    'net-connect.cjs': "require('node:net').connect(443, 'outside.invalid');\n",
    'tls-connect.cjs': "require('node:tls').connect(443, 'outside.invalid');\n",
    'http2-connect.cjs': "require('node:http2').connect('https://outside.invalid');\n",
    'dgram-send.cjs': "require('node:dgram').createSocket('udp4').send('x', 53, 'outside.invalid');\n",
    'websocket.js': "new WebSocket('wss://outside.invalid/socket');\n",
    'event-source.js': "new EventSource('https://outside.invalid/events');\n",
    'exec-curl.cjs': "require('node:child_process').exec('curl https://outside.invalid/data');\n"
  };
  for (const [name, source] of Object.entries(rejectedCapabilities)) {
    fs.writeFileSync(path.join(runtimeRoot, 'nested', name), source);
  }
  const surface = verifier.runtimeSurfaceFiles([runtimeRoot]);
  assert.strictEqual(surface.length, 13);
  assert.deepStrictEqual(
    verifier.outboundAdapterFiles(surface).map(file => path.basename(file)).sort(),
    Object.keys(rejectedCapabilities).sort()
  );
  assert.deepStrictEqual(verifier.outboundAdapterFiles(verifier.runtimeSurfaceFiles()), [], 'reviewed client/supervisor capabilities must be the only production exceptions');
  const productionFiles = verifier.runtimeSurfaceFiles();
  const productionManifest = verifier.runtimeManifest();
  assert.strictEqual(verifier.validateRuntimeManifest({ files: productionFiles }), true);
  assert.ok(Object.keys(productionManifest).every(file => !/(?:^|\/)tests?\//.test(file) && !/(?:^|\/)test-/.test(file)));
  assert.throws(() => verifier.validateRuntimeManifest({ files: productionFiles.slice(1) }), /runtime manifest.*(?:missing|set)/i);
  assert.throws(() => verifier.validateRuntimeManifest({ files: [...productionFiles, __filename] }), /runtime manifest.*(?:unexpected|set)/i);
  const changedManifest = { ...productionManifest, [Object.keys(productionManifest)[0]]: '0'.repeat(64) };
  assert.throws(() => verifier.validateRuntimeManifest({ files: productionFiles, manifest: changedManifest }), /runtime manifest.*hash/i);
  const clientSource = fs.readFileSync(path.join(__dirname, '..', '.runtime/vm_debug_ci/workspace/scripts/matrix-client.js'), 'utf8');
  const supervisorSource = fs.readFileSync(path.join(__dirname, '..', '.runtime/vm_debug_ci/workspace/scripts/matrix-runtime.js'), 'utf8');
  const inboxSource = fs.readFileSync(path.join(__dirname, '..', '.runtime/vm_debug_ci/workspace/scripts/matrix-inbox-watch.js'), 'utf8');
  const operationsSource = fs.readFileSync(path.join(__dirname, '..', '.runtime/vm_debug_ci/workspace/scripts/stream-watch.js'), 'utf8');
  assert.strictEqual(verifier.approvedCapabilitySource('client', clientSource), true);
  assert.strictEqual(verifier.approvedCapabilitySource('supervisor', supervisorSource), true);
  assert.strictEqual(verifier.approvedCapabilitySource('inbox', inboxSource), true);
  assert.strictEqual(verifier.approvedCapabilitySource('operations', operationsSource), true);
  assert.strictEqual(verifier.approvedCapabilitySource('inbox', `${inboxSource}\nfetch(process.env.OUTSIDE_URL);\n`), false);
  assert.strictEqual(verifier.approvedCapabilitySource('operations', `${operationsSource}\nfetch(process.env.OUTSIDE_URL);\n`), false);
  assert.strictEqual(verifier.approvedCapabilitySource('client', clientSource.replace('fetch(url, {', 'fetch(new URL(process.env.OUTSIDE_URL), {')), false);
  assert.strictEqual(verifier.approvedCapabilitySource('client', clientSource.replace('for (const [key, value]', "url.href = 'https:' + '//outside.invalid/data';\n  for (const [key, value]")), false);
  assert.strictEqual(verifier.approvedCapabilitySource('supervisor', `${supervisorSource}\nfetch(process.env.OUTSIDE_URL);\n`), false);
  assert.strictEqual(verifier.approvedCapabilitySource('supervisor', supervisorSource.replace('let response;', "url.href = 'https:' + '//outside.invalid/health';\n  let response;")), false);
  assert.strictEqual(verifier.approvedCapabilitySource('supervisor', `${supervisorSource}\neval(process.env.RUNTIME_CODE);\n`), false);
  assert.strictEqual(verifier.approvedCapabilitySource('supervisor', `${supervisorSource}\nimport(process.env.RUNTIME_MODULE);\n`), false);

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

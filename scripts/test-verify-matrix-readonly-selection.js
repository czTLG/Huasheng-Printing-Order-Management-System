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
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('matrix read-only verifier tests passed');

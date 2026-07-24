'use strict';

const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const stages = [
  ['canonical store and immutable lifecycle', 'scripts/test-matrix-ledger-store.js', ''],
  ['candidate through exact confirmation and accepted follow-up', 'scripts/test-matrix-ledger-command.js', 'matrix ledger command tests passed'],
  ['Sent, reply, attachment, bounce, delay, automatic reply and unresolved reconciliation', 'scripts/test-matrix-ledger-inbox.js', 'matrix ledger inbox tests passed'],
  ['stale, altered content, duplicate confirmation and delivery ambiguity gates', 'scripts/test-matrix-stream-delivery.js', 'matrix stream delivery tests passed'],
  ['management API failure has no local fallback', '.runtime/vm_debug_ci/workspace/tests/test-matrix-ledger-client.js', 'matrix ledger client tests passed']
];

for (const [name, script, marker] of stages) {
  const result = spawnSync(process.execPath, [script], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' }
  });
  if (result.error) throw result.error;
  assert.strictEqual(result.status, 0, `${name} failed:\n${result.stdout}\n${result.stderr}`);
  if (marker) assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

const clientSource = require('node:fs').readFileSync(
  path.join(ROOT, '.runtime/vm_debug_ci/workspace/scripts/matrix-client.js'),
  'utf8'
);
assert.doesNotMatch(clientSource, /\bnodemailer\b|SMTP_[A-Z0-9_]+|sendMail\s*\(/);
assert.match(clientSource, /redirect:\s*'manual'/);
assert.match(clientSource, /AbortSignal\.timeout/);
console.log('matrix ledger end-to-end tests passed');

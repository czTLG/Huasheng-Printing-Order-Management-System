'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const artifact = require('./test-bridge-artifact-0.6.9.js');

assert.strictEqual(typeof artifact.resolveArtifactSource, 'function');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-artifact-source-'));
try {
  const explicit = path.join(root, 'explicit');
  fs.mkdirSync(explicit);
  assert.strictEqual(artifact.resolveArtifactSource({
    env: { MATRIX_BRIDGE_ARTIFACT_DIR: explicit }, candidates: []
  }), explicit);
  assert.throws(() => artifact.resolveArtifactSource({
    env: {}, candidates: [path.join(root, 'missing')]
  }), /local.*artifact.*required|bootstrap/i);

  const source = fs.readFileSync(path.join(__dirname, 'test-bridge-artifact-0.6.9.js'), 'utf8');
  assert.ok(!source.includes("run('npm', ['pack'"), 'default artifact verification must not run npm pack');
  assert.ok(!source.includes("run('npm', ['install'"), 'default artifact verification must not install dependencies');
  console.log('bridge artifact local input tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

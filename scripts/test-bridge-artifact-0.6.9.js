'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ORIGINAL_SHA256, patchFile, sha256 } = require('../.runtime/vm_debug_ci/bridge-patch/patch-stream-card.cjs');

const VERSION = '0.6.9';

function resolveArtifactSource({ env = process.env, candidates } = {}) {
  const configured = String(env.MATRIX_BRIDGE_ARTIFACT_DIR || '').trim();
  if (configured) {
    const explicit = path.resolve(configured);
    if (!fs.existsSync(explicit)) throw new Error(`configured local bridge artifact not found: ${explicit}`);
    return explicit;
  }
  const prefix = String(env.npm_config_prefix || '').trim();
  const localCandidates = candidates || [
    '/tmp/matrix-bridge-artifact-0.6.9/package',
    ...(prefix ? [path.join(prefix, 'lib/node_modules/@modelzen/feishu-codex-bridge')] : []),
    path.resolve(path.dirname(process.execPath), '../lib/node_modules/@modelzen/feishu-codex-bridge'),
    '/usr/local/lib/node_modules/@modelzen/feishu-codex-bridge',
    '/usr/lib/node_modules/@modelzen/feishu-codex-bridge'
  ];
  const source = localCandidates.map(candidate => path.resolve(candidate)).find(candidate => fs.existsSync(path.join(candidate, 'package.json')));
  if (!source) {
    throw new Error('verified local bridge artifact required; run a separate explicit bootstrap step and set MATRIX_BRIDGE_ARTIFACT_DIR');
  }
  return source;
}

function verifiedArtifact() {
  const source = resolveArtifactSource();
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  assert.strictEqual(manifest.name, '@modelzen/feishu-codex-bridge');
  assert.strictEqual(manifest.version, VERSION);
  assert.strictEqual(manifest.type, 'module');
  assert.strictEqual(sha256(fs.readFileSync(path.join(source, 'dist/cli.js'))), ORIGINAL_SHA256);
  assert.ok(fs.existsSync(path.join(source, 'node_modules/@larksuiteoapi/node-sdk')), 'local artifact runtime dependencies missing; bootstrap them separately');
  return source;
}

function main() {
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-bridge-esm-'));
try {
  const source = verifiedArtifact();
  const artifact = path.join(root, 'package');
  fs.cpSync(source, artifact, { recursive: true });
  const cliPath = path.join(artifact, 'dist/cli.js');
  patchFile(cliPath);

  const home = path.join(root, 'home');
  const bridgeHome = path.join(home, '.feishu-codex-bridge');
  const appId = 'cli_matrix_artifact_test';
  const botDir = path.join(bridgeHome, 'bots', appId);
  fs.mkdirSync(botDir, { recursive: true });
  fs.writeFileSync(path.join(bridgeHome, 'bots.json'), JSON.stringify({
    version: 1, current: appId,
    bots: [{ name: 'matrix-artifact-test', appId, tenant: 'feishu', active: true, createdAt: 0 }]
  }));
  fs.writeFileSync(path.join(botDir, 'config.json'), JSON.stringify({
    accounts: { app: { id: appId, secret: 'fixture-secret-never-sent', tenant: 'feishu' } },
    preferences: { cliBridge: { enabled: false } }
  }));

  const sentinel = path.join(root, 'registered.txt');
  const extension = path.join(root, 'extension.cjs');
  fs.writeFileSync(extension, [
    "'use strict';",
    "const fs = require('node:fs');",
    "module.exports.register = () => {",
    "  fs.writeFileSync(process.env.MATRIX_ARTIFACT_SENTINEL, 'registered');",
    "  throw new Error('MATRIX_ARTIFACT_REGISTRATION_SENTINEL');",
    "};",
    ''
  ].join('\n'));
  const preload = path.join(root, 'preload.cjs');
  const trace = path.join(root, 'preload-trace.txt');
  fs.writeFileSync(preload, [
    "'use strict';",
    "const fs = require('node:fs');",
    "const trace = value => fs.appendFileSync(process.env.MATRIX_ARTIFACT_TRACE, String(value) + '\\n');",
    "for (const method of ['log', 'error', 'warn']) { const original = console[method]; console[method] = (...args) => { trace(method + ': ' + args.join(' ')); return original(...args); }; }",
    "process.on('exit', code => trace('exit: ' + code));",
    "global.fetch = async url => {",
    "  const target = String(url);",
    "  trace('fetch: ' + target);",
    "  let body = { code: 0, data: {} };",
    "  if (target.includes('/auth/v3/tenant_access_token/internal')) body = { code: 0, tenant_access_token: 'fixture-token' };",
    "  else if (target.includes('/bot/v3/info')) body = { code: 0, bot: { app_name: 'Fixture', open_id: 'ou_fixture' } };",
    "  else if (target.includes('/application/v6/scopes')) body = { code: 0, data: { scopes: [] } };",
    "  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers({ 'content-type': 'application/json' }) };",
    "};",
    ''
  ].join('\n'));

  const child = spawnSync(process.execPath, [cliPath, 'run', '--bot', 'matrix-artifact-test'], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      NODE_ENV: 'test',
      NODE_OPTIONS: `--require=${preload}`,
      STREAM_CARD_EXTENSION: extension,
      MATRIX_ARTIFACT_SENTINEL: sentinel,
      MATRIX_ARTIFACT_TRACE: trace
    },
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 8 * 1024 * 1024
  });
  const childEvidence = `status=${child.status} signal=${child.signal}\nTRACE:\n${fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8') : '<missing>'}\nSTDERR:\n${child.stderr}\nSTDOUT:\n${child.stdout}`;
  assert.strictEqual(child.signal, null, `artifact runtime timed out: ${childEvidence}`);
  assert.strictEqual(fs.existsSync(sentinel), true, `real ESM registration did not execute: ${childEvidence}`);
  assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), 'registered');
  assert.match(childEvidence, /MATRIX_ARTIFACT_REGISTRATION_SENTINEL/);
  console.log('bridge 0.6.9 artifact compatibility tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
}

if (require.main === module) main();

module.exports = { resolveArtifactSource, verifiedArtifact, main };

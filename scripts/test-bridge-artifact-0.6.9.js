'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ORIGINAL_SHA256, patchFile, sha256 } = require('../.runtime/vm_debug_ci/bridge-patch/patch-stream-card.cjs');

const VERSION = '0.6.9';
const TARBALL_SHA1 = '13a66585528127d4c49344cec3fa166624285ee9';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout || '').trim()}`);
  return result;
}

function verifiedArtifact(root) {
  const configured = String(process.env.MATRIX_BRIDGE_ARTIFACT_DIR || '').trim();
  const cached = '/tmp/matrix-bridge-artifact-0.6.9/package';
  let source = configured || (fs.existsSync(path.join(cached, 'node_modules')) ? cached : '');
  if (!source) {
    const download = path.join(root, 'download');
    fs.mkdirSync(download);
    const packed = run('npm', ['pack', `@modelzen/feishu-codex-bridge@${VERSION}`, '--pack-destination', download], { cwd: root });
    const filename = packed.stdout.trim().split(/\r?\n/).at(-1);
    const tarball = path.join(download, filename);
    assert.strictEqual(crypto.createHash('sha1').update(fs.readFileSync(tarball)).digest('hex'), TARBALL_SHA1);
    run('tar', ['-xzf', tarball, '-C', download]);
    source = path.join(download, 'package');
    run('npm', ['install', '--ignore-scripts', '--omit=dev'], { cwd: source });
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  assert.strictEqual(manifest.name, '@modelzen/feishu-codex-bridge');
  assert.strictEqual(manifest.version, VERSION);
  assert.strictEqual(manifest.type, 'module');
  assert.strictEqual(sha256(fs.readFileSync(path.join(source, 'dist/cli.js'))), ORIGINAL_SHA256);
  assert.ok(fs.existsSync(path.join(source, 'node_modules/@larksuiteoapi/node-sdk')));
  return source;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-bridge-esm-'));
try {
  const source = verifiedArtifact(root);
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

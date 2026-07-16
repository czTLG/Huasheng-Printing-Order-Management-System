'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const patcherPath = path.resolve(__dirname, '..', '..', 'bridge-patch', 'patch-stream-card.cjs');
const dockerfilePath = path.resolve(__dirname, '..', '..', 'Dockerfile');
const { ORIGINAL_SHA256, PATCHED_SHA256, patchSource, patchFile } = require(patcherPath);

const fixture = `var __defProp = Object.defineProperty;
async function intake(msg, project) {
  const text = msg.content.trim();
  const cmd = parseCommand(text);
  return cmd;
}
function boot(channel, cfg, cliBridge) {
  const dispatcher = new CardDispatcher(channel, cfg);
  cliBridge?.register(dispatcher);
}
`;

const behaviorFixture = `var __defProp = Object.defineProperty;
class CardDispatcher { constructor(channel, cfg) {} }
export default async function run(msg, project) {
  const channel = {};
  const cfg = {};
  const cliBridge = null;
  const sendManagedCard = () => {};
  const updateManagedCard = () => {};
  const card = () => {};
  const md = () => {};
  const note = () => {};
  const hr = () => {};
  const actions = () => {};
  const button = () => {};
  const linkButton = () => {};
  const parseCommand = text => { project.events.push('generic:' + text); return text; };
  const dispatcher = new CardDispatcher(channel, cfg);
  cliBridge?.register(dispatcher);
  const text = msg.content.trim();
  const cmd = parseCommand(text);
  return cmd;
};
`;

const registrationBlock = `const streamCardPath = process.env.STREAM_CARD_EXTENSION;
  const streamCardRequire = createStreamCardRequire(import.meta.url);
  const streamCardExtension = streamCardPath ? streamCardRequire(streamCardPath) : null;
  const streamCardHandler = streamCardExtension?.register?.({
    channel, dispatcher, sendManagedCard, updateManagedCard,
    card: { card, md, note, hr, actions, button, linkButton }
  });`;
const messageLine = 'if (streamCardHandler?.onMessage && await streamCardHandler.onMessage({ msg, project })) return;';
const loaderLine = 'import { createRequire as createStreamCardRequire } from "node:module";';

function count(text, needle) {
  return text.split(needle).length - 1;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-patch-'));
(async () => {
try {
  assert.strictEqual(ORIGINAL_SHA256, 'b8016fbab2d60bc4da32b45f48564aec76059b184f943df1c1f0a4a1a1e32233');
  assert.strictEqual(PATCHED_SHA256, '95e6b56e8158124dda6a976bff7b1471d23f14386c772776386483c517de3078');
  assert.notStrictEqual(PATCHED_SHA256, ORIGINAL_SHA256);
  const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
  assert.ok(dockerfile.includes('npm install -g @openai/codex @modelzen/feishu-codex-bridge@0.6.9'));
  assert.ok(dockerfile.includes('COPY bridge-patch/patch-stream-card.cjs /tmp/patch-stream-card.cjs'));
  assert.ok(dockerfile.includes('node /tmp/patch-stream-card.cjs "$(npm root -g)/@modelzen/feishu-codex-bridge/dist/cli.js"'));
  assert.ok(dockerfile.includes('&& rm /tmp/patch-stream-card.cjs'));

  const unknownPath = path.join(tmp, 'unknown.js');
  fs.writeFileSync(unknownPath, fixture);
  const unknownBefore = crypto.createHash('sha256').update(fs.readFileSync(unknownPath)).digest('hex');
  assert.throws(() => patchFile(unknownPath), /checksum mismatch/);
  assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(unknownPath)).digest('hex'), unknownBefore);

  assert.throws(() => patchSource(fixture.replace('  const cmd = parseCommand(text);\n', '')), /message anchor.*exactly once/);
  assert.throws(() => patchSource(fixture.replace('  cliBridge?.register(dispatcher);\n', '')), /registration anchor.*exactly once/);
  assert.throws(() => patchSource(fixture.replace('  const cmd = parseCommand(text);\n', '  const cmd = parseCommand(text);\n  const cmd = parseCommand(text);\n')), /message anchor.*exactly once/);
  assert.throws(() => patchSource(fixture.replace('  cliBridge?.register(dispatcher);\n', '  cliBridge?.register(dispatcher);\n  cliBridge?.register(dispatcher);\n')), /registration anchor.*exactly once/);

  const patched = patchSource(fixture);
  assert.strictEqual(count(patched, loaderLine), 1);
  assert.strictEqual(count(patched, registrationBlock), 1);
  assert.strictEqual(count(patched, messageLine), 1);
  assert.ok(patched.indexOf(messageLine) < patched.indexOf('const cmd = parseCommand(text);'));
  assert.strictEqual(patchSource(patched), patched);
  assert.strictEqual(count(patchSource(patched), registrationBlock), 1);
  assert.strictEqual(count(patchSource(patched), messageLine), 1);

  const extensionPath = path.join(tmp, 'extension.cjs');
  const behaviorPath = path.join(tmp, 'behavior.mjs');
  fs.writeFileSync(extensionPath, `module.exports.register = () => ({ onMessage: async ({ msg, project }) => { project.events.push('extension:' + msg.content); return msg.content === 'handled'; } });\n`);
  fs.writeFileSync(behaviorPath, patchSource(behaviorFixture));
  const previousExtension = process.env.STREAM_CARD_EXTENSION;
  process.env.STREAM_CARD_EXTENSION = extensionPath;
  try {
    const { default: run } = await import(pathToFileURL(behaviorPath).href);
    const unknownProject = { events: [] };
    assert.strictEqual(await run({ content: 'unknown' }, unknownProject), 'unknown');
    assert.deepStrictEqual(unknownProject.events, ['extension:unknown', 'generic:unknown']);
    const handledProject = { events: [] };
    assert.strictEqual(await run({ content: 'handled' }, handledProject), undefined);
    assert.deepStrictEqual(handledProject.events, ['extension:handled']);
  } finally {
    if (previousExtension === undefined) delete process.env.STREAM_CARD_EXTENSION;
    else process.env.STREAM_CARD_EXTENSION = previousExtension;
  }

  console.log('bridge patch tests passed');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

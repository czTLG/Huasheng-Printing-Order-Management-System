'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const watcher = require('../scripts/stream-watch.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-watch-routing-'));
const botDir = path.join(root, 'bots', 'app-test');
fs.mkdirSync(botDir, { recursive: true });

const writeProjects = projects => fs.writeFileSync(
  path.join(botDir, 'projects.json'),
  JSON.stringify({ version: 1, projects })
);

writeProjects([
  { name: 'build', chatId: 'chat-build' },
  { name: 'vm_debug_ci', chatId: 'chat-vm' }
]);

assert.strictEqual(watcher.resolveOrderChatId({
  appId: 'app-test',
  projectName: 'vm_debug_ci',
  bridgeRoot: root
}), 'chat-vm');

assert.strictEqual(watcher.resolveOrderChatId({
  explicitChatId: 'chat-explicit',
  appId: 'app-test',
  projectName: 'vm_debug_ci',
  bridgeRoot: root
}), 'chat-explicit');

writeProjects([{ name: 'build', chatId: 'chat-build' }]);
assert.throws(() => watcher.resolveOrderChatId({
  appId: 'app-test',
  projectName: 'vm_debug_ci',
  bridgeRoot: root
}), /not found/);

writeProjects([
  { name: 'vm_debug_ci', chatId: 'chat-vm-a' },
  { name: 'vm_debug_ci', chatId: 'chat-vm-b' }
]);
assert.throws(() => watcher.resolveOrderChatId({
  appId: 'app-test',
  projectName: 'vm_debug_ci',
  bridgeRoot: root
}), /multiple/);

fs.rmSync(root, { recursive: true, force: true });
console.log('PASS stream watch order routing');

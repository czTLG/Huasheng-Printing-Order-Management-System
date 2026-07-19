'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const workspace = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(workspace, 'scripts/matrix-client.js'), 'utf8');
const command = fs.readFileSync(path.join(workspace, 'scripts/matrix-context.js'), 'utf8');
const instructions = fs.readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8');

assert.match(client, /function contextSearch\(/);
assert.match(client, /'\/context\/search'/);
assert.match(command, /MATRIX_OWNER_OPEN_ID/);
assert.match(command, /contextSearch/);
assert.match(instructions, /matrix-context\.js/);
assert.match(instructions, /不得.*Outlook.*Gmail/);
assert.match(instructions, /客户.*邮件线程.*附件.*询盘.*核算任务/);

console.log('PASS matrix context bridge');

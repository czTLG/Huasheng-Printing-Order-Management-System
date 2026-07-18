'use strict';

const assert = require('node:assert');
const { createMatrixChannelPolicy } = require('../src/services/matrixChannelPolicy');
const fixture = require('./fixtures/matrix-core/channel-routing.json');

const policy = createMatrixChannelPolicy(fixture);
assert.strictEqual(policy.classifyChat(fixture.billChatId), 'bill');
assert.strictEqual(policy.classifyChat(fixture.vmciChatId), 'vmci');
assert.strictEqual(policy.authoritativeChannel('quote_followup'), 'bill');
assert.strictEqual(policy.authoritativeChannel('cost_review'), 'vmci');
assert.deepStrictEqual(policy.routeIncoming({ chatId: fixture.vmciChatId, taskType: 'quote_followup' }), { accepted: false, channel: 'vmci', authoritativeChannel: 'bill', handoffRequired: true });
assert.deepStrictEqual(policy.routeIncoming({ chatId: fixture.billChatId, taskType: 'quote_followup' }), { accepted: true, channel: 'bill', authoritativeChannel: 'bill', handoffRequired: false });
for (const bad of ['', null, fixture.billChatId.slice(0, -1), ` ${fixture.billChatId}`, 'Bill', 'unknown']) {
  assert.throws(() => policy.classifyChat(bad), /exact configured chat id/i);
}
assert.throws(() => createMatrixChannelPolicy({ billChatId: fixture.billChatId, vmciChatId: fixture.billChatId }), /distinct/i);
assert.throws(() => policy.authoritativeChannel('unknown_task'), /task type.*declared/i);
assert.throws(() => policy.assertBoundChat('bill', fixture.vmciChatId), /channel chat mismatch/i);
console.log('PASS matrix channel policy');

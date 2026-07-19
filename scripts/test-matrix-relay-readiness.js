'use strict';

const assert = require('node:assert');
const { run } = require('./check-matrix-relay-readiness');

(async () => {
  let sends = 0;
  const output = [];
  const result = await run({
    factory: {
      senderAddress: 'sales@gdhspack.com',
      replyToAddress: 'sales@gdhspack.com',
      transport: { async sendMail() { sends += 1; } },
      async readiness() { return { ready: true, checkedAt: '2026-07-19T02:00:00.000Z', errorClass: '' }; }
    },
    write: value => output.push(value)
  });
  assert.strictEqual(sends, 0);
  assert.strictEqual(result.send_invoked, false);
  assert.deepStrictEqual(output, [result]);
  console.log('matrix relay readiness tests passed');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

'use strict';

const assert = require('node:assert');
const { createMatrixRelayFactory } = require('../src/services/matrixRelayFactory');

(async () => {
  const calls = { create: 0, verify: 0, send: 0 };
  const fakeTransport = {
    async verify() { calls.verify += 1; return true; },
    async sendMail(mail) { calls.send += 1; return { accepted: [mail.to], rejected: [] }; }
  };
  const nodemailerImpl = {
    createTransport(options) {
      calls.create += 1;
      assert.deepStrictEqual(options, {
        host: 'smtp.example.test', port: 465, secure: true,
        auth: { user: 'sales@example.test', pass: 'test-secret' }
      });
      return fakeTransport;
    }
  };
  const env = {
    SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465', SMTP_SECURE: 'true',
    SMTP_USER: 'sales@example.test', SMTP_PASS: 'test-secret',
    SMTP_FROM: 'Huasheng Packaging Editorial Team <sales@gdhspack.com>'
  };
  const relay = createMatrixRelayFactory({ env, nodemailerImpl, clock: () => new Date('2026-07-19T01:00:00Z') });
  assert.strictEqual(relay.senderAddress, 'sales@gdhspack.com');
  assert.strictEqual(relay.senderHeader, 'Gavin | Huasheng Packaging <sales@gdhspack.com>');
  assert.strictEqual(relay.replyToAddress, 'sales@gdhspack.com');
  assert.deepStrictEqual(await relay.readiness(), { ready: true, checkedAt: '2026-07-19T01:00:00.000Z', errorClass: '' });
  assert.deepStrictEqual(calls, { create: 1, verify: 1, send: 0 });

  assert.throws(() => createMatrixRelayFactory({ env: { ...env, SMTP_FROM: 'other@example.test' }, nodemailerImpl }), /sender identity/);
  assert.throws(() => createMatrixRelayFactory({ env: { ...env, SMTP_PASS: '' }, nodemailerImpl }), /SMTP configuration incomplete/);
  console.log('matrix relay factory tests passed');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

'use strict';

const path = require('node:path');
const dotenv = require('dotenv');
const { createMatrixRelayFactory } = require('../src/services/matrixRelayFactory');

async function run({ factory, write = value => process.stdout.write(`${JSON.stringify(value)}\n`) } = {}) {
  const relay = factory || createMatrixRelayFactory({ env: process.env });
  const result = await relay.readiness();
  const safe = {
    ready: result.ready === true,
    checked_at: result.checkedAt || null,
    error_class: result.errorClass || '',
    sender: relay.senderAddress,
    reply_to: relay.replyToAddress,
    send_invoked: false
  };
  write(safe);
  if (!safe.ready) process.exitCode = 1;
  return safe;
}

if (require.main === module) {
  if (!process.argv.includes('--no-send')) throw new Error('--no-send is required');
  const envPath = path.resolve(process.env.MATRIX_RELAY_ENV_FILE || '/etc/packaging-system/smtp.env');
  dotenv.config({ path: envPath, quiet: true, override: false });
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ ready: false, error_class: 'relay_preflight_failed', send_invoked: false })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { run };

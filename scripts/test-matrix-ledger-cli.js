'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, run } = require('./run-matrix-ledger-command');

(async () => {
  const intakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-intake-cli-'));
  const intakePath = path.join(intakeDir, 'request.json');
  fs.writeFileSync(intakePath, JSON.stringify({ candidate_id: 71, subject: 'Exact' }), { mode: 0o600 });
  assert.deepStrictEqual(parseArgs(['customer', 'get', '--id', '115']), {
    command: 'customer.get', customerId: 115
  });
  assert.deepStrictEqual(parseArgs(['preview', 'get', '--customer-id', '115']), {
    command: 'preview.get', customerId: 115
  });
  assert.throws(() => parseArgs(['delivery', 'confirm', '--customer-id', '115']), /version-id/);
  assert.throws(
    () => parseArgs([
      'delivery', 'confirm', '--customer-id', '115', '--version-id', '902',
      '--content-hash', 'a'.repeat(64), '--confirmation', '确认', '--idempotency-key', 'key-1'
    ]),
    /exact confirmation/
  );

  const calls = [];
  const client = {
    customerGet: async (...args) => { calls.push(['customerGet', ...args]); return { customer_id: 115 }; },
    finalPreview: async (...args) => { calls.push(['finalPreview', ...args]); return { version_id: 902 }; },
    confirmDelivery: async (...args) => { calls.push(['confirmDelivery', ...args]); return { state: 'accepted' }; },
    threadList: async (...args) => { calls.push(['threadList', ...args]); return { rows: [] }; },
    taskList: async (...args) => { calls.push(['taskList', ...args]); return { rows: [] }; }
    , createIntake: async (...args) => { calls.push(['createIntake', ...args]); return { status: 'draft' }; }
  };
  const env = { MATRIX_CONTEXT_OPEN_ID: 'ou-current', MATRIX_INTAKE_DIR: intakeDir };
  assert.deepStrictEqual(await run([
    'intake', 'create', '--input', intakePath, '--idempotency-key', 'intake-cli-1'
  ], { client, env }), { status: 'draft' });
  assert.deepStrictEqual(calls.at(-1), ['createIntake', 'ou-current', {
    candidate_id: 71, subject: 'Exact', idempotency_key: 'intake-cli-1'
  }]);
  fs.chmodSync(intakePath, 0o644);
  await assert.rejects(() => run([
    'intake', 'create', '--input', intakePath, '--idempotency-key', 'intake-cli-2'
  ], { client, env }), /permissions/);
  fs.chmodSync(intakePath, 0o600);
  const credentialPath = path.join(intakeDir, 'credential.json');
  fs.writeFileSync(credentialPath, JSON.stringify({ candidate_id: 71, smtp_token: 'forbidden' }), { mode: 0o600 });
  await assert.rejects(() => run([
    'intake', 'create', '--input', credentialPath, '--idempotency-key', 'intake-cli-3'
  ], { client, env }), /credential-like key/);
  const symlinkPath = path.join(intakeDir, 'link.json');
  fs.symlinkSync(intakePath, symlinkPath);
  await assert.rejects(() => run([
    'intake', 'create', '--input', symlinkPath, '--idempotency-key', 'intake-cli-4'
  ], { client, env }), /regular protected file/);
  assert.deepStrictEqual(await run(['customer', 'get', '--id', '115'], { client, env }), { customer_id: 115 });
  assert.deepStrictEqual(await run(['preview', 'get', '--customer-id', '115'], { client, env }), { version_id: 902 });
  assert.deepStrictEqual(await run(['thread', 'list', '--customer-id', '115'], { client, env }), { rows: [] });
  assert.deepStrictEqual(await run(['task', 'list', '--customer-id', '115'], { client, env }), { rows: [] });
  assert.deepStrictEqual(await run([
    'delivery', 'confirm', '--customer-id', '115', '--version-id', '902',
    '--content-hash', 'a'.repeat(64), '--confirmation', '确认发送 UNITEA Kazakhstan',
    '--idempotency-key', 'key-1', '--chat-id', 'current-session', '--card-event-id', 'cli-1'
  ], { client, env }), { state: 'accepted' });
  assert.deepStrictEqual(calls.at(-1), [
    'confirmDelivery', 'ou-current', 115, 902, {
      expected_content_hash: 'a'.repeat(64),
      confirmation_text: '确认发送 UNITEA Kazakhstan',
      idempotency_key: 'key-1',
      chat_id: 'current-session',
      card_event_id: 'cli-1'
    }
  ]);
  await assert.rejects(() => run(['customer', 'get', '--id', '115'], { client, env: {} }), /open id/);
  fs.rmSync(intakeDir, { recursive: true, force: true });
  console.log('matrix ledger CLI tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

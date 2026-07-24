'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  ensureCutoverSchema,
  enableCanonicalDeliveryOnly,
  assertCanonicalDeliveryOnly,
  scan
} = require('../src/services/matrixLedgerCutover');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-ledger-cutover-'));
(async () => {
try {
  const db = new Database(':memory:');
  ensureCutoverSchema(db);
  assert.throws(() => assertCanonicalDeliveryOnly({ db }), /canonical delivery required/);
  assert.deepStrictEqual(enableCanonicalDeliveryOnly({ db, actorUserId: 7, now: '2026-07-24T00:00:00.000Z' }), {
    state_key: 'canonical_delivery_only',
    state_value: '1'
  });
  assert.doesNotThrow(() => assertCanonicalDeliveryOnly({ db }));
  assert.throws(
    () => db.prepare("UPDATE matrix_runtime_state SET state_value = '0' WHERE state_key = 'canonical_delivery_only'").run(),
    /cannot be disabled/
  );

  const directTree = path.join(root, 'direct');
  fs.mkdirSync(directTree);
  fs.writeFileSync(path.join(directTree, 'temporary-sender.js'), "require('nodemailer').createTransport({}).sendMail({to:'x'});\n");
  assert.throws(() => scan({ trees: [directTree] }), /direct delivery path/);

  const safeTree = path.join(root, 'safe');
  fs.mkdirSync(safeTree);
  fs.writeFileSync(path.join(safeTree, 'client.js'), "fetch('http://127.0.0.1/api/matrix/customers/1/final-preview');\n");
  assert.doesNotThrow(() => scan({ trees: [safeTree] }));

  const registry = path.join(root, 'registry.csv');
  fs.writeFileSync(registry, 'id,status\n1,submitted\n', { mode: 0o660 });
  assert.throws(() => scan({ trees: [safeTree], legacyPaths: [registry] }), /legacy ledger must be read-only/);
  fs.chmodSync(registry, 0o640);
  assert.doesNotThrow(() => scan({ trees: [safeTree], legacyPaths: [registry] }));

  let fallbackCalls = 0;
  const unavailableClient = async () => { throw new Error('management service unavailable'); };
  const legacySend = async () => {
    await unavailableClient();
    fallbackCalls += 1;
  };
  await assert.rejects(() => legacySend(), /management service unavailable/);
  assert.strictEqual(fallbackCalls, 0);
  db.close();
  console.log('matrix ledger cutover tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

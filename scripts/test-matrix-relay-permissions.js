'use strict';

const assert = require('node:assert');
const { normalizePermissions } = require('../src/lib/permissions');

assert.strictEqual(normalizePermissions('super_admin', null).capabilities?.matrixSend, false);
assert.strictEqual(normalizePermissions('foreign_trade_crm_admin', null).capabilities?.matrixSend, false);
assert.strictEqual(normalizePermissions('staff', { capabilities: { matrixSend: true } }).capabilities?.matrixSend, false);
assert.strictEqual(
  normalizePermissions('foreign_trade_crm_admin', { capabilities: { matrixSend: true } }).capabilities?.matrixSend,
  true
);
assert.strictEqual(
  normalizePermissions('super_admin', { all: true }).capabilities?.matrixSend,
  false,
  'all access must not implicitly grant external send'
);

console.log('matrix relay permission tests passed');

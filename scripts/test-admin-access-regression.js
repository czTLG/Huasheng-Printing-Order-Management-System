const assert = require('node:assert');
const { normalizePermissions } = require('../src/lib/permissions');

assert.strictEqual(normalizePermissions('foreign_trade_crm_admin', {}).capabilities.matrixSend, false);
assert.strictEqual(normalizePermissions('foreign_trade_crm_admin', { capabilities: { matrixSend: true } }).capabilities.matrixSend, true);
assert.strictEqual(normalizePermissions('super_admin', { capabilities: { matrixSend: true } }).capabilities.matrixSend, true);
assert.strictEqual(normalizePermissions('worker', { capabilities: { matrixSend: true } }).capabilities.matrixSend, false);
assert.strictEqual(normalizePermissions('worker', { all: true }).capabilities.matrixSend, true);

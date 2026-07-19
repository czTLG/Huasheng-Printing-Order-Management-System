'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/server.js'), 'utf8');
const dropIn = fs.readFileSync(path.join(__dirname, '..', 'deploy/systemd/packaging-system-relay.conf'), 'utf8');
assert.ok(source.includes("require('./services/matrixRelayFactory')"));
assert.ok(source.includes("require('./services/matrixStreamDelivery')"));
assert.ok(source.includes("require('./services/matrixStreamReadiness')"));
assert.ok(source.includes("require('./services/matrixStreamPreview')"));
assert.ok(source.includes("process.env.MATRIX_RELAY_ENABLED === '1'"));
assert.ok(source.includes('deliveryService: matrixDeliveryService'));
assert.ok(source.includes('previewService: matrixPreviewService'));
assert.ok(source.includes('resolveTxt: dns.resolveTxt'));
assert.ok(source.includes("fromAddress: matrixRelayFactory.senderAddress"));
assert.ok(source.includes("replyToAddress: matrixRelayFactory.replyToAddress"));
assert.ok(!source.includes('/etc/packaging-system/smtp.env'), 'server code must not open protected config directly');
assert.ok(!source.includes('SMTP_PASS='), 'server source must not embed a credential');
assert.match(dropIn, /^\[Service\]\nEnvironmentFile=\/etc\/packaging-system\/smtp\.env\nEnvironment=MATRIX_RELAY_ENABLED=1\nEnvironment=MATRIX_MESSAGE_ID_DOMAIN=gdhspack\.com\nEnvironment=MATRIX_DKIM_SELECTOR=default\n$/);
assert.ok(!/SMTP_(?:PASS|USER|HOST)=/.test(dropIn), 'relay drop-in must contain no SMTP values');
console.log('matrix relay server wiring tests passed');

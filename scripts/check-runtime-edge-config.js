'use strict';

const assert = require('node:assert');
const fs = require('node:fs');

const file = process.argv[2];
if (!file) throw new Error('nginx site path required');

const source = fs.readFileSync(file, 'utf8');
assert.match(
  source,
  /^\s*listen 443 ssl http2;/m,
  'IPv4 TLS listener must enable HTTP/2'
);
assert.match(
  source,
  /^\s*listen \[::\]:443 ssl http2(?: ipv6only=on)?;/m,
  'IPv6 TLS listener must enable HTTP/2'
);

console.log('runtime edge config verified');

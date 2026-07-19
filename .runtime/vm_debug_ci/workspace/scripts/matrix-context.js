#!/usr/bin/env node
'use strict';

const client = require('./matrix-client.js');

async function main() {
  const query = process.argv.slice(2).join(' ').trim();
  const openId = String(process.env.MATRIX_OWNER_OPEN_ID || '').trim();
  if (!openId) throw new Error('MATRIX_OWNER_OPEN_ID is required');
  if (query.length < 2) throw new Error('usage: matrix-context.js <company, contact, or email>');
  const result = await client.contextSearch(openId, query);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error?.message || 'context lookup failed'}\n`);
  process.exit(1);
});

module.exports = { main };

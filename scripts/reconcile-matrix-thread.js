#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function main() {
  const inputPath = path.resolve(process.argv[2] || '');
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error('private input file required');
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const { db, initDb } = require('../src/db');
  const { reconcileThread } = require('../src/services/matrixThreadReconcile');
  const originalLog = console.log;
  console.log = () => {};
  try { initDb(); } finally { console.log = originalLog; }
  if (!input.customer?.email && Array.isArray(input.email_message_ids)) {
    const inbound = db.prepare(`
      SELECT contact_email, from_name FROM email_messages
      WHERE id IN (${input.email_message_ids.map(() => '?').join(',')}) AND direction = 'inbound'
      ORDER BY received_at ASC, id ASC LIMIT 1
    `).get(...input.email_message_ids);
    input.customer = { ...input.customer, email: inbound?.contact_email, contact_person: input.customer?.contact_person || inbound?.from_name };
  }
  const result = reconcileThread(db, input);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    customer_id: result.customer_id,
    inquiry_id: result.inquiry_id,
    specification_id: result.specification_id,
    costing_request_id: result.costing_request_id,
    linked_message_count: result.email_message_ids.length
  })}\n`);
}

try { main(); }
catch (_) {
  process.stdout.write(`${JSON.stringify({ ok: false, code: 'MATRIX_RECONCILE_FAILED' })}\n`);
  process.exitCode = 1;
}

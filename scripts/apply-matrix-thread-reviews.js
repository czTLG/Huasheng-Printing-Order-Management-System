#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildThreadContext } = require('../src/services/matrixThreadContext');
const { saveThreadReview } = require('../src/services/matrixThreadReview');

function main() {
  const inputPath = path.resolve(process.argv[2] || '');
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error('private input file required');
  const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const { db, initDb } = require('../src/db');
  const originalLog = console.log; console.log = () => {};
  try { initDb(); } finally { console.log = originalLog; }
  const results = [];
  db.transaction(() => {
    for (const item of Array.isArray(payload.items) ? payload.items : []) {
      const context = buildThreadContext(db, Number(item.email_message_id));
      const saved = saveThreadReview(db, { ...item, thread_key: context.thread_key, source: 'human_verified' });
      results.push({ email_message_id: Number(item.email_message_id), quality_rank: Number(saved.quality_rank) });
    }
  })();
  process.stdout.write(`${JSON.stringify({ ok: true, applied: results.length, results })}\n`);
}

try { main(); }
catch (_) {
  process.stdout.write(`${JSON.stringify({ ok: false, code: 'MATRIX_THREAD_REVIEW_FAILED' })}\n`);
  process.exitCode = 1;
}

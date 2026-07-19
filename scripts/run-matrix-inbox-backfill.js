#!/usr/bin/env node
'use strict';

const { initDb } = require('../src/db');
const { syncMailbox } = require('../src/lib/imapSync');

function positiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

async function main() {
  if (process.env.MATRIX_INBOX_ENABLED !== '1') {
    throw new Error('matrix inbox is not enabled');
  }
  initDb();
  const folder = process.env.MATRIX_INBOX_BACKFILL_FOLDER === 'Sent' ? 'Sent' : 'INBOX';
  const result = await syncMailbox({
    folder,
    days: positiveInteger(process.env.MATRIX_INBOX_BACKFILL_DAYS, 90, 365),
    limit: positiveInteger(process.env.MATRIX_INBOX_BACKFILL_LIMIT, 2000, 5000),
    operator: 'matrix-backfill',
    syncType: 'backfill'
  });
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    run_id: result.id,
    scanned_count: result.scanned_count,
    inserted_count: result.inserted_count,
    skipped_count: result.skipped_count,
    error_count: result.error_count
  })}\n`);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ status: 'failed', code: String(error?.code || 'BACKFILL_FAILED') })}\n`);
  process.exitCode = 1;
});

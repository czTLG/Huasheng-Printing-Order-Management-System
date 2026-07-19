#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { db } = require('../src/db');

function grouped(table, column) {
  return Object.fromEntries(db.prepare(`SELECT ${column} state, COUNT(*) count FROM ${table} GROUP BY ${column}`)
    .all().map((row) => [String(row.state || 'unset'), Number(row.count)]));
}

function fileSafety() {
  const root = path.resolve(process.env.MATRIX_INBOX_ATTACHMENT_ROOT || '');
  const rows = db.prepare(`
    SELECT storage_key, file_size FROM matrix_inbox_attachments
    WHERE availability_state = 'available' AND storage_key IS NOT NULL AND storage_key <> ''
  `).all();
  let valid = 0;
  for (const row of rows) {
    const target = path.resolve(root, String(row.storage_key));
    if (!target.startsWith(`${root}${path.sep}`)) continue;
    try {
      const stat = fs.lstatSync(target);
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size === Number(row.file_size) && (stat.mode & 0o077) === 0) valid += 1;
    } catch (_) {}
  }
  return { expected: rows.length, valid };
}

const duplicateJobs = Number(db.prepare(`
  SELECT COUNT(*) count FROM (
    SELECT email_message_id FROM matrix_inbox_jobs GROUP BY email_message_id HAVING COUNT(*) > 1
  )
`).get().count || 0);
const latestRun = db.prepare(`
  SELECT status, sync_type, scanned_count, inserted_count, skipped_count, error_count
  FROM email_sync_runs ORDER BY id DESC LIMIT 1
`).get() || {};
const safety = fileSafety();
const output = {
  jobs: grouped('matrix_inbox_jobs', 'delivery_state'),
  correlation: grouped('matrix_inbox_jobs', 'correlation_state'),
  attachments: grouped('matrix_inbox_attachments', 'availability_state'),
  attachment_files: safety,
  duplicate_jobs: duplicateJobs,
  latest_sync: latestRun,
  ok: duplicateJobs === 0 && safety.expected === safety.valid && Number(latestRun.error_count || 0) === 0
};
process.stdout.write(`${JSON.stringify(output)}\n`);
if (!output.ok) process.exitCode = 1;

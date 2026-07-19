#!/usr/bin/env node
'use strict';

const { db } = require('../src/db');

const cutoff = '2026-06-30T16:00:00.000Z';
const result = db.prepare(`
  UPDATE matrix_inbox_jobs
  SET delivery_state = 'suppressed', lease_token = NULL, lease_expires_at = NULL,
      last_error = 'historical_cutoff', updated_at = datetime('now')
  WHERE delivery_state IN ('pending', 'retry')
    AND email_message_id IN (
      SELECT id FROM email_messages
      WHERE datetime(COALESCE(received_at, created_at)) < datetime(?)
    )
`).run(cutoff);

process.stdout.write(`${JSON.stringify({ ok: true, suppressed_count: Number(result.changes || 0) })}\n`);

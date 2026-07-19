#!/usr/bin/env node
'use strict';

const { db } = require('../src/db');

const result = db.prepare(`
  UPDATE matrix_inbox_jobs
  SET delivery_state = 'triage_hold', lease_token = NULL, lease_expires_at = NULL,
      last_error = NULL, updated_at = datetime('now')
  WHERE delivery_state IN ('pending', 'retry')
`).run();

process.stdout.write(`${JSON.stringify({ ok: true, held_count: Number(result.changes || 0) })}\n`);

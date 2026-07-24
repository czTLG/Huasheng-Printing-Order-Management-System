#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { assertCanonicalDeliveryOnly, scan } = require('../src/services/matrixLedgerCutover');

const ROOT = path.resolve(__dirname, '..');

async function verify({ dbPath = process.env.DB_PATH || path.join(ROOT, 'data/app.db'), env = process.env } = {}) {
  const sourceFiles = [
    path.join(ROOT, 'scripts/run-matrix-ledger-command.js'),
    path.join(ROOT, '.runtime/vm_debug_ci/workspace/scripts/matrix-client.js'),
    path.join(ROOT, '.runtime/vm_debug_ci/workspace/scripts/matrix-watch.js'),
    path.join(ROOT, '.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs')
  ];
  const legacyPaths = [
    path.join(ROOT, '.worktrees/matrix-signal-sprint/docs/matrix-signal/registry.csv'),
    path.join(ROOT, '.worktrees/matrix-signal-sprint/runtime-data-matrix-signal-private/20260718')
  ].filter(target => fs.existsSync(target));
  scan({ trees: sourceFiles, legacyPaths });

  const relayFactory = fs.readFileSync(path.join(ROOT, 'src/services/matrixRelayFactory.js'), 'utf8');
  if (!relayFactory.includes("nodemailerImpl = require('nodemailer')")
      || !relayFactory.includes('nodemailerImpl.createTransport')
      || !relayFactory.includes('transport.sendMail')) {
    throw new Error('canonical relay factory missing');
  }
  for (const file of ['src/services/matrixStreamDelivery.js', 'src/services/matrixThreadDelivery.js']) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (!source.includes('assertCanonicalDeliveryOnly') && !source.includes("require('./matrixLedgerCutover')")) {
      throw new Error(`canonical delivery cutover missing: ${file}`);
    }
    if (/\bnodemailer\b|SMTP_[A-Z0-9_]+/.test(source)) throw new Error(`direct delivery path: ${file}`);
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try { assertCanonicalDeliveryOnly({ db }); } finally { db.close(); }

  let apiReady = 'static';
  const base = String(env.MATRIX_API_BASE_URL || '').trim();
  const token = String(env.MATRIX_BRIDGE_TOKEN || '').trim();
  const openId = String(env.MATRIX_CONTEXT_OPEN_ID || env.MATRIX_OWNER_OPEN_ID || '').trim();
  if (base && token && openId) {
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname.replace(/\/$/, '') !== '/api/matrix') {
      throw new Error('management API base invalid');
    }
    const response = await fetch(new URL(`${url.pathname.replace(/\/$/, '')}/ready`, url.origin), {
      headers: { 'x-matrix-bridge-token': token, 'x-feishu-open-id': openId },
      redirect: 'manual',
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`management service unavailable (${response.status})`);
    apiReady = 'live';
  }
  return { ready: true, api_ready: apiReady, send_invoked: false };
}

if (require.main === module) {
  if (!process.argv.slice(2).includes('--no-send')) {
    process.stderr.write('verification requires --no-send\n');
    process.exitCode = 2;
  } else {
    verify().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
  }
}

module.exports = { verify };

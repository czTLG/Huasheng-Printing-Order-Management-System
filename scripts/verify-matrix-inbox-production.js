#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { ImapFlow } = require('imapflow');

const PROTECTED_ENV = '/etc/packaging-system/smtp.env';
const INBOX_ENV = '/etc/packaging-system/inbox.env';
const DEFAULT_ATTACHMENT_ROOT = '/home/admin/work/packaging-system/runtime-data-matrix-inbox-private';

function bool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function candidatesFor(smtpHost) {
  const host = String(smtpHost || '').toLowerCase();
  if (host.includes('mxhichina')) return ['imap.mxhichina.com', 'imap.qiye.aliyun.com'];
  if (host.includes('aliyun')) return ['imap.qiye.aliyun.com', 'imap.mxhichina.com'];
  return ['imap.qiye.aliyun.com', 'imap.mxhichina.com'];
}

function privateRoot(root) {
  try {
    const stat = fs.lstatSync(root);
    return stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0;
  } catch (_) { return false; }
}

async function verifyHost(host, config) {
  const client = new ImapFlow({
    host,
    port: Number(config.port || 993),
    secure: bool(config.secure, true),
    auth: { user: config.user, pass: config.password },
    logger: false
  });
  try {
    await client.connect();
    await client.mailboxOpen('INBOX', { readOnly: true });
    return true;
  } catch (_) {
    return false;
  } finally {
    try { await client.logout(); } catch (_) {}
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--protected')) dotenv.config({ path: PROTECTED_ENV, quiet: true, override: false });
  const user = process.env.ALIYUN_MAIL_USER || process.env.SMTP_USER || '';
  const password = process.env.ALIYUN_MAIL_PASSWORD || process.env.SMTP_PASS || '';
  const explicitHost = process.env.MATRIX_INBOX_IMAP_HOST || process.env.ALIYUN_MAIL_IMAP_HOST || '';
  const hosts = explicitHost ? [explicitHost] : candidatesFor(process.env.SMTP_HOST);
  const attachmentRoot = process.env.MATRIX_INBOX_ATTACHMENT_ROOT || DEFAULT_ATTACHMENT_ROOT;
  const output = {
    configured: Boolean(user && password && hosts.length),
    tls: false,
    authenticated: false,
    inbox_opened: false,
    attachment_root_private: privateRoot(attachmentRoot)
  };
  let verifiedHost = '';
  if (output.configured) {
    for (const host of hosts) {
      if (await verifyHost(host, {
        user,
        password,
        port: process.env.MATRIX_INBOX_IMAP_PORT || process.env.ALIYUN_MAIL_IMAP_PORT || 993,
        secure: process.env.MATRIX_INBOX_IMAP_SECURE || process.env.ALIYUN_MAIL_IMAP_SECURE || 'true'
      })) {
        verifiedHost = host;
        output.tls = true;
        output.authenticated = true;
        output.inbox_opened = true;
        break;
      }
    }
  }
  const ok = Object.values(output).every(Boolean);
  if (ok && args.has('--write-config')) {
    if (process.getuid?.() !== 0) throw new Error('protected configuration installation requires root');
    const content = [
      'MATRIX_INBOX_ENABLED=1',
      `MATRIX_INBOX_IMAP_HOST=${verifiedHost}`,
      'MATRIX_INBOX_IMAP_PORT=993',
      'MATRIX_INBOX_IMAP_SECURE=true',
      `MATRIX_INBOX_ATTACHMENT_ROOT=${path.resolve(attachmentRoot)}`,
      ''
    ].join('\n');
    fs.writeFileSync(INBOX_ENV, content, { mode: 0o600 });
    fs.chmodSync(INBOX_ENV, 0o600);
    fs.chownSync(INBOX_ENV, 0, 0);
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (!ok) process.exitCode = 1;
}

main().catch(() => {
  process.stdout.write(`${JSON.stringify({ configured: false, tls: false, authenticated: false, inbox_opened: false, attachment_root_private: false })}\n`);
  process.exitCode = 1;
});

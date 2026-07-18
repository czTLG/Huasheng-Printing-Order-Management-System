#!/usr/bin/env node
'use strict';

const POLICY_STATUSES = new Set(['approved', 'paused', 'blocked']);

function validCountry(value) {
  const country = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error('exact ISO country required');
  return country;
}

function validChannel(value) {
  const channel = String(value || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(channel) || channel === 'all') throw new Error('exact channel required');
  return channel;
}

function parseArgs(argv) {
  const command = String(argv[0] || '').trim();
  if (!['list', 'set'].includes(command)) throw new Error('command must be list or set');
  const options = { command };
  const fields = {
    '--actor': 'actor', '--country': 'country', '--channel': 'channel', '--status': 'status',
    '--reviewed-at': 'reviewedAt', '--expires-at': 'expiresAt'
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--source-url') {
      if (index + 1 >= argv.length) throw new Error('source URL value required');
      options.sourceUrls = [...(options.sourceUrls || []), String(argv[index + 1] || '').trim()];
      index += 1;
      continue;
    }
    const field = fields[argument];
    if (!field || index + 1 >= argv.length) throw new Error('named flags only');
    if (Object.prototype.hasOwnProperty.call(options, field)) throw new Error('duplicate flag');
    options[field] = String(argv[index + 1] || '').trim();
    index += 1;
  }
  if (options.country !== undefined) options.country = validCountry(options.country);
  if (options.channel !== undefined) options.channel = validChannel(options.channel);
  return options;
}

function validatePolicy(input = {}) {
  const country = validCountry(input.country);
  const channel = validChannel(input.channel);
  const status = String(input.status || '').trim().toLowerCase();
  if (!POLICY_STATUSES.has(status)) throw new Error('policy status must be approved, paused, or blocked');
  const reviewedAtMs = Date.parse(String(input.reviewedAt || ''));
  const expiresAtMs = Date.parse(String(input.expiresAt || ''));
  if (!Number.isFinite(reviewedAtMs)) throw new Error('valid review time required');
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= reviewedAtMs) throw new Error('expiry must be after review time');
  const sourceUrls = Array.isArray(input.sourceUrls) ? input.sourceUrls : [];
  if (!sourceUrls.length) throw new Error('at least one authoritative source URL required');
  const normalizedSources = sourceUrls.map(value => {
    let url;
    try { url = new URL(String(value || '')); } catch (_) { throw new Error('valid authoritative source URL required'); }
    if (url.protocol !== 'https:' || !url.hostname.includes('.')) throw new Error('HTTPS authoritative source URL required');
    return url.toString();
  });
  return {
    actor: String(input.actor || '').trim(), country, channel, status,
    reviewedAt: new Date(reviewedAtMs).toISOString(), expiresAt: new Date(expiresAtMs).toISOString(),
    sourceUrls: [...new Set(normalizedSources)]
  };
}

function setPolicy(db, input = {}) {
  const value = validatePolicy(input);
  const actor = db.prepare('SELECT id, username, role, status FROM users WHERE username = ?').get(value.actor);
  if (!actor || actor.status !== 'active' || actor.role !== 'super_admin') throw new Error('active super_admin actor required');
  const write = db.transaction(() => {
    db.prepare(`
      INSERT INTO matrix_stream_country_policies (
        country_code, channel, status, sender_identity_required, opt_out_required,
        reviewed_by, reviewed_at, expires_at, source_urls_json
      ) VALUES (?, ?, ?, 1, 1, ?, ?, ?, ?)
      ON CONFLICT(country_code, channel) DO UPDATE SET
        status = excluded.status, sender_identity_required = 1, opt_out_required = 1,
        reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at,
        expires_at = excluded.expires_at, source_urls_json = excluded.source_urls_json
    `).run(value.country, value.channel, value.status, actor.id, value.reviewedAt, value.expiresAt,
      JSON.stringify(value.sourceUrls));
    const detail = {
      country_code: value.country, channel: value.channel, status: value.status,
      reviewed_at: value.reviewedAt, expires_at: value.expiresAt, source_count: value.sourceUrls.length
    };
    db.prepare(`
      INSERT INTO audit_logs (role, user_name, action, resource_type, resource_id, detail, created_at)
      VALUES (?, ?, 'matrix_policy_set', 'matrix_country_policy', ?, ?, ?)
    `).run(actor.role, actor.username, `${value.country}:${value.channel}`, JSON.stringify(detail), value.reviewedAt);
    return db.prepare('SELECT * FROM matrix_stream_country_policies WHERE country_code = ? AND channel = ?')
      .get(value.country, value.channel);
  });
  return write.immediate();
}

function listPolicies(db, input = {}) {
  const clauses = [];
  const values = [];
  if (input.country) { clauses.push('country_code = ?'); values.push(validCountry(input.country)); }
  if (input.channel) { clauses.push('channel = ?'); values.push(validChannel(input.channel)); }
  return db.prepare(`SELECT * FROM matrix_stream_country_policies${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY country_code, channel`).all(...values);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { db, initDb } = require('../src/db');
  try {
    initDb();
    const result = options.command === 'set' ? setPolicy(db, options) : listPolicies(db, options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`Policy operation failed: ${error?.message || 'unknown error'}\n`);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, setPolicy, listPolicies };

#!/usr/bin/env node
'use strict';

const { db, initDb, now } = require('../src/db');

const ALLOWED_TARGET_ROLES = new Set(['super_admin', 'foreign_trade_crm_admin']);

function parseArgs(argv) {
  const result = { replace: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--replace') {
      result.replace = true;
      continue;
    }
    const fields = { '--open-id': 'openId', '--username': 'username', '--bound-by': 'boundBy' };
    const field = fields[argument];
    if (!field || index + 1 >= argv.length) throw new Error('invalid arguments');
    result[field] = String(argv[index + 1] || '').trim();
    index += 1;
  }
  if (!result.openId || !result.username || !result.boundBy || result.openId.length > 128) throw new Error('required arguments missing');
  return result;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  initDb();
  const target = db.prepare('SELECT id, username, role, status FROM users WHERE username = ?').get(options.username);
  const operator = db.prepare('SELECT id, username, role, status FROM users WHERE username = ?').get(options.boundBy);
  if (!target || !operator) throw new Error('user not found');
  if (target.status !== 'active' || operator.status !== 'active') throw new Error('active user required');
  if (!ALLOWED_TARGET_ROLES.has(target.role)) throw new Error('target role not allowed');
  if (operator.role !== 'super_admin') throw new Error('binding administrator role required');

  const bind = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM matrix_actor_bindings WHERE feishu_open_id = ?').get(options.openId);
    if (existing && existing.status === 'active' && existing.user_id !== target.id && !options.replace) {
      throw new Error('active binding replacement requires --replace');
    }
    const at = now();
    if (!existing) {
      db.prepare(`
        INSERT INTO matrix_actor_bindings (feishu_open_id, user_id, status, bound_by, bound_at, revoked_at)
        VALUES (?, ?, 'active', ?, ?, NULL)
      `).run(options.openId, target.id, operator.id, at);
    } else if (existing.user_id !== target.id || existing.status !== 'active') {
      db.prepare(`
        UPDATE matrix_actor_bindings
        SET user_id = ?, status = 'active', bound_by = ?, bound_at = ?, revoked_at = NULL
        WHERE id = ?
      `).run(target.id, operator.id, at, existing.id);
    }
    db.prepare(`
      INSERT INTO audit_logs (role, user_name, action, resource_type, resource_id, detail, created_at)
      VALUES (?, ?, 'matrix_bind_actor', 'matrix_actor_binding', '', ?, ?)
    `).run(operator.role, operator.username, JSON.stringify({ targetUserId: target.id, replaced: Boolean(existing && existing.user_id !== target.id) }), at);
  });
  bind.immediate();
  process.stdout.write('Actor binding updated.\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`Binding failed: ${error?.message || 'unknown error'}\n`);
  process.exitCode = 1;
} finally {
  db.close();
}

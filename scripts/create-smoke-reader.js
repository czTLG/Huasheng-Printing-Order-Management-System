const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { db, now } = require('../src/db');
const { defaultPermissionsByRole } = require('../src/lib/permissions');

const username = String(process.env.SMOKE_READER_USERNAME || 'prod_smoke_reader').trim();
const password = String(process.env.SMOKE_READER_PASSWORD || crypto.randomBytes(18).toString('base64url'));
const permissions = defaultPermissionsByRole('smoke_reader');
const hash = bcrypt.hashSync(password, 12);
const existing = db.prepare('SELECT id FROM users WHERE username=?').get(username);

if (existing) {
  db.prepare(`
    UPDATE users
    SET password=?, role='smoke_reader', status='active', full_name=?, permissions_json=?, approved_at=?
    WHERE id=?
  `).run(hash, '生产只读冒烟', JSON.stringify(permissions), now(), existing.id);
} else {
  db.prepare(`
    INSERT INTO users (username, password, role, status, created_at, full_name, permissions_json, approved_at)
    VALUES (?, ?, 'smoke_reader', 'active', ?, ?, ?, ?)
  `).run(username, hash, now(), '生产只读冒烟', JSON.stringify(permissions), now());
}

console.log(`SMOKE_READER_USERNAME=${username}`);
console.log(`SMOKE_READER_PASSWORD=${password}`);

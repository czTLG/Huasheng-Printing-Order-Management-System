const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const root = path.resolve(__dirname, '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-admin-access-'));
const dbPath = path.join(tmpRoot, 'data', 'app.db');
const port = Number(process.env.ADMIN_ACCESS_TEST_PORT || 19084);
const baseUrl = `http://127.0.0.1:${port}`;
const adminPassword = 'AdminRegression!2026';
let child;
let output = '';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(urlPath, { method = 'GET', token, body, status = 200 } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text }; }
  assert.strictEqual(response.status, status, `${method} ${urlPath}: expected ${status}, got ${response.status}: ${text}`);
  return json;
}

async function waitForHealth() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch (_) {}
    await sleep(200);
  }
  throw new Error(`server health timeout: ${output.slice(-1500)}`);
}

async function login(username, password, status = 200) {
  return request('/api/auth/login', { method: 'POST', body: { username, password }, status });
}

async function main() {
  child = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DISABLE_CRON: '1', FORCE_HTTPS: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { output += String(chunk); });
  await waitForHealth();

  const db = new Database(dbPath);
  db.prepare("UPDATE users SET password=? WHERE username='admin'").run(bcrypt.hashSync(adminPassword, 10));
  db.close();

  const admin = await login('admin', adminPassword);
  assert(admin.token, 'admin login should return a token');

  const pending = await request('/api/auth/register', {
    method: 'POST',
    body: { username: 'pending-review', password: 'PendingPass1!', fullName: 'Pending Review' }
  });
  await login('pending-review', 'PendingPass1!', 403);

  await request('/api/auth/users', { status: 401 });
  await request(`/api/auth/users/${pending.userId}/approve`, {
    method: 'POST',
    body: { role: 'ai_sales', permissions: { modules: { orders: true } } },
    status: 401
  });

  await request(`/api/auth/users/${pending.userId}/approve`, {
    method: 'POST',
    token: admin.token,
    body: { role: 'ai_sales', permissions: { modules: { orders: true, workorder: false } } }
  });
  const approved = await login('pending-review', 'PendingPass1!');
  const me = await request('/api/auth/me', { token: approved.token });
  assert.strictEqual(me.user.role, 'ai_sales');
  assert.strictEqual(me.user.permissions.modules.orders, true);
  assert.strictEqual(me.user.permissions.modules.workorder, false);

  await request('/api/auth/users', { token: approved.token, status: 403 });
  await request(`/api/auth/users/${pending.userId}/permissions`, {
    method: 'POST',
    token: approved.token,
    body: { role: 'manager', permissions: { modules: { admin: true } } },
    status: 403
  });

  await request(`/api/auth/users/${pending.userId}/permissions`, {
    method: 'POST',
    token: admin.token,
    body: { role: 'manager', permissions: { modules: { orders: true, stats: true } } }
  });
  const users = await request('/api/auth/users', { token: admin.token });
  const updated = users.find(user => Number(user.id) === Number(pending.userId));
  assert(updated, 'updated user should remain visible');
  assert.strictEqual(updated.role, 'manager');
  assert.strictEqual(updated.permissions.modules.stats, true);

  await request(`/api/auth/users/${pending.userId}/reset-password`, {
    method: 'POST', token: admin.token, body: { newPassword: '12345' }, status: 400
  });
  await request(`/api/auth/users/${pending.userId}/reset-password`, {
    method: 'POST', token: approved.token, body: { newPassword: 'ForbiddenPass1!' }, status: 403
  });
  await request(`/api/auth/users/${pending.userId}/reset-password`, {
    method: 'POST', token: admin.token, body: { newPassword: 'ResetPass1!' }
  });
  await login('pending-review', 'PendingPass1!', 401);
  await login('pending-review', 'ResetPass1!');

  await request('/api/auth/users/999999/reset-password', {
    method: 'POST', token: admin.token, body: { newPassword: 'ResetPass1!' }, status: 404
  });
  const adminUser = users.find(user => user.username === 'admin');
  await request(`/api/auth/users/${adminUser.id}`, { method: 'DELETE', token: admin.token, status: 400 });

  const verifyDb = new Database(dbPath, { readonly: true });
  const actions = verifyDb.prepare(`SELECT action FROM audit_logs WHERE resource_id=?`).all(String(pending.userId)).map(row => row.action);
  verifyDb.close();
  assert(actions.includes('approve_user'), 'approval should create an audit record');
  assert(actions.includes('edit_user_permissions'), 'permission edit should create an audit record');
  assert(actions.includes('reset_user_password'), 'password reset should create an audit record');

  console.log('admin access regression: PASS');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
}).finally(() => {
  if (child && !child.killed) child.kill('SIGTERM');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

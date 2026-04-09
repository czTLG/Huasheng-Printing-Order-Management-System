const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, now, audit } = require('../db');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const loginAttempts = new Map(); // key: username/ip
const AUTH_ADMIN_USERS = new Set(['chenyongjie', 'gavin']);

function requireAuthAdmin(req, res, next) {
  const u = String(req.user?.userName || '');
  if (req.user?.role === 'super_admin' || AUTH_ADMIN_USERS.has(u)) return next();
  return res.status(403).json({ error: '仅授权管理员可访问' });
}

function defaultPermissionsByRole(role='ai_sales') {
  if (role === 'super_admin') return { all: true };
  if (role === 'manager') return {
    modules: { orders: true, board: true, workorder: true, cost: true, stats: true },
    ordersStages: ['印刷','复膜','制袋','发货','完成','全部'],
    boardStages: ['印刷','复膜','制袋','发货','完成','全部']
  };
  if (role === 'ai_sales') return {
    modules: { orders: true, workorder: true, cost: true, stats: true },
    ordersStages: ['印刷','复膜','制袋','发货','完成','全部'],
    boardStages: []
  };
  if (role === 'worker_print') return { modules: { orders: true, board: true }, ordersStages: ['印刷'], boardStages: ['印刷'] };
  if (role === 'worker_film') return { modules: { orders: true, board: true }, ordersStages: ['复膜'], boardStages: ['复膜'] };
  if (role === 'worker_bag') return { modules: { orders: true, board: true }, ordersStages: ['制袋'], boardStages: ['制袋'] };
  if (role === 'worker_ship') return { modules: { orders: true, board: true }, ordersStages: ['发货'], boardStages: ['发货'] };
  if (role === 'worker') return { modules: { orders: true, board: true }, ordersStages: ['印刷','复膜','制袋','发货'], boardStages: ['印刷','复膜','制袋','发货'] };
  return { modules: { orders: true }, ordersStages: ['印刷','复膜','制袋','发货','完成','全部'], boardStages: [] };
}

function normalizePermissions(role='ai_sales', p) {
  const d = defaultPermissionsByRole(role);
  if (!p || typeof p !== 'object') return d;
  if (p.all) return { all: true };
  const modules = Object.assign({}, d.modules || {}, p.modules || {});
  const uniq = (arr=[]) => [...new Set(arr.filter(Boolean))];
  const ordersStages = uniq(Array.isArray(p.ordersStages) ? p.ordersStages : (d.ordersStages || []));
  const boardStages = uniq(Array.isArray(p.boardStages) ? p.boardStages : (d.boardStages || []));
  return { modules, ordersStages, boardStages };
}

function isHashedPassword(pwd = '') {
  return String(pwd).startsWith('$2a$') || String(pwd).startsWith('$2b$') || String(pwd).startsWith('$2y$');
}

function tooManyAttempts(key) {
  const item = loginAttempts.get(key);
  if (!item) return false;
  if (Date.now() > item.until) {
    loginAttempts.delete(key);
    return false;
  }
  return item.count >= 8;
}

function markFailedAttempt(key) {
  const cur = loginAttempts.get(key);
  if (!cur || Date.now() > cur.until) {
    loginAttempts.set(key, { count: 1, until: Date.now() + 10 * 60 * 1000 });
    return;
  }
  cur.count += 1;
  loginAttempts.set(key, cur);
}

function clearAttempts(key) {
  loginAttempts.delete(key);
}

router.post('/register', (req, res) => {
  const { username, password, fullName } = req.body || {};
  if (!username || !password || !fullName) return res.status(400).json({ error: '账号/密码/姓名 必填' });
  try {
    const hash = bcrypt.hashSync(String(password), 10);
    const r = db.prepare("INSERT INTO users (username, password, role, status, created_at, full_name) VALUES (?, ?, 'pending', 'pending', ?, ?)")
      .run(String(username).trim(), hash, now(), String(fullName).trim());
    res.json({ ok: true, userId: r.lastInsertRowid, message: '注册成功，等待超级管理员审批' });
  } catch (e) {
    const msg = String(e?.message || '');
    if (msg.includes('UNIQUE') || msg.includes('users.username')) {
      return res.status(400).json({ ok: false, error: '注册失败：该账号已存在，请换一个账号' });
    }
    return res.status(400).json({ ok: false, error: `注册失败：${msg || '数据库写入失败'}` });
  }
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, error: '请先登录' });
  res.json({ ok: true, user: { id: req.user.id, username: req.user.userName, role: req.user.role, name: req.user.fullName || req.user.userName, permissions: req.user.permissions || null } });
});

router.post('/change-password', (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, error: '请先登录' });
  const oldPassword = String(req.body?.oldPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!oldPassword || !newPassword) return res.status(400).json({ ok: false, error: '旧密码和新密码必填' });

  const u = db.prepare('SELECT id, username, password FROM users WHERE id=?').get(Number(req.user.id || 0));
  if (!u) return res.status(404).json({ ok: false, error: '用户不存在' });

  let oldOk = false;
  if (isHashedPassword(u.password)) {
    oldOk = bcrypt.compareSync(oldPassword, u.password);
  } else {
    oldOk = String(u.password || '') === oldPassword;
  }
  if (!oldOk) return res.status(400).json({ ok: false, error: '旧密码错误' });

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password=? WHERE id=?').run(newHash, u.id);
  audit({ role: req.user.role, userName: req.user.userName, action: 'change_password', resourceType: 'user', resourceId: u.id });
  res.json({ ok: true, message: '密码修改成功' });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const uname = String(username || '').trim();
  const ip = req.ip || 'unknown';
  const key = `${uname}@${ip}`;

  if (tooManyAttempts(key)) {
    return res.status(429).json({ ok: false, error: '尝试次数过多，请10分钟后再试' });
  }

  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(uname);
  let ok = false;

  if (u) {
    if (isHashedPassword(u.password)) {
      ok = bcrypt.compareSync(String(password || ''), u.password);
    } else {
      // legacy plaintext compatibility + auto-upgrade to hash
      ok = u.password === String(password || '');
      if (ok) {
        const newHash = bcrypt.hashSync(String(password || ''), 10);
        db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newHash, u.id);
      }
    }
  }

  if (!u || !ok) {
    markFailedAttempt(key);
    return res.status(401).json({ ok: false, error: '账号或密码错误' });
  }
  if (u.status !== 'active') return res.status(403).json({ ok: false, error: '账号待审批，请联系超级管理员' });

  clearAttempts(key);
  const token = jwt.sign({ sub: String(u.id), role: u.role, userName: u.username }, JWT_SECRET, { expiresIn: '24h' });
  audit({ role: u.role, userName: u.username, action: 'login', resourceType: 'user', resourceId: u.id });
  let permissions = null;
  try { permissions = u.permissions_json ? JSON.parse(u.permissions_json) : defaultPermissionsByRole(u.role); } catch(_) { permissions = defaultPermissionsByRole(u.role); }
  res.json({ ok: true, token, user: { id: u.id, username: u.username, role: u.role, name: u.full_name || u.username, permissions } });
});

router.get('/users/pending', requireAuthAdmin, (req, res) => {
  const rows = db.prepare("SELECT id, username, full_name, role, status, created_at FROM users WHERE status='pending' ORDER BY id DESC").all();
  res.json(rows);
});

router.post('/users/:id/approve', requireAuthAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { role = 'ai_sales', permissions } = req.body || {};
  const normalized = normalizePermissions(role, permissions);
  db.prepare("UPDATE users SET status='active', role=?, permissions_json=?, approved_at=? WHERE id=?")
    .run(role, JSON.stringify(normalized), now(), id);
  audit({ role: req.user.role, userName: req.user.userName, action: 'approve_user', resourceType: 'user', resourceId: id, detail: JSON.stringify({ role, permissions: normalized }) });
  res.json({ ok: true });
});

router.get('/users', requireAuthAdmin, (req, res) => {
  const rows = db.prepare('SELECT id, username, full_name, role, status, created_at, approved_at, permissions_json FROM users ORDER BY id DESC').all()
    .map(r=>({ ...r, permissions: (()=>{ try{return r.permissions_json?JSON.parse(r.permissions_json):defaultPermissionsByRole(r.role);}catch(_){return defaultPermissionsByRole(r.role);} })() }));
  res.json(rows);
});

router.post('/users/:id/permissions', requireAuthAdmin, (req, res) => {
  const id = Number(req.params.id || 0);
  const target = db.prepare('SELECT id, username, role FROM users WHERE id=?').get(id);
  if (!target) return res.status(404).json({ error: '用户不存在' });

  const role = String(req.body?.role || target.role || 'ai_sales');
  const permissions = normalizePermissions(role, req.body?.permissions || null);

  db.prepare('UPDATE users SET role=?, permissions_json=? WHERE id=?').run(role, JSON.stringify(permissions), id);
  audit({ role: req.user.role, userName: req.user.userName, action: 'edit_user_permissions', resourceType: 'user', resourceId: id, detail: JSON.stringify({ target: target.username, role, permissions }) });
  res.json({ ok: true });
});

router.delete('/users/:id', requireAuthAdmin, (req, res) => {
  const id = Number(req.params.id || 0);
  const target = db.prepare('SELECT id, username, role FROM users WHERE id=?').get(id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  if (String(target.username || '') === String(req.user?.userName || '')) return res.status(400).json({ error: '不能删除当前登录账号' });

  db.prepare('DELETE FROM users WHERE id=?').run(id);
  audit({ role: req.user.role, userName: req.user.userName, action: 'delete_user', resourceType: 'user', resourceId: id, detail: JSON.stringify({ target: target.username }) });
  res.json({ ok: true });
});

function detectModuleByAudit(a = {}) {
  const action = String(a.action || '');
  const rt = String(a.resource_type || '');
  if (action.includes('work_order') || rt === 'work_order' || rt === 'customer') return '开单管理';
  if (action.includes('cost') || rt === 'cost' || rt === 'material_price' || rt === 'cost_email_log') return '成本核算';
  if (action.includes('order') || rt === 'order' || rt === 'order_stage_log') return '订单管理/看板';
  if (action.includes('menu') || rt === 'menu_item') return '菜单模块';
  if (action.includes('approve_user') || action.includes('edit_user_permissions') || rt === 'user') return '权限管理';
  if (action.includes('quote') || rt === 'quote' || rt === 'quote_sheet') return '报价';
  return '其他';
}

router.get('/dashboard/today', requireAuthAdmin, (req, res) => {
  const usersTotal = db.prepare('SELECT count(*) AS c FROM users').get().c;
  const usersActive = db.prepare("SELECT count(*) AS c FROM users WHERE status='active'").get().c;
  const newUsersToday = db.prepare("SELECT count(*) AS c FROM users WHERE date(created_at)=date('now','localtime')").get().c;

  const quotesToday = db.prepare("SELECT count(*) AS c FROM quotes WHERE date(created_at)=date('now','localtime')").get().c;
  const sheetsToday = db.prepare("SELECT count(*) AS c FROM quote_sheets WHERE date(created_at)=date('now','localtime')").get().c;
  const ordersToday = db.prepare("SELECT count(*) AS c FROM orders WHERE date(created_at)=date('now','localtime')").get().c;

  const usersUsedToday = db.prepare("SELECT count(DISTINCT user_name) AS c FROM audit_logs WHERE date(created_at)=date('now','localtime')").get().c;
  const activityToday = db.prepare("SELECT action, count(*) AS c FROM audit_logs WHERE date(created_at)=date('now','localtime') GROUP BY action ORDER BY c DESC").all();
  const recentLogs = db.prepare("SELECT user_name, action, detail, created_at FROM audit_logs ORDER BY id DESC LIMIT 30").all();

  res.json({
    usersTotal,
    usersActive,
    newUsersToday,
    usersUsedToday,
    ordersToday,
    quotesToday,
    sheetsToday,
    activityToday,
    recentLogs
  });
});

router.get('/users/activity', requireAuthAdmin, (req, res) => {
  const days = Math.max(1, Math.min(30, Number(req.query.days || 7)));
  const rows = db.prepare(`
    SELECT user_name, action, resource_type, created_at
    FROM audit_logs
    WHERE datetime(created_at) >= datetime('now', ?)
    ORDER BY id DESC
    LIMIT 8000
  `).all(`-${days} day`);

  const map = new Map();
  rows.forEach(r => {
    const u = String(r.user_name || '').trim();
    if (!u) return;
    if (!map.has(u)) map.set(u, { userName: u, total: 0, lastAt: '', moduleCounts: {}, actionCounts: {} });
    const item = map.get(u);
    item.total += 1;
    if (!item.lastAt || String(r.created_at) > item.lastAt) item.lastAt = String(r.created_at || '');
    const m = detectModuleByAudit(r);
    item.moduleCounts[m] = (item.moduleCounts[m] || 0) + 1;
    const a = String(r.action || '');
    item.actionCounts[a] = (item.actionCounts[a] || 0) + 1;
  });

  const list = [...map.values()].map(x => ({
    ...x,
    topModules: Object.entries(x.moduleCounts).sort((a,b)=>b[1]-a[1]).slice(0,4),
    topActions: Object.entries(x.actionCounts).sort((a,b)=>b[1]-a[1]).slice(0,6)
  })).sort((a,b)=>b.total-a.total);

  res.json({ days, users: list });
});

router.get('/users/:username/activity', requireAuthAdmin, (req, res) => {
  const days = Math.max(1, Math.min(30, Number(req.query.days || 7)));
  const username = String(req.params.username || '').trim();
  const rows = db.prepare(`
    SELECT user_name, action, resource_type, detail, created_at
    FROM audit_logs
    WHERE user_name = ? AND datetime(created_at) >= datetime('now', ?)
    ORDER BY id DESC
    LIMIT 300
  `).all(username, `-${days} day`);
  const logs = rows.map(r => ({
    ...r,
    module: detectModuleByAudit(r)
  }));
  res.json({ days, username, total: logs.length, logs });
});

router.get('/users/activity/export', requireAuthAdmin, (req, res) => {
  const period = String(req.query.period || 'daily');
  const days = period === 'weekly' ? 7 : 1;
  const rows = db.prepare(`
    SELECT user_name, action, resource_type, detail, created_at
    FROM audit_logs
    WHERE datetime(created_at) >= datetime('now', ?)
    ORDER BY created_at DESC
    LIMIT 10000
  `).all(`-${days} day`);

  const csvHead = '用户名,模块,动作,资源类型,详情,时间\n';
  const esc = (v='') => '"' + String(v).replace(/"/g,'""') + '"';
  const csvBody = rows.map(r => [
    esc(r.user_name || ''),
    esc(detectModuleByAudit(r)),
    esc(r.action || ''),
    esc(r.resource_type || ''),
    esc(r.detail || ''),
    esc(r.created_at || '')
  ].join(',')).join('\n');

  const fileName = `user_activity_${period}_${new Date().toISOString().slice(0,10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
  res.send('\ufeff' + csvHead + csvBody);
});

module.exports = router;

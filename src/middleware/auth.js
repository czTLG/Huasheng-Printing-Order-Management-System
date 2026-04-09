const jwt = require('jsonwebtoken');
const { db } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

function fakeAuth(req, res, next) {
  if (req.path === '/health' || req.path === '/login' || req.path === '/register' || req.path === '/api/auth/login' || req.path === '/api/auth/register') {
    return next();
  }

  const auth = req.header('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7);

    // New JWT token path
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const id = Number(payload.sub);
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (u && u.status === 'active') {
        let permissions = null;
        try { permissions = u.permissions_json ? JSON.parse(u.permissions_json) : null; } catch(_) { permissions = null; }
        req.user = { id: u.id, role: u.role, userName: u.username, fullName: u.full_name || '', permissions };

        const viewAs = req.header('x-view-as-role');
        const allowedViewRoles = new Set(['manager', 'ai_sales', 'worker', 'worker_print', 'worker_film', 'worker_bag', 'worker_ship']);
        if (u.role === 'super_admin' && viewAs && allowedViewRoles.has(viewAs)) {
          req.user.viewAsRole = viewAs;
          req.user.role = viewAs;
        }

        return next();
      }
    } catch (_) {
      // fallback to legacy token format below
    }

    // Legacy token fallback: user-<id>
    if (token.startsWith('user-')) {
      const id = Number(token.replace('user-', ''));
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (u && u.status === 'active') {
        let permissions = null;
        try { permissions = u.permissions_json ? JSON.parse(u.permissions_json) : null; } catch(_) { permissions = null; }
        req.user = { id: u.id, role: u.role, userName: u.username, fullName: u.full_name || '', permissions };
        return next();
      }
    }
  }

  return res.status(401).json({ error: '请先登录' });
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: '无权限访问该功能', yourRole: req.user?.role || null, need: roles });
    }
    next();
  };
}

module.exports = { fakeAuth, allowRoles };

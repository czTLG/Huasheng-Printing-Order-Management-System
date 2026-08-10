const jwt = require('jsonwebtoken');
const { db } = require('../db');
const { defaultPermissionsByRole } = require('../lib/permissions');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const WHATSAPP_SYNC_TOKEN = process.env.WHATSAPP_SYNC_TOKEN || '';

function fakeAuth(req, res, next) {
  const auth = req.header('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const syncDebugPaths = new Set(['/api/crm/whatsapp/sync', '/api/crm/messages']);
  if (
    req.path === '/health' ||
    req.path === '/login' ||
    req.path === '/register' ||
    req.path === '/api/auth/login' ||
    req.path === '/api/auth/register' ||
    (syncDebugPaths.has(req.path) && bearer && bearer === WHATSAPP_SYNC_TOKEN)
  ) {
    if (req.path === '/api/crm/messages' && bearer && bearer === WHATSAPP_SYNC_TOKEN) {
      req.whatsappSyncDebug = true;
    }
    return next();
  }

  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7);

    // New JWT token path
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const id = Number(payload.sub);
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (u && u.status === 'active') {
        let permissions = null;
        try { permissions = u.permissions_json ? JSON.parse(u.permissions_json) : defaultPermissionsByRole(u.role); } catch(_) { permissions = defaultPermissionsByRole(u.role); }
        req.user = { id: u.id, role: u.role, userName: u.username, fullName: u.full_name || '', permissions };
        req.authMode = 'jwt';

        const viewAs = req.header('x-view-as-role');
        const allowedViewRoles = new Set(['manager', 'foreign_trade_crm_admin', 'stream_publisher', 'costing_user', 'freight_user', 'ai_sales', 'worker', 'worker_print', 'worker_film', 'worker_bag', 'worker_ship']);
        if (u.role === 'super_admin' && viewAs && allowedViewRoles.has(viewAs)) {
          req.user.viewAsRole = viewAs;
          req.user.role = viewAs;
        }

        if (req.user.role === 'stream_publisher') {
          const requestPath = String(req.originalUrl || req.path || '').split('?')[0];
          const allowed = requestPath.startsWith('/api/stream-desk/')
            || requestPath === '/api/auth/me'
            || requestPath === '/api/auth/change-password';
          if (!allowed) return res.status(403).json({ error: '内容发布账号只能访问内容发布台' });
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
        try { permissions = u.permissions_json ? JSON.parse(u.permissions_json) : defaultPermissionsByRole(u.role); } catch(_) { permissions = defaultPermissionsByRole(u.role); }
        req.user = { id: u.id, role: u.role, userName: u.username, fullName: u.full_name || '', permissions };
        req.authMode = 'legacy';
        if (req.user.role === 'stream_publisher') {
          const requestPath = String(req.originalUrl || req.path || '').split('?')[0];
          const allowed = requestPath.startsWith('/api/stream-desk/')
            || requestPath === '/api/auth/me'
            || requestPath === '/api/auth/change-password';
          if (!allowed) return res.status(403).json({ error: '内容发布账号只能访问内容发布台' });
        }
        return next();
      }
    }
  }

  return res.status(401).json({ error: '请先登录' });
}

function allowRoles(...roles) {
  return (req, res, next) => {
    const isSmokeRead = req.user?.role === 'smoke_reader'
      && (req.method === 'GET' || req.method === 'HEAD')
      && /^\/api\/(orders|work-orders)(?:\/|$)/.test(String(req.originalUrl || ''));
    if (isSmokeRead) return next();
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: '无权限访问该功能', yourRole: req.user?.role || null, need: roles });
    }
    next();
  };
}

module.exports = { fakeAuth, allowRoles };

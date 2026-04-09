const express = require('express');
const { db, now, audit } = require('../db');

const router = express.Router();

function onlyChen(req, res, next) {
  if ((req.user?.userName || '') !== 'chenyongjie') {
    return res.status(403).json({ error: '仅陈永杰可使用该模块' });
  }
  next();
}

router.get('/items', onlyChen, (req, res) => {
  const rows = db.prepare('SELECT id, name, type, disabled, created_by, created_at, updated_at FROM menu_items ORDER BY disabled ASC, type ASC, updated_at DESC, id DESC LIMIT 1000').all();
  res.json({ rows });
});

router.post('/items', onlyChen, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const type = String(req.body?.type || '').trim();
  if (!name) return res.status(400).json({ error: '菜名不能为空' });
  if (!['菜', '汤', '肉菜', '粥'].includes(type)) return res.status(400).json({ error: '类型必须是 菜/汤/肉菜/粥' });

  const t = now();
  const r = db.prepare('INSERT INTO menu_items (name, type, disabled, created_by, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)')
    .run(name, type, req.user.userName, t, t);

  audit({ role: req.user.role, userName: req.user.userName, action: 'menu_add_item', resourceType: 'menu_item', resourceId: r.lastInsertRowid, detail: `${name}|${type}` });
  res.json({ ok: true, id: r.lastInsertRowid });
});

router.post('/items/:id/disable', onlyChen, (req, res) => {
  const id = Number(req.params.id || 0);
  const row = db.prepare('SELECT id, name FROM menu_items WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  db.prepare('UPDATE menu_items SET disabled=1, updated_at=? WHERE id=?').run(now(), id);
  audit({ role: req.user.role, userName: req.user.userName, action: 'menu_disable_item', resourceType: 'menu_item', resourceId: id, detail: row.name || '' });
  res.json({ ok: true });
});

router.post('/items/:id/enable', onlyChen, (req, res) => {
  const id = Number(req.params.id || 0);
  const row = db.prepare('SELECT id, name FROM menu_items WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  db.prepare('UPDATE menu_items SET disabled=0, updated_at=? WHERE id=?').run(now(), id);
  audit({ role: req.user.role, userName: req.user.userName, action: 'menu_enable_item', resourceType: 'menu_item', resourceId: id, detail: row.name || '' });
  res.json({ ok: true });
});

router.delete('/items/:id', onlyChen, (req, res) => {
  const id = Number(req.params.id || 0);
  const row = db.prepare('SELECT id, name FROM menu_items WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  db.prepare('DELETE FROM menu_items WHERE id=?').run(id);
  audit({ role: req.user.role, userName: req.user.userName, action: 'menu_delete_item', resourceType: 'menu_item', resourceId: id, detail: row.name || '' });
  res.json({ ok: true });
});

module.exports = router;

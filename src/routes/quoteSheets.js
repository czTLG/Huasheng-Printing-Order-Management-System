const express = require('express');
const { allowRoles } = require('../middleware/auth');
const { db, now, audit } = require('../db');

const router = express.Router();

router.post('/', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const {
    orderId = null,
    customerName,
    productName,
    bagType = '',
    specs = {},
    inputJson = {},
    calcJson = {},
    quantity = 0,
    unitPrice = 0,
    cost = 0,
    profitRate = 0,
    notes = ''
  } = req.body || {};

  if (!customerName || !productName) return res.status(400).json({ error: 'customerName/productName 必填' });

  const qty = Number(quantity);
  const up = Number(unitPrice);
  const c = Number(cost) || 0;
  const pRate = Number(profitRate) || 0;

  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'quantity 必须大于 0' });
  if (!Number.isFinite(up) || up <= 0) return res.status(400).json({ error: 'unitPrice 必须大于 0' });
  if (!Number.isFinite(c) || c < 0) return res.status(400).json({ error: 'cost 不能小于 0' });
  if (!Number.isFinite(pRate) || pRate < 0 || pRate > 1) return res.status(400).json({ error: 'profitRate 必须在 0~1 之间' });

  const amount = +(qty * up).toFixed(2);

  const ts = now();
  const result = db.prepare(`
    INSERT INTO quote_sheets
    (order_id, customer_name, product_name, bag_type, specs_json, input_json, calc_json, quantity, unit_price, amount, cost, profit_rate, notes, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(orderId, customerName, productName, bagType, JSON.stringify(specs), JSON.stringify(inputJson), JSON.stringify(calcJson), qty, up, amount, c, pRate, notes, req.user.userName, ts, ts);

  audit({ role: req.user.role, userName: req.user.userName, action: 'create_quote_sheet', resourceType: 'quote_sheet', resourceId: result.lastInsertRowid });
  res.json({ ok: true, id: result.lastInsertRowid, amount });
});

router.get('/', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const rows = ['super_admin', 'manager'].includes(req.user.role)
    ? db.prepare('SELECT * FROM quote_sheets ORDER BY id DESC').all()
    : db.prepare('SELECT * FROM quote_sheets WHERE created_by = ? ORDER BY id DESC').all(req.user.userName);
  res.json(rows.map(r => ({ ...r, specs_json: JSON.parse(r.specs_json || '{}'), input_json: JSON.parse(r.input_json || '{}'), calc_json: JSON.parse(r.calc_json || '{}') })));
});

router.get('/:id', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const row = db.prepare('SELECT * FROM quote_sheets WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: '报价单不存在' });
  if (!['super_admin', 'manager'].includes(req.user.role) && row.created_by !== req.user.userName) {
    return res.status(403).json({ error: '只能查看自己的报价单' });
  }
  res.json({ ...row, specs_json: JSON.parse(row.specs_json || '{}'), input_json: JSON.parse(row.input_json || '{}'), calc_json: JSON.parse(row.calc_json || '{}') });
});

module.exports = router;

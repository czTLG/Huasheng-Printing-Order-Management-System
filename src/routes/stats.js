const express = require('express');
const { db } = require('../db');
const { allowRoles } = require('../middleware/auth');

const router = express.Router();

// GET /api/stats/dashboard — KPI summary and breakdowns
router.get('/dashboard', allowRoles('super_admin','manager','ai_sales'), (req, res) => {
  try {
    const today = db.prepare("SELECT count(*) AS c FROM orders WHERE date(created_at)=date('now','localtime')").get().c;
    const week = db.prepare("SELECT count(*) AS c FROM orders WHERE datetime(created_at)>=datetime('now','-7 day','localtime')").get().c;
    const month = db.prepare("SELECT count(*) AS c FROM orders WHERE datetime(created_at)>=datetime('now','-30 day','localtime')").get().c;
    const total = db.prepare("SELECT count(*) AS c FROM orders").get().c;
    const inProgress = db.prepare("SELECT count(*) AS c FROM orders WHERE status IN ('印刷','复膜','制袋','发货')").get().c;
    const completed = db.prepare("SELECT count(*) AS c FROM orders WHERE status='完成'").get().c;
    const doneMonth = db.prepare("SELECT count(*) AS c FROM orders WHERE status='完成' AND datetime(updated_at)>=datetime('now','-30 day','localtime')").get().c;
    const urgent = db.prepare("SELECT count(*) AS c FROM orders WHERE urgency=1").get().c;
    const urgentInProgress = db.prepare("SELECT count(*) AS c FROM orders WHERE urgency=1 AND status IN ('印刷','复膜','制袋','发货')").get().c;
    const totalQty = db.prepare("SELECT COALESCE(SUM(CAST(order_qty AS REAL)),0) AS q FROM orders").get().q;
    const customers = db.prepare("SELECT count(DISTINCT customer_name) AS c FROM orders").get().c;
    const statusBreakdown = db.prepare("SELECT status AS name, count(*) AS value FROM orders GROUP BY status").all();

    // Stuck orders (>3 days in same status, excluding completed)
    const stuck = db.prepare(`
      SELECT id, customer_name, order_spec, status,
        CAST((julianday('now','localtime') - julianday(COALESCE(updated_at,created_at))) AS INTEGER) AS stay_days,
        COALESCE(updated_at,created_at) AS last_update
      FROM orders
      WHERE status IN ('印刷','复膜','制袋','发货')
        AND (julianday('now','localtime') - julianday(COALESCE(updated_at,created_at))) >= 3
      ORDER BY stay_days DESC
      LIMIT 20
    `).all();

    res.json({
      kpi: {
        total,
        today,
        week,
        month,
        inProgress,
        completed,
        doneMonth,
        urgent,
        urgentInProgress,
        totalQty: Number(totalQty.toFixed(0)),
        customerCount: customers
      },
      statusBreakdown: statusBreakdown.map(r => ({
        name: r.name,
        value: r.value,
        color: r.name === '印刷' ? '#3b82f6' : r.name === '复膜' ? '#8b5cf6' : r.name === '制袋' ? '#f59e0b' : r.name === '发货' ? '#f97316' : r.name === '完成' ? '#10b981' : '#94a3b8'
      })),
      stuckOrders: stuck.map(r => ({
        order_id: r.id,
        customer_name: r.customer_name,
        spec: r.order_spec,
        status: r.status,
        stay_days: r.stay_days,
        last_update: r.last_update
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/trend?days=30 — daily order trend
router.get('/trend', allowRoles('super_admin','manager','ai_sales'), (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 7), 90);
    const rows = db.prepare(`
      SELECT date(created_at) AS day, count(*) AS order_count,
        COALESCE(SUM(CASE WHEN status='完成' THEN 1 ELSE 0 END),0) AS completed_count,
        COALESCE(SUM(urgency),0) AS urgent_count
      FROM orders
      WHERE date(created_at) >= date('now','localtime','-${days} day')
      GROUP BY date(created_at)
      ORDER BY day ASC
    `).all();

    // Fill missing days with zeros
    const map = new Map();
    rows.forEach(r => map.set(r.day, r));
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const monthDay = key.slice(5);
      const row = map.get(key);
      result.push({
        date: monthDay,
        orderCount: row ? row.order_count : 0,
        completedCount: row ? row.completed_count : 0,
        urgentCount: row ? row.urgent_count : 0
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/stage-flow?days=14 — daily stage completion flow
router.get('/stage-flow', allowRoles('super_admin','manager','ai_sales'), (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 14, 7), 90);
    const rows = db.prepare(`
      SELECT date(created_at) AS day, stage, count(*) AS cnt,
        COALESCE(SUM(COALESCE(qty,0)),0) AS total_qty
      FROM order_stage_logs
      WHERE event_type='COMPLETE' AND COALESCE(rolled_back,0)=0
        AND date(created_at) >= date('now','localtime','-${days} day')
      GROUP BY date(created_at), stage
      ORDER BY day ASC, stage
    `).all();

    const map = new Map();
    rows.forEach(r => {
      const key = r.day;
      if (!map.has(key)) map.set(key, {});
      map.get(key)[r.stage] = { cnt: r.cnt, qty: r.total_qty };
    });

    const stages = ['印刷', '复膜', '制袋', '发货'];
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const monthDay = key.slice(5);
      const dayData = map.get(key) || {};
      const entry = { date: monthDay };
      stages.forEach(s => {
        entry[`${s}In`] = dayData[s]?.cnt || 0;
        entry[`${s}Out`] = dayData[s]?.qty || 0;
      });
      result.push(entry);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/customer-rank?limit=5 — top customers by order count
router.get('/customer-rank', allowRoles('super_admin','manager','ai_sales'), (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 5, 1), 20);
    const rows = db.prepare(`
      SELECT customer_name, count(*) AS order_count,
        COALESCE(SUM(CAST(order_qty AS REAL)),0) AS total_qty
      FROM orders
      WHERE customer_name IS NOT NULL AND customer_name != ''
      GROUP BY customer_name
      ORDER BY order_count DESC
      LIMIT ?
    `).all(limit);

    res.json(rows.map(r => ({
      name: r.customer_name,
      orderCount: r.order_count,
      qty: Number(r.total_qty.toFixed(0))
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/bagtype-dist — bag type distribution
router.get('/bagtype-dist', allowRoles('super_admin','manager','ai_sales'), (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT COALESCE(NULLIF(bag_type,''), '未指定') AS name, count(*) AS count
      FROM orders
      GROUP BY name
      ORDER BY count DESC
      LIMIT 15
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

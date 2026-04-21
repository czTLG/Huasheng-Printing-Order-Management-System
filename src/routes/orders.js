const express = require('express');
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const { db, now, audit } = require('../db');
const { allowRoles } = require('../middleware/auth');

const router = express.Router();
const flow = ['印刷', '复膜', '制袋', '发货', '完成'];
const boardPanelCache = new Map();
const STAGE_UNIT = { '印刷': '米', '复膜': '米', '制袋': '袋', '发货': '单' };
const WORKER_ROLES = ['worker','worker_print','worker_film','worker_bag','worker_ship'];

function validId(v) {
  const id = Number(v);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function canOperateStage(row = {}, user = {}, stage = '') {
  if (!WORKER_ROLES.includes(user.role)) return true;
  const worker = String(user.userName || '');
  if (user.role === 'worker_print') return stage === '印刷' && row.assigned_print_worker === worker;
  if (user.role === 'worker_film') return stage === '复膜' && row.assigned_lamination_worker === worker;
  if (user.role === 'worker_bag') return stage === '制袋' && row.assigned_bagging_worker === worker;
  if (user.role === 'worker_ship') return stage === '发货' && row.assigned_shipping_worker === worker;
  return (
    (stage === '印刷' && row.assigned_print_worker === worker) ||
    (stage === '复膜' && row.assigned_lamination_worker === worker) ||
    (stage === '制袋' && row.assigned_bagging_worker === worker) ||
    (stage === '发货' && row.assigned_shipping_worker === worker)
  );
}

function normalizeRollbackStage(processType = '') {
  const p = String(processType || '').trim().toUpperCase();
  if (p === 'PRINT' || p === '印刷') return '印刷';
  if (p === 'LAMINATION' || p === 'FILM' || p === '覆膜' || p === '复膜') return '复膜';
  if (p === 'BAGGING' || p === 'BAG' || p === '制袋') return '制袋';
  return '';
}

function getRollbackStageByOrderStatus(status = '') {
  const s = String(status || '').trim();
  if (s === '复膜') return '印刷';
  if (s === '制袋') return '复膜';
  if (s === '发货' || s === '完成') return '制袋';
  return '';
}


function normalizeLayerName(name=''){
  return String(name||'').trim().replace(/\s+/g,' ').toUpperCase();
}
function normalizeLayerSpec(spec=''){
  const raw=String(spec||'').trim().toLowerCase().replace(/\s+/g,'');
  if(!raw) return '';
  const m=raw.match(/^(\d+(?:\.\d+)?)[x×\*](\d+(?:\.\d+)?)(c|cm|㎝)?$/i);
  if(m){
    const u=(m[3]||'c').toLowerCase()==='cm'?'cm':'c';
    return `${m[1]}*${m[2]}${u}`;
  }
  return raw.replace(/[x×]/g,'*');
}
function parseLayerWeightKg(v=''){
  const s=String(v||'').trim().toLowerCase().replace(/\s+/g,'');
  if(!s) return 0;
  const n=parseFloat(s);
  if(!Number.isFinite(n) || n<=0) return 0;
  if(s.includes('吨') || s.endsWith('t')) return n*1000;
  if(s.includes('g') && !s.includes('kg')) return n/1000;
  return n;
}

function normalizeTxt(s=''){
  return String(s||'').replace(/\s+/g,'').trim();
}

function inferPrintFilmFields(p = {}) {
  const mold = String(p.printMold || p.printFilm || '').trim();
  let size = String(p.printFilmSize || '').trim();
  let qty = String(p.printFilmQty || '').trim();
  let unit = String(p.printFilmUnit || '').trim();
  if ((!size || !qty || !unit) && mold) {
    const raw = mold.replace(/\s+/g, ' ').trim();
    if (!size) {
      const mSize = raw.match(/(\d+(?:\.\d+)?\s*[x×\*]\s*\d+(?:\.\d+)?\s*[cCＣ㎝mM]?)/);
      const hit = String((mSize && mSize[0]) || '').trim();
      if (hit) size = hit.replace(/[×x]/g, '*').replace(/\s+/g, '');
    }
    if (!qty || !unit) {
      const mQty = raw.match(/(\d+(?:\.\d+)?)\s*(粒|米|卷|kg|千克|公斤|个)/i);
      if (mQty) {
        if (!qty) qty = String(mQty[1] || '').trim();
        if (!unit) unit = String(mQty[2] || '').trim();
      }
    }
  }
  return { mold, size, qty, unit };
}
function maybeProductLikeCustomer(customer='', useCase=''){
  const c=normalizeTxt(customer);
  if(!c) return true;
  const u=String(useCase||'');
  const m=u.match(/(?:品名|用途)[:：]\s*([^；;\n]+)/);
  const p=normalizeTxt(m?m[1]:'');
  if(!p) return false;
  return c===p || c.includes('，') || c.includes(',');
}
function enrichCustomerDisplay(rows=[]){
  if(!Array.isArray(rows) || !rows.length) return rows||[];
  const out = rows.map(r=>({ ...r, customer_name_display: r.customer_name, is_legacy_imported: false }));
  const ids = out.map(r=>Number(r.id)).filter(Boolean);
  const byId=new Map();
  if(ids.length){
    const ph=ids.map(()=>'?').join(',');
    const wos = db.prepare(`SELECT order_id, customer_name, id FROM work_orders WHERE order_id IN (${ph}) ORDER BY id DESC`).all(...ids);
    wos.forEach(w=>{ const k=Number(w.order_id||0); if(!k||byId.has(k)) return; byId.set(k,String(w.customer_name||'').trim()); });
  }
  out.forEach(r=>{
    let legacy = {};
    try { legacy = JSON.parse(r.legacy_json || '{}'); } catch {}
    const isLegacyImported = !!(r.legacy_source_key || legacy?._openid);
    r.is_legacy_imported = isLegacyImported;
    const suspicious = maybeProductLikeCustomer(r.customer_name, r.use_case);
    const woName=String(byId.get(Number(r.id))||'').trim();
    if(isLegacyImported){
      // 用户口径：历史导入单客户信息易混淆，直接不展示客户
      r.customer_name_display = '';
      return;
    }
    if(suspicious){
      r.customer_name_display = woName || '';
    }
  });
  return out;
}

router.post('/', allowRoles('super_admin','manager'), (req, res) => {
  const {
    customerName,
    bagType,
    useCase = '',
    size = {},
    urgency = 0,
    assignedPrintWorker = '',
    assignedLaminationWorker = '',
    assignedBaggingWorker = '',
    assignedShippingWorker = '',
    orderQty = '',
    orderSpec = ''
  } = req.body || {};

  const cleanCustomerName = String(customerName || '').trim();
  const cleanBagType = String(bagType || '').trim();
  if (!cleanCustomerName || !cleanBagType) {
    return res.status(400).json({ error: 'customerName 与 bagType 必填' });
  }

  const stmt = db.prepare(`
    INSERT INTO orders (
      customer_name, bag_type, use_case, size_json, order_qty, order_spec, status, urgency, priority,
      assigned_print_worker, assigned_lamination_worker, assigned_bagging_worker, assigned_shipping_worker,
      created_by, start_time, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, '印刷', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const ts = now();
  const result = stmt.run(
    cleanCustomerName,
    cleanBagType,
    String(useCase || '').trim(),
    JSON.stringify(size),
    String(orderQty || ''),
    String(orderSpec || ''),
    Number(urgency) ? 1 : 0,
    Number(urgency) ? 100 : 0,
    String(assignedPrintWorker || '').trim(),
    String(assignedLaminationWorker || '').trim(),
    String(assignedBaggingWorker || '').trim(),
    String(assignedShippingWorker || '').trim(),
    req.user.userName,
    ts,
    ts,
    ts
  );

  audit({
    role: req.user.role,
    userName: req.user.userName,
    action: 'create_order',
    resourceType: 'order',
    resourceId: result.lastInsertRowid,
    detail: `${cleanCustomerName}-${cleanBagType}`
  });

  res.json({ ok: true, id: result.lastInsertRowid });
});

router.get('/', (req, res) => {
  const status = req.query.status;
  const q = String(req.query.q || '').trim();
  const updatedFrom = String(req.query.updatedFrom || '').trim();
  const page = Number(req.query.page || 0);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
  const usePaging = page > 0;
  const sortBy = String(req.query.sortBy || 'priority');
  const sortOrder = String(req.query.sortOrder || 'desc').toLowerCase()==='asc' ? 'ASC' : 'DESC';

  let where = '';
  let params = [];

  if (['worker','worker_print','worker_film','worker_bag','worker_ship'].includes(req.user.role)) {
    const worker = req.user.userName;
    if (req.user.role === 'worker_print') { where = "status='印刷' AND assigned_print_worker=?"; params=[worker]; }
    else if (req.user.role === 'worker_film') { where = "status='复膜' AND assigned_lamination_worker=?"; params=[worker]; }
    else if (req.user.role === 'worker_bag') { where = "status='制袋' AND assigned_bagging_worker=?"; params=[worker]; }
    else if (req.user.role === 'worker_ship') { where = "status='发货' AND assigned_shipping_worker=?"; params=[worker]; }
    else {
      where = "((status='印刷' AND assigned_print_worker=?) OR (status='复膜' AND assigned_lamination_worker=?) OR (status='制袋' AND assigned_bagging_worker=?) OR (status='发货' AND assigned_shipping_worker=?))";
      params=[worker,worker,worker,worker];
    }
  }

  if (status) {
    where = where ? `${where} AND status = ?` : 'status = ?';
    params.push(status);
  }

  if (updatedFrom) {
    where = where ? `${where} AND datetime(updated_at) >= datetime(?)` : 'datetime(updated_at) >= datetime(?)';
    params.push(updatedFrom);
  }

  if (q) {
    const kw = `%${q}%`;
    const qSql = '(customer_name LIKE ? OR bag_type LIKE ? OR use_case LIKE ? OR order_spec LIKE ? OR order_qty LIKE ?)';
    where = where ? `${where} AND ${qSql}` : qSql;
    params.push(kw, kw, kw, kw, kw);
  }

  const whereSql = where ? `WHERE ${where}` : '';
  let orderSql = ' ORDER BY priority DESC, urgency DESC, updated_at DESC';
  if (sortBy === 'start_time') {
    orderSql = ` ORDER BY datetime(COALESCE(start_time, created_at)) ${sortOrder}, priority DESC, urgency DESC`;
  }

  const attachWoLite = (rows=[]) => {
    const ids = rows.map(r=>Number(r.id)).filter(Boolean);
    if(!ids.length) return rows;
    const marks = ids.map(()=>'?').join(',');
    const ws = db.prepare(`SELECT order_id, customer_name, spec, process_requirements_json, id FROM work_orders WHERE order_id IN (${marks}) ORDER BY id DESC`).all(...ids);
    const map = new Map();
    const build = (p={})=>{
      const pf = inferPrintFilmFields(p);
      return {
        wo_print_qty: String(p.printQty||p.print_qty||'').trim(),
        wo_print_mold: String(pf.mold||'').trim(),
        wo_print_film_size: String(pf.size||'').trim(),
        wo_print_film_qty: String(pf.qty||'').trim(),
        wo_print_film_unit: String(pf.unit||'').trim(),
        wo_ink_requirement: String(p.inkRequirement||'').trim()
      };
    };
    ws.forEach(w=>{
      const oid=Number(w.order_id);
      if(!oid || map.has(oid)) return;
      let p={};
      try{ p=JSON.parse(w.process_requirements_json||'{}'); }catch(_){ p={}; }
      map.set(oid, build(p));
    });

    const missing = rows.filter(r=>!map.has(Number(r.id)));
    if(missing.length){
      const fallbackRows = db.prepare(`
        SELECT customer_name, spec, process_requirements_json
        FROM work_orders
        WHERE customer_name IS NOT NULL AND spec IS NOT NULL
        ORDER BY id DESC
        LIMIT 5000
      `).all();
      const pairMap = new Map();
      fallbackRows.forEach(w=>{
        const key = `${String(w.customer_name||'').trim()}||${String(w.spec||'').trim()}`;
        if(!key || pairMap.has(key)) return;
        let p={};
        try{ p=JSON.parse(w.process_requirements_json||'{}'); }catch(_){ p={}; }
        pairMap.set(key, build(p));
      });
      missing.forEach(r=>{
        const key = `${String(r.customer_name||'').trim()}||${String(r.order_spec||'').trim()}`;
        if(pairMap.has(key)) map.set(Number(r.id), pairMap.get(key));
      });
    }

    const subRows = db.prepare(`SELECT order_id FROM order_subscriptions WHERE user_name=? AND order_id IN (${marks})`).all(String(req.user?.userName||''), ...ids);
    const subSet = new Set(subRows.map(x=>Number(x.order_id||0)));
    return rows.map(r=>({ ...r, ...(map.get(Number(r.id))||{}), my_subscribed: subSet.has(Number(r.id)) ? 1 : 0 }));
  };

  if (!usePaging) {
    const rows = db.prepare(`SELECT * FROM orders ${whereSql}${orderSql}`).all(...params);
    const fixed = enrichCustomerDisplay(attachWoLite(rows));
    return res.json(fixed.map(r => ({ ...r, size_json: JSON.parse(r.size_json || '{}') })));
  }

  const total = db.prepare(`SELECT count(*) AS c FROM orders ${whereSql}`).get(...params).c;
  const offset = (page - 1) * pageSize;
  const rows = db.prepare(`SELECT * FROM orders ${whereSql}${orderSql} LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
  const fixed = enrichCustomerDisplay(attachWoLite(rows));
  res.json({
    rows: fixed.map(r => ({ ...r, size_json: JSON.parse(r.size_json || '{}') })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  });
});

router.get('/stats/capacity', allowRoles('super_admin','manager','ai_sales'), (req, res) => {
  const mode = String(req.query.mode || 'day'); // day|week|month
  const days = Math.max(1, Math.min(180, Number(req.query.days || 30)));
  const from = new Date(Date.now() - days * 86400000).toISOString();

  const bucketExpr = mode === 'month'
    ? "strftime('%Y-%m', datetime(created_at,'localtime'))"
    : (mode === 'week'
      ? "strftime('%Y-W%W', datetime(created_at,'localtime'))"
      : "strftime('%Y-%m-%d', datetime(created_at,'localtime'))");

  const trend = db.prepare(`
    SELECT ${bucketExpr} AS bucket, stage, SUM(COALESCE(qty,0)) AS qty_sum, COUNT(*) AS cnt
    FROM order_stage_logs
    WHERE event_type='COMPLETE' AND COALESCE(rolled_back,0)=0 AND datetime(created_at) >= datetime(?)
    GROUP BY bucket, stage
    ORDER BY bucket DESC
    LIMIT 800
  `).all(from);

  const bySource = db.prepare(`
    SELECT stage, source, SUM(COALESCE(qty,0)) AS qty_sum, COUNT(*) AS cnt
    FROM order_stage_logs
    WHERE event_type='COMPLETE' AND COALESCE(rolled_back,0)=0 AND datetime(created_at) >= datetime(?)
    GROUP BY stage, source
    ORDER BY stage ASC, qty_sum DESC
  `).all(from);

  const byUser = db.prepare(`
    SELECT operated_by, stage, SUM(COALESCE(qty,0)) AS qty_sum, COUNT(*) AS cnt
    FROM order_stage_logs
    WHERE event_type='COMPLETE' AND COALESCE(rolled_back,0)=0 AND datetime(created_at) >= datetime(?)
    GROUP BY operated_by, stage
    ORDER BY qty_sum DESC
    LIMIT 200
  `).all(from);

  res.json({ mode, days, trend, bySource, byUser });
});

router.get('/stats/boss-dashboard', allowRoles('super_admin','manager','ai_sales'), (req, res) => {
  const normalizeLocalTs = (v='') => {
    let s = String(v || '').trim();
    if (!s) return '';
    s = s.replace('T', ' ');
    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(s)) s += ':00';
    return s;
  };

  const today = db.prepare("SELECT count(*) AS c FROM orders WHERE date(created_at)=date('now','localtime')").get().c;
  const week = db.prepare("SELECT count(*) AS c FROM orders WHERE datetime(created_at)>=datetime('now','-7 day','localtime')").get().c;
  const month = db.prepare("SELECT count(*) AS c FROM orders WHERE datetime(created_at)>=datetime('now','-30 day','localtime')").get().c;

  const inProgress = db.prepare("SELECT count(*) AS c FROM orders WHERE status IN ('印刷','复膜','制袋','发货')").get().c;
  const doneMonth = db.prepare("SELECT count(*) AS c FROM orders WHERE status='完成' AND datetime(updated_at)>=datetime('now','-30 day','localtime')").get().c;
  const urgentInProgress = db.prepare("SELECT count(*) AS c FROM orders WHERE urgency=1 AND status IN ('印刷','复膜','制袋','发货')").get().c;

  const statusBreakdown = db.prepare("SELECT status, count(*) AS c FROM orders GROUP BY status").all();

  const machineFromRaw = String(req.query.machineFrom || '').trim();
  const machineToRaw = String(req.query.machineTo || '').trim();
  const machineFrom = normalizeLocalTs(machineFromRaw);
  const machineTo = normalizeLocalTs(machineToRaw);
  const hasMachineRange = !!(machineFrom && machineTo);

  const machineSql = hasMachineRange
    ? `
      SELECT stage, source, SUM(COALESCE(qty,0)) AS meter_sum, COUNT(*) AS cnt
      FROM order_stage_logs
      WHERE event_type='COMPLETE' AND COALESCE(rolled_back,0)=0
        AND datetime(created_at) >= datetime(?)
        AND datetime(created_at) <= datetime(?)
        AND stage IN ('印刷','复膜')
        AND unit = '米'
        AND source IS NOT NULL
        AND TRIM(source) != ''
      GROUP BY stage, source
      ORDER BY stage ASC, meter_sum DESC
      LIMIT 200
    `
    : `
      SELECT stage, source, SUM(COALESCE(qty,0)) AS meter_sum, COUNT(*) AS cnt
      FROM order_stage_logs
      WHERE event_type='COMPLETE' AND COALESCE(rolled_back,0)=0
        AND datetime(created_at) >= datetime('now','-30 day','localtime')
        AND stage IN ('印刷','复膜')
        AND unit = '米'
        AND source IS NOT NULL
        AND TRIM(source) != ''
      GROUP BY stage, source
      ORDER BY stage ASC, meter_sum DESC
      LIMIT 200
    `;
  const machineMeterRows = hasMachineRange
    ? db.prepare(machineSql).all(machineFrom, machineTo)
    : db.prepare(machineSql).all();

  const machineOutputTop = machineMeterRows.map(x => ({
    stage: String(x.stage || ''),
    machine: String(x.source || '').trim(),
    totalMeter: Number(Number(x.meter_sum || 0).toFixed(2)),
    usedCount: Number(x.cnt || 0),
    formula: '近30天机台米数=Σ该机台在工序日志中的完成数量(qty,单位=米)'
  }));
  const stuckTop = db.prepare(`
    SELECT id, customer_name, order_spec, status, updated_at,
      CAST((julianday('now','localtime') - julianday(COALESCE(updated_at,created_at))) * 24 AS INTEGER) AS stay_hours
    FROM orders
    WHERE status IN ('印刷','复膜','制袋','发货')
    ORDER BY stay_hours DESC
    LIMIT 12
  `).all();

  const materialSalesperson = String(req.query.materialSalesperson || '').trim();
  const materialFromRaw = String(req.query.materialFrom || '').trim();
  const materialToRaw = String(req.query.materialTo || '').trim();
  const materialFrom = normalizeLocalTs(materialFromRaw);
  const materialTo = normalizeLocalTs(materialToRaw);
  const hasMaterialRange = !!(materialFrom && materialTo);

  // 材料消耗（按开单理论消耗：直接取开单每层重量）
  const woSql = hasMaterialRange
    ? `
      SELECT id, work_no, order_id, salesperson_name, customer_name, product_name, created_at, process_requirements_json
      FROM work_orders
      WHERE order_id IS NOT NULL
        AND datetime(created_at) >= datetime(?)
        AND datetime(created_at) <= datetime(?)
      ORDER BY id DESC
      LIMIT 2500
    `
    : `
      SELECT id, work_no, order_id, salesperson_name, customer_name, product_name, created_at, process_requirements_json
      FROM work_orders
      WHERE order_id IS NOT NULL
        AND datetime(created_at) >= datetime('now','-30 day','localtime')
      ORDER BY id DESC
      LIMIT 2500
    `;
  const woRows = hasMaterialRange
    ? db.prepare(woSql).all(materialFrom, materialTo)
    : db.prepare(woSql).all();

  const matMap = new Map();
  const materialDetails = [];
  const workOrderSet = new Set();
  const salesMap = new Map();

  woRows.forEach(r => {
    const salesName = String(r.salesperson_name || '').trim();
    if (materialSalesperson && salesName !== materialSalesperson) return;

    workOrderSet.add(Number(r.id || 0));
    let p = {};
    try { p = JSON.parse(r.process_requirements_json || '{}'); } catch {}

    for (let i = 1; i <= 4; i++) {
      const name = normalizeLayerName(p[`layer${i}`] || p[`mat${i}`] || '');
      if (!name) continue;
      const weightRaw = p[`l${i}Weight`] || p[`l${i}_weight`] || p[`weight${i}`] || '';
      const kg = parseLayerWeightKg(weightRaw);
      if (!(kg > 0)) continue;

      const old = matMap.get(name) || { usedCount: 0, totalKg: 0, orderIds: new Set() };
      old.usedCount += 1;
      old.totalKg += kg;
      old.orderIds.add(Number(r.id || 0));
      matMap.set(name, old);

      materialDetails.push({
        materialName: name,
        layerNo: i,
        weightKg: Number(kg.toFixed(3)),
        workOrderId: Number(r.id || 0),
        workNo: String(r.work_no || ''),
        orderId: Number(r.order_id || 0),
        salesperson: salesName,
        customerName: String(r.customer_name || ''),
        productName: String(r.product_name || ''),
        createdAt: String(r.created_at || '')
      });
      if (salesName) {
        const sv = salesMap.get(salesName) || { name: salesName, weightKg: 0, count: 0 };
        sv.weightKg += kg;
        sv.count += 1;
        salesMap.set(salesName, sv);
      }
    }
  });

  const materialTop = [...matMap.entries()].map(([name, v]) => ({
    name,
    usedCount: v.usedCount,
    totalUsageKg: Number(v.totalKg.toFixed(3)),
    totalUsageTon: Number((v.totalKg / 1000).toFixed(6)),
    workOrderCount: v.orderIds.size,
    usageFormula: '材料总消耗(kg)=Σ开单各层填写重量(l1Weight~l4Weight)'
  })).sort((a, b) => b.totalUsageKg - a.totalUsageKg).slice(0, 60);

  const materialSalespersonTop = [...salesMap.values()]
    .sort((a,b)=>b.weightKg-a.weightKg)
    .map(x=>({ name:x.name, totalUsageKg:Number(x.weightKg.toFixed(3)), usedCount:x.count }));
  const allSalesRows = db.prepare(`
    SELECT DISTINCT salesperson_name
    FROM work_orders
    WHERE order_id IS NOT NULL AND salesperson_name IS NOT NULL AND TRIM(salesperson_name)!=''
    ORDER BY salesperson_name
  `).all();
  const isZhName = (s='') => /[\u4e00-\u9fff]/.test(String(s||''));
  let materialSalespersons = allSalesRows.map(x=>String(x.salesperson_name||'').trim()).filter(Boolean);
  const activeSalespersons = db.prepare("SELECT name FROM salespersons WHERE active=1 ORDER BY name").all().map(x=>String(x.name||'').trim()).filter(Boolean);
  materialSalespersons = [...new Set([...materialSalespersons, ...activeSalespersons])]
    .filter(isZhName)
    .sort((a,b)=>String(a).localeCompare(String(b),'zh-CN'));
  if (!materialSalespersons.length) {
    materialSalespersons = [...new Set(woRows.map(r=>String(r.salesperson_name||'').trim()).filter(Boolean))]
      .filter(isZhName)
      .sort((a,b)=>String(a).localeCompare(String(b),'zh-CN'));
  }

  const totalUsageKg = materialTop.reduce((s, x) => s + Number(x.totalUsageKg || 0), 0);
  const materialSummary = {
    totalUsageKg: Number(totalUsageKg.toFixed(3)),
    totalUsageTon: Number((totalUsageKg / 1000).toFixed(6)),
    workOrderCount: workOrderSet.size,
    materialKindCount: materialTop.length,
    formula: '订单总消耗(kg)=Σ(各材料层填写重量kg)'
  };
  const materialDetailTop = materialDetails.slice(0, 300);

  // 交期风险（逾期）
  const overdueTop = db.prepare(`
    SELECT w.id, w.customer_name, w.product_name, w.delivery_date, COALESCE(o.status,'未同步') AS order_status,
      CAST((julianday('now','localtime') - julianday(w.delivery_date)) AS INTEGER) AS overdue_days
    FROM work_orders w
    LEFT JOIN orders o ON o.id = w.order_id
    WHERE w.delivery_date IS NOT NULL
      AND w.delivery_date != ''
      AND date(w.delivery_date) < date('now','localtime')
      AND (o.id IS NULL OR o.status != '完成')
    ORDER BY overdue_days DESC
    LIMIT 12
  `).all();

  // 毛利异常（低毛利）
  const marginRiskTop = db.prepare(`
    SELECT id, customer_name, product_name, amount, cost,
      CASE WHEN COALESCE(amount,0) > 0 THEN ((amount - COALESCE(cost,0)) * 100.0 / amount) ELSE 0 END AS margin_rate
    FROM quote_sheets
    WHERE datetime(updated_at) >= datetime('now','-60 day','localtime')
      AND COALESCE(amount,0) > 0
    ORDER BY margin_rate ASC
    LIMIT 12
  `).all();

  // 材料涨价预警：近30天 vs 前30天
  const matsLast = db.prepare(`
    SELECT input_json FROM cost_snapshots
    WHERE kind='history' AND datetime(created_at)>=datetime('now','-30 day','localtime')
    ORDER BY id DESC LIMIT 1000
  `).all();
  const matsPrev = db.prepare(`
    SELECT input_json FROM cost_snapshots
    WHERE kind='history' AND datetime(created_at)<datetime('now','-30 day','localtime')
      AND datetime(created_at)>=datetime('now','-60 day','localtime')
    ORDER BY id DESC LIMIT 1000
  `).all();

  const parseMatAvg = (rows=[]) => {
    const mm = new Map();
    rows.forEach(r => {
      let input={};
      try{ input=JSON.parse(r.input_json||'{}'); }catch{}
      const names = Array.isArray(input.materialNames) ? input.materialNames : [input.mat1,input.mat2,input.mat3,input.mat4];
      const prices = Array.isArray(input.price) ? input.price : [input.pr1,input.pr2,input.pr3,input.pr4];
      names.forEach((n,i)=>{
        const name=String(n||'').trim();
        const p=Number(prices?.[i]||0)||0;
        if(!name || p<=0) return;
        const old=mm.get(name)||{sum:0,cnt:0};
        old.sum+=p; old.cnt+=1; mm.set(name,old);
      });
    });
    return mm;
  };
  const lastAvgMap=parseMatAvg(matsLast);
  const prevAvgMap=parseMatAvg(matsPrev);
  const materialPriceAlerts=[...lastAvgMap.entries()].map(([name,v])=>{
    const lastAvg=v.sum/Math.max(1,v.cnt);
    const p=prevAvgMap.get(name);
    const prevAvg=(p&&p.cnt)?(p.sum/p.cnt):0;
    const changePct=prevAvg>0?((lastAvg-prevAvg)*100/prevAvg):0;
    return { name, prevAvg:Number(prevAvg.toFixed(2)), lastAvg:Number(lastAvg.toFixed(2)), changePct:Number(changePct.toFixed(2)) };
  }).filter(x=>x.prevAvg>0 && x.changePct>=8).sort((a,b)=>b.changePct-a.changePct).slice(0,12);

  const todayChangesRaw = db.prepare(`
    SELECT resource_id, detail, user_name, created_at
    FROM audit_logs
    WHERE action='advance_order_status'
      AND resource_type='order'
      AND datetime(created_at) >= datetime(date('now','localtime') || ' 00:00:00')
      AND datetime(created_at) < datetime(date('now','localtime','+1 day') || ' 00:00:00')
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 200
  `).all();
  const orderIdSet = [...new Set(todayChangesRaw.map(r => Number(r.resource_id || 0)).filter(Boolean))];
  const orderNameMap = new Map();
  if (orderIdSet.length) {
    const ph = orderIdSet.map(() => '?').join(',');
    const rowsN = db.prepare(`SELECT id, customer_name FROM orders WHERE id IN (${ph})`).all(...orderIdSet);
    rowsN.forEach(x => orderNameMap.set(Number(x.id), x.customer_name || ''));
  }
  const todayChanges = todayChangesRaw.map(r => {
    const orderId = Number(r.resource_id || 0);
    const m = String(r.detail || '').match(/([^\s]+)\s*->\s*([^|\s]+)/);
    return {
      orderId,
      customerName: orderNameMap.get(orderId) || '',
      fromStatus: m ? m[1] : '',
      toStatus: m ? m[2] : '',
      changedAt: r.created_at || '',
      operatedBy: r.user_name || ''
    };
  }).filter(x => x.orderId > 0);

  res.json({
    summary: { today, week, month, inProgress, doneMonth, urgentInProgress },
    statusBreakdown,
    stuckTop,
    overdueTop,
    marginRiskTop,
    materialPriceAlerts,
    materialTop,
    materialSummary,
    materialDetails: materialDetailTop,
    machineOutputTop,
    todayChanges,
    materialRange: {
      from: hasMaterialRange ? materialFrom : '',
      to: hasMaterialRange ? materialTo : '',
      label: hasMaterialRange ? `${materialFrom} ~ ${materialTo}` : '近30天（开单同步订单）'
    },
    materialSalespersons,
    materialSalespersonTop,
    selectedMaterialSalesperson: materialSalesperson,
    machineRange: {
      from: hasMachineRange ? machineFrom : '',
      to: hasMachineRange ? machineTo : '',
      label: hasMachineRange ? `${machineFrom} ~ ${machineTo}` : '近30天'
    }
  });
});


router.get('/stats/production-report', allowRoles('super_admin','manager','ai_sales'), (req, res) => {
  const normalizeLocalTs = (v='') => {
    let s = String(v || '').trim();
    if (!s) return '';
    s = s.replace('T', ' ');
    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(s)) s += ':00';
    return s;
  };
  const nowDt = new Date();
  const defaultFromDt = new Date(nowDt);
  defaultFromDt.setHours(8,0,0,0);
  if(nowDt.getHours()<8) defaultFromDt.setDate(defaultFromDt.getDate()-1);
  const pad=n=>String(n).padStart(2,'0');
  const toSql=(d)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  const from = normalizeLocalTs(req.query.from || '') || toSql(defaultFromDt);
  const to = normalizeLocalTs(req.query.to || '') || toSql(nowDt);

  const rows = db.prepare(`
    SELECT l.stage, l.source, l.qty, l.unit, l.created_at,
           o.id AS order_id, o.customer_name, o.order_spec, o.bag_type
    FROM order_stage_logs l
    LEFT JOIN orders o ON o.id = l.order_id
    WHERE l.event_type='COMPLETE' AND COALESCE(l.rolled_back,0)=0
      AND datetime(l.created_at) >= datetime(?)
      AND datetime(l.created_at) <= datetime(?)
      AND l.stage IN ('印刷','复膜','制袋')
      AND COALESCE(l.qty,0) > 0
    ORDER BY datetime(l.created_at) DESC, l.id DESC
    LIMIT 1200
  `).all(from,to);

  const details = rows.map(r=>({
    stage: String(r.stage||''),
    productName: String(r.customer_name||'-'),
    machine: String(r.source||'-').trim() || '-',
    meter: Number(Number(r.qty||0).toFixed(2)),
    unit: String(r.unit||''),
    orderId: Number(r.order_id||0),
    spec: String(r.order_spec||''),
    bagType: String(r.bag_type||''),
    createdAt: r.created_at || '',
    meterFormula: '机台米数=工序日志完成数量qty（unit=米）'
  }));

  const machineMap = new Map();
  details.forEach(x=>{
    const key=`${x.stage}__${x.machine}`;
    const old=machineMap.get(key)||{ stage:x.stage, machine:x.machine, totalMeter:0, count:0 };
    old.totalMeter += Number(x.meter||0);
    old.count += 1;
    machineMap.set(key, old);
  });
  const machineStats=[...machineMap.values()].map(x=>(
    { ...x, totalMeter:Number(x.totalMeter.toFixed(2)), formula:'机台产量=Σ该机台在该工序日志qty' }
  )).sort((a,b)=>b.totalMeter-a.totalMeter);

  res.json({
    range: { from, to, label: `${from} ~ ${to}`, defaultRule: '未选择时间时默认当天08:00到当前时刻' },
    details,
    machineStats
  });
});

router.get('/stats/film-usage', allowRoles('super_admin','manager','ai_sales'), (req, res) => {
  const from = String(req.query.from || '2025-02-01T00:00:00');
  const to = String(req.query.to || '2026-02-01T00:00:00');
  const kw = String(req.query.kw || '卷膜,自动包');
  const kws = kw.split(/[，,]/).map(x => x.trim()).filter(Boolean);
  const likeSql = kws.length ? '(' + kws.map(() => 'customer_name LIKE ?').join(' OR ') + ')' : '1=1';
  const likeParams = kws.map(k => `%${k}%`);

  const rows = db.prepare(`
    SELECT id, customer_name, order_qty, start_time, created_at
    FROM orders
    WHERE datetime(COALESCE(start_time, created_at)) >= datetime(?)
      AND datetime(COALESCE(start_time, created_at)) < datetime(?)
      AND ${likeSql}
    ORDER BY datetime(COALESCE(start_time, created_at)) ASC
  `).all(from, to, ...likeParams);

  const unitTotals = { roll: 0, kg: 0, ton: 0, meter: 0, wan_meter: 0, unknown: 0 };
  const formatCount = {};
  const productTotals = {};

  function splitProductCount(name = '') {
    const m = String(name).match(/(\d+)\s*款/);
    if (m) return Math.max(1, Number(m[1]));
    const cleaned = String(name).replace(/自动包|卷膜|透明|有文字|无文字|\d+(?:\.\d+)?\s*[xX*×]\s*\d+(?:\.\d+)?/g, '');
    const segs = cleaned.split(/[，、,和]/).map(s => s.trim()).filter(Boolean);
    return Math.max(1, Math.min(10, segs.length || 1));
  }

  function detectFormat(q = '') {
    const s = String(q || '').trim();
    if (!s) return '空';
    if (/^\d+(\.\d+)?\s*卷$/.test(s)) return '纯卷数';
    if (/^\d+(\.\d+)?\s*(kg|KG|千克|公斤|斤|吨|米|万米|万)$/.test(s)) return '纯数值+单位';
    if (/^各\d+(\.\d+)?\s*(kg|KG|千克|公斤|斤|吨|卷|米|万米|万|款)$/.test(s)) return '各+数值+单位';
    if (/各\d+(\.\d+)?/.test(s) && /，|,|和|其他/.test(s)) return '分组+各(混合描述)';
    if (/\d+(\.\d+)?\s*(kg|KG|卷|米|万米|万|吨)/.test(s)) return '多数值混合';
    return '其他';
  }

  function parseBase(q = '') {
    const s = String(q || '').trim();
    const out = [];
    const re = /(\d+(?:\.\d+)?)\s*(万米|米|kg|KG|千克|公斤|斤|吨|卷|万)/g;
    let m;
    while ((m = re.exec(s))) {
      out.push({ value: Number(m[1]), unit: m[2] });
    }
    return out;
  }

  for (const r of rows) {
    const qty = String(r.order_qty || '').trim();
    const fmt = detectFormat(qty);
    formatCount[fmt] = (formatCount[fmt] || 0) + 1;

    const pieces = parseBase(qty);
    const count = splitProductCount(r.customer_name || '');

    if (!pieces.length) {
      unitTotals.unknown += 1;
      continue;
    }

    for (const p of pieces) {
      const val = Number(p.value) || 0;
      if (p.unit === '卷') unitTotals.roll += val;
      else if (p.unit === '吨') unitTotals.ton += val;
      else if (p.unit === 'kg' || p.unit === 'KG' || p.unit === '千克' || p.unit === '公斤') unitTotals.kg += val;
      else if (p.unit === '斤') unitTotals.kg += val * 0.5;
      else if (p.unit === '米') unitTotals.meter += val;
      else if (p.unit === '万米') unitTotals.wan_meter += val;
    }

    const key = r.customer_name || '未命名';
    if (!productTotals[key]) productTotals[key] = { orders: 0, splitCount: count, roll: 0, kg: 0, meter: 0, wan_meter: 0 };
    productTotals[key].orders += 1;
    for (const p of pieces) {
      const share = (Number(p.value) || 0) / count;
      if (p.unit === '卷') productTotals[key].roll += share;
      else if (p.unit === '吨') productTotals[key].kg += share * 1000;
      else if (p.unit === 'kg' || p.unit === 'KG' || p.unit === '千克' || p.unit === '公斤') productTotals[key].kg += share;
      else if (p.unit === '斤') productTotals[key].kg += share * 0.5;
      else if (p.unit === '米') productTotals[key].meter += share;
      else if (p.unit === '万米') productTotals[key].wan_meter += share;
    }
  }

  const topProducts = Object.entries(productTotals)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => (b.kg - a.kg) || (b.roll - a.roll) || (b.orders - a.orders))
    .slice(0, 120);

  res.json({
    from, to, keywords: kws, totalOrders: rows.length,
    formatCount,
    unitTotals,
    unitTotalsNormalized: {
      ton_from_kg: Number((unitTotals.kg / 1000).toFixed(3)),
      ton_direct: Number(unitTotals.ton.toFixed(3)),
      ton_combined: Number((unitTotals.ton + unitTotals.kg / 1000).toFixed(3))
    },
    topProducts
  });
});

router.patch('/:id', allowRoles('super_admin','manager'), (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: '订单ID无效' });
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '订单不存在' });

  const { customerName, bagType, useCase, urgency } = req.body || {};
  db.prepare(`
    UPDATE orders
    SET customer_name = COALESCE(?, customer_name),
        bag_type = COALESCE(?, bag_type),
        use_case = COALESCE(?, use_case),
        urgency = COALESCE(?, urgency),
        updated_at = ?
    WHERE id = ?
  `).run(customerName ?? null, bagType ?? null, useCase ?? null, urgency ?? null, now(), id);

  audit({ role: req.user.role, userName: req.user.userName, action: 'edit_order', resourceType: 'order', resourceId: id });
  res.json({ ok: true });
});

router.patch('/:id/full', allowRoles('super_admin','manager'), (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: '订单ID无效' });
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '订单不存在' });

  const b = req.body || {};
  const status = String(b.status ?? row.status);
  const statusAllowed = ['印刷', '复膜', '制袋', '发货', '完成'];
  if (!statusAllowed.includes(status)) return res.status(400).json({ error: '状态值无效' });

  db.prepare(`
    UPDATE orders
    SET customer_name=?, bag_type=?, use_case=?, order_qty=?, order_spec=?,
        status=?, urgency=?,
        assigned_print_worker=?, assigned_lamination_worker=?, assigned_bagging_worker=?, assigned_shipping_worker=?,
        updated_at=?
    WHERE id=?
  `).run(
    String(b.customer_name ?? row.customer_name ?? '').trim(),
    String(b.bag_type ?? row.bag_type ?? '').trim(),
    String(b.use_case ?? row.use_case ?? '').trim(),
    String(b.order_qty ?? row.order_qty ?? '').trim(),
    String(b.order_spec ?? row.order_spec ?? '').trim(),
    status,
    Number(b.urgency) === 1 ? 1 : 0,
    String(b.assigned_print_worker ?? row.assigned_print_worker ?? '').trim(),
    String(b.assigned_lamination_worker ?? row.assigned_lamination_worker ?? '').trim(),
    String(b.assigned_bagging_worker ?? row.assigned_bagging_worker ?? '').trim(),
    String(b.assigned_shipping_worker ?? row.assigned_shipping_worker ?? '').trim(),
    now(),
    id
  );

  audit({ role: req.user.role, userName: req.user.userName, action: 'edit_order_full', resourceType: 'order', resourceId: id });
  res.json({ ok: true });
});

router.patch('/:id/processing', allowRoles('super_admin', 'manager', 'worker', 'worker_print', 'worker_film', 'worker_bag', 'worker_ship'), (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: '订单ID无效' });
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '订单不存在' });
  if (row.status === '完成') return res.status(400).json({ error: '已完成订单无需标记处理中' });

  if (!canOperateStage(row, req.user, row.status)) {
    return res.status(403).json({ error: '工人仅可操作本人负责工序' });
  }

  db.prepare('UPDATE orders SET processing_started_at = ?, processing_stage = ?, updated_at = ? WHERE id = ?').run(now(), row.status, now(), id);
  audit({
    role: req.user.role,
    userName: req.user.userName,
    action: 'mark_order_processing',
    resourceType: 'order',
    resourceId: id,
    detail: row.status
  });

  res.json({ ok: true, status: row.status });
});

router.patch('/:id/next', allowRoles('super_admin', 'manager', 'worker', 'worker_print', 'worker_film', 'worker_bag', 'worker_ship'), (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: '订单ID无效' });
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '订单不存在' });

  const idx = flow.indexOf(row.status);
  if (idx === -1 || idx === flow.length - 1) {
    return res.status(400).json({ error: '当前状态不可继续流转' });
  }

  if (!canOperateStage(row, req.user, row.status)) {
    return res.status(403).json({ error: '工人仅可操作本人负责工序' });
  }

  const stage = row.status;
  const stageCfg = {
    '印刷': { unit: '米', requireLog: true },
    '复膜': { unit: '米', requireLog: true },
    '制袋': { unit: '袋', requireLog: true },
    '发货': { unit: '单', requireLog: true }
  };
  const cfg = stageCfg[stage] || { unit: '', requireLog: false };

  const source = String(req.body?.source || '').trim();
  const qtyRaw = req.body?.qty;
  const qty = qtyRaw === '' || qtyRaw == null ? null : Number(qtyRaw);

  if (cfg.requireLog && !source) {
    return res.status(400).json({ error: `${stage}完成需选择机台/加工来源` });
  }
  if (cfg.requireLog && (!Number.isFinite(qty) || qty <= 0)) {
    return res.status(400).json({ error: `${stage}完成需填写${cfg.unit}数且大于0` });
  }

  const next = flow[idx + 1];
  const ts = now();
  const advance = db.transaction(() => {
    db.prepare('UPDATE orders SET status = ?, processing_started_at = NULL, processing_stage = NULL, updated_at = ? WHERE id = ?').run(next, ts, id);
    if (!source) return 0;
    const ins = db.prepare(`
      INSERT INTO order_stage_logs (order_id, stage, source, qty, unit, operated_by, role, event_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'COMPLETE', ?)
    `).run(id, stage, source, Number.isFinite(qty) ? qty : null, cfg.unit || String(req.body?.unit || ''), req.user.userName || '', req.user.role || '', ts);
    return Number(ins.lastInsertRowid || 0);
  });
  const completionLogId = advance();

  audit({
    role: req.user.role,
    userName: req.user.userName,
    action: 'advance_order_status',
    resourceType: 'order',
    resourceId: id,
    detail: `${row.status} -> ${next}${source ? ` | ${source}${Number.isFinite(qty)?` ${qty}${cfg.unit}`:''}` : ''}`
  });

  res.json({ ok: true, from: row.status, to: next, completionLogId });
});

router.post('/:id/rollback-last-complete', allowRoles('super_admin', 'manager', 'ai_sales', 'worker', 'worker_print', 'worker_film', 'worker_bag', 'worker_ship'), (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: '订单ID无效' });

  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '订单不存在' });

  const stage = getRollbackStageByOrderStatus(row.status);
  if (!stage) return res.status(400).json({ error: '当前环节无可回退的上一步' });
  if (!canOperateStage(row, req.user, stage)) {
    return res.status(403).json({ error: '工人仅可回退本人负责工序' });
  }

  const reason = String(req.body?.reason || '').trim();
  const ts = now();

  const doRollback = db.transaction(() => {
    const target = db.prepare(`
      SELECT *
      FROM order_stage_logs
      WHERE order_id = ?
        AND stage = ?
        AND event_type = 'COMPLETE'
        AND COALESCE(rolled_back,0) = 0
      ORDER BY id DESC
      LIMIT 1
    `).get(id, stage);

    if (!target) {
      const err = new Error('该工序没有可回退的完成记录');
      err.code = 'NO_COMPLETE_EVENT_TO_ROLLBACK';
      throw err;
    }

    const targetPayload = {
      source: target.source || '',
      qty: Number(target.qty || 0),
      unit: target.unit || STAGE_UNIT[stage] || '',
      completedAt: target.created_at || '',
      completedBy: target.operated_by || '',
      stage
    };

    db.prepare(`
      UPDATE order_stage_logs
      SET rolled_back = 1
      WHERE id = ?
    `).run(target.id);

    const ins = db.prepare(`
      INSERT INTO order_stage_logs (
        order_id, stage, source, qty, unit, operated_by, role,
        event_type, rollback_of_log_id, rollback_reason, extra_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ROLLBACK', ?, ?, ?, ?)
    `).run(
      id,
      stage,
      target.source || '',
      Number(target.qty || 0),
      target.unit || STAGE_UNIT[stage] || '',
      req.user.userName || '',
      req.user.role || '',
      Number(target.id || 0),
      reason,
      JSON.stringify(targetPayload),
      ts
    );

    db.prepare('UPDATE orders SET status = ?, processing_started_at = NULL, processing_stage = NULL, updated_at = ? WHERE id = ?').run(stage, ts, id);

    const toStatus = stage;
    audit({
      role: req.user.role,
      userName: req.user.userName,
      action: 'rollback_order_stage_complete',
      resourceType: 'order',
      resourceId: id,
      detail: `${target.stage} 回退 | ${target.source || '-'} ${target.qty || '-'}${target.unit || ''} | ${row.status} -> ${toStatus}${reason ? ` | ${reason}` : ''}`
    });

    return { target, rollbackLogId: Number(ins.lastInsertRowid || 0), toStatus };
  });

  try {
    const result = doRollback();
    return res.json({
      ok: true,
      orderId: id,
      stage,
      from: row.status,
      to: result.toStatus,
      rollbackLogId: result.rollbackLogId,
      rolledBackLogId: Number(result.target.id || 0),
      original: {
        source: result.target.source || '',
        qty: Number(result.target.qty || 0),
        unit: result.target.unit || STAGE_UNIT[stage] || '',
        createdAt: result.target.created_at || '',
        operatedBy: result.target.operated_by || ''
      }
    });
  } catch (e) {
    if (e?.code === 'NO_COMPLETE_EVENT_TO_ROLLBACK') {
      return res.status(409).json({ error: e.message || '无可回退记录', code: e.code });
    }
    return res.status(500).json({ error: e?.message || '回退失败' });
  }
});

router.get('/:id/stage-logs', allowRoles('super_admin','manager','ai_sales','worker','worker_print','worker_film','worker_bag','worker_ship'), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: '订单ID无效' });

  const rows = db.prepare(`
    SELECT id, stage, source, qty, unit, operated_by, role, event_type, rolled_back, rollback_of_log_id, rollback_reason, extra_json, created_at
    FROM order_stage_logs
    WHERE order_id = ?
    ORDER BY id DESC
    LIMIT 200
  `).all(id);

  const logs = rows.map(r => {
    let extra = {};
    try { extra = JSON.parse(r.extra_json || '{}'); } catch {}
    return {
      id: Number(r.id || 0),
      stage: String(r.stage || ''),
      source: String(r.source || ''),
      qty: Number(r.qty || 0),
      unit: String(r.unit || ''),
      eventType: String(r.event_type || 'COMPLETE'),
      rolledBack: Number(r.rolled_back || 0) === 1,
      rollbackOfLogId: Number(r.rollback_of_log_id || 0),
      rollbackReason: String(r.rollback_reason || ''),
      operatedBy: String(r.operated_by || ''),
      role: String(r.role || ''),
      createdAt: String(r.created_at || ''),
      extra
    };
  });

  res.json({ ok: true, logs });
});

router.get('/board/panel', allowRoles('super_admin','manager','ai_sales','worker','worker_print','worker_film','worker_bag','worker_ship'), (req, res) => {
  const statuses = ['印刷', '复膜', '制袋', '发货', '完成'];
  const activeStatuses = ['印刷', '复膜', '制袋', '发货'];
  const isWorker = ['worker','worker_print','worker_film','worker_bag','worker_ship'].includes(req.user.role);
  const worker = req.user.userName || '';

  const cacheKey = `${req.user.role}|${worker}`;
  const cached = boardPanelCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < 45000) {
    return res.json(cached.data);
  }

  let rows = [];
  if (isWorker) {
    let where = "(status='印刷' AND assigned_print_worker=?) OR (status='复膜' AND assigned_lamination_worker=?) OR (status='制袋' AND assigned_bagging_worker=?) OR (status='发货' AND assigned_shipping_worker=?)";
    let params = [worker, worker, worker, worker];
    if (req.user.role === 'worker_print') { where = "status='印刷' AND assigned_print_worker=?"; params = [worker]; }
    if (req.user.role === 'worker_film') { where = "status='复膜' AND assigned_lamination_worker=?"; params = [worker]; }
    if (req.user.role === 'worker_bag') { where = "status='制袋' AND assigned_bagging_worker=?"; params = [worker]; }
    if (req.user.role === 'worker_ship') { where = "status='发货' AND assigned_shipping_worker=?"; params = [worker]; }

    rows = db.prepare(`
      SELECT * FROM orders
      WHERE (${where})
      ORDER BY priority DESC, urgency DESC, updated_at DESC
      LIMIT 900
    `).all(...params);
  } else {
    const updatedFrom = new Date(Date.now() - 60 * 86400000).toISOString();
    rows = db.prepare(`
      SELECT * FROM orders
      WHERE status IN ('印刷','复膜','制袋','发货')
         OR (status='完成' AND datetime(updated_at) >= datetime(?))
      ORDER BY priority DESC, urgency DESC, updated_at DESC
      LIMIT 1200
    `).all(updatedFrom);
  }

  rows = enrichCustomerDisplay(rows);

  const summary = (isWorker ? activeStatuses : statuses).map(s => ({
    status: s,
    total: rows.filter(x => x.status === s).length,
    urgent: rows.filter(x => x.status === s && Number(x.urgency) === 1).length
  }));

  // 给看板补充开单信息（印刷数量/印刷米数/覆膜层等），用于列模板扩展
  const rowIds = rows.map(r => Number(r.id)).filter(Boolean);
  const woMap = new Map();
  const buildWo = (w = {}) => {
    let p = {};
    try { p = JSON.parse(w.process_requirements_json || '{}'); } catch {}
    const pf = inferPrintFilmFields(p);
    return {
      wo_work_no: w.work_no || '',
      wo_print_qty: p.printQty || '',
      wo_print_meter: p.printShift || '',
      wo_print_mold: pf.mold || '',
      wo_print_film_size: pf.size || '',
      wo_print_film_qty: pf.qty || '',
      wo_print_film_unit: pf.unit || '',
      wo_ref_color: p.refColor || '',
      wo_ink_requirement: p.inkRequirement || '',
      wo_film_type: p.filmType || '',
      wo_film_note: p.filmNote || '',
      wo_layer1: p.layer1 || '', wo_l1_size: p.l1Size || '', wo_l1_weight: p.l1Weight || '',
      wo_layer2: p.layer2 || '', wo_l2_size: p.l2Size || '', wo_l2_weight: p.l2Weight || '',
      wo_layer3: p.layer3 || '', wo_l3_size: p.l3Size || '', wo_l3_weight: p.l3Weight || '',
      wo_layer4: p.layer4 || '', wo_l4_size: p.l4Size || '', wo_l4_weight: p.l4Weight || '',
      wo_delivery_date: w.delivery_date || '',
      wo_bag_type: w.bag_type || '',
      wo_outsource: p.outsource || '',
      wo_zip_pos: p.zipPos || '',
      wo_tear_pos: p.tearPos || '',
      wo_hole_pos: p.holePos || '',
      wo_holes: p.holes || '',
      wo_edges: p.edges || '',
      wo_edge_cm: p.edgeCm || '',
      wo_pack_type: p.packType || '',
      wo_box_spec: p.boxSpec || '',
      wo_actual_qty: p.actualQty || '',
      wo_packer_sign: p.packerSign || '',
      wo_other_req: p.otherReq || '',
      wo_remark: p.remark || ''
    };
  };

  if (rowIds.length) {
    const ph = rowIds.map(() => '?').join(',');
    const woRows = db.prepare(`
      SELECT order_id, work_no, customer_name, spec, process_requirements_json, bag_type, delivery_date, roller, created_at, id
      FROM work_orders
      WHERE order_id IN (${ph})
      ORDER BY id DESC
    `).all(...rowIds);
    woRows.forEach(w => {
      const oid = Number(w.order_id || 0);
      if (!oid || woMap.has(oid)) return;
      woMap.set(oid, buildWo(w));
    });

    // 兜底：历史数据可能缺 order_id，按“客户+规格”回捞最近开单
    const missing = rows.filter(r => !woMap.has(Number(r.id)));
    if (missing.length) {
      const fallbackRows = db.prepare(`
        SELECT id, work_no, customer_name, spec, process_requirements_json, bag_type, delivery_date, roller, created_at
        FROM work_orders
        WHERE customer_name IS NOT NULL AND spec IS NOT NULL
        ORDER BY id DESC
        LIMIT 5000
      `).all();
      const pairMap = new Map();
      fallbackRows.forEach(w => {
        const key = `${String(w.customer_name || '').trim()}||${String(w.spec || '').trim()}`;
        if (!key || pairMap.has(key)) return;
        pairMap.set(key, buildWo(w));
      });
      missing.forEach(r => {
        const key = `${String(r.customer_name || '').trim()}||${String(r.order_spec || '').trim()}`;
        const hit = pairMap.get(key);
        if (hit) woMap.set(Number(r.id), hit);
      });
    }
  }

  const subSet = new Set(
    db.prepare('SELECT order_id FROM order_subscriptions WHERE user_name=?').all(String(req.user?.userName||'')).map(x=>Number(x.order_id||0))
  );
  const payload = {
    rows: rows.map(r => ({ ...r, my_subscribed: subSet.has(Number(r.id)) ? 1 : 0, ...((woMap.get(Number(r.id))||{})), size_json: JSON.parse(r.size_json || '{}') })),
    summary,
    cachedSeconds: 45
  };
  boardPanelCache.set(cacheKey, { ts: Date.now(), data: payload });
  if (boardPanelCache.size > 20) {
    const first = boardPanelCache.keys().next().value;
    if (first) boardPanelCache.delete(first);
  }
  res.json(payload);
});

router.get('/board/summary', allowRoles('super_admin','manager','ai_sales','worker'), (req, res) => {
  const statuses = ['印刷', '复膜', '制袋', '发货', '完成'];

  if (['worker','worker_print','worker_film','worker_bag','worker_ship'].includes(req.user.role)) {
    const worker = req.user.userName;
    const scope = [
      { status: '印刷', field: 'assigned_print_worker' },
      { status: '复膜', field: 'assigned_lamination_worker' },
      { status: '制袋', field: 'assigned_bagging_worker' },
      { status: '发货', field: 'assigned_shipping_worker' }
    ];
    const summary = scope.map(item => {
      const total = db.prepare(`SELECT count(*) AS c FROM orders WHERE status = ? AND ${item.field} = ?`).get(item.status, worker).c;
      const urgent = db.prepare(`SELECT count(*) AS c FROM orders WHERE status = ? AND ${item.field} = ? AND urgency = 1`).get(item.status, worker).c;
      return { status: item.status, total, urgent };
    });
    return res.json(summary);
  }

  const summary = statuses.map(s => {
    const total = db.prepare('SELECT count(*) AS c FROM orders WHERE status = ?').get(s).c;
    const urgent = db.prepare('SELECT count(*) AS c FROM orders WHERE status = ? AND urgency = 1').get(s).c;
    return { status: s, total, urgent };
  });
  res.json(summary);
});

router.get('/subscriptions/mine', (req, res) => {
  const rows = db.prepare('SELECT order_id, created_at FROM order_subscriptions WHERE user_name=? ORDER BY id DESC').all(String(req.user?.userName||''));
  res.json({ rows });
});

router.post('/:id/subscribe', (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: '订单ID无效' });
  const row = db.prepare('SELECT id FROM orders WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: '订单不存在' });
  db.prepare('INSERT OR IGNORE INTO order_subscriptions(order_id,user_name,created_at) VALUES(?,?,?)').run(id, String(req.user?.userName||''), now());
  audit({ role: req.user.role, userName: req.user.userName, action: 'subscribe_order', resourceType: 'order', resourceId: id });
  res.json({ ok: true });
});

router.delete('/:id/subscribe', (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: '订单ID无效' });
  db.prepare('DELETE FROM order_subscriptions WHERE order_id=? AND user_name=?').run(id, String(req.user?.userName||''));
  audit({ role: req.user.role, userName: req.user.userName, action: 'unsubscribe_order', resourceType: 'order', resourceId: id });
  res.json({ ok: true });
});

router.post('/:id/priority', allowRoles('super_admin','manager'), (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: '订单ID无效' });
  const row = db.prepare('SELECT id FROM orders WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '订单不存在' });
  const { priority = 0 } = req.body || {};
  const cleanPriority = Math.max(0, Math.min(999, Math.trunc(Number(priority) || 0)));
  db.prepare('UPDATE orders SET priority = ?, updated_at = ? WHERE id = ?').run(cleanPriority, now(), id);
  audit({ role: req.user.role, userName: req.user.userName, action: 'set_order_priority', resourceType: 'order', resourceId: id, detail: String(cleanPriority) });
  res.json({ ok: true, id, priority: cleanPriority });
});

router.post('/:id/image', allowRoles('super_admin','manager','ai_sales'), async (req, res) => {
  try {
    const id = validId(req.params.id);
    if (!id) return res.status(400).json({ error: '订单ID无效' });
    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: '订单不存在' });

    const imageUrl = String(req.body?.imageUrl || '').trim();
    const imageDataUrl = String(req.body?.imageDataUrl || '').trim();
    let finalUrl = '';
    let thumbUrl = '';

    if (imageUrl) {
      if (!/^https?:\/\//i.test(imageUrl) && !imageUrl.startsWith('/uploads/')) {
        return res.status(400).json({ error: '图片地址必须是 http(s) 或 /uploads/ 开头' });
      }
      finalUrl = imageUrl;
      thumbUrl = imageUrl;
    } else if (imageDataUrl) {
      const m = imageDataUrl.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i);
      if (!m) return res.status(400).json({ error: '仅支持 PNG/JPG/WEBP 图片' });
      const ext = m[2].toLowerCase() === 'jpeg' ? 'jpg' : m[2].toLowerCase();
      const b64 = m[3];
      const buf = Buffer.from(b64, 'base64');
      if (buf.length > 6 * 1024 * 1024) return res.status(400).json({ error: '图片过大，请控制在6MB以内' });

      const dir = path.join(__dirname, '..', '..', 'public', 'uploads', 'orders');
      fs.mkdirSync(dir, { recursive: true });
      const ts = Date.now();
      const fileName = `order_${id}_${ts}.${ext}`;
      const filePath = path.join(dir, fileName);
      fs.writeFileSync(filePath, buf);
      finalUrl = `/uploads/orders/${fileName}`;

      // 生成压缩缩略图（详情页优先加载，提升速度）
      const thumbName = `order_${id}_${ts}_thumb.jpg`;
      const thumbPath = path.join(dir, thumbName);
      try {
        const img = await Jimp.read(buf);
        img.scaleToFit(720, 720).quality(72);
        await img.writeAsync(thumbPath);
        thumbUrl = `/uploads/orders/${thumbName}`;
      } catch {
        thumbUrl = finalUrl;
      }
    } else {
      return res.status(400).json({ error: '请提供 imageUrl 或 imageDataUrl' });
    }

    db.prepare('UPDATE orders SET order_image_url=?, order_image_thumb_url=?, order_image_uploaded_by=?, updated_at=? WHERE id=?').run(finalUrl, thumbUrl || finalUrl, req.user.userName || '', now(), id);
    audit({ role: req.user.role, userName: req.user.userName, action: 'set_order_image', resourceType: 'order', resourceId: id, detail: finalUrl });
    res.json({ ok: true, imageUrl: finalUrl, thumbUrl: thumbUrl || finalUrl });
  } catch (e) {
    res.status(500).json({ error: e.message || '保存图片失败' });
  }
});

router.delete('/:id/image', allowRoles('super_admin','manager','ai_sales','worker','worker_print','worker_film','worker_bag','worker_ship'), (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: '订单ID无效' });
  const row = db.prepare('SELECT id, order_image_url, order_image_thumb_url, order_image_uploaded_by FROM orders WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '订单不存在' });
  if (!row.order_image_url && !row.order_image_thumb_url) return res.json({ ok: true, removed: false });

  const who = String(req.user?.userName || '');
  if (!row.order_image_uploaded_by || row.order_image_uploaded_by !== who) {
    return res.status(403).json({ error: '仅图片上传人可删除图片' });
  }

  const removeLocal = (u='') => {
    try {
      const s = String(u || '');
      if (!s.startsWith('/uploads/orders/')) return;
      const p = path.join(__dirname, '..', '..', 'public', s.replace(/^\//, ''));
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {}
  };
  removeLocal(row.order_image_url);
  removeLocal(row.order_image_thumb_url);

  db.prepare('UPDATE orders SET order_image_url=NULL, order_image_thumb_url=NULL, order_image_uploaded_by=NULL, updated_at=? WHERE id=?').run(now(), id);
  audit({ role: req.user.role, userName: req.user.userName, action: 'delete_order_image', resourceType: 'order', resourceId: id });
  res.json({ ok: true, removed: true });
});

router.get('/:id/detail', allowRoles('super_admin','manager','ai_sales','worker','worker_print','worker_film','worker_bag','worker_ship'), (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: '订单ID无效' });
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '订单不存在' });

  let legacy = {};
  try { legacy = JSON.parse(row.legacy_json || '{}'); } catch {}

  let wo = db.prepare(`
    SELECT id, work_no, salesperson_name, customer_name, product_name, bag_type, spec, quantity, delivery_date, roller, remark, process_requirements_json, created_at
    FROM work_orders
    WHERE order_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(id);

  // 兜底：历史订单可能未写 order_id，按客户+规格回捞最近开单
  if (!wo) {
    wo = db.prepare(`
      SELECT id, work_no, salesperson_name, customer_name, product_name, bag_type, spec, quantity, delivery_date, roller, remark, process_requirements_json, created_at
      FROM work_orders
      WHERE customer_name = ? AND spec = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(String(row.customer_name || ''), String(row.order_spec || ''));
  }

  let woSummary = null;
  if (wo) {
    let p = {};
    try { p = JSON.parse(wo.process_requirements_json || '{}'); } catch {}
    const pf = inferPrintFilmFields(p);
    woSummary = {
      id: wo.id,
      workNo: wo.work_no,
      salespersonName: wo.salesperson_name || '',
      customerName: wo.customer_name || '',
      productName: wo.product_name || '',
      bagType: wo.bag_type || '',
      spec: wo.spec || '',
      quantity: wo.quantity || '',
      deliveryDate: wo.delivery_date || '',
      roller: wo.roller || '',
      remark: wo.remark || '',
      date: p.date || '',
      printQty: p.printQty || p.print_qty || '',
      printMold: pf.mold || '',
      printFilmSize: pf.size || '',
      printFilmQty: pf.qty || '',
      printFilmUnit: pf.unit || '',
      printShift: p.printShift || '',
      refColor: p.refColor || '',
      inkRequirement: p.inkRequirement || '',
      filmType: p.filmType || '',
      filmNote: p.filmNote || '',
      layer1: { material: p.layer1 || '', size: p.l1Size || '', weight: p.l1Weight || '' },
      layer2: { material: p.layer2 || '', size: p.l2Size || '', weight: p.l2Weight || '' },
      layer3: { material: p.layer3 || '', size: p.l3Size || '', weight: p.l3Weight || '' },
      layer4: { material: p.layer4 || '', size: p.l4Size || '', weight: p.l4Weight || '' },
      l1Size: p.l1Size || '', l1Weight: p.l1Weight || '',
      l2Size: p.l2Size || '', l2Weight: p.l2Weight || '',
      l3Size: p.l3Size || '', l3Weight: p.l3Weight || '',
      l4Size: p.l4Size || '', l4Weight: p.l4Weight || '',
      outsource: p.outsource || '',
      zipPos: p.zipPos || '',
      tearPos: p.tearPos || '',
      holePos: p.holePos || '',
      holes: p.holes || '',
      edges: p.edges || '',
      edgeCm: p.edgeCm || '',
      packType: p.packType || '',
      boxSpec: p.boxSpec || '',
      actualQty: p.actualQty || '',
      packerSign: p.packerSign || '',
      otherReq: p.otherReq || ''
    };
  }

  const isLegacyImported = !!(row.legacy_source_key || legacy?._openid);
  const suspiciousCustomer = maybeProductLikeCustomer(row.customer_name, row.use_case);
  const fixedCustomer = isLegacyImported
    ? ''
    : (suspiciousCustomer ? String(wo?.customer_name || '').trim() : row.customer_name);

  const recentStageLogs = db.prepare(`
    SELECT stage, source, qty, unit, created_at
    FROM order_stage_logs
    WHERE order_id = ?
      AND event_type='COMPLETE'
      AND COALESCE(rolled_back,0)=0
    ORDER BY id DESC
    LIMIT 2
  `).all(id);
  let recentChangeDiff = '';
  if (recentStageLogs.length >= 2) {
    const a = recentStageLogs[0], b = recentStageLogs[1];
    const qa = Number(a.qty || 0), qb = Number(b.qty || 0);
    const delta = Number.isFinite(qa) && Number.isFinite(qb) ? (qa - qb) : null;
    recentChangeDiff = `${a.stage} ${a.source} ${a.qty || '-'}${a.unit || ''}（上次 ${b.stage} ${b.source} ${b.qty || '-'}${b.unit || ''}${delta===null?'':`，差值 ${delta>=0?'+':''}${delta}` }）`;
  } else if (recentStageLogs.length === 1) {
    const a = recentStageLogs[0];
    recentChangeDiff = `${a.stage} ${a.source} ${a.qty || '-'}${a.unit || ''}`;
  }
  const operationLogsRaw = db.prepare(`
    SELECT id, stage, source, qty, unit, operated_by, event_type, rolled_back, rollback_of_log_id, rollback_reason, extra_json, created_at
    FROM order_stage_logs
    WHERE order_id = ?
    ORDER BY id DESC
    LIMIT 100
  `).all(id);
  const operation_logs = operationLogsRaw.map(x => {
    let extra = {};
    try { extra = JSON.parse(x.extra_json || '{}'); } catch {}
    return {
      id: Number(x.id || 0),
      stage: String(x.stage || ''),
      source: String(x.source || ''),
      qty: Number(x.qty || 0),
      unit: String(x.unit || ''),
      event_type: String(x.event_type || 'COMPLETE'),
      rolled_back: Number(x.rolled_back || 0),
      rollback_of_log_id: Number(x.rollback_of_log_id || 0),
      rollback_reason: String(x.rollback_reason || ''),
      operated_by: String(x.operated_by || ''),
      created_at: String(x.created_at || ''),
      extra
    };
  });

  res.json({
    ...row,
    is_legacy_imported: isLegacyImported,
    customer_name_display: fixedCustomer,
    image_can_delete: String(row.order_image_uploaded_by || '') === String(req.user?.userName || ''),
    size_json: JSON.parse(row.size_json || '{}'),
    legacy_json: legacy,
    work_order_summary: woSummary,
    source_work_no: woSummary?.workNo || '',
    recent_change_diff: recentChangeDiff,
    operation_logs
  });
});

router.patch('/:id/work-order-full', allowRoles('super_admin','manager'), (req, res) => {
  const id = validId(req.params.id);
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '订单不存在' });

  let wo = db.prepare('SELECT * FROM work_orders WHERE order_id=? ORDER BY id DESC LIMIT 1').get(id);
  if (!wo) {
    wo = db.prepare('SELECT * FROM work_orders WHERE customer_name=? AND spec=? ORDER BY id DESC LIMIT 1')
      .get(String(row.customer_name || ''), String(row.order_spec || ''));
  }
  if (!wo) return res.status(404).json({ error: '未找到对应开单记录，无法保存' });

  let p = {};
  try { p = JSON.parse(wo.process_requirements_json || '{}'); } catch (_) { p = {}; }
  const b = req.body || {};

  const nextP = {
    ...p,
    date: String(b.date ?? p.date ?? '').trim(),
    refColor: String(b.refColor ?? p.refColor ?? '').trim(),
    inkRequirement: String(b.inkRequirement ?? p.inkRequirement ?? '').trim(),
    printQty: String(b.printQty ?? p.printQty ?? p.print_qty ?? '').trim(),
    printMold: String(b.printMold ?? p.printMold ?? p.printFilm ?? '').trim(),
    printFilmSize: String(b.printFilmSize ?? p.printFilmSize ?? '').trim(),
    printFilmQty: String(b.printFilmQty ?? p.printFilmQty ?? '').trim(),
    printFilmUnit: String(b.printFilmUnit ?? p.printFilmUnit ?? '').trim(),
    printShift: String(b.printShift ?? p.printShift ?? '').trim(),
    filmType: String(b.filmType ?? p.filmType ?? '').trim(),
    filmNote: String(b.filmNote ?? p.filmNote ?? '').trim(),
    l1Size: String(b.l1Size ?? p.l1Size ?? '').trim(),
    layer1: String(b.layer1 ?? p.layer1 ?? '').trim(),
    l1Weight: String(b.l1Weight ?? p.l1Weight ?? '').trim(),
    l2Size: String(b.l2Size ?? p.l2Size ?? '').trim(),
    layer2: String(b.layer2 ?? p.layer2 ?? '').trim(),
    l2Weight: String(b.l2Weight ?? p.l2Weight ?? '').trim(),
    l3Size: String(b.l3Size ?? p.l3Size ?? '').trim(),
    layer3: String(b.layer3 ?? p.layer3 ?? '').trim(),
    l3Weight: String(b.l3Weight ?? p.l3Weight ?? '').trim(),
    l4Size: String(b.l4Size ?? p.l4Size ?? '').trim(),
    layer4: String(b.layer4 ?? p.layer4 ?? '').trim(),
    l4Weight: String(b.l4Weight ?? p.l4Weight ?? '').trim(),
    outsource: String(b.outsource ?? p.outsource ?? '').trim(),
    zipPos: String(b.zipPos ?? p.zipPos ?? '').trim(),
    tearPos: String(b.tearPos ?? p.tearPos ?? '').trim(),
    holePos: String(b.holePos ?? p.holePos ?? '').trim(),
    holes: String(b.holes ?? p.holes ?? '').trim(),
    edges: String(b.edges ?? p.edges ?? '').trim(),
    edgeCm: String(b.edgeCm ?? p.edgeCm ?? '').trim(),
    packType: String(b.packType ?? p.packType ?? '').trim(),
    boxSpec: String(b.boxSpec ?? p.boxSpec ?? '').trim(),
    actualQty: String(b.actualQty ?? p.actualQty ?? '').trim(),
    packerSign: String(b.packerSign ?? p.packerSign ?? '').trim(),
    otherReq: String(b.otherReq ?? p.otherReq ?? '').trim()
  };

  db.prepare(`
    UPDATE work_orders
    SET product_name=?, bag_type=?, spec=?, quantity=?, delivery_date=?, roller=?, remark=?, process_requirements_json=?, updated_at=?
    WHERE id=?
  `).run(
    String(b.productName ?? wo.product_name ?? '').trim(),
    String(b.bagType ?? wo.bag_type ?? '').trim(),
    String(b.spec ?? wo.spec ?? '').trim(),
    String(b.quantity ?? wo.quantity ?? '').trim(),
    String(b.deliveryDate ?? wo.delivery_date ?? '').trim(),
    String(b.roller ?? wo.roller ?? '').trim(),
    String(b.remark ?? wo.remark ?? '').trim(),
    JSON.stringify(nextP),
    now(),
    wo.id
  );

  audit({ role: req.user.role, userName: req.user.userName, action: 'edit_work_order_from_order_detail', resourceType: 'work_order', resourceId: wo.id, detail: `order=${id}` });
  res.json({ ok: true, workOrderId: wo.id });
});

router.delete('/:id', allowRoles('super_admin','manager'), (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: '订单ID无效' });
  const row = db.prepare('SELECT id FROM orders WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '订单不存在' });
  db.prepare('DELETE FROM orders WHERE id = ?').run(id);
  audit({ role: req.user.role, userName: req.user.userName, action: 'delete_order', resourceType: 'order', resourceId: id });
  res.json({ ok: true });
});

module.exports = router;

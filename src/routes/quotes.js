const express = require('express');
const { allowRoles } = require('../middleware/auth');
const { generateQuote } = require('../services/quoteEngine');
const { db, now, audit } = require('../db');

const router = express.Router();

router.get('/mine', allowRoles('super_admin','manager','ai_sales','worker'), (req, res) => {
  const rows = db.prepare('SELECT id, order_id, quote_type, customer_json, internal_json, created_by, created_at FROM quotes WHERE created_by = ? ORDER BY id DESC LIMIT 200').all(req.user.userName);
  res.json(rows.map(r => ({ ...r, customer_json: JSON.parse(r.customer_json || '{}'), internal_json: JSON.parse(r.internal_json || '{}') })));
});

function arrFromText(s) {
  return String(s || '').split(/[，,]/).map(x => Number(String(x).trim())).filter(n => Number.isFinite(n));
}

function buildInputByMaterialFactor(input = {}, factor = 1) {
  const cloned = JSON.parse(JSON.stringify(input || {}));
  if (Array.isArray(cloned.price)) {
    cloned.price = cloned.price.map(x => Number((Number(x || 0) * factor).toFixed(2)));
  }
  return cloned;
}

function parseChatToQuote(message = '') {
  const text = String(message);
  const pick = (re, d = 0) => {
    const m = text.match(re);
    return m ? Number(m[1]) : d;
  };
  const pickArr = (re) => {
    const m = text.match(re);
    return m ? arrFromText(m[1]) : [];
  };

  if (text.includes('八边封')) {
    return {
      quoteType: 'eight_side_seal',
      input: {
        ba_chang: pick(/包长\s*([\d.]+)/),
        ba_kuang: pick(/包宽\s*([\d.]+)/),
        ba_di: pick(/包底\s*([\d.]+)/),
        thick: pickArr(/厚度[:：\s]*([\d.,，\s]+)/),
        price: pickArr(/单价[:：\s]*([\d.,，\s]+)/),
        proportion: pickArr(/比重[:：\s]*([\d.,，\s]+)/),
        jgf: pick(/加工费\s*([\d.]+)/),
        zxyf: pick(/运费\s*([\d.]+)/),
        sh: pick(/损耗\s*([\d.]+)/),
        lr: pick(/利润\s*([\d.]+)/),
        ba_zdf: pick(/拉链费\s*([\d.]+)/)
      }
    };
  }

  if (text.includes('自动包')) {
    return {
      quoteType: 'auto_bag',
      input: {
        thick: pickArr(/厚度[:：\s]*([\d.,，\s]+)/),
        price: pickArr(/单价[:：\s]*([\d.,，\s]+)/),
        proportion: pickArr(/比重[:：\s]*([\d.,，\s]+)/),
        jgf: pick(/加工费\s*([\d.]+)/),
        fqfy: pick(/复膜费\s*([\d.]+)/),
        yf: pick(/运费\s*([\d.]+)/),
        zt: pick(/制袋费\s*([\d.]+)/),
        btzt: pick(/包装制袋费\s*([\d.]+)/),
        sh: pick(/损耗\s*([\d.]+)/),
        lr: pick(/利润\s*([\d.]+)/)
      }
    };
  }

  return {
    quoteType: 'material_weight',
    input: {
      chang: pick(/长\s*([\d.]+)/),
      kuang: pick(/宽\s*([\d.]+)/),
      thick: pickArr(/厚度[:：\s]*([\d.,，\s]+)/),
      proportion: pickArr(/比重[:：\s]*([\d.,，\s]+)/)
    }
  };
}

router.post('/chat', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  try {
    const { message = '', orderId = null } = req.body || {};
    const parsed = parseChatToQuote(message);
    const { internalVersion, customerVersion } = generateQuote({ quoteType: parsed.quoteType, input: parsed.input, margin: 0.1 });

    const result = db.prepare(`
      INSERT INTO quotes (order_id, quote_type, internal_json, customer_json, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(orderId, parsed.quoteType, JSON.stringify(internalVersion), JSON.stringify(customerVersion), req.user.userName, now());

    audit({ role: req.user.role, userName: req.user.userName, action: 'chat_quote', resourceType: 'quote', resourceId: result.lastInsertRowid, detail: parsed.quoteType });

    res.json({
      ok: true,
      quoteId: result.lastInsertRowid,
      assistantReply: `已按${parsed.quoteType}生成报价。客户版报价：${customerVersion.finalQuote ?? '见明细'} 元。`,
      parsed,
      internalVersion,
      customerVersion
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/generate', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  try {
    const { orderId = null, quoteType, input = {}, margin = 0.1 } = req.body || {};
    const { internalVersion, customerVersion } = generateQuote({ quoteType, input, margin: Number(margin) || 0.1 });

    const stmt = db.prepare(`
      INSERT INTO quotes (order_id, quote_type, internal_json, customer_json, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      orderId,
      quoteType,
      JSON.stringify(internalVersion),
      JSON.stringify(customerVersion),
      req.user.userName,
      now()
    );

    audit({
      role: req.user.role,
      userName: req.user.userName,
      action: 'generate_quote',
      resourceType: 'quote',
      resourceId: result.lastInsertRowid,
      detail: quoteType
    });

    res.json({
      ok: true,
      quoteId: result.lastInsertRowid,
      internalVersion,
      customerVersion,
      export: {
        excel: `TODO:/exports/quote_${result.lastInsertRowid}.xlsx`,
        word: `TODO:/exports/quote_${result.lastInsertRowid}.docx`,
        pdf: `TODO:/exports/quote_${result.lastInsertRowid}.pdf`
      }
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/generate-multi', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  try {
    const { quoteType, input = {}, baseQuantity = 10000, quantities = [10000, 20000, 30000], materialFactors = [1, 1.05, 1.1] } = req.body || {};
    if (!quoteType) return res.status(400).json({ error: 'quoteType 必填' });

    const baseQ = Number(baseQuantity) || 10000;
    const qList = (Array.isArray(quantities) ? quantities : [quantities]).map(Number).filter(n => Number.isFinite(n) && n > 0);
    const fList = (Array.isArray(materialFactors) ? materialFactors : [materialFactors]).map(Number).filter(n => Number.isFinite(n) && n > 0);
    if (!qList.length || !fList.length) return res.status(400).json({ error: 'quantities/materialFactors 至少提供一个有效值' });

    const base = generateQuote({ quoteType, input, margin: 0.1 }).internalVersion.calc || {};
    const baseFinal = Number(base.finalQuote || 0);
    const baseUnit = baseQ > 0 ? (baseFinal / baseQ) : 0;

    const plans = [];
    let idx = 1;
    for (const q of qList) {
      for (const factor of fList) {
        const planInput = buildInputByMaterialFactor(input, factor);
        const { internalVersion, customerVersion } = generateQuote({ quoteType, input: planInput, margin: 0.1 });
        const finalQuote = Number(internalVersion?.calc?.finalQuote || 0);
        const unitPrice = baseUnit > 0 ? Number((finalQuote / baseQ).toFixed(6)) : 0;
        const amount = Number((unitPrice * q).toFixed(2));
        plans.push({
          planNo: idx++,
          quoteType,
          quantity: q,
          materialFactor: factor,
          finalQuote,
          estimatedUnitPrice: unitPrice,
          estimatedAmount: amount,
          customerVersion,
          internalCalc: internalVersion.calc
        });
      }
    }

    plans.sort((a, b) => a.estimatedAmount - b.estimatedAmount);

    audit({
      role: req.user.role,
      userName: req.user.userName,
      action: 'generate_multi_quote',
      resourceType: 'quote',
      resourceId: '',
      detail: `${quoteType} | plans=${plans.length}`
    });

    res.json({ ok: true, quoteType, baseQuantity: baseQ, plans });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/:id/detail', allowRoles('super_admin','manager','ai_sales','worker'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '报价不存在' });

  const owner = row.created_by === req.user.userName;
  if (!owner && !['super_admin','manager'].includes(req.user.role)) {
    return res.status(403).json({ error: '只能查看自己的报价详情' });
  }

  res.json({
    id: row.id,
    orderId: row.order_id,
    quoteType: row.quote_type,
    customer: JSON.parse(row.customer_json),
    internal: JSON.parse(row.internal_json),
    createdBy: row.created_by,
    createdAt: row.created_at
  });
});

router.get('/:id', allowRoles('super_admin','manager','ai_sales','worker'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '报价不存在' });

  const owner = row.created_by === req.user.userName;
  if (!owner && !['super_admin','manager'].includes(req.user.role)) {
    return res.status(403).json({ error: '只能查看自己的报价' });
  }

  const canViewInternal = ['super_admin','manager'].includes(req.user.role);
  res.json({
    id: row.id,
    orderId: row.order_id,
    quoteType: row.quote_type,
    internal: canViewInternal ? JSON.parse(row.internal_json) : '无权限',
    customer: JSON.parse(row.customer_json),
    createdBy: row.created_by,
    createdAt: row.created_at
  });
});

module.exports = router;

const express = require('express');
const PDFDocument = require('pdfkit');
const { db } = require('../db');
const { allowRoles } = require('../middleware/auth');
const { generateQuote } = require('../services/quoteEngine');

const router = express.Router();

function safe(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function htmlEscape(v) {
  return safe(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nz(v, fixed = null) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '-';
  return fixed === null ? String(n) : n.toFixed(fixed);
}

function csvSafe(v) {
  const s = safe(v);
  if (/^[=+\-@\t\r]/.test(s)) return `'${s}`;
  return s;
}

function loadSheet(req, res) {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM quote_sheets WHERE id = ?').get(id);
  if (!row) {
    res.status(404).json({ error: '报价单不存在' });
    return null;
  }
  if (!['super_admin', 'manager'].includes(req.user.role) && row.created_by !== req.user.userName) {
    res.status(403).json({ error: '只能导出自己的报价单' });
    return null;
  }

  const canInternal = ['super_admin', 'manager'].includes(req.user.role);
  const requestedView = req.query.view === 'internal' ? 'internal' : (req.query.view === 'customer' ? 'customer' : null);
  const view = requestedView || (canInternal ? 'internal' : 'customer');
  if (view === 'internal' && !canInternal) {
    res.status(403).json({ error: '无权限导出内部版报价单' });
    return null;
  }

  let input = {};
  let calc = {};
  try { input = JSON.parse(row.input_json || '{}'); } catch {}
  try { calc = JSON.parse(row.calc_json || '{}'); } catch {}
  if ((!calc || Object.keys(calc).length === 0) && row.bag_type && input && Object.keys(input).length) {
    try { calc = generateQuote({ quoteType: row.bag_type, input }).internalVersion.calc || {}; } catch {}
  }

  if (view === 'customer') {
    // 客户版：不包含成本结构与内部参数
    input = {};
    calc = {
      finalQuote: Number(row.amount || 0),
      unitPrice: Number(row.unit_price || 0),
      quantity: Number(row.quantity || 0)
    };
  }

  return { row, input, calc, view };
}

function layerRows(input = {}, calc = {}) {
  const thick = input.thick || [0, 0, 0, 0];
  const prop = input.proportion || [0, 0, 0, 0];
  const price = input.price || [0, 0, 0, 0];
  const names = input.materialNames || input.materials || ['', '', '', ''];
  const w = calc.layerWeightTon || calc.layerWeightKg || [0, 0, 0, 0];
  const c = calc.layerCost || [0, 0, 0, 0];
  return [0, 1, 2, 3].map(i => ({
    layer: `L${i + 1}`,
    material: names[i] || '-',
    thick: Number(thick[i] || 0),
    prop: Number(prop[i] || 0),
    price: Number(price[i] || 0),
    weight: Number(w[i] || 0),
    cost: Number(c[i] || 0)
  }));
}

router.get('/quote-sheet/:id.csv', allowRoles('super_admin', 'manager', 'ai_sales', 'worker'), (req, res) => {
  const data = loadSheet(req, res); if (!data) return;
  const { row, input, calc, view } = data;
  const layers = layerRows(input, calc);

  const lines = [];
  lines.push('字段,值');
  lines.push(`报价单ID,${row.id}`);
  lines.push(`版本,${view === 'internal' ? '内部版' : '客户版'}`);
  lines.push(`客户,${csvSafe(row.customer_name)}`);
  lines.push(`产品,${csvSafe(row.product_name)}`);
  lines.push(`袋型,${csvSafe(row.bag_type || '')}`);
  lines.push(`数量,${row.quantity}`);
  lines.push(`单价,${row.unit_price}`);
  lines.push(`金额,${row.amount}`);

  if (view === 'internal') {
    lines.push(`成本,${row.cost}`);
    lines.push(`利润率,${row.profit_rate}`);
    lines.push('');
    lines.push('【手动输入参数】,');
    Object.entries(input || {}).forEach(([k, v]) => lines.push(`${csvSafe(k)},"${csvSafe(Array.isArray(v) ? v.join(',') : v)}"`));
    lines.push('');
    lines.push('【分层明细】,');
    lines.push('层数,材料名称(手填),厚度C(手填),比重(手填),单价(手填),材料重量(自动),材料成本(自动)');
    layers.forEach(x => lines.push(`${csvSafe(x.layer)},${csvSafe(x.material)},${x.thick},${x.prop},${x.price},${x.weight},${x.cost}`));
    lines.push('');
    lines.push('【自动计算结果】,');
    Object.entries(calc || {}).forEach(([k, v]) => lines.push(`${csvSafe(k)},"${csvSafe(Array.isArray(v) ? v.join(',') : v)}"`));
  } else {
    lines.push('');
    lines.push('备注,客户版不展示内部成本结构');
  }

  const csv = lines.join('\n') + '\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="quote_sheet_${row.id}_${view}.csv"`);
  res.send('\uFEFF' + csv);
});

router.get('/quote-sheet/:id.xls', allowRoles('super_admin', 'manager', 'ai_sales', 'worker'), (req, res) => {
  const data = loadSheet(req, res); if (!data) return;
  const { row, input, calc, view } = data;
  const layers = layerRows(input, calc);

  if (view === 'customer') {
    const html = `
    <html><meta charset="utf-8"><body>
    <style>table{border-collapse:collapse;width:100%;font-family:'Microsoft YaHei',Arial}td,th{border:0.5px solid #d5dbe3;padding:8px;text-align:center}.title{background:#dbeafe;font-size:20px;font-weight:bold}</style>
    <table>
      <tr><th class="title" colspan="4">客户版报价单 #${row.id}</th></tr>
      <tr><td>客户</td><td>${htmlEscape(row.customer_name)}</td><td>产品</td><td>${htmlEscape(row.product_name)}</td></tr>
      <tr><td>袋型</td><td>${htmlEscape(row.bag_type || '-')}</td><td>日期</td><td>${htmlEscape(String(row.created_at || '').slice(0,10))}</td></tr>
      <tr><td>数量</td><td>${htmlEscape(row.quantity)}</td><td>单价</td><td>${htmlEscape(row.unit_price)}</td></tr>
      <tr><td>报价总额</td><td colspan="3"><b>${htmlEscape(row.amount)}</b></td></tr>
      <tr><td>备注</td><td colspan="3">客户版不展示内部成本结构</td></tr>
    </table></body></html>`;
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="quote_sheet_${row.id}_customer.xls"`);
    return res.send(html);
  }

  const html = `
  <html><meta charset="utf-8"><body>
  <style>
    table{border-collapse:collapse;width:100%;font-family:'Microsoft YaHei',Arial}
    td,th{border:0.5px solid #d5dbe3;padding:6px;text-align:center}
    .title{background:#7ec8f7;font-size:20px;font-weight:bold}
    .sec{background:#e8f3ff;font-weight:bold}
    .in{background:#f7fbff}
    .auto{background:#eef8ff}
    .left{text-align:left}
  </style>
  <table>
    <tr><th class="title" colspan="7">${htmlEscape(row.bag_type || '包装袋')} 报价/成本核算表（报价单 #${row.id}）</th></tr>
    <tr><th class="sec" colspan="7">一、基础信息</th></tr>
    <tr>
      <td class="in">客户(手填)</td><td>${htmlEscape(row.customer_name)}</td>
      <td class="in">产品(手填)</td><td>${htmlEscape(row.product_name)}</td>
      <td class="in">袋型(手填)</td><td>${htmlEscape(row.bag_type || '-')}</td>
      <td class="in">日期</td>
    </tr>
    <tr>
      <td class="in">数量(手填)</td><td>${htmlEscape(row.quantity)}</td>
      <td class="auto">单价(自动/或手改)</td><td>${htmlEscape(row.unit_price)}</td>
      <td class="auto">金额(自动)</td><td>${htmlEscape(row.amount)}</td>
      <td>${htmlEscape(String(row.created_at || '').slice(0, 10))}</td>
    </tr>

    <tr><th class="sec" colspan="7">二、分层明细（手填 vs 自动）</th></tr>
    <tr>
      <th>层数</th><th class="in">材料名称(手填)</th><th class="in">厚度C(手填)</th><th class="in">比重(手填)</th><th class="in">单价(手填)</th><th class="auto">材料重量(自动)</th><th class="auto">材料成本(自动)</th>
    </tr>
    ${layers.map(x => `<tr><td>${x.layer}</td><td>${htmlEscape(x.material)}</td><td>${nz(x.thick)}</td><td>${nz(x.prop)}</td><td>${nz(x.price)}</td><td>${nz(x.weight)}</td><td>${nz(x.cost)}</td></tr>`).join('')}

    <tr><th class="sec" colspan="7">三、关键参数</th></tr>
    <tr><td class="in">展开长度(自动)</td><td>${nz(calc.z_chang)}</td><td class="in">展开宽度(自动)</td><td>${nz(calc.z_kuang)}</td><td class="in">产品面积(自动)</td><td colspan="2">${nz(calc.z_mian)}</td></tr>
    <tr><td class="in">总厚度(自动)</td><td>${nz(calc.totalThickness)}</td><td class="in">总吨位/总重量(自动)</td><td>${nz(calc.all_dun ?? calc.totalWeightKg)}</td><td class="in">单位成本(自动)</td><td colspan="2">${nz(calc.unitCost)}</td></tr>
    <tr><td class="auto">总成本(自动)</td><td>${nz(calc.totalCost ?? calc.costBeforeProfit)}</td><td class="auto">最终报价(自动)</td><td>${nz(calc.finalQuote)}</td><td class="in">利润率(手填)</td><td colspan="2">${nz(row.profit_rate)}</td></tr>

    <tr><th class="sec" colspan="7">四、手填参数原文（复核）</th></tr>
    <tr><td class="left" colspan="7">${Object.entries(input||{}).map(([k,v])=>`${htmlEscape(k)}: ${htmlEscape(Array.isArray(v)?v.join(','):v)}`).join(' ｜ ')}</td></tr>
  </table>
  </body></html>`;

  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="quote_sheet_${row.id}.xls"`);
  res.send(html);
});

router.get('/quote-sheet/:id.doc', allowRoles('super_admin', 'manager', 'ai_sales', 'worker'), (req, res) => {
  const data = loadSheet(req, res); if (!data) return;
  const { row, calc, view } = data;
  const layers = layerRows(data.input, calc);

  if (view === 'customer') {
    const html = `
    <html><meta charset="utf-8"><body>
    <style>table{border-collapse:collapse;width:100%;font-family:'Microsoft YaHei',Arial}td,th{border:0.5px solid #d5dbe3;padding:8px;text-align:center}.title{background:#dbeafe;font-size:20px;font-weight:bold}</style>
    <table>
      <tr><th class="title" colspan="4">客户版报价单 #${row.id}</th></tr>
      <tr><td>客户</td><td>${htmlEscape(row.customer_name)}</td><td>产品</td><td>${htmlEscape(row.product_name)}</td></tr>
      <tr><td>袋型</td><td>${htmlEscape(row.bag_type || '-')}</td><td>日期</td><td>${htmlEscape(String(row.created_at || '').slice(0,10))}</td></tr>
      <tr><td>数量</td><td>${htmlEscape(row.quantity)}</td><td>单价</td><td>${htmlEscape(row.unit_price)}</td></tr>
      <tr><td>报价总额</td><td colspan="3"><b>${htmlEscape(row.amount)}</b></td></tr>
      <tr><td>备注</td><td colspan="3">客户版不展示内部成本结构</td></tr>
    </table></body></html>`;
    res.setHeader('Content-Type', 'application/msword; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="quote_sheet_${row.id}_customer.doc"`);
    return res.send(html);
  }

  const html = `
  <html><meta charset="utf-8"><body>
  <style>
    table{border-collapse:collapse;width:100%;font-family:'Microsoft YaHei',Arial}
    td,th{border:0.5px solid #d5dbe3;padding:6px;text-align:center}
    .title{background:#bfe6ff;font-size:19px;font-weight:bold}
    .sec{background:#eaf5ff;font-weight:bold}
    .in{background:#f7fbff}
    .auto{background:#eef6ff}
  </style>
  <table>
    <tr><th class="title" colspan="7">${htmlEscape(row.bag_type || '包装袋')} 报价单 #${row.id}</th></tr>
    <tr><th class="sec" colspan="7">基础信息</th></tr>
    <tr><td class="in">客户</td><td>${htmlEscape(row.customer_name)}</td><td class="in">产品</td><td>${htmlEscape(row.product_name)}</td><td class="in">袋型</td><td>${htmlEscape(row.bag_type || '-')}</td><td>${htmlEscape(String(row.created_at || '').slice(0, 10))}</td></tr>
    <tr><td class="in">数量</td><td>${htmlEscape(row.quantity)}</td><td class="auto">单价</td><td>${htmlEscape(row.unit_price)}</td><td class="auto">金额</td><td colspan="2">${htmlEscape(row.amount)}</td></tr>
    <tr><th class="sec" colspan="7">分层材料明细</th></tr>
    <tr><th>层数</th><th class="in">材料名称</th><th class="in">厚度C</th><th class="in">比重</th><th class="in">单价</th><th class="auto">材料重量</th><th class="auto">材料成本</th></tr>
    ${layers.map(x => `<tr><td>${x.layer}</td><td>${htmlEscape(x.material)}</td><td>${nz(x.thick)}</td><td>${nz(x.prop)}</td><td>${nz(x.price)}</td><td>${nz(x.weight)}</td><td>${nz(x.cost)}</td></tr>`).join('')}
    <tr><th class="sec" colspan="7">关键结果</th></tr>
    <tr><td class="auto">展开长度</td><td>${nz(calc.z_chang)}</td><td class="auto">展开宽度</td><td>${nz(calc.z_kuang)}</td><td class="auto">产品面积</td><td colspan="2">${nz(calc.z_mian)}</td></tr>
    <tr><td class="auto">总厚度</td><td>${nz(calc.totalThickness)}</td><td class="auto">总吨位/总重量</td><td>${nz(calc.all_dun ?? calc.totalWeightKg)}</td><td class="auto">单位成本</td><td colspan="2">${nz(calc.unitCost)}</td></tr>
    <tr><td class="auto">总成本</td><td>${nz(calc.totalCost ?? calc.costBeforeProfit)}</td><td class="auto">最终报价</td><td>${nz(calc.finalQuote)}</td><td class="in">利润率</td><td colspan="2">${nz(row.profit_rate)}</td></tr>
  </table>
  </body></html>`;

  res.setHeader('Content-Type', 'application/msword; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="quote_sheet_${row.id}.doc"`);
  res.send(html);
});

router.get('/quote-sheet/:id.pdf', allowRoles('super_admin', 'manager', 'ai_sales', 'worker'), (req, res) => {
  const data = loadSheet(req, res); if (!data) return;
  const { row, input, calc, view } = data;
  const layers = layerRows(input, calc);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="quote_sheet_${row.id}_${view}.pdf"`);

  const doc = new PDFDocument({ size: 'A4', margin: 28 });
  doc.pipe(res);
  doc.font('Helvetica'); // Avoid Chinese glyph corruption when CJK font is unavailable.

  if (view === 'customer') {
    const left = 28;
    const width = doc.page.width - 56;
    let y = 34;
    doc.rect(left, y, width, 54).stroke();
    doc.fontSize(18).text('报价单 / QUOTATION SHEET', left, y + 16, { width, align: 'center' });
    y += 70;
    doc.rect(left, y, width, 140).stroke();
    doc.fontSize(11)
      .text(`报价编号 Quote No: ${safe(row.id)}`, left + 10, y + 12)
      .text(`日期 Date: ${safe(String(row.created_at).slice(0, 10))}`, left + width / 2, y + 12)
      .text(`客户 Customer: ${safe(row.customer_name)}`, left + 10, y + 40)
      .text(`产品 Product: ${safe(row.product_name)}`, left + width / 2, y + 40)
      .text(`袋型 Bag Type: ${safe(row.bag_type || '-')}`, left + 10, y + 68)
      .text(`数量 Qty: ${safe(row.quantity || '-')}`, left + width / 2, y + 68)
      .text(`单价 Unit Price: ${nz(row.unit_price)}`, left + 10, y + 96)
      .text(`金额 Amount: ${nz(row.amount)}`, left + width / 2, y + 96);
    doc.fontSize(10).text('客户版不展示内部成本结构 / Internal cost hidden in customer view.', left + 10, y + 122);
    doc.end();
    return;
  }

  const left = 28;
  const right = doc.page.width - 28;
  const width = right - left;
  let y = 30;

  doc.lineWidth(1).rect(left, y, width, 52).stroke();
  doc.fontSize(18).text('HUASHENG PRINTING CO., LTD', left, y + 10, { width, align: 'center' });
  doc.fontSize(11).text('报价单 / QUOTATION SHEET', left, y + 32, { width, align: 'center' });
  y += 62;

  doc.rect(left, y, width, 82).stroke();
  doc.fontSize(10)
    .text(`报价编号 Quote No: ${safe(row.id)}`, left + 8, y + 8)
    .text(`日期 Date: ${safe(String(row.created_at).slice(0, 10))}`, left + width / 2, y + 8)
    .text(`客户 Customer: ${safe(row.customer_name)}`, left + 8, y + 28)
    .text(`产品 Product: ${safe(row.product_name)}`, left + width / 2, y + 28)
    .text(`袋型 Bag Type: ${safe(row.bag_type || '-')}`, left + 8, y + 48)
    .text(`数量 Qty: ${safe(row.quantity || '-')}`, left + width / 2, y + 48)
    .text(`单价 Unit Price: ${nz(row.unit_price)}`, left + 8, y + 66)
    .text(`金额 Amount: ${nz(row.amount)}`, left + width / 2, y + 66);
  y += 94;

  const cols = [48, 84, 62, 62, 66, 84, 84];
  const headers = ['Layer', 'Material*', 'Thick*', 'Density*', 'Price*', 'Weight(A)', 'Cost(A)'];
  const rowH = 20;
  const tableW = cols.reduce((a, b) => a + b, 0);

  let x = left;
  doc.rect(left, y, tableW, rowH).stroke();
  headers.forEach((h, i) => {
    if (i > 0) doc.moveTo(x, y).lineTo(x, y + rowH).stroke();
    doc.fontSize(8).text(h, x + 3, y + 6, { width: cols[i] - 6, align: 'center' });
    x += cols[i];
  });
  y += rowH;

  layers.forEach((r) => {
    x = left;
    doc.rect(left, y, tableW, rowH).stroke();
    const vals = [r.layer, r.material, nz(r.thick), nz(r.prop), nz(r.price), nz(r.weight), nz(r.cost)];
    vals.forEach((v, i) => {
      if (i > 0) doc.moveTo(x, y).lineTo(x, y + rowH).stroke();
      doc.fontSize(8).text(safe(v), x + 3, y + 6, { width: cols[i] - 6, align: 'center' });
      x += cols[i];
    });
    y += rowH;
  });

  y += 10;
  doc.rect(left, y, width, 92).stroke();
  doc.fontSize(10).text('关键计算结果 / Key Calculated Results', left + 8, y + 8);
  doc.fontSize(9)
    .text(`z_chang: ${nz(calc.z_chang)}`, left + 8, y + 28)
    .text(`z_kuang: ${nz(calc.z_kuang)}`, left + 170, y + 28)
    .text(`z_mian: ${nz(calc.z_mian)}`, left + 320, y + 28)
    .text(`totalThickness: ${nz(calc.totalThickness)}`, left + 8, y + 46)
    .text(`totalWeight: ${nz(calc.all_dun ?? calc.totalWeightKg)}`, left + 170, y + 46)
    .text(`unitCost: ${nz(calc.unitCost)}`, left + 320, y + 46)
    .text(`totalCost: ${nz(calc.totalCost ?? calc.costBeforeProfit)}`, left + 8, y + 64)
    .text(`finalQuote: ${nz(calc.finalQuote)}`, left + 170, y + 64)
    .text('* = manual input, (A) = auto generated', left + 8, y + 80);

  y += 104;
  doc.rect(left, y, width, 96).stroke();
  doc.fontSize(10).text('Bag Sketch (simple)', left + 8, y + 8);
  const bx = left + 16, by = y + 28, bw = 120, bh = 54;
  doc.roundedRect(bx, by, bw, bh, 4).stroke();
  doc.moveTo(bx + 12, by + bh).lineTo(bx + bw - 12, by + bh).stroke();
  doc.fontSize(9)
    .text(`Length: ${nz(input.ba_chang)}`, bx + bw + 20, by + 4)
    .text(`Width: ${nz(input.ba_kuang)}`, bx + bw + 20, by + 20)
    .text(`Bottom: ${nz(input.ba_di)}`, bx + bw + 20, by + 36);

  doc.end();
});

module.exports = router;

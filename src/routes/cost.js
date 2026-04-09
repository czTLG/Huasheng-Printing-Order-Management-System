const express = require('express');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { allowRoles } = require('../middleware/auth');
const { db, now, audit } = require('../db');
const {
  calcAutoBag,
  calcEightSideSeal,
  calcStandZipperBag,
  calcIrregularZipperBag,
  calcBackSealBag,
  calcMaterialWeight
} = require('../services/quoteEngine');

const router = express.Router();

const COST_USERS = new Set(['chenyongjie','gavin','chenrunyang']);
router.use((req, res, next) => {
  const u = String(req.user?.userName || '').trim();
  if (COST_USERS.has(u)) return next();
  return res.status(403).json({ error: '成本核算仅指定用户可访问' });
});

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function p4(arr) {
  const a = (arr || []).map(n);
  while (a.length < 4) a.push(0);
  return a;
}

function traceSeal(input = {}, result = {}, opts = {}) {
  const multiArea = !!opts.multiArea;
  const freightFactor = Number(opts.freightFactor || 1);
  const lenOffset = Number(opts.lenOffset ?? 3.5);
  const widthOffset = Number(opts.widthOffset ?? 0.5);
  const zipperExtraCm = Number(opts.zipperExtraCm ?? 0);

  const ba_chang = n(input.ba_chang);
  const ba_kuang = n(input.ba_kuang);
  const ba_di = n(input.ba_di);
  const ba_ce = n(input.ba_ce || input.side || 0);
  const thick = p4(input.thick);
  const price = p4(input.price);
  const proportion = p4(input.proportion);
  const jgf = n(input.jgf);
  const zxyf = n(input.zxyf);
  const sh = n(input.sh);
  const lr = n(input.lr);
  const lldj = n(input.lldj);

  const z_chang = ba_chang * 2 + lenOffset + ba_di;
  const z_kuang = ba_kuang + ba_ce + widthOffset;
  const z_mian = z_chang * z_kuang;
  const z_mian_2 = n(input.z_mian_2) || z_mian;
  const z_mian_3 = n(input.z_mian_3) || z_mian;
  const z_mian_4 = n(input.z_mian_4) || z_mian;
  const areas = multiArea ? [z_mian, z_mian_2, z_mian_3, z_mian_4] : [z_mian, z_mian, z_mian, z_mian];

  const proth = thick.map((t, i) => t * proportion[i]);
  const dun = proth.map((x, i) => (x * areas[i]) / 1000000);
  const layerCost = dun.map((d, i) => d * price[i]);

  const all_dun = dun.reduce((a, b) => a + b, 0);
  const ba_all_clcb = layerCost.reduce((a, b) => a + b, 0);
  const alljgf = (jgf * z_mian) / 10000;
  const defaultZdf = ((z_kuang + zipperExtraCm) * lldj) / 100;
  const ba_zdf = n(input.ba_zdf) || defaultZdf;
  const rescb = (ba_all_clcb + alljgf) * (1 + sh) + ba_zdf;
  const ba_danyun = ((zxyf * all_dun) / 1000) * freightFactor;
  const zhbj = ba_danyun + rescb * (1 + lr);

  return {
    formulaProfile: multiArea ? 'stand_zipper_bag' : (freightFactor === 1 ? 'eight_or_irregular' : 'seal_bag_custom'),
    steps: [
      { key: 'z_chang', formula: `ba_chang * 2 + ${lenOffset} + ba_di`, value: z_chang },
      { key: 'ba_ce', formula: 'side panel width', value: ba_ce },
      { key: 'z_kuang', formula: `ba_kuang + ba_ce + ${widthOffset}`, value: z_kuang },
      { key: 'z_mian', formula: 'z_chang * z_kuang', value: z_mian },
      { key: 'areas', formula: multiArea ? '[z_mian,z_mian_2,z_mian_3,z_mian_4]' : 'all use z_mian', value: areas },
      { key: 'proth', formula: 'thick[i] * proportion[i]', value: proth },
      { key: 'dun', formula: '(proth[i] * area[i]) / 1000000', value: dun },
      { key: 'layerCost', formula: 'dun[i] * price[i]', value: layerCost },
      { key: 'all_dun', formula: 'sum(dun)', value: all_dun },
      { key: 'materialCost', formula: 'sum(layerCost)', value: ba_all_clcb },
      { key: 'alljgf', formula: '(jgf * z_mian) / 10000', value: alljgf },
      { key: 'zipperCost', formula: `ba_zdf || ((z_kuang + ${zipperExtraCm}) * lldj / 100)`, value: ba_zdf },
      { key: 'rescb', formula: '(materialCost + alljgf) * (1 + sh) + zipperCost', value: rescb },
      { key: 'freight', formula: '((zxyf * all_dun) / 1000) * freightFactor', value: ba_danyun },
      { key: 'finalQuote', formula: 'freight + rescb * (1 + lr)', value: zhbj }
    ],
    compareWithResult: {
      result_all_dun: result.all_dun,
      result_totalCost: result.totalCost,
      result_finalQuote: result.finalQuote,
      expected_all_dun: all_dun,
      expected_totalCost: rescb,
      expected_finalQuote: zhbj
    }
  };
}

function traceEight(input = {}, result = {}) {
  const ba_chang = n(input.ba_chang);
  const ba_kuang = n(input.ba_kuang);
  const ba_di = n(input.ba_di);
  const thick = p4(input.thick);
  const price = p4(input.price);
  const proportion = p4(input.proportion);
  const proth = thick.map((t, i) => t * proportion[i]);

  const front_len = ba_chang * 2 + 4 + ba_di;
  const front_wid = ba_kuang + 0.6;
  const front_area = front_len * front_wid;
  const side_len = ba_chang;
  const side_wid = ba_di * 2 + 1.2;
  const side_area = side_len * side_wid;

  const front_dun = proth.map(x => (x * front_area) / 1000000);
  const side_dun = proth.map(x => (x * side_area) / 1000000);
  const dun = front_dun.map((x, i) => x + side_dun[i]);
  const layerCost = dun.map((d, i) => d * price[i]);

  const jgf = n(input.jgf);
  const zxyf = n(input.zxyf);
  const sh = n(input.sh);
  const lr = n(input.lr);
  const lldj = n(input.lldj);

  const materialCost = layerCost.reduce((a, b) => a + b, 0);
  const processCost = (jgf * (front_area + side_area)) / 10000;
  const zipperCost = n(input.ba_zdf) || ((front_wid * lldj) / 100);
  const all_dun = dun.reduce((a, b) => a + b, 0);
  const freightCost = ((zxyf * all_dun) / 1000);
  const totalCost = (materialCost + processCost) * (1 + sh) + zipperCost + freightCost;
  const finalQuote = totalCost * (1 + lr);

  return {
    formulaProfile: 'eight_side_excel_like',
    steps: [
      { key: 'front_len', formula: 'ba_chang*2 + 4 + ba_di', value: front_len },
      { key: 'front_wid', formula: 'ba_kuang + 0.6', value: front_wid },
      { key: 'front_area', formula: 'front_len * front_wid', value: front_area },
      { key: 'side_len', formula: 'ba_chang', value: side_len },
      { key: 'side_wid', formula: 'ba_di*2 + 1.2', value: side_wid },
      { key: 'side_area', formula: 'side_len * side_wid', value: side_area },
      { key: 'dun', formula: '((proth*front_area)+(proth*side_area))/1000000', value: dun },
      { key: 'layerCost', formula: 'dun[i] * price[i]', value: layerCost },
      { key: 'materialCost', formula: 'sum(layerCost)', value: materialCost },
      { key: 'processCost', formula: 'jgf*(front_area+side_area)/10000', value: processCost },
      { key: 'zipperCost', formula: 'ba_zdf || (front_wid*lldj/100)', value: zipperCost },
      { key: 'freightCost', formula: 'zxyf*all_dun/1000', value: freightCost },
      { key: 'finalQuote', formula: '((material+process)*(1+sh)+zipper+freight)*(1+lr)', value: finalQuote }
    ],
    compareWithResult: {
      result_finalQuote: result.finalQuote,
      expected_finalQuote: finalQuote
    }
  };
}

function traceStand(input = {}, result = {}) {
  const ba_chang = n(input.ba_chang);
  const ba_kuang = n(input.ba_kuang);
  const ba_di = n(input.ba_di);
  const thick = p4(input.thick);
  const price = p4(input.price);
  const proportion = p4(input.proportion);

  const z_chang = ba_chang * 2 + 1.5 + ba_di;
  const z_kuang = ba_kuang;
  const layerLengths = [z_chang, z_chang + 0.5, z_chang + 1.0, z_chang + 1.5];
  const layerAreas = layerLengths.map(L => L * z_kuang);
  const z_mian = layerAreas[0];

  const proth = thick.map((t, i) => t * proportion[i]);
  const dun = proth.map((x, i) => (x * layerAreas[i]) / 1000000);
  const layerCost = dun.map((d, i) => d * price[i]);

  const all_dun = dun.reduce((a, b) => a + b, 0);
  const materialCost = layerCost.reduce((a, b) => a + b, 0);
  const jgf = n(input.jgf), zxyf = n(input.zxyf), sh = n(input.sh), lr = n(input.lr), lldj = n(input.lldj);
  const processCost = (jgf * z_mian) / 10000;
  const zipperCost = n(input.ba_zdf) || ((z_kuang * lldj) / 100);
  const freightCost = ((zxyf * all_dun) / 1000);
  const totalCost = (materialCost + processCost) * (1 + sh) + zipperCost + freightCost;
  const finalQuote = totalCost * (1 + lr);

  return {
    formulaProfile: 'stand_zipper_front_only',
    steps: [
      { key: 'z_chang', formula: 'ba_chang*2 + 1.5 + ba_di', value: z_chang },
      { key: 'layerLengths', formula: '[z_chang, z_chang+0.5, z_chang+1.0, z_chang+1.5]', value: layerLengths },
      { key: 'layerAreas', formula: 'layerLengths[i] * z_kuang', value: layerAreas },
      { key: 'dun', formula: '(proth[i] * layerAreas[i])/1000000', value: dun },
      { key: 'layerCost', formula: 'dun[i] * price[i]', value: layerCost },
      { key: 'materialCost', formula: 'sum(layerCost)', value: materialCost },
      { key: 'processCost', formula: '(jgf*z_mian)/10000', value: processCost },
      { key: 'zipperCost', formula: 'ba_zdf || (z_kuang*lldj/100)', value: zipperCost },
      { key: 'freightCost', formula: 'zxyf*all_dun/1000', value: freightCost },
      { key: 'finalQuote', formula: '((material+process)*(1+sh)+zipper+freight)*(1+lr)', value: finalQuote }
    ],
    compareWithResult: {
      result_finalQuote: result.finalQuote,
      expected_finalQuote: finalQuote
    }
  };
}

function traceIrregular(input = {}, result = {}) {
  const ba_chang = n(input.ba_chang);
  const ba_kuang = n(input.ba_kuang);
  const ba_di = n(input.ba_di);
  const irregularHasBottom = n(input.irregular_has_bottom) === 1;
  const thick = p4(input.thick);
  const price = p4(input.price);
  const proportion = p4(input.proportion);
  const proth = thick.map((t, i) => t * proportion[i]);

  const z_chang_base = ba_chang * 2 + 3;
  const z_chang = z_chang_base + (irregularHasBottom ? (ba_di + 1.5) : 0);
  const z_kuang = ba_kuang + 0.5;
  const layerLengths = [z_chang, z_chang + 0.5, z_chang + 1.0, z_chang + 1.5];
  const layerAreas = layerLengths.map(L => (L * z_kuang) / 10000);
  const layerWeightTon = proth.map((x, i) => (x * (layerAreas[i] * 10000)) / 1000000);
  const layerCost = layerWeightTon.map((dun, i) => dun * price[i]);

  const jgf = n(input.jgf), zxyf = n(input.zxyf), sh = n(input.sh), lr = n(input.lr), lldj = n(input.lldj);
  const materialCost = layerCost.reduce((a, b) => a + b, 0);
  const processCost = jgf * layerAreas[0];
  const zipperCost = n(input.ba_zdf) || (((z_kuang + 10) * lldj) / 100);
  const all_dun = layerWeightTon.reduce((a, b) => a + b, 0);
  const costBeforeFreight = (materialCost + processCost) * (1 + sh) + zipperCost;
  const freightPerBag = (zxyf * all_dun) / 1000;
  const finalQuote = costBeforeFreight * (1 + lr) + freightPerBag;
  const unitCost = all_dun ? (costBeforeFreight / all_dun) : 0;
  const unitQuote = unitCost * (1 + lr) + zxyf;

  return {
    formulaProfile: 'irregular_zipper_excel_like',
    steps: [
      { key: 'z_chang', formula: 'ba_chang*2 + 3 + (irregular_has_bottom? (ba_di+1.5) : 0)', value: z_chang },
      { key: 'irregular_has_bottom', formula: '0=无底,1=有底', value: irregularHasBottom ? 1 : 0 },
      { key: 'z_kuang', formula: 'ba_kuang + 0.5', value: z_kuang },
      { key: 'layerLengths', formula: '[z_chang, z_chang+0.5, z_chang+1.0, z_chang+1.5]', value: layerLengths },
      { key: 'layerAreas(m²)', formula: 'layerLengths[i]*z_kuang/10000', value: layerAreas },
      { key: 'layerWeightTon', formula: '(thick[i]*proportion[i]*(layerAreas[i]*10000))/1000000', value: layerWeightTon },
      { key: 'layerCost', formula: 'layerWeightTon[i]*price[i]', value: layerCost },
      { key: 'processCost', formula: 'jgf * layerAreas[0]', value: processCost },
      { key: 'zipperCost', formula: 'ba_zdf || ((z_kuang+10)*lldj/100)', value: zipperCost },
      { key: 'costBeforeFreight', formula: '(material+process)*(1+sh)+zipper', value: costBeforeFreight },
      { key: 'freightPerBag', formula: 'zxyf*all_dun/1000', value: freightPerBag },
      { key: 'finalQuote', formula: 'costBeforeFreight*(1+lr)+freightPerBag', value: finalQuote },
      { key: 'unitQuote(元/吨)', formula: '(costBeforeFreight/all_dun)*(1+lr)+zxyf', value: unitQuote }
    ],
    compareWithResult: {
      result_finalQuote: result.finalQuote,
      expected_finalQuote: finalQuote
    }
  };
}

function traceBack(input = {}, result = {}) {
  const bagMode = String(input.bag_mode || input.subType || 'back_seal');
  const ba_chang = n(input.ba_chang);
  const ba_kuang = n(input.ba_kuang);
  const ba_ce = n(input.ba_ce || input.side || 0);
  const thick = p4(input.thick);
  const price = p4(input.price);
  const proportion = p4(input.proportion);
  const proth = thick.map((t, i) => t * proportion[i]);

  const base = (ba_kuang + ba_ce) * 2;
  const z_chang = bagMode === 'four_side_seal' ? (base + 1.5) : (base + 2 + 1.5);
  const z_kuang = ba_chang;
  const layerLengths = [z_chang, z_chang + 0.5, z_chang + 1.0, z_chang + 1.5];
  const layerAreas = layerLengths.map(L => (L * z_kuang) / 10000);
  const z_mian = layerAreas[0];
  const layerWeightKg = proth.map((x, i) => (x * layerAreas[i]) / 100);
  const layerCost = layerWeightKg.map((kg, i) => kg * price[i]);
  const all_kg = layerWeightKg.reduce((a, b) => a + b, 0);

  const jgf = n(input.jgf), zxyf = n(input.zxyf), sh = n(input.sh), lr = n(input.lr), lldj = n(input.lldj);
  const materialCost = layerCost.reduce((a, b) => a + b, 0);
  const processCost = jgf * z_mian;
  const zipperCost = n(input.ba_zdf) || ((ba_chang * lldj) / 100);
  const costBeforeFreight = (materialCost + processCost) * (1 + sh) + zipperCost;
  const freightCost = (zxyf * all_kg) / 1000;
  const finalQuote = costBeforeFreight * (1 + lr) + freightCost;
  const unitQuote = all_kg ? ((costBeforeFreight / all_kg) * 1000) * (1 + lr) + zxyf : 0;

  return {
    formulaProfile: bagMode === 'four_side_seal' ? 'four_side_seal' : (bagMode === 'side_seal' ? 'side_seal' : 'back_seal'),
    steps: [
      { key: 'bag_mode', formula: 'back_seal | side_seal | four_side_seal', value: bagMode },
      { key: 'z_chang', formula: bagMode==='four_side_seal' ? '(ba_kuang+ba_ce)*2+1.5' : '(ba_kuang+ba_ce)*2+2+1.5', value: z_chang },
      { key: 'z_kuang', formula: 'ba_chang', value: z_kuang },
      { key: 'layerLengths', formula: '[z_chang, z_chang+0.5, z_chang+1.0, z_chang+1.5]', value: layerLengths },
      { key: 'layerAreas(m²)', formula: 'layerLengths[i]*z_kuang/10000', value: layerAreas },
      { key: 'layerWeightKg', formula: '(thick[i]*proportion[i]*layerAreas[i])/100', value: layerWeightKg },
      { key: 'layerCost', formula: 'layerWeightKg[i]*price[i]', value: layerCost },
      { key: 'processCost', formula: 'jgf*z_mian', value: processCost },
      { key: 'zipperCost', formula: 'ba_zdf || (ba_chang*lldj/100)', value: zipperCost },
      { key: 'costBeforeFreight', formula: '(material+process)*(1+sh)+zipper', value: costBeforeFreight },
      { key: 'freightCost', formula: 'zxyf*all_kg/1000', value: freightCost },
      { key: 'finalQuote', formula: 'costBeforeFreight*(1+lr)+freight', value: finalQuote },
      { key: 'unitQuote(元/吨)', formula: '((costBeforeFreight/all_kg)*1000)*(1+lr)+zxyf', value: unitQuote }
    ],
    compareWithResult: {
      result_finalQuote: result.finalQuote,
      expected_finalQuote: finalQuote
    }
  };
}

function traceAuto(input = {}, result = {}) {
  const thick = p4(input.thick);
  const price = p4(input.price);
  const proportion = p4(input.proportion);

  const proth = thick.map((t, i) => t * proportion[i]);
  const allproRaw = proth.reduce((a, b) => a + b, 0);
  // 折合厚度(C)：先算 Σ(thick[i]*proportion[i])，再按基准表口径 ÷10
  const allpro = allproRaw / 10;
  const ratio = proth.map(x => (allproRaw ? x / allproRaw : 0));
  const dun = ratio.map(x => x * 1000);
  const clcb = dun.map((d, i) => d * price[i]);
  const sqmPerTon = allpro ? (10000 / allpro) : 0;

  const jgf = n(input.jgf);
  const fqfy = n(input.fqfy);
  const yf = n(input.yf || input.zxyf);
  const zt = n(input.zt);
  const btzt = n(input.btzt);
  const sh = n(input.sh);
  const lr = n(input.lr);

  const alljgf = jgf * sqmPerTon;
  const baseCost = alljgf + fqfy + yf + zt + btzt + clcb.reduce((a, b) => a + b, 0);
  const rescb = baseCost * (1 + sh);
  const zhbj = rescb * (1 + lr);
  const rollW = n(input.roll_w || 0);
  const rollL = n(input.roll_l || 0);
  const rollAreaM2 = (rollW * rollL) / 100;
  const pricePerSqm = sqmPerTon ? (zhbj / sqmPerTon) : 0;
  const rollPrice = rollAreaM2 * pricePerSqm;
  const rollWeightKg = rollAreaM2 * allpro / 10;

  return {
    formulaProfile: 'auto_bag',
    steps: [
      { key: 'thick', formula: '输入厚度 thick[i]', value: thick },
      { key: 'proportion', formula: '输入比重 proportion[i]', value: proportion },
      { key: 'proth', formula: 'thick[i] * proportion[i]', value: proth },
      { key: 'allproRaw', formula: 'sum(proth)', value: allproRaw },
      { key: 'allpro', formula: 'allproRaw / 10', value: allpro },
      { key: 'ratio', formula: 'proth[i] / allproRaw', value: ratio },
      { key: 'dun', formula: 'ratio[i] * 1000', value: dun },
      { key: 'clcb', formula: 'dun[i] * price[i]', value: clcb },
      { key: 'sqmPerTon', formula: '10000 / allpro', value: sqmPerTon },
      { key: 'alljgf', formula: 'jgf * sqmPerTon', value: alljgf },
      { key: 'baseCost', formula: 'alljgf + fqfy + yf + zt + btzt + sum(clcb)', value: baseCost },
      { key: 'costBeforeProfit', formula: 'baseCost * (1 + sh)', value: rescb },
      { key: 'finalQuote', formula: 'costBeforeProfit * (1 + lr)', value: zhbj },
      { key: 'rollAreaM2', formula: '(roll_w*roll_l)/100', value: rollAreaM2 },
      { key: 'pricePerSqm', formula: 'finalQuote/sqmPerTon', value: pricePerSqm },
      { key: 'rollPrice', formula: 'rollAreaM2 * pricePerSqm', value: rollPrice },
      { key: 'rollWeightKg', formula: 'rollAreaM2 * allpro / 10', value: rollWeightKg }
    ],
    compareWithResult: {
      result_costBeforeProfit: result.costBeforeProfit,
      result_finalQuote: result.finalQuote,
      expected_costBeforeProfit: rescb,
      expected_finalQuote: zhbj
    }
  };
}

function traceWeight(input = {}, result = {}) {
  const chang = n(input.chang);
  const kuang = n(input.kuang);
  const thick = p4(input.thick);
  const proportion = p4(input.proportion);

  const layerWeightKg = thick.map((t, i) => chang * kuang * t * proportion[i] * 0.01);
  const totalWeightKg = layerWeightKg.reduce((a, b) => a + b, 0);
  const totalWeightG = totalWeightKg * 1000;

  return {
    formulaProfile: 'material_weight',
    steps: [
      { key: 'layerWeightKg', formula: 'chang * kuang * thick[i] * proportion[i] * 0.01', value: layerWeightKg },
      { key: 'totalWeightKg', formula: 'sum(layerWeightKg)', value: totalWeightKg },
      { key: 'totalWeightG', formula: 'totalWeightKg * 1000', value: totalWeightG }
    ],
    compareWithResult: {
      result_totalWeightKg: result.totalWeightKg,
      result_totalWeightG: result.totalWeightG,
      expected_totalWeightKg: totalWeightKg,
      expected_totalWeightG: totalWeightG
    }
  };
}

router.get('/material-prices', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const rows = db.prepare('SELECT code, prop, price, updated_by, updated_at FROM material_prices ORDER BY code').all();
  res.json(rows);
});

router.post('/material-prices', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  const prop = Number(req.body?.prop);
  const price = Number(req.body?.price);
  if (!code) return res.status(400).json({ error: '材料名不能为空' });
  if (!Number.isFinite(prop) || prop <= 0) return res.status(400).json({ error: '比重必须大于0' });
  if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: '价格必须大于0' });

  db.prepare(`
    INSERT INTO material_prices (code, prop, price, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET prop=excluded.prop, price=excluded.price, updated_by=excluded.updated_by, updated_at=excluded.updated_at
  `).run(code, prop, price, req.user.userName, now());

  audit({ role: req.user.role, userName: req.user.userName, action: 'update_material_price', resourceType: 'material_price', resourceId: code, detail: JSON.stringify({ prop, price }) });
  res.json({ ok: true, code, prop, price });
});

router.get('/snapshots', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const kind = String(req.query.kind || '').trim();
  if (!['case', 'history'].includes(kind)) return res.status(400).json({ error: 'kind 必须是 case/history' });
  const rows = db.prepare(`
    SELECT id, user_name, kind, name, cost_type, input_json, result_json, created_at, updated_at
    FROM cost_snapshots
    WHERE user_name = ? AND kind = ?
    ORDER BY datetime(created_at) DESC
    LIMIT 1000
  `).all(req.user.userName, kind);
  res.json(rows.map(r => ({
    ...r,
    costType: r.cost_type,
    input: JSON.parse(r.input_json || '{}'),
    result: r.result_json ? JSON.parse(r.result_json) : null
  })));
});

router.post('/snapshots', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const kind = String(req.body?.kind || '').trim();
  const name = String(req.body?.name || '').trim();
  const costType = String(req.body?.costType || '').trim();
  const input = req.body?.input || {};
  const result = req.body?.result ?? null;
  if (!['case', 'history'].includes(kind)) return res.status(400).json({ error: 'kind 必须是 case/history' });
  if (!costType) return res.status(400).json({ error: 'costType 必填' });
  if (kind === 'case' && !name) return res.status(400).json({ error: '样例名称必填' });

  const ts = now();
  const ret = db.prepare(`
    INSERT INTO cost_snapshots (user_name, kind, name, cost_type, input_json, result_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.userName, kind, name, costType, JSON.stringify(input || {}), result == null ? null : JSON.stringify(result), ts, ts);

  res.json({ ok: true, id: ret.lastInsertRowid });
});

router.patch('/snapshots/:id', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name 必填' });
  const row = db.prepare('SELECT * FROM cost_snapshots WHERE id=? AND user_name=?').get(id, req.user.userName);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  db.prepare('UPDATE cost_snapshots SET name=?, updated_at=? WHERE id=?').run(name, now(), id);
  res.json({ ok: true });
});

router.delete('/snapshots/:id', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const id = Number(req.params.id);
  const ret = db.prepare('DELETE FROM cost_snapshots WHERE id=? AND user_name=?').run(id, req.user.userName);
  if (!ret.changes) return res.status(404).json({ error: '记录不存在' });
  res.json({ ok: true });
});

router.post('/export.xls', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  try {
    const { costType, input = {}, result = {} } = req.body || {};
    if (!costType) return res.status(400).json({ error: 'costType 必填' });

    const safe = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const num = (v, d = 8) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return '-';
      return n.toFixed(d).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
    };
    const bagTypeMap = {
      eight_side_seal: '八边封袋成本核算',
      stand_zipper_bag: '自立拉链袋成本核算',
      three_side_seal: '三边封袋成本核算',
      irregular_zipper_bag: '自立异形拉链袋成本核算',
      back_seal: '背封袋成本核算',
      side_seal: '侧边封袋成本核算',
      four_side_seal: '四边封袋成本核算',
      auto_bag: '自动包核算表',
      material_weight: '材料重量核算'
    };

    const matNames = [input.mat1, input.mat2, input.mat3, input.mat4, ...(input.materialNames || []), ...(input.materials || [])];
    const arr4 = (arr, fb) => {
      const a = Array.isArray(arr) ? arr.slice(0, 4) : [];
      while (a.length < 4) a.push(undefined);
      const hasAny = a.some(v => v !== undefined && v !== null && String(v) !== '');
      if (hasAny) return a;
      return fb;
    };
    const thick = arr4(input.thick, [input.t1, input.t2, input.t3, input.t4]);
    const prop = arr4(input.proportion, [input.p1, input.p2, input.p3, input.p4]);
    const price = arr4(input.price, [input.pr1, input.pr2, input.pr3, input.pr4]);
    const lw = result.layerWeightTon || result.layerWeightKg || [0, 0, 0, 0];
    const lc = result.layerCost || [0, 0, 0, 0];

    const layerRows = [0,1,2,3].map(i => `
      <tr>
        <td>L${i+1}</td>
        <td>${safe(matNames[i] || '-')}</td>
        <td>${num(thick[i],4)}</td>
        <td>${num(prop[i],4)}</td>
        <td>${num(price[i],4)}</td>
        <td>${num(lw[i],8)}</td>
        <td>${num(lc[i],8)}</td>
      </tr>`).join('');

    const eightSideExtra = costType === 'eight_side_seal' ? `
      <tr><th class='sec' colspan='7'>四、八边封拆分（正面 + 侧边）</th></tr>
      <tr><th>部位</th><th>材料成本</th><th>加工成本</th><th>运费分摊</th><th>成本小计</th><th>报价</th><th>面积</th></tr>
      <tr><td>正面</td><td>${num(result.frontMaterialCost,8)}</td><td>${num(result.frontProcessCost,8)}</td><td>${num(result.frontFreightCost,8)}</td><td>${num(result.frontCost,8)}</td><td>${num(result.frontQuote,8)}</td><td>${num(result.z_mian,4)}</td></tr>
      <tr><td>侧边</td><td>${num(result.sideMaterialCost,8)}</td><td>${num(result.sideProcessCost,8)}</td><td>${num(result.sideFreightCost,8)}</td><td>${num(result.sideCost,8)}</td><td>${num(result.sideQuote,8)}</td><td>${num(result.side_mian,4)}</td></tr>
      <tr><td><b>合计</b></td><td>${num(result.materialCost,8)}</td><td>${num(result.processCost,8)}</td><td>${num(result.freightCost,8)}</td><td>${num(result.totalCost,8)}</td><td><b>${num(result.finalQuote,8)}</b></td><td>${num((Number(result.z_mian)||0)+(Number(result.side_mian)||0),4)}</td></tr>
    ` : '';

    const autoExtra = costType === 'auto_bag' ? `
      <tr><th class='sec' colspan='7'>四、自动包关键指标（基准表口径）</th></tr>
      <tr><th>折合厚度</th><th>材料比例(kg/吨)</th><th>材料成本(元)</th><th>每吨平方数</th><th>分切费用</th><th>纸筒</th><th>边条纸箱</th></tr>
      <tr><td>${num(result.allpro,4)}</td><td>${safe((result.dun||[]).map(v=>num(v,4)).join(' / '))}</td><td>${safe((result.clcb||[]).map(v=>num(v,6)).join(' / '))}</td><td>${num(result.sqmPerTon,6)}</td><td>${num(input.fqfy,4)}</td><td>${num(input.zt,4)}</td><td>${num(input.btzt,4)}</td></tr>
      <tr><th>每卷平方数</th><th>每平方价格</th><th>每卷价格</th><th>每卷重量(kg)</th><th>卷宽(cm)</th><th>卷长(m)</th><th>运费(元/吨)</th></tr>
      <tr><td>${num(result.rollAreaM2,6)}</td><td>${num(result.pricePerSqm,9)}</td><td>${num(result.rollPrice,6)}</td><td>${num(result.rollWeightKg,6)}</td><td>${num(input.roll_w,4)}</td><td>${num(input.roll_l,4)}</td><td>${num(input.yf || input.zxyf,4)}</td></tr>
    ` : '';

    const html = `
    <html><meta charset="utf-8"><body>
    <style>
      table{border-collapse:collapse;width:100%;font-family:'Microsoft YaHei',Arial}
      td,th{border:0.5px solid #d5dbe3;padding:6px;text-align:center}
      .title{background:#93c5fd;font-size:22px;font-weight:800}
      .sec{background:#dbeafe;font-weight:700;text-align:left}
      .in{background:#f8fbff}
      .auto{background:#eef6ff}
      .left{text-align:left}
    </style>
    <table>
      <tr><th class="title" colspan="7">${safe(bagTypeMap[costType] || costType)}（内部版）</th></tr>
      <tr><th class='sec' colspan='7'>一、基础参数</th></tr>
      <tr>
        <td class='in'>袋型</td><td>${safe(bagTypeMap[costType] || costType)}（${safe(costType)}）</td>
        <td class='in'>包长</td><td>${num(input.ba_chang,4)}</td>
        <td class='in'>包宽</td><td>${num(input.ba_kuang,4)}</td>
        <td class='in'>包底/侧</td>
      </tr>
      <tr>
        <td class='in'>底边</td><td>${num(input.ba_di,4)}</td>
        <td class='in'>侧边</td><td>${num(input.ba_ce,4)}</td>
        <td class='in'>加工费(元/㎡)</td><td>${num(input.jgf,6)}</td>
        <td>${new Date().toISOString().slice(0,19).replace('T',' ')}</td>
      </tr>
      <tr>
        <td class='in'>损耗(%)</td><td>${num(Number(input.sh)*100,4)}</td>
        <td class='in'>利润(%)</td><td>${num(Number(input.lr)*100,4)}</td>
        <td class='in'>运费(元/吨)</td><td>${num(input.zxyf,4)}</td>
        <td class='in'>拉链单价(元/米)</td><td>${num(input.lldj,6)}</td>
      </tr>
      <tr>
        <td class='in'>总厚度C</td><td>${num(result.totalThickness ?? (Number(thick[0]||0)+Number(thick[1]||0)+Number(thick[2]||0)+Number(thick[3]||0)),4)}</td>
        <td class='in'>拉链总费用</td><td>${num(input.ba_zdf,8)}</td>
        <td class='in'>第二层面积</td><td>${num(input.z_mian_2,4)}</td>
        <td class='in'>第三/四层面积</td><td>${num(input.z_mian_3,4)} / ${num(input.z_mian_4,4)}</td>
      </tr>

      <tr><th class='sec' colspan='7'>二、分层材料明细（完整保留成本信息）</th></tr>
      <tr><th>层数</th><th>材料</th><th>厚度C</th><th>比重</th><th>单价</th><th>材料重量(自动)</th><th>材料成本(自动)</th></tr>
      ${layerRows}

      <tr><th class='sec' colspan='7'>三、关键计算结果（内部核算）</th></tr>
      <tr><td class='auto'>展开长度</td><td>${num(result.z_chang,4)}</td><td class='auto'>展开宽度</td><td>${num(result.z_kuang,4)}</td><td class='auto'>面积</td><td colspan='2'>${num(result.z_mian,4)}</td></tr>
      <tr><td class='auto'>总厚度</td><td>${num(result.totalThickness,4)}</td><td class='auto'>总吨位/重量</td><td>${num(result.all_dun ?? result.totalWeightKg,8)}</td><td class='auto'>单位成本(元/吨)</td><td colspan='2'>${num(result.unitCost,4)}</td></tr>
      <tr><td class='auto'>材料成本</td><td>${num(result.materialCost,8)}</td><td class='auto'>加工成本</td><td>${num(result.processCost,8)}</td><td class='auto'>拉链成本</td><td colspan='2'>${num(result.zipperCost,8)}</td></tr>
      <tr><td class='auto'>运费分摊</td><td>${num(result.freightCost,8)}</td><td class='auto'>成本小计</td><td>${num(result.totalCost ?? result.costBeforeProfit,8)}</td><td class='auto'>最终报价</td><td colspan='2'><b>${num(result.finalQuote,8)}</b></td></tr>

      ${eightSideExtra}
      ${autoExtra}

      <tr><th class='sec' colspan='7'>五、原始输入（审计留痕）</th></tr>
      <tr><td class='left' colspan='7'>${Object.entries(input||{}).map(([k,v])=>`${safe(k)}: ${safe(Array.isArray(v)?v.join(','):v)}`).join(' ｜ ')}</td></tr>
    </table></body></html>`;

    const cnName = (bagTypeMap[costType] || costType).replace(/\s+/g,'');
    const fileName = `${cnName}_内部核算_${new Date().toISOString().slice(0,10)}.xls`;
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cost_export.xls"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(html);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

function buildCostMailHtml(costType, input = {}, result = {}) {
  const bagTypeMap = {
    eight_side_seal: '八边封袋', stand_zipper_bag: '自立拉链袋', three_side_seal: '三边封袋',
    irregular_zipper_bag: '自立异形拉链袋', back_seal: '背封袋', side_seal: '侧边封袋',
    four_side_seal: '四边封袋', auto_bag: '自动包装', material_weight: '材料重量核算'
  };
  const num=(v,d=4)=>{ const n=Number(v); return Number.isFinite(n)?n.toFixed(d).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1'):'-'; };
  const esc=(v)=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<html><meta charset='utf-8'><body><table border='1' cellspacing='0' cellpadding='6' style='border-collapse:collapse;width:100%;font-family:Microsoft YaHei,Arial'>
    <tr><th colspan='4' style='font-size:20px'>${esc(bagTypeMap[costType]||costType)}成本核算表</th></tr>
    <tr><td>袋型</td><td>${esc(bagTypeMap[costType]||costType)}</td><td>规格</td><td>${num(input.ba_chang,2)}*${num(input.ba_kuang,2)}${input.ba_di?`+${num(input.ba_di,2)}`:''}</td></tr>
    <tr><td>总厚度</td><td>${num(result.totalThickness,4)}</td><td>最终报价</td><td><b>${num(result.finalQuote,8)}</b></td></tr>
    <tr><td>材料成本</td><td>${num(result.materialCost,8)}</td><td>加工成本</td><td>${num(result.processCost,8)}</td></tr>
    <tr><td>运费分摊</td><td>${num(result.freightCost,8)}</td><td>成本小计</td><td>${num(result.totalCost ?? result.costBeforeProfit,8)}</td></tr>
  </table></body></html>`;
}

function buildCostMailPdfBuffer(costType, input = {}, result = {}) {
  return new Promise((resolve, reject) => {
    const bagTypeMap = {
      eight_side_seal: '八边封袋', stand_zipper_bag: '自立拉链袋', three_side_seal: '三边封袋',
      irregular_zipper_bag: '自立异形拉链袋', back_seal: '背封袋', side_seal: '侧边封袋',
      four_side_seal: '四边封袋', auto_bag: '自动包装', material_weight: '材料重量核算'
    };
    const num=(v,d=4)=>{ const n=Number(v); return Number.isFinite(n)?n.toFixed(d).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1'):'-'; };
    const doc = new PDFDocument({ size: 'A4', margin: 24 });
    const chunks=[]; doc.on('data',c=>chunks.push(c)); doc.on('end',()=>resolve(Buffer.concat(chunks))); doc.on('error',reject);

    // 邮件附件PDF同样强制使用中文字体，避免乱码
    const zhCandidates = [
      path.join(__dirname, '../../assets/fonts/NotoSansCJKsc-Regular.otf'),
      path.join(__dirname, '../../data/fonts/NotoSansSC-Regular.otf')
    ];
    let zhOk = false;
    for (const fp of zhCandidates) {
      try {
        if (fs.existsSync(fp)) {
          doc.registerFont('zh', fp);
          doc.font('zh');
          zhOk = true;
          break;
        }
      } catch (_) {}
    }
    if (!zhOk) doc.font('Helvetica');

    doc.fontSize(18).text(`华胜印刷成本核算单`, { align:'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`袋型：${bagTypeMap[costType]||costType}`);
    doc.text(`规格：${num(input.ba_chang,2)}*${num(input.ba_kuang,2)}${input.ba_di?`+${num(input.ba_di,2)}`:''}`);
    doc.text(`总厚度：${num(result.totalThickness,4)} C`);
    doc.text(`材料成本：${num(result.materialCost,8)}`);
    doc.text(`加工成本：${num(result.processCost,8)}`);
    doc.text(`运费分摊：${num(result.freightCost,8)}`);
    doc.text(`成本小计：${num(result.totalCost ?? result.costBeforeProfit,8)}`);
    doc.fontSize(14).text(`最终报价：${num(result.finalQuote,8)}`, { underline:true });
    doc.end();
  });
}

async function sendCostEmailByPayload(payload = {}) {
  const { costType, input = {}, result = {}, to = '', cc = '' } = payload || {};
  if (!costType || !to) throw new Error('costType/to 必填');
  const host = process.env.SMTP_HOST || '';
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || 'true').toLowerCase() !== 'false';
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const from = process.env.SMTP_FROM || user || '';
  if (!host || !user || !pass || !from) throw new Error('未配置SMTP');

  const html = buildCostMailHtml(costType, input, result);
  const pdfBuf = await buildCostMailPdfBuffer(costType, input, result);
  const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  await transporter.sendMail({
    from,
    to,
    cc: cc || undefined,
    subject: `成本核算发送 ${costType}`,
    html,
    text: '请查看附件中的成本核算Excel与PDF。',
    attachments: [
      { filename: `cost_${costType}.xls`, content: Buffer.from(html, 'utf8'), contentType: 'application/vnd.ms-excel' },
      { filename: `cost_${costType}.pdf`, content: pdfBuf, contentType: 'application/pdf' }
    ]
  });
}

router.get('/email-logs', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const rows = db.prepare(`
    SELECT id, user_name, cost_type, to_list, cc_list, status, error, created_at, updated_at
    FROM cost_email_logs
    WHERE user_name = ?
    ORDER BY id DESC
    LIMIT 80
  `).all(req.user.userName || '');
  res.json({ rows });
});

router.post('/email-logs/:id/retry', allowRoles('super_admin', 'manager', 'ai_sales'), async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const row = db.prepare('SELECT * FROM cost_email_logs WHERE id=? AND user_name=?').get(id, req.user.userName || '');
    if (!row) return res.status(404).json({ error: '记录不存在' });
    const payload = JSON.parse(row.payload_json || '{}');
    await sendCostEmailByPayload(payload);
    db.prepare('UPDATE cost_email_logs SET status=?, error=?, updated_at=? WHERE id=?').run('sent', '', now(), id);
    audit({ role: req.user.role, userName: req.user.userName, action: 'retry_cost_email', resourceType: 'cost_email_log', resourceId: id, detail: row.cost_type || '' });
    res.json({ ok: true });
  } catch (err) {
    const id = Number(req.params.id || 0);
    db.prepare('UPDATE cost_email_logs SET status=?, error=?, updated_at=? WHERE id=?').run('send_failed', String(err?.message || '发送失败'), now(), id);
    res.status(500).json({ ok: false, error: err.message || '发送失败' });
  }
});

router.post('/send-email', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const payload = req.body || {};
  const { costType, to = '', cc = '' } = payload;
  const ts = now();
  const ret = db.prepare(`
    INSERT INTO cost_email_logs (user_name, cost_type, to_list, cc_list, status, error, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.userName || '', String(costType || ''), String(to || ''), String(cc || ''), 'pending', '', JSON.stringify(payload || {}), ts, ts);
  const logId = Number(ret.lastInsertRowid || 0);

  // 异步队列发送：前端秒回，后台发信并回写状态
  setTimeout(async () => {
    try {
      await sendCostEmailByPayload(payload);
      db.prepare('UPDATE cost_email_logs SET status=?, error=?, updated_at=? WHERE id=?').run('sent', '', now(), logId);
      audit({ role: req.user.role, userName: req.user.userName, action: 'send_cost_email', resourceType: 'cost', resourceId: costType, detail: `queued id=${logId} to=${to};cc=${cc||''}` });
    } catch (err) {
      db.prepare('UPDATE cost_email_logs SET status=?, error=?, updated_at=? WHERE id=?').run('send_failed', String(err?.message || '发送失败'), now(), logId);
      audit({ role: req.user.role, userName: req.user.userName, action: 'send_cost_email_failed', resourceType: 'cost', resourceId: costType, detail: `queued id=${logId} ${String(err?.message || '发送失败')}` });
    }
  }, 0);

  res.json({ ok: true, queued: true, id: logId, message: '已加入发送队列' });
});

router.post('/export.pdf', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  try {
    const { costType, input = {}, result = {} } = req.body || {};
    if (!costType) return res.status(400).json({ error: 'costType 必填' });

    const numFmt = (v, d = 4) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return '-';
      return n.toFixed(d).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
    };
    const txt = (v) => (v === null || v === undefined || v === '' ? '-' : String(v));
    const bagTypeMap = {
      eight_side_seal: '八边封袋',
      stand_zipper_bag: '自立拉链袋',
      three_side_seal: '三边封袋',
      irregular_zipper_bag: '自立异形拉链袋',
      back_seal: '背封袋',
      side_seal: '侧边封袋',
      four_side_seal: '四边封袋',
      auto_bag: '自动包装',
      material_weight: '材料重量核算'
    };

    const matNames = [input.mat1, input.mat2, input.mat3, input.mat4, ...(input.materialNames || []), ...(input.materials || [])];
    const thick = Array.isArray(input.thick) ? input.thick : [input.t1, input.t2, input.t3, input.t4];
    const totalThick = Number(result.totalThickness || (thick || []).reduce((a, b) => Number(a) + Number(b || 0), 0));

    const doc = new PDFDocument({ size: 'A4', margin: 24 });
    const cnName = (bagTypeMap[costType] || costType).replace(/\s+/g,'');
    const pdfName = `华胜印刷报价单_${cnName}_${new Date().toISOString().slice(0,10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="quote.pdf"; filename*=UTF-8''${encodeURIComponent(pdfName)}`);
    doc.pipe(res);

    // 中文字体，避免PDF乱码
    const zhFontPath = path.join(__dirname, '../../assets/fonts/NotoSansCJKsc-Regular.otf');
    try {
      doc.registerFont('zh', zhFontPath);
      doc.font('zh');
    } catch {
      doc.font('Helvetica');
    }

    const left = 24;
    const pageW = 595.28;
    const right = pageW - 24;
    const width = right - left;
    let y = 20;

    // 页面外框
    doc.lineWidth(1);
    doc.rect(left, y, width, 800).stroke('#334155');

    // 页眉（企业化）
    doc.rect(left + 10, y + 10, width - 20, 114).fillAndStroke('#f8fafc', '#334155');
    doc.rect(left + 10, y + 10, width - 20, 6).fill('#1d4ed8');
    const logoPath = path.join(__dirname, '../../public/assets/company-logo-v2.jpg');
    try { doc.image(logoPath, left + 20, y + 26, { fit: [155, 74], align: 'left', valign: 'center' }); } catch {}
    const titleX = left + 190;
    const titleW = width - 220;
    const nowDate = new Date();
    const dateStr = nowDate.toISOString().slice(0, 10);
    const quoteNo = `Q${dateStr.replace(/-/g,'')}-${String(nowDate.getHours()).padStart(2,'0')}${String(nowDate.getMinutes()).padStart(2,'0')}`;
    const validUntil = new Date(nowDate.getTime() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    doc.fontSize(25).fillColor('#0f172a').text('华胜印刷有限公司报价单', titleX, y + 40, { width: titleW, align: 'left' });
    doc.fontSize(11).fillColor('#64748b').text('Quotation Sheet', titleX, y + 73, { width: titleW, align: 'left' });
    doc.fontSize(10).fillColor('#475569').text(`报价单编号：${quoteNo}    有效期至：${validUntil}`, titleX, y + 90, { width: titleW, align: 'left' });

    y += 130;

    // 基础信息（标准两列）
    doc.rect(left + 10, y, width - 20, 96).fillAndStroke('#ffffff', '#334155');
    const specParts = [
      `长 ${numFmt(input.ba_chang, 2)} cm`,
      `宽 ${numFmt(input.ba_kuang, 2)} cm`
    ];
    if (costType === 'eight_side_seal' || costType === 'stand_zipper_bag' || costType === 'irregular_zipper_bag') specParts.push(`底 ${numFmt(input.ba_di, 2)} cm`);
    if (costType === 'back_seal' || costType === 'side_seal' || costType === 'four_side_seal') specParts.push(`侧 ${numFmt(input.ba_ce, 2)} cm`);

    // 左栏
    doc.fontSize(12).fillColor('#0f172a').text(`袋型：${bagTypeMap[costType] || costType}`, left + 20, y + 12);
    doc.fontSize(11).fillColor('#1f2937').text(`规格：${specParts.join('    ')}`, left + 20, y + 34);
    doc.text(`总厚度：${numFmt(totalThick, 4)} C`, left + 20, y + 56);

    // 右栏
    doc.fontSize(11).fillColor('#1f2937').text(`报价日期：${dateStr}`, left + width - 220, y + 14);
    doc.text(`有效期：${validUntil}`, left + width - 220, y + 32);
    const refQuoteRaw = input.referenceQuote ?? input.reference_quote ?? input.refQuote ?? input.ref_quote;
    const refQuote = Number(refQuoteRaw);
    const hasRefQuote = Number.isFinite(refQuote) && refQuote > 0;
    doc.roundedRect(left + width - 236, y + 46, 206, hasRefQuote ? 52 : 42, 7).fillAndStroke('#eaf2ff', '#60a5fa');
    doc.fontSize(10).fillColor('#475569').text('最终报价', left + width - 230, y + 50, { width: 194, align: 'center' });
    doc.fontSize(15).fillColor('#1e3a8a').text(`${numFmt(result.finalQuote, 6)} 元/个`, left + width - 230, y + 64, { width: 194, align: 'center' });
    if (hasRefQuote) {
      doc.fontSize(9.5).fillColor('#64748b').text(`参考报价：${numFmt(refQuote, 6)} 元/个`, left + width - 230, y + 80, { width: 194, align: 'center' });
    }

    y += 108;

    // 材料分层表（不展示成本/价格）
    doc.fontSize(13).fillColor('#111827').text('材料分层说明', left + 12, y);
    y += 16;
    const cols = [80, 220, 210];
    const headers = ['层级', '材料名称', '厚度(C)'];
    const tableX = left + 10;
    const rowH = 24;
    let x = tableX;

    doc.rect(tableX, y, cols.reduce((a, b) => a + b, 0), rowH).fillAndStroke('#eaf2ff', '#334155');
    headers.forEach((h, i) => {
      doc.fillColor('#111827').fontSize(11).text(h, x, y + 8, { width: cols[i], align: 'center' });
      if (i > 0) doc.moveTo(x, y).lineTo(x, y + rowH).stroke('#374151');
      x += cols[i];
    });
    y += rowH;

    [0, 1, 2, 3].forEach(i => {
      x = tableX;
      doc.rect(tableX, y, cols.reduce((a, b) => a + b, 0), rowH).stroke('#374151');
      const row = [`第${i + 1}层`, txt(matNames[i] || '-'), numFmt(thick[i], 4)];
      row.forEach((v, idx) => {
        doc.fillColor('#111827').fontSize(11).text(v, x + 2, y + 8, { width: cols[idx] - 4, align: 'center' });
        if (idx > 0) doc.moveTo(x, y).lineTo(x, y + rowH).stroke('#374151');
        x += cols[idx];
      });
      y += rowH;
    });

    y += 12;

    // 八边封专属：正面/侧边结构说明（不展示成本）
    if (costType === 'eight_side_seal') {
      doc.fontSize(13).fillColor('#111827').text('八边封结构说明（正面 + 侧边）', left + 12, y);
      y += 16;
      const bcols = [120, 120, 120, 150];
      const bhead = ['部位', '展开长度(cm)', '展开宽度(cm)', '面积(cm²)'];
      const bx = left + 10;
      const bh = 26;
      x = bx;
      doc.rect(bx, y, bcols.reduce((a, b) => a + b, 0), bh).fillAndStroke('#fef3c7', '#92400e');
      bhead.forEach((h, i) => {
        doc.fillColor('#111827').fontSize(10).text(h, x, y + 7, { width: bcols[i], align: 'center' });
        if (i > 0) doc.moveTo(x, y).lineTo(x, y + bh).stroke('#92400e');
        x += bcols[i];
      });
      y += bh;

      const rows = [
        ['正面', numFmt(result.z_chang, 2), numFmt(result.z_kuang, 2), numFmt(result.z_mian, 2)],
        ['侧边', numFmt(result.side_chang, 2), numFmt(result.side_kuang, 2), numFmt(result.side_mian, 2)]
      ];
      rows.forEach(r => {
        x = bx;
        doc.rect(bx, y, bcols.reduce((a, b) => a + b, 0), bh).stroke('#92400e');
        r.forEach((v, i) => {
          doc.fillColor('#111827').fontSize(10).text(v, x, y + 7, { width: bcols[i], align: 'center' });
          if (i > 0) doc.moveTo(x, y).lineTo(x, y + bh).stroke('#92400e');
          x += bcols[i];
        });
        y += bh;
      });
      y += 8;
    }

    // 专业说明（自适应一页）
    const notesH = Math.max(160, 790 - y - 28);
    doc.rect(left + 10, y, width - 20, notesH).fillAndStroke('#fcfdff', '#334155');
    doc.rect(left + 10, y, width - 20, 26).fill('#f1f5f9');
    doc.fontSize(11.5).fillColor('#0f172a').text('工艺与交付说明', left + 18, y + 8);
    const notes = [
      '1. 本报价单为客户展示版本，已隐藏内部成本、利润、损耗等经营数据。',
      '2. 材料分层、厚度与袋型结构按本次核算参数自动生成，用于客户确认规格。',
      '3. 印刷颜色、版面、工艺（拉链/切边/封边）变化时，报价需按新参数复核。',
      '备注：以上报价以最终打样确认文件为准。'
    ];
    let ny = y + 34;
    notes.forEach((t, idx) => { doc.fontSize(11).fillColor(idx===3?'#0f172a':'#374151').text(t, left + 20, ny, { width: width - 40, lineGap: 1 }); ny += 24; });

    // 页脚
    doc.fontSize(10).fillColor('#6b7280').text('华胜印刷有限公司  |  包装袋印刷与复合解决方案', left + 10, 790, { width: width - 20, align: 'center' });

    doc.end();
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/calculate', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  try {
    const { costType, input = {}, withTrace = true } = req.body || {};
    let result;
    let trace;

    switch (costType) {
      case 'auto_bag':
        result = calcAutoBag(input);
        trace = traceAuto(input, result);
        break;
      case 'eight_side_seal':
        result = calcEightSideSeal(input);
        trace = traceEight(input, result);
        break;
      case 'stand_zipper_bag':
        result = calcStandZipperBag(input);
        trace = traceStand(input, result);
        break;
      case 'three_side_seal': {
        const fixedInput = { ...input, ba_di: 0 };
        result = calcStandZipperBag(fixedInput);
        trace = traceStand(fixedInput, result);
        break;
      }
      case 'irregular_zipper_bag':
        result = calcIrregularZipperBag(input);
        trace = traceIrregular(input, result);
        break;
      case 'back_seal':
        result = calcBackSealBag({ ...input, bag_mode: 'back_seal' });
        trace = traceBack({ ...input, bag_mode: 'back_seal' }, result);
        break;
      case 'side_seal':
        result = calcBackSealBag({ ...input, bag_mode: 'side_seal' });
        trace = traceBack({ ...input, bag_mode: 'side_seal' }, result);
        break;
      case 'four_side_seal':
        result = calcBackSealBag({ ...input, bag_mode: 'four_side_seal' });
        trace = traceBack({ ...input, bag_mode: 'four_side_seal' }, result);
        break;
      case 'material_weight':
        result = calcMaterialWeight(input);
        trace = traceWeight(input, result);
        break;
      default:
        return res.status(400).json({ error: '不支持的 costType' });
    }

    res.json({ ok: true, costType, result, trace: withTrace ? trace : undefined });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round(v, d = 4) {
  const p = Math.pow(10, d);
  return Math.round((v + Number.EPSILON) * p) / p;
}

function pad4(arr) {
  const a = (arr || []).map(num);
  while (a.length < 4) a.push(0);
  return a;
}

// 自动包核算（hess）
function calcAutoBag(input) {
  const thick = pad4(input.thick);
  const price = pad4(input.price);
  const proportion = pad4(input.proportion);

  const proth = thick.map((t, i) => t * proportion[i]);
  const allproRaw = proth.reduce((a, b) => a + b, 0);
  const foldedThickness = allproRaw / 10; // 折合厚度（与基准表口径一致）
  const ratio = proth.map(x => (allproRaw ? x / allproRaw : 0));
  const dun = ratio.map(x => x * 1000); // 材料比例(kg/吨)
  const clcb = dun.map((d, i) => d * price[i]); // 材料成本(元)

  const sqmPerTon = foldedThickness ? (10000 / foldedThickness) : 0; // 每吨平方数
  const jgf = num(input.jgf);
  const fqfy = num(input.fqfy);
  const yf = num(input.yf || input.zxyf);
  const zt = num(input.zt);
  const btzt = num(input.btzt);
  const sh = num(input.sh);
  const lr = num(input.lr);

  const alljgf = jgf * sqmPerTon;
  const materialCost = clcb.reduce((a, b) => a + b, 0);
  const baseCost = alljgf + fqfy + yf + zt + btzt + materialCost;
  const rescb = baseCost * (1 + sh);
  const zhbj = rescb * (1 + lr);

  // 每卷指标（自动包表展示）
  const rollW = num(input.roll_w || 0); // cm
  const rollL = num(input.roll_l || 0); // m
  const rollAreaM2 = (rollW * rollL) / 100;
  const pricePerSqm = sqmPerTon ? (zhbj / sqmPerTon) : 0;
  const rollPrice = rollAreaM2 * pricePerSqm;
  const rollWeightKg = rollAreaM2 * foldedThickness / 10;

  const layerWeightTon = dun.map(x => round(x / 1000, 8)); // 每层吨位（吨）
  const layerCost = clcb.map(x => round(x, 8)); // 每层材料成本（元）

  return {
    allpro: round(foldedThickness, 4),
    ratio: ratio.map(x => round(x, 6)),
    dun: dun.map(x => round(x, 6)),
    clcb: clcb.map(x => round(x, 8)),
    layerWeightTon,
    layerCost,
    materialCost: round(materialCost, 8),
    sqmPerTon: round(sqmPerTon, 6),
    mdpb1: round(sqmPerTon, 6),
    alljgf: round(alljgf, 8),
    fqfy: round(fqfy, 8), yf: round(yf, 8), zt: round(zt, 8), btzt: round(btzt, 8),
    costBeforeProfit: round(rescb, 8),
    finalQuote: round(zhbj, 8),
    rollAreaM2: round(rollAreaM2, 6),
    pricePerSqm: round(pricePerSqm, 9),
    rollPrice: round(rollPrice, 8),
    rollWeightKg: round(rollWeightKg, 8)
  };
}

// 通用“展开面积+分层吨位”核算（异形/自立拉链/兼容）
function calcSealBagBase(input, opts = {}) {
  const ba_chang = num(input.ba_chang);
  const ba_kuang = num(input.ba_kuang);
  const ba_di = num(input.ba_di);
  const ba_ce = num(input.ba_ce || input.side || 0);
  const lenOffset = num(opts.lenOffset ?? 3.5);
  const widthOffset = num(opts.widthOffset ?? 0.5);
  const zipperExtraCm = num(opts.zipperExtraCm ?? 0);

  const thick = pad4(input.thick);
  const price = pad4(input.price);
  const proportion = pad4(input.proportion);

  const z_chang = ba_chang * 2 + lenOffset + ba_di;
  // 侧面参数仅在对应袋型启用（未启用时 ba_ce=0）
  const z_kuang = ba_kuang + ba_ce + widthOffset;
  const z_mian = z_chang * z_kuang;

  const z_mian_2 = num(input.z_mian_2) || z_mian;
  const z_mian_3 = num(input.z_mian_3) || z_mian;
  const z_mian_4 = num(input.z_mian_4) || z_mian;
  const areas = opts.multiArea ? [z_mian, z_mian_2, z_mian_3, z_mian_4] : [z_mian, z_mian, z_mian, z_mian];

  const proth = thick.map((t, i) => t * proportion[i]);
  const dun = proth.map((x, i) => (x * areas[i]) / 1000000);
  const ba_clcb = dun.map((d, i) => d * price[i]);
  const totalThickness = thick.reduce((a,b)=>a+b,0);
  const all_dun = dun.reduce((a, b) => a + b, 0);
  const ba_all_clcb = ba_clcb.reduce((a, b) => a + b, 0);

  const jgf = num(input.jgf);
  const zxyf = num(input.zxyf);
  const sh = num(input.sh);
  const lr = num(input.lr);

  const lldj = num(input.lldj);
  const defaultZdf = ((z_kuang + zipperExtraCm) * lldj) / 100;
  const ba_zdf = num(input.ba_zdf) || defaultZdf;

  const alljgf = (jgf * z_mian) / 10000;
  const rescb = (ba_all_clcb + alljgf) * (1 + sh) + ba_zdf;
  const freightFactor = opts.freightFactor || 1;
  const ba_danyun = ((zxyf * all_dun) / 1000) * freightFactor;
  const zhbj = ba_danyun + rescb * (1 + lr);

  return {
    z_chang: round(z_chang), z_kuang: round(z_kuang), z_mian: round(z_mian), ba_ce: round(ba_ce), z_mian_2: round(z_mian_2), z_mian_3: round(z_mian_3), z_mian_4: round(z_mian_4),
    totalThickness: round(totalThickness,4),
    layerWeightTon: dun.map(x=>round(x,6)),
    layerCost: ba_clcb.map(x=>round(x,8)),
    all_dun: round(all_dun, 6), materialCost: round(ba_all_clcb, 8), processCost: round(alljgf, 6), zipperCost: round(ba_zdf, 6),
    totalCost: round(rescb, 6), freightCost: round(ba_danyun, 6), finalQuote: round(zhbj, 6), unitCost: all_dun ? round((rescb / all_dun) * 1000, 6) : 0
  };
}

function calcEightSideSeal(input) {
  // Excel对齐思路：八边封 = 正面 + 侧边 两段成本相加
  const ba_chang = num(input.ba_chang);
  const ba_kuang = num(input.ba_kuang);
  const ba_di = num(input.ba_di);
  const thick = pad4(input.thick);
  const price = pad4(input.price);
  const proportion = pad4(input.proportion);
  const proth = thick.map((t, i) => t * proportion[i]);

  // 正面
  // Excel基准：八边封正面展开长度 = 包长*2 + 4 + 底边
  const front_len = ba_chang * 2 + 4 + ba_di;
  // Excel基准：八边封正面展开宽度 = 包宽 + 0.6
  const front_wid = ba_kuang + 0.6;
  const front_area = front_len * front_wid;
  const front_dun = proth.map(x => (x * front_area) / 1000000);
  const front_layer_cost = front_dun.map((d, i) => d * price[i]);

  // 侧边（侧面与底合并输入后按底值展开）
  const side_len = ba_chang;
  const side_wid = ba_di * 2 + 1.2;
  const side_area = side_len * side_wid;
  const side_dun = proth.map(x => (x * side_area) / 1000000);
  const side_layer_cost = side_dun.map((d, i) => d * price[i]);

  const jgf = num(input.jgf);
  const zxyf = num(input.zxyf);
  const sh = num(input.sh);
  const lr = num(input.lr);
  const lldj = num(input.lldj);

  const frontMat = front_layer_cost.reduce((a, b) => a + b, 0);
  const sideMat = side_layer_cost.reduce((a, b) => a + b, 0);
  const frontProcess = (jgf * front_area) / 10000;
  const sideProcess = (jgf * side_area) / 10000;

  const zipperCost = num(input.ba_zdf) || ((front_wid * lldj) / 100);
  const frontDunSum = front_dun.reduce((a, b) => a + b, 0);
  const sideDunSum = side_dun.reduce((a, b) => a + b, 0);
  const all_dun = frontDunSum + sideDunSum;
  const freightTotal = ((zxyf * all_dun) / 1000);
  const freightFront = all_dun ? freightTotal * (frontDunSum / all_dun) : 0;
  const freightSide = all_dun ? freightTotal * (sideDunSum / all_dun) : 0;

  const frontCost = (frontMat + frontProcess) * (1 + sh) + zipperCost + freightFront;
  const sideCost = (sideMat + sideProcess) * (1 + sh) + freightSide;
  const frontQuote = frontCost * (1 + lr);
  const sideQuote = sideCost * (1 + lr);
  const finalQuote = frontQuote + sideQuote;

  return {
    z_chang: round(front_len), z_kuang: round(front_wid), z_mian: round(front_area),
    side_chang: round(side_len), side_kuang: round(side_wid), side_mian: round(side_area),
    layerWeightTon: front_dun.map((x, i) => round(x + side_dun[i], 6)),
    layerCost: front_layer_cost.map((x, i) => round(x + side_layer_cost[i], 8)),
    all_dun: round(all_dun, 6),
    materialCost: round(frontMat + sideMat, 8),
    processCost: round(frontProcess + sideProcess, 6),
    zipperCost: round(zipperCost, 6),
    freightCost: round(freightTotal, 6),
    frontMaterialCost: round(frontMat, 8),
    sideMaterialCost: round(sideMat, 8),
    frontProcessCost: round(frontProcess, 6),
    sideProcessCost: round(sideProcess, 6),
    frontFreightCost: round(freightFront, 6),
    sideFreightCost: round(freightSide, 6),
    frontCost: round(frontCost, 6),
    sideCost: round(sideCost, 6),
    frontQuote: round(frontQuote, 6),
    sideQuote: round(sideQuote, 6),
    totalCost: round(frontCost + sideCost, 6),
    finalQuote: round(finalQuote, 6),
    unitCost: all_dun ? round(((frontCost + sideCost) / all_dun) * 1000, 4) : 0
  };
}
function calcIrregularZipperBag(input) {
  // 按基准表“自立异形拉链袋成本核算”对齐
  const ba_chang = num(input.ba_chang);
  const ba_kuang = num(input.ba_kuang);
  const ba_di = num(input.ba_di);
  const irregularHasBottom = num(input.irregular_has_bottom) === 1;
  const thick = pad4(input.thick);
  const price = pad4(input.price);
  const proportion = pad4(input.proportion);
  const proth = thick.map((t, i) => t * proportion[i]);
  const totalThickness = thick.reduce((a,b)=>a+b,0);

  const z_chang_base = ba_chang * 2 + 3;
  const z_chang = z_chang_base + (irregularHasBottom ? (ba_di + 1.5) : 0);
  const z_kuang = ba_kuang + 0.5;
  const layerLengths = [z_chang, z_chang + 0.5, z_chang + 1.0, z_chang + 1.5];
  const layerAreas = layerLengths.map(L => (L * z_kuang) / 10000); // m²

  // 基准表口径：材料重量按“吨”链路计算（与表内数值一致）
  const layerWeightTon = proth.map((x, i) => (x * (layerAreas[i] * 10000)) / 1000000);
  const layerCost = layerWeightTon.map((dun, i) => dun * price[i]);

  const jgf = num(input.jgf);
  const zxyf = num(input.zxyf);
  const sh = num(input.sh);
  const lr = num(input.lr);
  const lldj = num(input.lldj);

  const materialCost = layerCost.reduce((a, b) => a + b, 0);
  const processCost = jgf * layerAreas[0];
  const zipperCost = num(input.ba_zdf) || (((z_kuang + 10) * lldj) / 100); // 基准：+10cm
  const all_dun = layerWeightTon.reduce((a, b) => a + b, 0);

  // 每个袋成本（不含运费）：(材料+加工)*(1+损耗)+拉链
  const costBeforeFreight = (materialCost + processCost) * (1 + sh) + zipperCost;
  const freightPerBag = (zxyf * all_dun) / 1000;
  const finalQuote = costBeforeFreight * (1 + lr) + freightPerBag;
  const unitCost = all_dun ? (costBeforeFreight / all_dun) : 0; // 元/吨成本
  const unitQuote = unitCost * (1 + lr) + zxyf; // 元/吨报价

  return {
    irregularHasBottom,
    z_chang: round(z_chang), z_kuang: round(z_kuang), z_mian: round(layerAreas[0], 6),
    totalThickness: round(totalThickness,4),
    z_chang_2: round(layerLengths[1]), z_chang_3: round(layerLengths[2]), z_chang_4: round(layerLengths[3]),
    z_mian_2: round(layerAreas[1], 6), z_mian_3: round(layerAreas[2], 6), z_mian_4: round(layerAreas[3], 6),
    layerWeightTon: layerWeightTon.map(x => round(x, 8)),
    layerWeightKg: layerWeightTon.map(x => round(x * 1000, 8)),
    layerCost: layerCost.map(x => round(x, 8)),
    all_dun: round(all_dun, 8),
    all_kg: round(all_dun * 1000, 8),
    materialCost: round(materialCost, 8),
    processCost: round(processCost, 8),
    zipperCost: round(zipperCost, 8),
    freightCost: round(freightPerBag, 8),
    totalCost: round(costBeforeFreight, 8),
    finalQuote: round(finalQuote, 9),
    unitCost: round(unitCost, 6),
    unitQuote: round(unitQuote, 6)
  };
} // yixin
function calcStandZipperBag(input) {
  // 按用户要求：自立拉链袋 = 八边封“正面段”核算，去掉侧边段
  const ba_chang = num(input.ba_chang);
  const ba_kuang = num(input.ba_kuang);
  const ba_di = num(input.ba_di);
  const thick = pad4(input.thick);
  const price = pad4(input.price);
  const proportion = pad4(input.proportion);
  const proth = thick.map((t, i) => t * proportion[i]);
  const totalThickness = thick.reduce((a,b)=>a+b,0);

  const z_chang = ba_chang * 2 + 1.5 + ba_di;
  const z_kuang = ba_kuang;
  const layerLengths = [z_chang, z_chang + 0.5, z_chang + 1.0, z_chang + 1.5];
  const layerAreas = layerLengths.map(L => L * z_kuang);
  const z_mian = layerAreas[0];

  const dun = proth.map((x, i) => (x * layerAreas[i]) / 1000000);
  const layerCost = dun.map((d, i) => d * price[i]);

  const jgf = num(input.jgf);
  const zxyf = num(input.zxyf);
  const sh = num(input.sh);
  const lr = num(input.lr);
  const lldj = num(input.lldj);

  const materialCost = layerCost.reduce((a, b) => a + b, 0);
  const processCost = (jgf * z_mian) / 10000;
  const zipperCost = num(input.ba_zdf) || ((z_kuang * lldj) / 100);
  const all_dun = dun.reduce((a, b) => a + b, 0);
  const freightCost = ((zxyf * all_dun) / 1000);
  const totalCost = (materialCost + processCost) * (1 + sh) + zipperCost + freightCost;
  const finalQuote = totalCost * (1 + lr);

  return {
    z_chang: round(z_chang), z_kuang: round(z_kuang), z_mian: round(z_mian),
    totalThickness: round(totalThickness,4),
    z_chang_2: round(layerLengths[1]), z_chang_3: round(layerLengths[2]), z_chang_4: round(layerLengths[3]),
    z_mian_2: round(layerAreas[1]), z_mian_3: round(layerAreas[2]), z_mian_4: round(layerAreas[3]),
    layerWeightTon: dun.map(x => round(x, 6)),
    layerCost: layerCost.map(x => round(x, 8)),
    all_dun: round(all_dun, 6),
    materialCost: round(materialCost, 8),
    processCost: round(processCost, 6),
    zipperCost: round(zipperCost, 6),
    freightCost: round(freightCost, 6),
    totalCost: round(totalCost, 6),
    finalQuote: round(finalQuote, 6),
    unitCost: all_dun ? round((totalCost / all_dun) * 1000, 4) : 0
  };
} // zhili
function calcBackSealBag(input) {
  // 背封/侧边封/四边封共用：按侧边参与核算，不用底
  const i = { ...input, ba_ce: num(input.ba_ce || input.side || 0) };
  const bagMode = String(i.bag_mode || i.subType || 'back_seal'); // back_seal | side_seal | four_side_seal
  const ba_chang = num(i.ba_chang); // 高/长
  const ba_kuang = num(i.ba_kuang); // 宽
  const ba_ce = num(i.ba_ce);       // 侧边
  const thick = pad4(i.thick);
  const price = pad4(i.price);
  const proportion = pad4(i.proportion);
  const proth = thick.map((t, idx) => t * proportion[idx]);
  const totalThickness = thick.reduce((a,b)=>a+b,0);

  // 用户新口径：
  // 背封/侧边封：z_chang=(宽+侧)*2+2+1.5
  // 四边封：z_chang=(宽+侧)*2+1.5
  const base = (ba_kuang + ba_ce) * 2;
  const z_chang = bagMode === 'four_side_seal' ? (base + 1.5) : (base + 2 + 1.5);
  const z_kuang = ba_chang;

  const layerLengths = [z_chang, z_chang + 0.5, z_chang + 1.0, z_chang + 1.5];
  const layerAreas = layerLengths.map(L => (L * z_kuang) / 10000); // m²
  const z_mian = layerAreas[0];

  const layerWeightKg = proth.map((x, idx) => (x * layerAreas[idx]) / 100);
  const layerCost = layerWeightKg.map((kg, idx) => kg * price[idx]);
  const all_kg = layerWeightKg.reduce((a, b) => a + b, 0);
  const materialCost = layerCost.reduce((a, b) => a + b, 0);

  const jgf = num(i.jgf), zxyf = num(i.zxyf), sh = num(i.sh), lr = num(i.lr), lldj = num(i.lldj);
  const processCost = jgf * z_mian;
  // 织带费/拉链单价改为按“高/长”核算（不是宽）
  const zipperCost = num(i.ba_zdf) || ((ba_chang * lldj) / 100);
  const costBeforeFreight = (materialCost + processCost) * (1 + sh) + zipperCost;
  const freightCost = (zxyf * all_kg) / 1000;
  const finalQuote = costBeforeFreight * (1 + lr) + freightCost;
  const unitCost = all_kg ? (costBeforeFreight / all_kg) * 1000 : 0;
  const unitQuote = unitCost * (1 + lr) + zxyf;

  return {
    bagMode,
    z_chang: round(z_chang), z_kuang: round(z_kuang), z_mian: round(z_mian, 6),
    totalThickness: round(totalThickness,4),
    z_chang_2: round(layerLengths[1]), z_chang_3: round(layerLengths[2]), z_chang_4: round(layerLengths[3]),
    z_mian_2: round(layerAreas[1], 6), z_mian_3: round(layerAreas[2], 6), z_mian_4: round(layerAreas[3], 6),
    layerWeightKg: layerWeightKg.map(x => round(x, 8)),
    layerWeightTon: layerWeightKg.map(x => round(x / 1000, 8)),
    layerCost: layerCost.map(x => round(x, 8)),
    all_kg: round(all_kg, 8),
    all_dun: round(all_kg / 1000, 8),
    materialCost: round(materialCost, 8),
    processCost: round(processCost, 8),
    zipperCost: round(zipperCost, 8),
    freightCost: round(freightCost, 8),
    totalCost: round(costBeforeFreight, 8),
    finalQuote: round(finalQuote, 10),
    unitCost: round(unitCost, 6),
    unitQuote: round(unitQuote, 6)
  };
}

// 材料重量核算（clhs）
function calcMaterialWeight(input) {
  const chang = num(input.chang);
  const kuang = num(input.kuang);
  const thick = pad4(input.thick);
  const proportion = pad4(input.proportion);

  const w = thick.map((t, i) => chang * kuang * t * proportion[i] * 0.01);
  const all_w = w.reduce((a, b) => a + b, 0);

  return {
    layerWeightKg: w.map(x => round(x, 6)),
    totalWeightKg: round(all_w, 6),
    totalWeightG: round(all_w * 1000, 3),
    totalThickness: round(thick.reduce((a, b) => a + b, 0), 4)
  };
}

function generateQuote({ quoteType, input, margin = 0.1 }) {
  let calc;
  if (quoteType === 'auto_bag') calc = calcAutoBag(input);
  else if (quoteType === 'eight_side_seal') calc = calcEightSideSeal(input);
  else if (quoteType === 'stand_zipper_bag') calc = calcStandZipperBag(input);
  else if (quoteType === 'irregular_zipper_bag') calc = calcIrregularZipperBag(input);
  else if (quoteType === 'back_seal') calc = calcBackSealBag({ ...input, bag_mode: 'back_seal' });
  else if (quoteType === 'side_seal') calc = calcBackSealBag({ ...input, bag_mode: 'side_seal' });
  else if (quoteType === 'four_side_seal') calc = calcBackSealBag({ ...input, bag_mode: 'four_side_seal' });
  else if (quoteType === 'material_weight') calc = calcMaterialWeight(input);
  else throw new Error('不支持的 quoteType');

  const internalVersion = { quoteType, input, calc, margin, generatedAt: new Date().toISOString() };
  const customerVersion = {
    quoteType,
    finalQuote: calc.finalQuote || null,
    summary: '客户版仅展示报价与规格，不含成本结构。',
    generatedAt: new Date().toISOString()
  };

  return { internalVersion, customerVersion };
}

module.exports = {
  calcAutoBag,
  calcEightSideSeal,
  calcStandZipperBag,
  calcIrregularZipperBag,
  calcBackSealBag,
  calcMaterialWeight,
  generateQuote
};

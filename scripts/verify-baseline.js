const fs = require('fs');
const path = require('path');
const {
  calcAutoBag,
  calcEightSideSeal,
  calcStandZipperBag,
  calcIrregularZipperBag,
  calcMaterialWeight
} = require('../src/services/quoteEngine');

function n(v) { const x = Number(v); return Number.isFinite(x) ? x : 0; }
function r(v, d = 6) { const p = 10 ** d; return Math.round((v + Number.EPSILON) * p) / p; }
function p4(arr) { const a = (arr || []).map(n); while (a.length < 4) a.push(0); return a; }

function expectedSeal(input, { multiArea = false, freightFactor = 1 } = {}) {
  const ba_chang = n(input.ba_chang), ba_kuang = n(input.ba_kuang), ba_di = n(input.ba_di);
  const thick = p4(input.thick), price = p4(input.price), prop = p4(input.proportion);

  const z_chang = ba_chang * 2 + 3.5 + ba_di;
  const z_kuang = ba_kuang + 0.5;
  const z_mian = z_chang * z_kuang;
  const z2 = n(input.z_mian_2) || z_mian;
  const z3 = n(input.z_mian_3) || z_mian;
  const z4 = n(input.z_mian_4) || z_mian;
  const areas = multiArea ? [z_mian, z2, z3, z4] : [z_mian, z_mian, z_mian, z_mian];

  const proth = thick.map((t, i) => t * prop[i]);
  const dun = proth.map((x, i) => (x * areas[i]) / 1000000);
  const layerCost = dun.map((d, i) => d * price[i]);
  const all_dun = dun.reduce((a, b) => a + b, 0);
  const matCost = layerCost.reduce((a, b) => a + b, 0);

  const jgf = n(input.jgf), zxyf = n(input.zxyf), sh = n(input.sh), lr = n(input.lr), lldj = n(input.lldj);
  const zipperCost = n(input.ba_zdf) || ((z_kuang * lldj) / 100);
  const processCost = (jgf * z_mian) / 10000;
  const totalCost = (matCost + processCost) * (1 + sh) + zipperCost;
  const freight = ((zxyf * all_dun) / 1000) * freightFactor;
  const finalQuote = freight + totalCost * (1 + lr);

  return {
    z_chang: r(z_chang, 4),
    z_kuang: r(z_kuang, 4),
    z_mian: r(z_mian, 4),
    all_dun: r(all_dun, 6),
    totalCost: r(totalCost, 2),
    finalQuote: r(finalQuote, 2)
  };
}

function expectedAuto(input) {
  const thick = p4(input.thick), price = p4(input.price), proportion = p4(input.proportion);
  const proth = thick.map((t, i) => t * proportion[i]);
  const allpro = proth.reduce((a, b) => a + b, 0);
  const ratio = proth.map(x => allpro ? x / allpro : 0);
  const dun = ratio.map(x => x * 1000);
  const clcb = dun.map((d, i) => d * price[i]);
  const mdpb1 = proth[0] ? (dun[0] / proth[0]) * 100 : 0;

  const jgf = n(input.jgf), fqfy = n(input.fqfy), yf = n(input.yf), zt = n(input.zt), btzt = n(input.btzt), sh = n(input.sh), lr = n(input.lr);
  const alljgf = jgf * mdpb1;
  const base = alljgf + fqfy + yf + zt + btzt + clcb.reduce((a, b) => a + b, 0);
  const costBeforeProfit = base * (1 + sh);
  const finalQuote = costBeforeProfit * (1 + lr);

  return {
    allpro: r(allpro, 4),
    costBeforeProfit: r(costBeforeProfit, 2),
    finalQuote: r(finalQuote, 2)
  };
}

function expectedWeight(input) {
  const chang = n(input.chang), kuang = n(input.kuang);
  const thick = p4(input.thick), prop = p4(input.proportion);
  const layerWeightKg = thick.map((t, i) => chang * kuang * t * prop[i] * 0.01);
  const totalWeightKg = layerWeightKg.reduce((a, b) => a + b, 0);
  const totalWeightG = totalWeightKg * 1000;
  return {
    totalWeightKg: r(totalWeightKg, 6),
    totalWeightG: r(totalWeightG, 3)
  };
}

function systemCalc(costType, input) {
  if (costType === 'eight_side_seal') return calcEightSideSeal(input);
  if (costType === 'stand_zipper_bag') return calcStandZipperBag(input);
  if (costType === 'irregular_zipper_bag') return calcIrregularZipperBag(input);
  if (costType === 'auto_bag') return calcAutoBag(input);
  if (costType === 'material_weight') return calcMaterialWeight(input);
  throw new Error('unknown costType: ' + costType);
}

function expectedCalc(costType, input) {
  if (costType === 'eight_side_seal') return expectedSeal(input, { multiArea: false, freightFactor: 1 });
  if (costType === 'stand_zipper_bag') return expectedSeal(input, { multiArea: true, freightFactor: 1.1 });
  if (costType === 'irregular_zipper_bag') return expectedSeal(input, { multiArea: false, freightFactor: 1 });
  if (costType === 'auto_bag') return expectedAuto(input);
  if (costType === 'material_weight') return expectedWeight(input);
  throw new Error('unknown costType: ' + costType);
}

function compare(costType, got, exp) {
  const fields = {
    eight_side_seal: ['z_chang', 'z_kuang', 'z_mian', 'all_dun', 'totalCost', 'finalQuote'],
    stand_zipper_bag: ['z_chang', 'z_kuang', 'z_mian', 'all_dun', 'totalCost', 'finalQuote'],
    irregular_zipper_bag: ['z_chang', 'z_kuang', 'z_mian', 'all_dun', 'totalCost', 'finalQuote'],
    auto_bag: ['allpro', 'costBeforeProfit', 'finalQuote'],
    material_weight: ['totalWeightKg', 'totalWeightG']
  }[costType];

  const diffs = [];
  for (const k of fields) {
    const gv = Number(got[k]);
    const ev = Number(exp[k]);
    const delta = Math.abs(gv - ev);
    const ok = delta <= 1e-6;
    if (!ok) diffs.push({ key: k, got: gv, expected: ev, delta });
  }
  return diffs;
}

const casesPath = path.join(__dirname, '..', 'baseline', 'cases.json');
const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));

let failed = 0;
console.log(`Baseline cases: ${cases.length}`);
for (const c of cases) {
  const got = systemCalc(c.costType, c.input);
  const exp = expectedCalc(c.costType, c.input);
  const diffs = compare(c.costType, got, exp);
  if (diffs.length) {
    failed += 1;
    console.log(`❌ ${c.id} (${c.costType})`);
    diffs.forEach(d => console.log(`   - ${d.key}: got=${d.got}, expected=${d.expected}, delta=${d.delta}`));
  } else {
    console.log(`✅ ${c.id} (${c.costType})`);
  }
}

if (failed > 0) {
  console.log(`\nFAILED: ${failed}/${cases.length}`);
  process.exit(1);
}
console.log(`\nPASS: ${cases.length}/${cases.length}`);

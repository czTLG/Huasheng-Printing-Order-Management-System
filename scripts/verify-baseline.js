const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const engine = require('../src/services/quoteEngine');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function calculate(costType, input) {
  switch (costType) {
    case 'auto_bag': return engine.calcAutoBag(input);
    case 'eight_side_seal': return engine.calcEightSideSeal(input);
    case 'stand_zipper_bag': return engine.calcStandZipperBag(input);
    case 'three_side_seal': return engine.calcStandZipperBag({ ...input, ba_di: 0 });
    case 'irregular_zipper_bag': return engine.calcIrregularZipperBag(input);
    case 'back_seal': return engine.calcBackSealBag({ ...input, bag_mode: 'back_seal' });
    case 'side_seal': return engine.calcBackSealBag({ ...input, bag_mode: 'side_seal' });
    case 'four_side_seal': return engine.calcBackSealBag({ ...input, bag_mode: 'four_side_seal' });
    case 'material_weight': return engine.calcMaterialWeight(input);
    default: throw new Error(`不支持的成本类型：${costType}`);
  }
}

function numericFields(value, prefix = '', result = {}) {
  if (Array.isArray(value)) value.forEach((item, index) => numericFields(item, `${prefix}[${index}]`, result));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => numericFields(item, prefix ? `${prefix}.${key}` : key, result));
  else if (typeof value === 'number' && Number.isFinite(value)) result[prefix] = value;
  return result;
}

function main() {
  const baselinePath = process.env.GOLDEN_BASELINE_PATH;
  if (!baselinePath) {
    console.error('缺少 GOLDEN_BASELINE_PATH；私密黄金基线必须位于项目目录之外。');
    process.exit(2);
  }
  const resolved = path.resolve(baselinePath);
  if (!fs.existsSync(resolved)) throw new Error(`私密黄金基线不存在：${resolved}`);
  const baseline = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (baseline.format_version !== 1 || baseline.status !== 'technical_baseline_confirmed' || !Array.isArray(baseline.cases)) throw new Error('私密黄金基线格式或状态不合法');

  const enginePath = path.join(__dirname, '..', 'src', 'services', 'quoteEngine.js');
  const engineHash = sha256(enginePath);
  if (baseline.engine_sha256 && baseline.engine_sha256 !== engineHash) throw new Error(`成本引擎哈希变化：当前=${engineHash}，基线=${baseline.engine_sha256}`);
  if (!baseline.engine_sha256 && process.env.GOLDEN_BASELINE_ALLOW_ENGINE_HASH_INIT !== '1') throw new Error('私密黄金基线缺少成本引擎哈希');

  let failed = 0;
  console.log(`Golden baseline cases: ${baseline.cases.length}`);
  for (const item of baseline.cases) {
    const current = numericFields(calculate(item.cost_type, item.input));
    const expected = numericFields(item.expected);
    const common = Object.keys(expected).filter(key => Object.hasOwn(current, key));
    const diffs = common.filter(key => Math.abs(current[key] - expected[key]) > 1e-6);
    if (!common.length || diffs.length) {
      failed += 1;
      console.log(`❌ ${item.case_id} (${item.cost_type}) 差异字段=${diffs.length || '无共同数值字段'}`);
    } else console.log(`✅ ${item.case_id} (${item.cost_type})`);
  }
  if (failed) { console.log(`\nFAILED: ${failed}/${baseline.cases.length}`); process.exit(1); }
  console.log(`\nPASS: ${baseline.cases.length}/${baseline.cases.length}`);
}

try { main(); } catch (error) { console.error(`黄金基线验证失败：${error.message}`); process.exit(1); }

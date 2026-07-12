#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const engine = require('../src/services/quoteEngine');
process.umask(0o077);

function args(argv) { const o = {}; for (let i = 0; i < argv.length; i += 2) o[argv[i].replace(/^--/, '')] = argv[i + 1]; return o; }
function hashBuffer(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function calculate(type, input) {
  switch (type) {
    case 'auto_bag': return engine.calcAutoBag(input);
    case 'eight_side_seal': return engine.calcEightSideSeal(input);
    case 'stand_zipper_bag': return engine.calcStandZipperBag(input);
    case 'three_side_seal': return engine.calcStandZipperBag({ ...input, ba_di: 0 });
    case 'irregular_zipper_bag': return engine.calcIrregularZipperBag(input);
    case 'back_seal': return engine.calcBackSealBag({ ...input, bag_mode: 'back_seal' });
    case 'side_seal': return engine.calcBackSealBag({ ...input, bag_mode: 'side_seal' });
    case 'four_side_seal': return engine.calcBackSealBag({ ...input, bag_mode: 'four_side_seal' });
    case 'material_weight': return engine.calcMaterialWeight(input);
    default: throw new Error(`不支持的类型：${type}`);
  }
}
function numeric(value, prefix = '', result = {}) {
  if (Array.isArray(value)) value.forEach((item, index) => numeric(item, `${prefix}[${index}]`, result));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => numeric(item, prefix ? `${prefix}.${key}` : key, result));
  else if (typeof value === 'number' && Number.isFinite(value)) result[prefix] = value;
  return result;
}
function matches(saved, current) {
  const a = numeric(saved), b = numeric(current), keys = Object.keys(a).filter(key => Object.hasOwn(b, key));
  return keys.length > 0 && keys.every(key => Math.abs(a[key] - b[key]) <= 1e-6);
}
function main() {
  const opt = args(process.argv.slice(2));
  if (!opt.db || !opt.out) throw new Error('用法：--db <app.db> --out <项目外私密目录>');
  const dbPath = path.resolve(opt.db), out = path.resolve(opt.out);
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  let rows;
  try { rows = db.prepare("SELECT id,cost_type,input_json,result_json,created_at,updated_at FROM cost_snapshots WHERE result_json IS NOT NULL AND trim(result_json) NOT IN ('','{}') ORDER BY cost_type,created_at,id").all(); } finally { db.close(); }
  const groups = {}, rejected = [];
  for (const row of rows) {
    let input, saved, current;
    try { input = JSON.parse(row.input_json); saved = JSON.parse(row.result_json); current = calculate(row.cost_type, input); }
    catch { rejected.push({ id: row.id, cost_type: row.cost_type, reason: 'invalid_or_unsupported' }); continue; }
    if (matches(saved, current)) (groups[row.cost_type] ||= []).push({ ...row, input, saved });
    else rejected.push({ id: row.id, cost_type: row.cost_type, reason: 'replay_mismatch' });
  }
  const cases = [];
  for (const [type, list] of Object.entries(groups).sort()) {
    const picks = [['earliest', 0], ['median', Math.floor((list.length - 1) / 2)], ['latest', list.length - 1]];
    for (const [label, index] of picks) { const row = list[index]; if (!row || cases.some(item => item.source_id === row.id)) continue; cases.push({ case_id: `${type}-${label}`, source_id: row.id, cost_type: type, source_created_at: row.created_at, source_updated_at: row.updated_at, input: row.input, expected: row.saved }); }
  }
  const enginePath = path.join(__dirname, '..', 'src', 'services', 'quoteEngine.js');
  const payload = { format_version: 1, status: 'technical_baseline_confirmed', business_formula_status: 'review_pending', generated_at: new Date().toISOString(), engine_sha256: hashBuffer(fs.readFileSync(enginePath)), selection: '每种类型最早一致、中位一致、最新一致', cases };
  const privatePath = path.join(out, 'private-golden-baseline.json');
  fs.writeFileSync(privatePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  const index = { format_version: 1, generated_at: payload.generated_at, engine_sha256: payload.engine_sha256, private_baseline_sha256: hashBuffer(fs.readFileSync(privatePath)), case_count: cases.length, cases: cases.map(item => ({ case_id: item.case_id, source_id: item.source_id, cost_type: item.cost_type, source_created_at: item.source_created_at, case_sha256: hashBuffer(JSON.stringify({ input: item.input, expected: item.expected })) })), rejected };
  fs.writeFileSync(path.join(out, 'golden-baseline-index.json'), `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
  console.log(`私密黄金基线生成完成：${cases.length} 个案例，排除 ${rejected.length} 条不一致或无效记录`);
}
try { main(); } catch (error) { console.error(`生成失败：${error.message}`); process.exit(1); }

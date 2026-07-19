#!/usr/bin/env node
'use strict';
const fs = require('node:fs');

function emit(body, code = 0) { fs.writeSync(code === 0 ? 1 : 2, `${JSON.stringify(body, null, 2)}\n`); process.exit(code); }
function blocked(reason) { emit({ status: 'blocked', reason }, 3); }
function positive(value, name) { const n = Number(value); if (!Number.isFinite(n) || n <= 0) blocked(`${name} must be a finite number > 0`); return n; }
function round(value, digits = 6) { const factor = 10 ** digits; return Math.round((value + Number.EPSILON) * factor) / factor; }
function sourceIds(value, name) {
  const ids = [...new Set((Array.isArray(value) ? value : []).map(Number).filter(Number.isInteger))];
  if (!ids.length) blocked(`${name} source_message_ids required`);
  return ids;
}

const inputPath = process.argv[2];
const profilePath = process.argv[3] || '/refs/packet-route-profiles.json';
if (!inputPath) blocked('usage: packet-route.js <input.json> [profiles.json]');
let input;
let registry;
try {
  input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  registry = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
} catch (error) { blocked(`unable to read route input/profile: ${error.message}`); }

const profile = (registry.profiles || []).find(row => row.id === String(input.profile_id || '').trim());
if (!profile) blocked('profile_id must match a reviewed route profile');
const allocationWeight = positive(input.allocation_weight_kg ?? input.net_weight_kg, 'allocation_weight_kg');
const exchangeRate = positive(input.exchange_rate_yuan_per_usd, 'exchange_rate_yuan_per_usd');
const fixed = profile.fixed_charges_yuan || {};
const baseTrucking = positive(fixed.trucking, 'profile.fixed_charges_yuan.trucking');
let truckingSurcharge = 0;
if (profile.trucking_surcharge && allocationWeight > Number(profile.trucking_surcharge.threshold_kg)) {
  truckingSurcharge = ((allocationWeight - Number(profile.trucking_surcharge.threshold_kg)) / 1000) * Number(profile.trucking_surcharge.yuan_per_excess_ton);
}
const trucking = baseTrucking + truckingSurcharge;
const declaration = positive(fixed.declaration, 'profile.fixed_charges_yuan.declaration');
const localPort = positive(fixed.local_port, 'profile.fixed_charges_yuan.local_port');
const operation = positive(fixed.operation, 'profile.fixed_charges_yuan.operation');
const originCharges = trucking + declaration + localPort + operation;
const originAllocation = originCharges / allocationWeight;

function calculate(item, index, requireEvidence) {
  const productPrice = positive(item.product_price_yuan_kg, `items[${index}].product_price_yuan_kg`);
  const itemWeight = positive(item.item_weight_kg ?? item.net_weight_kg, `items[${index}].item_weight_kg`);
  const fobYuanKg = productPrice + originAllocation;
  const priceStatus = String(item.price_status || '').trim();
  if (requireEvidence && !['owner_confirmed_manual_snapshot', 'deterministic_calculator_verified'].includes(priceStatus)) blocked(`items[${index}].price_status not accepted`);
  return {
    item_no: Number(item.item_no || index + 1),
    structure: String(item.structure || item.item_summary || `Item ${index + 1}`).trim(),
    item_weight_kg: itemWeight,
    product_price_yuan_kg: productPrice,
    ...(requireEvidence ? { price_status: priceStatus, source_message_ids: sourceIds(item.source_message_ids, `items[${index}]`) } : {}),
    result: {
      fob_yuan_kg: round(fobYuanKg),
      fob_usd_kg: round(fobYuanKg / exchangeRate),
      total_fob_yuan: round(fobYuanKg * itemWeight),
      total_fob_usd: round((fobYuanKg * itemWeight) / exchangeRate)
    }
  };
}

const isBatch = Array.isArray(input.items);
const items = isBatch ? input.items.map((item, index) => calculate(item, index, true)) : [calculate(input, 0, false)];
if (isBatch && !items.length) blocked('items required');
const summary = String(input.item_summary || '本批货物').trim();
const reviewMessage = [
  `请复核以下FOB起运费用：${summary}，暂按${profile.label_cn}（${profile.shipping_mode}）估算。`,
  `费用分摊总货量：${round(allocationWeight, 3)}kg；起运港：${profile.origin_port_cn}。`,
  `当前历史费用：拖车RMB ${round(trucking, 2)}、报关RMB ${round(declaration, 2)}、港杂/local RMB ${round(localPort, 2)}、操作费RMB ${round(operation, 2)}，合计RMB ${round(originCharges, 2)}。`,
  '请确认上述金额现在是否有效，并补充未包含项目、计费单位、有效期及所需单证。'
].join('\n');
const formulas = [
  'origin_charges_yuan = trucking + declaration + local_port + operation',
  'origin_allocation_yuan_kg = origin_charges_yuan / allocation_weight_kg',
  'fob_yuan_kg = product_price_yuan_kg + origin_allocation_yuan_kg',
  'fob_usd_kg = fob_yuan_kg / exchange_rate_yuan_per_usd'
];
const common = {
  status: 'internal_estimate', formula_version: 'matrix-route-v2', profile_version: registry.schema_version,
  ledger_updated_on: registry.ledger_updated_on, trade_term: 'FOB', origin_port: profile.origin_port,
  shipping_mode: profile.shipping_mode, evidence_class: profile.evidence_class,
  normalized_input: { profile_id: profile.id, allocation_weight_kg: allocationWeight, exchange_rate_yuan_per_usd: exchangeRate, item_summary: summary },
  intermediate: { trucking_yuan: round(trucking), trucking_surcharge_yuan: round(truckingSurcharge), declaration_yuan: round(declaration), local_port_yuan: round(localPort), operation_yuan: round(operation), origin_charges_yuan: round(originCharges), origin_allocation_yuan_kg: round(originAllocation) },
  formulas, unresolved_assumptions: profile.unresolved_assumptions || [], source: profile.source,
  requires_forwarder_review: true, forwarder_review_message_cn: reviewMessage
};
if (isBatch) {
  const lines = items.map(item => `${item.item_no}. ${item.structure}｜RMB ${item.product_price_yuan_kg}/kg｜FOB USD/kg ${item.result.fob_usd_kg}`);
  emit({ ...common, items, copyable_internal_message_cn: [`${summary}｜六项一次核算`, ...lines, `口径：(${originCharges}÷${allocationWeight} + 各品项人民币价) ÷ ${exchangeRate}`, '状态：内部估算，货代复核当前起运费用后才能形成正式客户报价。'].join('\n') });
}
const item = items[0];
emit({
  ...common,
  normalized_input: { ...common.normalized_input, product_price_yuan_kg: item.product_price_yuan_kg, item_weight_kg: item.item_weight_kg },
  intermediate: { ...common.intermediate, product_value_yuan: round(item.product_price_yuan_kg * item.item_weight_kg) },
  result: item.result
});

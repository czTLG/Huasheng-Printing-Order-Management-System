#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'packet-route.js');
const profiles = path.resolve(root, '..', '..', '..', 'docs', 'costing', 'packet-route-profiles.json');
const instructions = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
const productionCompose = fs.readFileSync(path.resolve(root, '..', '..', '..', 'runtime-data-matrix-86e2c31', '.runtime', 'vm_debug_ci', 'compose.production.yaml'), 'utf8');

assert.match(instructions, /\/refs\/packet-route\.js/);
assert.match(instructions, /do not ask the user to resend the old fee table/);
assert.match(productionCompose, /packet-route\.js:\/refs\/packet-route\.js:ro/);
assert.match(productionCompose, /packet-route-profiles\.json:\/refs\/packet-route-profiles\.json:ro/);

function run(input) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-route-'));
  const inputPath = path.join(dir, 'input.json');
  fs.writeFileSync(inputPath, JSON.stringify(input));
  const ret = spawnSync(process.execPath, [script, inputPath, profiles], { encoding: 'utf8' });
  let body = null;
  try { body = JSON.parse(ret.stdout || ret.stderr); } catch {}
  return { ...ret, body };
}

{
  const ret = run({
    profile_id: 'shenzhen_lcl_historical_warehouse',
    product_price_yuan_kg: 24.6,
    net_weight_kg: 1000,
    exchange_rate_yuan_per_usd: 7.2,
    item_summary: 'BOPP30+BOPP20卷膜，1000kg'
  });
  assert.equal(ret.status, 0, ret.stderr);
  assert.equal(ret.body.status, 'internal_estimate');
  assert.equal(ret.body.trade_term, 'FOB');
  assert.equal(ret.body.origin_port, 'Shenzhen');
  assert.equal(ret.body.intermediate.origin_charges_yuan, 3720);
  assert.equal(ret.body.result.fob_yuan_kg, 28.32);
  assert.equal(ret.body.result.fob_usd_kg, 3.933333);
  assert.equal(ret.body.requires_forwarder_review, true);
  assert.match(ret.body.forwarder_review_message_cn, /请复核/);
  assert.match(ret.body.forwarder_review_message_cn, /BOPP30\+BOPP20/);
  assert.match(ret.body.forwarder_review_message_cn, /深圳/);
  assert.ok(ret.body.unresolved_assumptions.includes('缺少体积/箱规，暂按历史深圳仓散货起运费用模型估算'));
}

{
  const ret = run({
    profile_id: 'shenzhen_shekou_40hq_reference',
    product_price_yuan_kg: 24.6,
    item_weight_kg: 1000,
    allocation_weight_kg: 20000,
    exchange_rate_yuan_per_usd: 7.2,
    item_summary: '拼柜中的BOPP30+BOPP20卷膜，1000kg'
  });
  assert.equal(ret.status, 0, ret.stderr);
  assert.equal(ret.body.intermediate.origin_charges_yuan, 6750);
  assert.equal(ret.body.intermediate.origin_allocation_yuan_kg, 0.3375);
  assert.equal(ret.body.intermediate.product_value_yuan, 24600);
  assert.equal(ret.body.result.fob_yuan_kg, 24.9375);
  assert.equal(ret.body.result.total_fob_yuan, 24937.5);
  assert.equal(ret.body.normalized_input.item_weight_kg, 1000);
  assert.equal(ret.body.normalized_input.allocation_weight_kg, 20000);
}

{
  const ret = run({
    profile_id: 'shenzhen_shekou_40hq_reference',
    product_price_yuan_kg: 20,
    net_weight_kg: 22000,
    exchange_rate_yuan_per_usd: 7.2,
    item_summary: '卷膜，22000kg'
  });
  assert.equal(ret.status, 0, ret.stderr);
  assert.equal(ret.body.intermediate.trucking_yuan, 3200);
  assert.equal(ret.body.intermediate.origin_charges_yuan, 6850);
  assert.ok(ret.body.unresolved_assumptions.some((row) => row.includes('重量口径')));
}

{
  const ret = run({
    profile_id: 'shenzhen_lcl_historical_warehouse',
    product_price_yuan_kg: 24.6,
    net_weight_kg: 1000
  });
  assert.equal(ret.status, 3);
  assert.equal(ret.body.status, 'blocked');
  assert.match(ret.body.reason, /exchange_rate_yuan_per_usd/);
}

console.log('packet route tests passed');

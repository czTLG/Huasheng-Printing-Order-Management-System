'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-route-batch-'));
try {
  const inputPath = path.join(root, 'input.json');
  fs.writeFileSync(inputPath, JSON.stringify({
    profile_id: 'shenzhen_shekou_40hq_reference',
    allocation_weight_kg: 20000,
    exchange_rate_yuan_per_usd: 6.7677,
    item_summary: 'Amid David 2006 Ltd. six items',
    items: [
      { item_no: 1, structure: 'BOPP30/BOPP20', item_weight_kg: 1000, product_price_yuan_kg: 24.6, price_status: 'owner_confirmed_manual_snapshot', source_message_ids: [572] },
      { item_no: 2, structure: 'BOPP30/PE-EVOH-PE55', item_weight_kg: 1000, product_price_yuan_kg: 37.0046, price_status: 'deterministic_calculator_verified', source_message_ids: [542, 572] },
      { item_no: 3, structure: 'BOPP30/BOPP MET20', item_weight_kg: 1000, product_price_yuan_kg: 25, price_status: 'owner_confirmed_manual_snapshot', source_message_ids: [572] },
      { item_no: 4, structure: 'PET12/AL8/PE55', item_weight_kg: 2500, product_price_yuan_kg: 25.6, price_status: 'owner_confirmed_manual_snapshot', source_message_ids: [572] },
      { item_no: 5, structure: 'PET12/PE40', item_weight_kg: 1000, product_price_yuan_kg: 21.4, price_status: 'owner_confirmed_manual_snapshot', source_message_ids: [572] },
      { item_no: 6, structure: 'BOPP MAT20/PET MET12/PEW55', item_weight_kg: 1000, product_price_yuan_kg: 21.4, price_status: 'owner_confirmed_manual_snapshot', source_message_ids: [572] }
    ]
  }), { mode: 0o600 });
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/packet-route.js'), inputPath, path.resolve(__dirname, '../../../../docs/costing/packet-route-profiles.json')], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.strictEqual(output.status, 'internal_estimate');
  assert.strictEqual(output.items.length, 6);
  assert.strictEqual(output.items[0].result.fob_usd_kg, 3.684782);
  assert.strictEqual(output.items[1].result.fob_usd_kg, 5.517694);
  assert.match(output.copyable_internal_message_cn, /1\. BOPP30\/BOPP20/);
  assert.match(output.copyable_internal_message_cn, /6\. BOPP MAT20\/PET MET12\/PEW55/);
  assert.match(output.copyable_internal_message_cn, /FOB USD\/kg/);
  assert.strictEqual(output.requires_forwarder_review, true);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('PASS matrix route batch');

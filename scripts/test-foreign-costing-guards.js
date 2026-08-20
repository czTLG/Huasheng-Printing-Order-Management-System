const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-cache-guards-'));
process.env.DB_PATH = path.join(tempRoot, 'data', 'app.db');

const {
  runPreCosting,
  evaluatePreCostingReadiness,
  _internals
} = require('../src/services/foreignCostingAssistant');

function completeInput(overrides = {}) {
  return {
    cost_type: 'stand_zipper_bag',
    quoteType: 'stand_zipper_bag',
    ba_chang: 20,
    ba_kuang: 12,
    ba_di: 4,
    quantity_total: 20000,
    quantity_per_variant: 20000,
    variants: 1,
    material_layers: [
      {
        raw_name: 'L1',
        normalized_material: 'L1',
        thickness: 1.2,
        proportion_used: 1.4,
        price_used: 10,
        confidence: 'high',
        needs_confirm: 0
      }
    ],
    thick: [1.2, 0, 0, 0],
    proportion: [1.4, 0, 0, 0],
    price: [10, 0, 0, 0],
    jgf: 0.6,
    zxyf: 0,
    sh: 0.08,
    lr: 0.12,
    lldj: 0,
    ba_zdf: 0,
    zipper_required: false,
    defaulted_fields: [],
    ...overrides
  };
}

function main() {
  assert.strictEqual(_internals.normalizeThicknessToC(12, 'mic'), 1.2);
  assert.strictEqual(_internals.normalizeThicknessToC(1.2, 'C'), 1.2);
  assert.strictEqual(_internals.normalizeThicknessToC(100, 'μm'), 10);

  const parsed = _internals.extractMaterialCandidates('PET 1.2C + PE 100mic');
  assert.deepStrictEqual(parsed.layers.map(layer => layer.thickness_value), [1.2, 10]);

  const incomplete = completeInput({
    material_layers: [{ raw_name: 'L1', thickness: 1.2, proportion_used: null, price_used: null }],
    proportion: [0, 0, 0, 0],
    price: [0, 0, 0, 0]
  });
  const blocked = runPreCosting(incomplete);
  assert.strictEqual(blocked.status, 'blocked');
  assert.strictEqual(blocked.result, null);
  assert.strictEqual(blocked.internalVersion, null);
  assert(blocked.readiness.blocking_fields.some(item => item.field.endsWith('.price_used')));
  assert(blocked.readiness.blocking_fields.some(item => item.field.endsWith('.proportion_used')));

  const defaulted = evaluatePreCostingReadiness(completeInput({ defaulted_fields: ['jgf', 'lr'] }));
  assert.strictEqual(defaulted.status, 'blocked');
  assert(defaulted.blocking_fields.some(item => item.field === 'jgf' && item.reason === 'unconfirmed_default'));
  assert(defaulted.blocking_fields.some(item => item.field === 'lr' && item.reason === 'unconfirmed_default'));

  const cautious = evaluatePreCostingReadiness(completeInput({
    cost_type: 'irregular_zipper_bag',
    quoteType: 'irregular_zipper_bag'
  }));
  assert.strictEqual(cautious.status, 'blocked');
  assert(cautious.blocking_fields.some(item => item.reason === 'manual_template_review_required'));

  const estimate = runPreCosting(completeInput());
  assert.strictEqual(estimate.status, 'internal_estimate');
  assert.strictEqual(estimate.readiness.can_calculate, true);
  assert(Number.isFinite(estimate.internalVersion.calc.finalQuote));
  assert.strictEqual(estimate.customerVersion, null);

  console.log('foreign costing guards: ok');
}

main();

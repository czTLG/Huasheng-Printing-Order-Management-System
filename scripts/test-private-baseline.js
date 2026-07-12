const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { calcMaterialWeight } = require('../src/services/quoteEngine');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'private-baseline-test-'));
const file = path.join(tmp, 'golden.json');
const input = { chang: 0.2, kuang: 0.12, thick: [3, 4, 5, 0], proportion: [0.92, 1.02, 1.12, 0] };

function run(expected, env = {}) {
  const ret = spawnSync(process.execPath, [path.join(root, 'scripts', 'verify-baseline.js')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, ...env }
  });
  assert.strictEqual(ret.status, expected, `status=${ret.status}\nstdout=${ret.stdout}\nstderr=${ret.stderr}`);
  return ret;
}

try {
  const payload = {
    format_version: 1,
    status: 'technical_baseline_confirmed',
    business_formula_status: 'review_pending',
    engine_sha256: '',
    cases: [{ case_id: 'weight-test', source_id: 1, cost_type: 'material_weight', input, expected: calcMaterialWeight(input) }]
  };
  fs.writeFileSync(file, JSON.stringify(payload));
  const ok = run(0, { GOLDEN_BASELINE_PATH: file, GOLDEN_BASELINE_ALLOW_ENGINE_HASH_INIT: '1' });
  assert(ok.stdout.includes('PASS: 1/1'));
  payload.cases[0].expected.totalWeightKg += 1;
  fs.writeFileSync(file, JSON.stringify(payload));
  assert(run(1, { GOLDEN_BASELINE_PATH: file, GOLDEN_BASELINE_ALLOW_ENGINE_HASH_INIT: '1' }).stdout.includes('FAILED: 1/1'));
  assert(run(2, { GOLDEN_BASELINE_PATH: '' }).stderr.includes('GOLDEN_BASELINE_PATH'));
  console.log('PRIVATE BASELINE TEST PASS');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

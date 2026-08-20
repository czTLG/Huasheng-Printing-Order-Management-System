const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-cache-followup-'));
const dbPath = path.join(tempRoot, 'data', 'app.db');
const port = Number(process.env.MATRIX_CACHE_FOLLOWUP_PORT || 19086);
const baseUrl = `http://127.0.0.1:${port}`;

let child;
let stdout = '';
let stderr = '';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch (_) {}
    await sleep(200);
  }
  throw new Error(`health timeout; stdout=${stdout.slice(-800)} stderr=${stderr.slice(-800)}`);
}

async function httpJson(urlPath, { method = 'GET', token, body, expectedStatus = 200 } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  assert.strictEqual(response.status, expectedStatus, `${method} ${urlPath}: ${text}`);
  return json;
}

async function main() {
  const assistantUi = fs.readFileSync(path.join(root, 'frontend-next/src/components/ForeignCostingAssistant.tsx'), 'utf8');
  const legacyUi = fs.readFileSync(path.join(root, 'frontend-next/src/components/Cost.tsx'), 'utf8');
  assert(assistantUi.includes("if (value == null || value.trim() === '') return null;"));
  assert(!assistantUi.includes("if (value == null || value === '') return 0;"));
  assert(legacyUi.includes("if (value == null || value.trim() === '') return null;"));
  assert(!legacyUi.includes('Number(form.ba_chang || 0)'));

  child = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      MATRIX_STREAM_DB_PATH: path.join(tempRoot, 'data', 'matrix-stream.db'),
      DISABLE_CRON: '1',
      FORCE_HTTPS: '0',
      COSTING_AI_PROVIDER: 'mock'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', chunk => { stdout += String(chunk); });
  child.stderr.on('data', chunk => { stderr += String(chunk); });

  await waitForHealth();
  const password = stdout.match(/username=admin password=(\S+)/)?.[1] || 'admin';
  const login = await httpJson('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password }
  });
  const token = login.token;
  assert(token);

  const baseInput = {
    ba_chang: 20,
    ba_kuang: 12,
    ba_di: 4,
    mat1: 'PET',
    thick: [1.2, null, null, null],
    proportion: [1.4, null, null, null],
    price: [10, null, null, null],
    jgf: 0.6,
    zxyf: 0,
    sh: 0.08,
    lr: 0.12,
    lldj: 2,
    ba_zdf: null
  };

  const blocked = await httpJson('/api/cost/calculate', {
    method: 'POST',
    token,
    expectedStatus: 422,
    body: {
      costType: 'stand_zipper_bag',
      input: { ...baseInput, ba_kuang: null }
    }
  });
  assert.strictEqual(blocked.status, 'blocked');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(blocked, 'result'), false);
  assert(blocked.readiness.blocking_fields.some(item => item.field === 'ba_kuang'));

  const estimate = await httpJson('/api/cost/calculate', {
    method: 'POST',
    token,
    body: { costType: 'stand_zipper_bag', input: baseInput }
  });
  assert.strictEqual(estimate.status, 'internal_estimate');
  assert(Number.isFinite(estimate.result.finalQuote));

  const draft = await httpJson('/api/foreign-costing-assistant/draft', {
    method: 'POST',
    token,
    body: {
      text: [
        'Synthetic Test Company, UAE.',
        'Stand-up zipper pouch.',
        'Size 120mm x 200mm x 40mm gusset.',
        'Material: PET 12 micron + PE 60 micron.',
        'Quantity 20000 pcs x 1 variants, total 20000 pcs.',
        'Incoterms EXW.',
        'Destination UAE.'
      ].join(' '),
      quote_input: {
        thick: [1.2, 6, null, null],
        proportion: [1.4, 0.92, null, null],
        price: [10, 9, null, null],
        jgf: 0.65,
        zxyf: 0,
        sh: 0.08,
        lr: 0.12,
        lldj: 2,
        customer_name: 'must-be-ignored',
        ba_chang: 999
      }
    }
  });
  assert.strictEqual(draft.quote_input.ba_chang, 20);
  assert.strictEqual(draft.quote_input.jgf, 0.65);
  assert.strictEqual(draft.quote_input.sh, 0.08);
  assert.strictEqual(draft.quote_input.material_layers[1].thickness, 6);
  assert(draft.quote_input_provenance.applied_fields.includes('jgf'));
  assert(draft.quote_input_provenance.applied_fields.includes('thick[0]'));
  assert(draft.quote_input_provenance.ignored_fields.includes('customer_name'));
  assert(draft.quote_input_provenance.ignored_fields.includes('ba_chang'));
  assert.strictEqual(draft.quote_input.input_provenance.field_sources.jgf, 'reviewed_form');

  const database = new Database(dbPath, { readonly: true });
  try {
    const row = database.prepare('SELECT quote_input_json FROM foreign_costing_drafts WHERE id = ?').get(draft.draft_id);
    const storedInput = JSON.parse(row.quote_input_json);
    assert.strictEqual(storedInput.input_provenance.field_sources.jgf, 'reviewed_form');
    assert(storedInput.input_provenance.revisions.at(-1).ignored_fields.includes('customer_name'));
  } finally {
    database.close();
  }

  console.log('matrix cache follow-up: ok');
}

main()
  .catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (child && !child.killed) child.kill('SIGTERM');
  });

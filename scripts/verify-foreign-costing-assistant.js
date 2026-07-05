const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const { createDraftFromText } = require('../src/services/foreignCostingAssistant');

const root = path.resolve(__dirname, '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foreign-costing-verify-'));
const dbPath = path.join(tmpRoot, 'data', 'app.db');
const port = Number(process.env.VERIFY_FOREIGN_COSTING_PORT || 19084);
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
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch (_) {}
    await sleep(250);
  }
  throw new Error(`health check timeout; stdout=${stdout.slice(-1200)} stderr=${stderr.slice(-1200)}`);
}

async function httpJson(urlPath, { method = 'GET', token, body, expectedStatus = 200 } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = { raw: text };
  }
  if (res.status !== expectedStatus) {
    throw new Error(`${method} ${urlPath} expected ${expectedStatus} got ${res.status}: ${text}`);
  }
  return json;
}

async function login(username, password, expectedStatus = 200) {
  return httpJson('/api/auth/login', {
    method: 'POST',
    expectedStatus,
    body: { username, password },
  });
}

function approxEqual(actual, expected, delta = 1e-6) {
  return Math.abs(Number(actual) - expected) <= delta;
}

function ensureNoForbiddenText(value, label) {
  const text = JSON.stringify(value);
  assert(!text.includes('undefined'), `${label} should not include undefined`);
  assert(!text.includes('NaN'), `${label} should not include NaN`);
  assert(!text.includes('[object Object]'), `${label} should not include [object Object]`);
  assert(!text.includes('正式报价已确认'), `${label} should not include formal quote wording`);
  assert(!text.includes('已发送客户'), `${label} should not include sent-customer wording`);
  assert(!text.includes('自动报价成功'), `${label} should not include auto-quote wording`);
}

async function main() {
  const ferrenoText = `Ferreno Chocolate Industry L.L.C, UAE.
Item No.1 flat bottom pouch / 3D pouch for chocolate hazelnut product.
Filling weight 500g.
Size 165mm W × 245mm H × 40+40mm gusset.
Material 12mic PET + 100mic transparent LDPE + matt varnish.
Zipper shown in artwork.
Artwork will be provided.
Quantity 25,000 pcs × 4 variants, total 100,000 pcs.
Incoterms EXW.
Destination UAE.`;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  child = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      DISABLE_CRON: '1',
      FORCE_HTTPS: '0',
      COSTING_AI_PROVIDER: 'mock'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', chunk => { stdout += String(chunk); });
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  child.on('exit', code => {
    if (code !== 0) stderr += `\n[server-exit] code=${code}`;
  });

  await waitForHealth();

  const pwMatch = stdout.match(/\[db\] Created default admin account\. username=admin password=(\S+)/);
  const adminPwd = pwMatch ? pwMatch[1] : 'admin';
  const adminLogin = await login('admin', adminPwd);
  assert(adminLogin?.token, 'admin login should return token');
  const token = adminLogin.token;

  const parseRet = await httpJson('/api/foreign-costing-assistant/parse', {
    method: 'POST',
    token,
    body: { text: ferrenoText }
  });
  assert.strictEqual(parseRet.status, 'internal_pre_quote');
  assert.strictEqual(parseRet.suggested_cost_type, 'eight_side_seal');
  assert(Array.isArray(parseRet.material_mapping_warnings) && parseRet.material_mapping_warnings.length > 0, 'parse should return material warnings');

  const draftRet = await createDraftFromText(ferrenoText, { provider: 'mock' });

  assert.strictEqual(draftRet.status, 'internal_pre_quote');
  assert.strictEqual(draftRet.suggested_cost_type || draftRet.quote_input?.cost_type || draftRet.quote_input?.quoteType, 'eight_side_seal');
  assert(approxEqual(draftRet.quote_input?.ba_kuang, 16.5), 'ba_kuang should be 16.5 cm');
  assert(approxEqual(draftRet.quote_input?.ba_chang, 24.5), 'ba_chang should be 24.5 cm');
  assert(approxEqual(draftRet.quote_input?.ba_di, 4), 'ba_di should be 4 cm');
  const draftLayers = Array.isArray(draftRet.quote_input?.material_layers) ? draftRet.quote_input.material_layers : [];
  const layerThicknesses = draftLayers.map(layer => Number(layer?.thickness)).filter(Number.isFinite);
  assert(layerThicknesses.includes(1.2) && layerThicknesses.includes(10), 'material_layers should include 1.2 and 10 thickness values');
  assert(!draftLayers.some(layer => /matt varnish/i.test(String(layer?.raw_name || layer?.material_name || ''))), 'matt varnish must not be a material layer');
  assert(Array.isArray(draftRet.quote_input?.surface_finish) && draftRet.quote_input.surface_finish.some(v => /matt varnish/i.test(String(v))), 'matt varnish should be in surface_finish');
  assert.strictEqual(Number(draftRet.quote_input?.quantity_total), 100000);
  assert.strictEqual(Number(draftRet.quote_input?.quantity_per_variant), 25000);
  assert.strictEqual(Number(draftRet.quote_input?.variants), 4);
  assert.strictEqual(String(draftRet.quote_input?.trade_term_requested || '').toUpperCase(), 'EXW');
  assert(Array.isArray(draftRet.quote_input?.material_mapping_warnings) && draftRet.quote_input.material_mapping_warnings.length > 0, 'material_mapping_warnings should exist');
  assert(Array.isArray(draftRet.calculation_table) && draftRet.calculation_table.length > 0, 'calculation_table should exist');
  assert(draftRet.father_review_panel && typeof draftRet.father_review_panel === 'object', 'father_review_panel should exist');
  assert(
    Object.prototype.hasOwnProperty.call(draftRet.father_review_panel, 'father_note') ||
    Object.prototype.hasOwnProperty.call(draftRet.father_review_panel, 'fatherNote'),
    'father_note field should exist'
  );
  assert(
    Object.prototype.hasOwnProperty.call(draftRet.father_review_panel, 'father_correction_note') ||
    Object.prototype.hasOwnProperty.call(draftRet.father_review_panel, 'fatherCorrectionNote'),
    'father_correction_note field should exist'
  );

  const warningsText = JSON.stringify(draftRet);
  [
    'final artwork not provided',
    'printing colors not confirmed',
    'gold effect not confirmed',
    '4 variants may require 4 sets of cylinders',
    'zipper cost needs father confirmation',
    'jgf need father confirmation',
    'material LDPE Tr. / transparent LDPE mapping needs father confirmation'
  ].forEach(msg => {
    assert(warningsText.toLowerCase().includes(msg.toLowerCase()), `missing warning: ${msg}`);
  });
  assert(/transparent ldpe|ldpe tr/i.test(warningsText) && /确认|confirm/i.test(warningsText), 'material mapping confirmation warning should mention transparent LDPE / LDPE Tr.');
  assert((draftRet.quote_input?.default_notes || []).includes('jgf 使用系统默认值，需复核'), 'default notes should mention jgf');
  assert((draftRet.quote_input?.default_notes || []).includes('sh 使用系统默认值，需复核'), 'default notes should mention sh');
  assert((draftRet.quote_input?.default_notes || []).includes('lr 使用系统默认值，需复核'), 'default notes should mention lr');
  ensureNoForbiddenText({ parseRet, draftRet }, 'draft response');

  const dbInsert = new Database(dbPath);
  let insertedDraftId = null;
  try {
    const result = dbInsert.prepare(`
      INSERT INTO foreign_costing_drafts (
        crm_inquiry_id, customer_id, customer_name, source_text, parsed_spec_json,
        material_mapping_json, quote_input_json, quote_result_json, calculation_table_json,
        ai_provider, ai_model, status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      null,
      null,
      String(draftRet.quote_input?.customer_name || ''),
      ferrenoText,
      JSON.stringify(draftRet.parsed_spec || {}),
      JSON.stringify(draftRet.material_mapping_json || draftRet.material_mapping || []),
      JSON.stringify(draftRet.quote_input || {}),
      JSON.stringify(draftRet.quote_result || {}),
      JSON.stringify(draftRet.calculation_table || []),
      'mock',
      'mock',
      'internal_pre_quote',
      'admin',
      new Date().toISOString().slice(0, 19).replace('T', ' '),
      new Date().toISOString().slice(0, 19).replace('T', ' ')
    );
    insertedDraftId = result.lastInsertRowid;
  } finally {
    dbInsert.close();
  }

  const reviewRet = await httpJson('/api/foreign-costing-assistant/review', {
    method: 'POST',
    token,
    body: {
      draft_id: insertedDraftId,
      father_note: '金色先按普通印刷，4款版费分开算。',
      father_correction_note: 'LDPE Tr. 后续默认映射 PE/透明PE，但必须提示确认单价。',
      approved_unit_price: '0.12',
      approved_total_price: '12.00',
      changed_fields: { jgf: 'system default', material_mapping: 'LDPE Tr. -> PE' }
    }
  });
  assert.strictEqual(reviewRet.status, 'reviewed');

  const db = new Database(dbPath, { readonly: true });
  try {
    const reviewRow = db.prepare(`
      SELECT father_note, father_correction_note, approved_unit_price, approved_total_price, changed_fields_json, status
      FROM foreign_costing_reviews
      ORDER BY id DESC
      LIMIT 1
    `).get();
    assert(reviewRow, 'review row should exist');
    assert.strictEqual(reviewRow.father_note, '金色先按普通印刷，4款版费分开算。');
    assert.strictEqual(reviewRow.father_correction_note, 'LDPE Tr. 后续默认映射 PE/透明PE，但必须提示确认单价。');
    assert.strictEqual(Number(reviewRow.approved_unit_price), 0.12);
    assert.strictEqual(Number(reviewRow.approved_total_price), 12);
    assert.strictEqual(reviewRow.status, 'reviewed');
    assert(String(reviewRow.changed_fields_json || '').includes('jgf'));
  } finally {
    db.close();
  }

  ensureNoForbiddenText(reviewRet, 'review response');

  console.log(JSON.stringify({
    status: 'ok',
    parse: {
      status: parseRet.status,
      suggested_cost_type: parseRet.suggested_cost_type
    },
    draft: {
      draft_id: insertedDraftId,
      suggested_cost_type: draftRet.suggested_cost_type || draftRet.quote_input?.cost_type || draftRet.quote_input?.quoteType,
      ba_kuang: draftRet.quote_input?.ba_kuang,
      ba_chang: draftRet.quote_input?.ba_chang,
      ba_di: draftRet.quote_input?.ba_di,
      variants: draftRet.quote_input?.variants,
      quantity_total: draftRet.quote_input?.quantity_total,
      quantity_per_variant: draftRet.quote_input?.quantity_per_variant
    },
    review: reviewRet
  }, null, 2));
}

main()
  .catch(err => {
    console.error('VERIFY FAIL');
    console.error(err.stack || err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (child && !child.killed) {
      child.kill('SIGTERM');
      await sleep(300);
      if (!child.killed) child.kill('SIGKILL');
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

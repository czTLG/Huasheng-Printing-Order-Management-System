const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const { createDraftFromText } = require('../src/services/foreignCostingAssistant');

const root = path.resolve(__dirname, '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'packaging-smoke-'));
const dbPath = path.join(tmpRoot, 'data', 'app.db');
const port = Number(process.env.SMOKE_PORT || 19081);
const baseUrl = `http://127.0.0.1:${port}`;

let child;
let stderr = '';
let stdout = '';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function todayMd() {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
}

function approxEqual(actual, expected, delta = 1e-6) {
  return Math.abs(Number(actual) - expected) <= delta;
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
  throw new Error(`health check timeout; stdout=${stdout.slice(-1000)} stderr=${stderr.slice(-1000)}`);
}

async function httpJson(urlPath, { method = 'GET', token, body, expectedStatus = 200 } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text }; }
  if (res.status !== expectedStatus) {
    throw new Error(`${method} ${urlPath} expected ${expectedStatus} got ${res.status}: ${text}`);
  }
  return json;
}

async function httpResponse(urlPath, { method = 'GET', token, body, expectedStatus = 200 } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (res.status !== expectedStatus) {
    const text = await res.text();
    throw new Error(`${method} ${urlPath} expected ${expectedStatus} got ${res.status}: ${text}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return { headers: res.headers, buffer, status: res.status };
}

async function login(username, password, expectedStatus = 200) {
  return httpJson('/api/auth/login', {
    method: 'POST',
    expectedStatus,
    body: { username, password }
  });
}

function assertForeignTradeAssistantTables() {
  const db = new Database(dbPath, { readonly: true });
  try {
    const requiredTables = [
      'material_aliases',
      'foreign_costing_drafts',
      'foreign_costing_reviews'
    ];
    const missing = requiredTables.filter(name => {
      const row = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`
      ).get(name);
      return !row;
    });
    assert.strictEqual(
      missing.length,
      0,
      `missing assistant tables: ${missing.join(', ')}`
    );
  } finally {
    db.close();
  }
}

async function assertForeignCostingAssistantFlow(token) {
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

  const parseRet = await httpJson('/api/foreign-costing-assistant/parse', {
    method: 'POST',
    token,
    body: { text: ferrenoText }
  });
  assert.strictEqual(parseRet.status, 'internal_pre_quote', 'foreign costing parse should stay internal');
  assert.strictEqual(parseRet.suggested_cost_type || '', 'eight_side_seal', 'Ferreno sample should map to eight_side_seal');
  assert(Array.isArray(parseRet.material_mapping_warnings) && parseRet.material_mapping_warnings.length > 0, 'parse should include material mapping warnings');

  const draftRet = await createDraftFromText(ferrenoText, { provider: 'mock' });
  assert.strictEqual(draftRet.status, 'internal_pre_quote', 'foreign costing draft should stay internal');
  assert.strictEqual(draftRet.suggested_cost_type || draftRet.quote_input?.cost_type || draftRet.quote_input?.quoteType || '', 'eight_side_seal', 'draft should map to eight_side_seal');
  assert.strictEqual(Number(draftRet.quote_input?.ba_kuang), 16.5, 'Ferreno width should normalize to 16.5 cm');
  assert.strictEqual(Number(draftRet.quote_input?.ba_chang), 24.5, 'Ferreno height should normalize to 24.5 cm');
  assert.strictEqual(Number(draftRet.quote_input?.ba_di), 4, 'Ferreno gusset should normalize to 4 cm');
  const draftLayers = Array.isArray(draftRet.quote_input?.material_layers) ? draftRet.quote_input.material_layers : [];
  assert(draftLayers.some(layer => approxEqual(layer?.thickness, 1.2)), 'draft should include PET 1.2 thickness value');
  assert(draftLayers.some(layer => approxEqual(layer?.thickness, 10)), 'draft should include LDPE 10 thickness value');
  assert(Array.isArray(draftRet.quote_input?.surface_finish) && draftRet.quote_input.surface_finish.some(v => String(v).toLowerCase().includes('matt varnish')), 'matt varnish should remain a surface finish');
  assert.strictEqual(Number(draftRet.quote_input?.quantity_total), 100000, 'Ferreno total quantity should be 100000');
  assert.strictEqual(Number(draftRet.quote_input?.quantity_per_variant), 25000, 'Ferreno per-variant quantity should be 25000');
  assert.strictEqual(Number(draftRet.quote_input?.variants), 4, 'Ferreno variants should be 4');
  assert.strictEqual(String(draftRet.quote_input?.trade_term_requested || '').toUpperCase(), 'EXW', 'Ferreno trade term should be EXW');
  assert(Array.isArray(draftRet.quote_input?.material_mapping_warnings) && draftRet.quote_input.material_mapping_warnings.length > 0, 'draft should include material mapping warnings');
  assert(Array.isArray(draftRet.calculation_table) && draftRet.calculation_table.length > 0, 'draft should include calculation table');
  assert(draftRet.father_review_panel && typeof draftRet.father_review_panel === 'object', 'draft should include father review panel');
  assert(
    Object.prototype.hasOwnProperty.call(draftRet.father_review_panel, 'father_note') ||
    Object.prototype.hasOwnProperty.call(draftRet.father_review_panel, 'fatherNote'),
    'draft should expose father_note field'
  );
  assert(
    Object.prototype.hasOwnProperty.call(draftRet.father_review_panel, 'father_correction_note') ||
    Object.prototype.hasOwnProperty.call(draftRet.father_review_panel, 'fatherCorrectionNote'),
    'draft should expose father_correction_note field'
  );

  const joinedWarnings = JSON.stringify(draftRet);
  [
    'final artwork not provided',
    'printing colors not confirmed',
    'gold effect not confirmed',
    '4 variants may require 4 sets of cylinders',
    'zipper cost needs father confirmation',
    'jgf need father confirmation'
  ].forEach(msg => {
    assert(joinedWarnings.toLowerCase().includes(msg.toLowerCase().replace(/\s+/g, ' ')), `draft should include warning: ${msg}`);
  });
  assert(/transparent ldpe|ldpe tr/i.test(joinedWarnings) && /确认|confirm/i.test(joinedWarnings), 'draft should include transparent LDPE / LDPE Tr. mapping warning');
  assert((draftRet.quote_input?.default_notes || []).includes('jgf 使用系统默认值，需复核'), 'draft should include jgf default note');
  assert((draftRet.quote_input?.default_notes || []).includes('sh 使用系统默认值，需复核'), 'draft should include sh default note');
  assert((draftRet.quote_input?.default_notes || []).includes('lr 使用系统默认值，需复核'), 'draft should include lr default note');
  assert(!joinedWarnings.includes('undefined'), 'draft should not include undefined');
  assert(!joinedWarnings.includes('NaN'), 'draft should not include NaN');
  assert(!joinedWarnings.includes('[object Object]'), 'draft should not include [object Object]');
  assert(!joinedWarnings.includes('正式报价已确认'), 'draft should not include formal quote confirmation wording');
  assert(!joinedWarnings.includes('已发送客户'), 'draft should not include sent customer wording');
  assert(!joinedWarnings.includes('自动报价成功'), 'draft should not include automatic quote wording');

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
  assert.strictEqual(reviewRet.status, 'reviewed', 'review endpoint should return reviewed');
  assert(reviewRet.review_id || reviewRet.id, 'review endpoint should return review id');

  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare(`
      SELECT father_note, father_correction_note, approved_unit_price, approved_total_price, changed_fields_json, status
      FROM foreign_costing_reviews
      ORDER BY id DESC
      LIMIT 1
    `).get();
    assert(row, 'review row should be saved');
    assert.strictEqual(row.father_note, '金色先按普通印刷，4款版费分开算。', 'saved review should persist father_note');
    assert.strictEqual(row.father_correction_note, 'LDPE Tr. 后续默认映射 PE/透明PE，但必须提示确认单价。', 'saved review should persist father_correction_note');
    assert.strictEqual(Number(row.approved_unit_price), 0.12, 'saved review should persist approved_unit_price');
    assert.strictEqual(Number(row.approved_total_price), 12, 'saved review should persist approved_total_price');
    assert.strictEqual(row.status, 'reviewed', 'saved review should persist reviewed status');
    assert(String(row.changed_fields_json || '').includes('jgf'), 'saved review should persist changed_fields');
  } finally {
    db.close();
  }
}

async function main() {
  const datedProductName = `柠檬凤爪 ${todayMd()}`;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartSql = todayStart.toISOString().slice(0, 19).replace('T', ' ');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const legacyLoginHtml = fs.readFileSync(path.join(root, 'public', 'legacy-login.html'), 'utf8');
  assert(
    legacyLoginHtml.includes("location.href='/legacy-app.html?ui=classic'"),
    'legacy login should redirect directly to legacy classic app after successful login'
  );

  child = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      DISABLE_CRON: '1',
      FORCE_HTTPS: '0',
      ALIYUN_MAIL_IMAP_HOST: '',
      ALIYUN_MAIL_IMAP_PORT: '',
      ALIYUN_MAIL_IMAP_SECURE: '',
      ALIYUN_MAIL_USER: '',
      ALIYUN_MAIL_PASSWORD: '',
      ALIYUN_MAIL_SYNC_DAYS: '',
      ALIYUN_MAIL_SYNC_LIMIT: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', chunk => { stdout += String(chunk); });
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  child.on('exit', code => {
    if (code !== 0) stderr += `\n[server-exit] code=${code}`;
  });

  await waitForHealth();
  assertForeignTradeAssistantTables();

  // Extract randomly generated admin password from server stdout
  const pwMatch = stdout.match(/\[db\] Created default admin account\. username=admin password=(\S+)/);
  const adminPwd = pwMatch ? pwMatch[1] : 'admin';

  await login('admin', 'wrong-password', 401);
  const adminLogin = await login('admin', adminPwd);
  assert(adminLogin?.token, 'admin login should return token');
  const adminToken = adminLogin.token;

  await assertForeignCostingAssistantFlow(adminToken);

  const me = await httpJson('/api/auth/me', { token: adminToken });
  assert.strictEqual(me.user.username, 'admin');
  assert.strictEqual(me.user.role, 'super_admin');
  assert.deepStrictEqual(me.user.permissions, { all: true, capabilities: { matrixSend: false } });

  await httpJson('/api/orders', { expectedStatus: 401 });

  await httpJson('/api/auth/register', {
    method: 'POST',
    body: { username: 'chenyongjie', password: 'guard123', fullName: '成本守护' }
  });
  await httpJson('/api/auth/register', {
    method: 'POST',
    body: { username: 'worker_print_guard', password: 'guard123', fullName: '印刷守护' }
  });
  await httpJson('/api/auth/register', {
    method: 'POST',
    body: { username: 'sales_scope_guard', password: 'guard123', fullName: '权限守护' }
  });
  await httpJson('/api/auth/register', {
    method: 'POST',
    body: { username: 'crm_admin_guard', password: 'guard123', fullName: '外贸守护' }
  });
  await httpJson('/api/auth/register', {
    method: 'POST',
    body: { username: 'father_costing_guard', password: 'guard123', fullName: '父亲核价' }
  });
  await httpJson('/api/auth/register', {
    method: 'POST',
    body: { username: 'freight_guard', password: 'guard123', fullName: '物流守护' }
  });

  const pending = await httpJson('/api/auth/users/pending', { token: adminToken });
  const costUser = pending.find(row => row.username === 'chenyongjie');
  const workerUser = pending.find(row => row.username === 'worker_print_guard');
  const scopedSalesUser = pending.find(row => row.username === 'sales_scope_guard');
  const crmAdminUser = pending.find(row => row.username === 'crm_admin_guard');
  const costingUser = pending.find(row => row.username === 'father_costing_guard');
  const freightUser = pending.find(row => row.username === 'freight_guard');
  assert(costUser, 'pending cost user should exist');
  assert(workerUser, 'pending worker user should exist');
  assert(scopedSalesUser, 'pending scoped sales user should exist');
  assert(crmAdminUser, 'pending crm admin user should exist');
  assert(costingUser, 'pending costing user should exist');
  assert(freightUser, 'pending freight user should exist');

  await httpJson(`/api/auth/users/${costUser.id}/approve`, {
    method: 'POST',
    token: adminToken,
    body: { role: 'manager' }
  });
  await httpJson(`/api/auth/users/${workerUser.id}/approve`, {
    method: 'POST',
    token: adminToken,
    body: { role: 'worker_print' }
  });
  await httpJson(`/api/auth/users/${scopedSalesUser.id}/approve`, {
    method: 'POST',
    token: adminToken,
    body: {
      role: 'ai_sales',
      permissions: {
        modules: { orders: true, workorder: true, board: false, cost: false, stats: false, admin: false }
      }
    }
  });
  await httpJson(`/api/auth/users/${crmAdminUser.id}/approve`, {
    method: 'POST',
    token: adminToken,
    body: { role: 'foreign_trade_crm_admin' }
  });
  await httpJson(`/api/auth/users/${costingUser.id}/approve`, {
    method: 'POST',
    token: adminToken,
    body: { role: 'costing_user' }
  });
  await httpJson(`/api/auth/users/${freightUser.id}/approve`, {
    method: 'POST',
    token: adminToken,
    body: { role: 'freight_user' }
  });

  const costLogin = await login('chenyongjie', 'guard123');
  assert(costLogin?.token, 'cost user login should return token');
  const scopedSalesLogin = await login('sales_scope_guard', 'guard123');
  const scopedSalesMe = await httpJson('/api/auth/me', { token: scopedSalesLogin.token });
  assert.deepStrictEqual(scopedSalesMe.user.permissions, {
    modules: { orders: true, workorder: true, board: false, cost: false, stats: false, admin: false, crm: false },
    ordersStages: ['印刷', '复膜', '制袋', '发货', '完成', '全部'],
    boardStages: [],
    capabilities: { matrixSend: false }
  });

  const crmAdminLogin = await login('crm_admin_guard', 'guard123');
  assert(crmAdminLogin?.token, 'crm admin login should return token');
  const crmAdminMe = await httpJson('/api/auth/me', { token: crmAdminLogin.token });
  assert.strictEqual(crmAdminMe.user.role, 'foreign_trade_crm_admin');
  assert.strictEqual(crmAdminMe.user.permissions.modules.crm, true, 'crm admin role should have crm module');
  assert.strictEqual(crmAdminMe.user.permissions.modules.orders, true, 'crm admin role should retain basic order visibility');
  const boundaryOrder = await httpJson('/api/orders', {
    method: 'POST',
    token: adminToken,
    body: {
      customerName: 'CRM 边界守护客户',
      bagType: '三边封袋',
      useCase: 'CRM 边界删除校验',
      size: { length: 10, width: 12 },
      orderQty: '1000',
      orderSpec: '10*12'
    }
  });
  assert.strictEqual(boundaryOrder.ok, true);
  assert(Number(boundaryOrder.id) > 0, 'boundary order id should be > 0');
  await httpJson(`/api/orders/${boundaryOrder.id}`, {
    method: 'DELETE',
    token: crmAdminLogin.token,
    expectedStatus: 403
  });
  await httpJson(`/api/orders/${boundaryOrder.id}`, {
    method: 'DELETE',
    token: adminToken
  });
  const adminDashboardRes = await httpResponse('/api/crm/dashboard', { token: adminToken });
  const adminDashboardText = adminDashboardRes.buffer.toString('utf8');
  assert(!adminDashboardText.includes('<!DOCTYPE html>'), 'crm dashboard should not return html');
  assert(
    String(adminDashboardRes.headers.get('content-type') || '').includes('application/json'),
    'crm dashboard should return json content type'
  );
  const adminDashboard = JSON.parse(adminDashboardText);
  assert(adminDashboard.summary && typeof adminDashboard.summary === 'object', 'crm dashboard should include summary');
  assert(Array.isArray(adminDashboard.today_tasks), 'crm dashboard should include today_tasks array');
  assert.strictEqual(typeof adminDashboard.summary.total_customers, 'number', 'crm dashboard total_customers should be a number');
  assert.strictEqual(typeof adminDashboard.summary.pending_quotation_drafts, 'number', 'crm dashboard pending_quotation_drafts should be a number');
  assert.strictEqual(typeof adminDashboard.summary.quote_readiness_ready, 'number', 'crm dashboard quote_readiness_ready should be in summary');
  const crmAdminDashboard = await httpJson('/api/crm/dashboard', { token: crmAdminLogin.token });
  assert(crmAdminDashboard.summary && typeof crmAdminDashboard.summary === 'object', 'crm admin dashboard should include summary');
  await httpJson('/api/crm/dashboard', { token: scopedSalesLogin.token, expectedStatus: 403 });
  const costingLogin = await login('father_costing_guard', 'guard123');
  assert(costingLogin?.token, 'costing user login should return token');
  const costingMe = await httpJson('/api/auth/me', { token: costingLogin.token });
  assert.strictEqual(costingMe.user.role, 'costing_user');
  assert.strictEqual(costingMe.user.permissions.modules.crm, false, 'costing user should not have full crm menu module');
  const freightLogin = await login('freight_guard', 'guard123');
  assert(freightLogin?.token, 'freight user login should return token');
  const freightMe = await httpJson('/api/auth/me', { token: freightLogin.token });
  assert.strictEqual(freightMe.user.role, 'freight_user');
  assert.strictEqual(freightMe.user.permissions.modules.crm, false, 'freight user should not have full crm menu module');

  await httpJson('/api/crm/customers', { token: scopedSalesLogin.token, expectedStatus: 403 });

  const crmCustomer = await httpJson('/api/crm/customers', {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      company_name: 'CRM 守护客户',
      contact_person: 'Alice',
      email: 'alice@example.com',
      whatsapp: '+8613800138000',
      country: 'Thailand',
      priority: 'A',
      stage: 'qualified',
      next_action: '确认规格'
    }
  });
  assert.strictEqual(crmCustomer.ok, true);
  const crmCustomerId = Number(crmCustomer.id);
  assert(crmCustomerId > 0, 'created crm customer id should be > 0');

  const crmCustomerList = await httpJson('/api/crm/customers?q=CRM', { token: crmAdminLogin.token });
  assert(Array.isArray(crmCustomerList.rows), 'crm customer list should return rows');
  assert(crmCustomerList.rows.some(row => Number(row.id) === crmCustomerId), 'created crm customer should be listed');

  await httpJson(`/api/crm/customers/${crmCustomerId}`, {
    method: 'PATCH',
    token: crmAdminLogin.token,
    body: { priority: 'B', risk_notes: '需要确认付款条款' }
  });

  const communication = await httpJson(`/api/crm/customers/${crmCustomerId}/communications`, {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      channel: 'whatsapp',
      direction: 'inbound',
      sender: 'Alice',
      recipient: 'crm_admin_guard',
      subject: 'Stand up pouch inquiry',
      raw_content: 'Need 50000 stand up pouches with zipper.',
      received_at: '2026-06-24 10:00:00'
    }
  });
  assert.strictEqual(communication.ok, true);

  const inquiry = await httpJson('/api/crm/inquiries', {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      customer_id: crmCustomerId,
      inquiry_title: '50000 zipper stand up pouches',
      product_type: 'pouch',
      packaging_type: 'stand_up_zipper_bag',
      quantity: '50000',
      destination_country: 'Thailand',
      priority: 'A',
      next_action: '发起规格确认'
    }
  });
  assert.strictEqual(inquiry.ok, true);
  const inquiryId = Number(inquiry.id);
  assert(inquiryId > 0, 'created inquiry id should be > 0');

  const customerDetail = await httpJson(`/api/crm/customers/${crmCustomerId}`, { token: crmAdminLogin.token });
  assert.strictEqual(Number(customerDetail.customer.latest_inquiry_id), inquiryId, 'customer should reference latest inquiry');
  assert.strictEqual(Number(customerDetail.latestInquiry.id), inquiryId, 'customer detail should include latest inquiry');
  assert.strictEqual(customerDetail.customer.stage, 'ready_to_quote', 'legacy qualified stage should normalize to ready_to_quote');
  const quoteReadinessBeforeSpec = await httpJson(`/api/crm/inquiries/${inquiryId}/quote-readiness`, { token: crmAdminLogin.token });
  assert.strictEqual(quoteReadinessBeforeSpec.quote_readiness.status, 'blocked', 'inquiry without complete specification should be blocked');
  assert(Array.isArray(quoteReadinessBeforeSpec.quote_readiness.missing_required_fields), 'quote readiness should expose missing required fields');
  await httpJson(`/api/crm/inquiries/${inquiryId}/quote-readiness`, { token: scopedSalesLogin.token, expectedStatus: 403 });

  const barrierInquiry = await httpJson('/api/crm/inquiries', {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      customer_id: crmCustomerId,
      inquiry_title: 'High barrier dry-food pouch',
      product_type: 'instant oats packaging pouch',
      packaging_type: 'stand_up_zipper_bag',
      quantity: '30000 pcs',
      destination_country: 'Bangladesh',
      trade_term_requested: 'EXW',
      priority: 'B',
      next_action: 'Confirm barrier structure'
    }
  });
  assert.strictEqual(barrierInquiry.ok, true);
  const barrierInquiryId = Number(barrierInquiry.id);
  assert(barrierInquiryId > 0, 'barrier inquiry id should be > 0');

  const barrierSpec = await httpJson(`/api/crm/inquiries/${barrierInquiryId}/specifications`, {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      product_type: 'instant oats packaging pouch',
      bag_type: 'stand-up zipper pouch',
      film_type: 'high barrier matte laminated pouch',
      size_width: '15 cm / 18 cm',
      size_height: '25 cm / 30 cm',
      gusset_size: '8 cm / 10 cm',
      thickness_total: '100-120 microns',
      thickness_unit: 'micron',
      material_structure_text: 'ALOX / matte high barrier',
      printing_colors: 'CMYK 4-5 colors',
      surface_finish: 'soft matte',
      zipper_required: true,
      window_required: true,
      artwork_status: 'ready',
      notes: '24 months shelf life'
    }
  });
  assert.strictEqual(barrierSpec.ok, true);
  const barrierReadiness = await httpJson(`/api/crm/inquiries/${barrierInquiryId}/quote-readiness`, { token: crmAdminLogin.token });
  assert(['partial', 'technical_check'].includes(barrierReadiness.quote_readiness.status), 'high barrier dry-food inquiry should not be blocked');
  assert(!String(barrierReadiness.quote_readiness.warnings || []).includes('蒸煮'), 'high barrier dry-food inquiry should not mention retort/boiling warnings');
  assert(!String(barrierReadiness.quote_readiness.warnings || []).includes('冷冻'), 'high barrier dry-food inquiry should not mention frozen warnings');
  assert.strictEqual(barrierReadiness.quote_readiness.next_action, 'Confirm final barrier structure, MOQ, and quotation scope.', 'high barrier dry-food inquiry should use a barrier review next action');

  const researchNote = await httpJson(`/api/crm/customers/${crmCustomerId}/research-notes`, {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      source_type: 'codex_parsed',
      title: 'Buyer background note',
      research_summary: '客户主营宠物零食包装，重点关注高阻隔自立拉链袋。',
      customer_type: 'brand_owner',
      industry: 'pet_food',
      main_products: 'pet snack pouch',
      website: 'https://example.com',
      risk_flags: '需确认付款习惯与采购决策链',
      suggested_priority: 'A',
      suggested_next_action: '继续确认规格和目标价'
    }
  });
  assert.strictEqual(researchNote.ok, true);
  const researchList = await httpJson(`/api/crm/customers/${crmCustomerId}/research-notes`, { token: crmAdminLogin.token });
  assert(Array.isArray(researchList.rows), 'research notes should return rows');
  assert(researchList.rows.some(row => Number(row.id) === Number(researchNote.id)), 'created research note should be listed');
  await httpJson(`/api/crm/customers/${crmCustomerId}/research-notes`, { token: scopedSalesLogin.token, expectedStatus: 403 });
  await httpJson('/api/crm/customer-priority', { token: scopedSalesLogin.token, expectedStatus: 403 });

  const specOne = await httpJson(`/api/crm/inquiries/${inquiryId}/specifications`, {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      product_type: 'pouch',
      bag_type: 'stand_up_zipper_bag',
      size_width: '180',
      size_height: '260',
      gusset_size: '80',
      thickness_total: '120',
      thickness_unit: 'mic',
      material_structure_text: 'PET12/AL7/PE100',
      printing_colors: '6',
      zipper_required: 1,
      source_communication_id: communication.id
    }
  });
  assert.strictEqual(specOne.ok, true);
  assert.strictEqual(Number(specOne.version_no), 1);

  const specTwo = await httpJson(`/api/crm/inquiries/${inquiryId}/specifications`, {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      product_type: 'pouch',
      bag_type: 'stand_up_zipper_bag',
      size_width: '190',
      size_height: '270',
      gusset_size: '80',
      thickness_total: '130',
      thickness_unit: 'mic',
      material_structure_text: 'PET12/NY15/PE100',
      printing_colors: '7',
      zipper_required: 1
    }
  });
  assert.strictEqual(specTwo.ok, true);
  assert.strictEqual(Number(specTwo.version_no), 2);

  const layer = await httpJson(`/api/crm/specifications/${specTwo.id}/layers`, {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      layer_order: 1,
      material_name: 'PET',
      material_code: 'PET',
      thickness: '12',
      thickness_unit: 'mic',
      layer_role: 'print'
    }
  });
  assert.strictEqual(layer.ok, true);

  const specifications = await httpJson(`/api/crm/inquiries/${inquiryId}/specifications`, { token: crmAdminLogin.token });
  assert.strictEqual(specifications.rows.length, 2, 'inquiry should list both specification versions');
  const oldSpec = specifications.rows.find(row => Number(row.id) === Number(specOne.id));
  const currentSpec = specifications.rows.find(row => Number(row.id) === Number(specTwo.id));
  assert.strictEqual(Number(oldSpec.is_current), 0, 'old specification should no longer be current');
  assert.strictEqual(Number(currentSpec.is_current), 1, 'new specification should be current');

  const inquiryDetail = await httpJson(`/api/crm/inquiries/${inquiryId}`, { token: crmAdminLogin.token });
  assert.strictEqual(Number(inquiryDetail.inquiry.latest_specification_id), Number(specTwo.id), 'inquiry should reference latest specification');
  assert(Array.isArray(inquiryDetail.currentSpecification.layers), 'current specification should include layers');
  assert(inquiryDetail.currentSpecification.layers.some(row => row.material_name === 'PET'), 'current specification should include added layer');

  const crmAuditLogs = await httpJson('/api/crm/audit-logs?resourceType=crm_customer', { token: crmAdminLogin.token });
  assert(Array.isArray(crmAuditLogs.rows), 'crm audit logs should return rows');
  assert(crmAuditLogs.rows.some(row => row.action === 'create_customer'), 'crm audit logs should include create_customer');
  const customerPriority = await httpJson('/api/crm/customer-priority?pending_costing=0', { token: crmAdminLogin.token });
  assert(Array.isArray(customerPriority.rows), 'customer priority should return rows');
  assert(customerPriority.rows.some(row => Number(row.id) === crmCustomerId), 'customer priority should include crm customer');
  const customerPriorityFiltered = await httpJson('/api/crm/customer-priority?pending_suggestions=1&customer_type=brand_owner', { token: crmAdminLogin.token });
  assert(Array.isArray(customerPriorityFiltered.rows), 'filtered customer priority should return rows');

  const rollCustomer = await httpJson('/api/crm/customers', {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      company_name: 'Roll Film Guard',
      contact_person: 'Bob',
      email: 'bob@rollguard.com',
      country: 'Pakistan',
      priority: 'B',
      stage: 'organized',
      next_action: '确认卷膜参数'
    }
  });
  assert.strictEqual(rollCustomer.ok, true);
  const rollCustomerId = Number(rollCustomer.id);
  const rollInquiry = await httpJson('/api/crm/inquiries', {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      customer_id: rollCustomerId,
      inquiry_title: 'Roll film for biscuits',
      product_type: 'roll film',
      packaging_type: 'roll film',
      quantity: '5000 kg',
      destination_country: 'Pakistan',
      trade_term_requested: 'EXW',
      next_action: '确认卷膜规格'
    }
  });
  assert.strictEqual(rollInquiry.ok, true);
  const rollInquiryId = Number(rollInquiry.id);
  const rollSpec = await httpJson(`/api/crm/inquiries/${rollInquiryId}/specifications`, {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      product_type: 'roll film',
      film_type: 'roll film',
      roll_width: '1200',
      repeat_length: '400',
      printing_colors: '4'
    }
  });
  assert.strictEqual(rollSpec.ok, true);
  const rollReadiness = await httpJson(`/api/crm/inquiries/${rollInquiryId}/quote-readiness`, { token: crmAdminLogin.token });
  assert.strictEqual(rollReadiness.quote_readiness.status, 'need_customer_info', 'roll film without material/thickness should need customer info');
  assert.strictEqual(rollReadiness.quote_readiness.color, 'yellow', 'roll film readiness should be yellow');

  const completeCustomer = await httpJson('/api/crm/customers', {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      company_name: 'Complete Guard Buyer',
      contact_person: 'Carol',
      email: 'carol@completeguard.com',
      country: 'Malaysia',
      priority: 'B',
      stage: 'organized',
      next_action: '核价'
    }
  });
  assert.strictEqual(completeCustomer.ok, true);
  const completeCustomerId = Number(completeCustomer.id);
  const completeInquiry = await httpJson('/api/crm/inquiries', {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      customer_id: completeCustomerId,
      inquiry_title: 'Stand up pouch complete quote readiness',
      product_type: 'pouch',
      packaging_type: 'stand-up pouch',
      quantity: '20000',
      destination_country: 'Malaysia',
      trade_term_requested: 'FOB',
      next_action: '进入核价'
    }
  });
  assert.strictEqual(completeInquiry.ok, true);
  const completeInquiryId = Number(completeInquiry.id);
  const completeSpec = await httpJson(`/api/crm/inquiries/${completeInquiryId}/specifications`, {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      product_type: 'pouch',
      bag_type: 'stand_up_pouch',
      size_width: '150',
      size_height: '220',
      gusset_size: '80',
      thickness_total: '120',
      thickness_unit: 'mic',
      material_structure_text: 'PET12/AL7/PE100',
      printing_colors: '6',
      surface_finish: 'matte',
      artwork_status: 'ready',
      filling_weight: '500g'
    }
  });
  assert.strictEqual(completeSpec.ok, true);
  const completeReadiness = await httpJson(`/api/crm/inquiries/${completeInquiryId}/quote-readiness`, { token: crmAdminLogin.token });
  assert.strictEqual(completeReadiness.quote_readiness.status, 'ready', 'complete inquiry should be ready');
  assert.strictEqual(completeReadiness.quote_readiness.color, 'green', 'complete inquiry should be green');
  const recalcComplete = await httpJson(`/api/crm/inquiries/${completeInquiryId}/recalculate-quote-readiness`, { method: 'POST', token: crmAdminLogin.token, body: {} });
  assert.strictEqual(recalcComplete.inquiry.quote_readiness_status, 'ready', 'recalculate should persist quote readiness');
  assert.strictEqual(recalcComplete.inquiry.quote_readiness_color, 'green', 'persisted readiness color should be green');

  const blockedDashboardInquiry = await httpJson('/api/crm/inquiries', {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      customer_id: completeCustomerId,
      inquiry_title: 'Blocked dashboard quote readiness sample',
      product_type: 'pouch',
      packaging_type: 'stand-up pouch',
      quantity: '12000',
      destination_country: 'Malaysia',
      trade_term_requested: 'FOB',
      next_action: '等待规格补充'
    }
  });
  assert.strictEqual(blockedDashboardInquiry.ok, true);

  const dbQuoteHints = new Database(dbPath);
  const tsHints = new Date().toISOString().slice(0, 19).replace('T', ' ');
  dbQuoteHints.prepare(`
    INSERT INTO crm_import_suggestions (
      source_type, source_id, suggestion_type, status, confidence, matched_customer_id, matched_inquiry_id,
      extracted_json, suggested_updates_json, risk_flags, summary, raw_input, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'email_ai_analysis',
    701,
    'specification',
    'pending',
    'high',
    completeCustomerId,
    Number(blockedDashboardInquiry.id),
    JSON.stringify({
      size: '500g: 15 x 25 x 8 cm; 1kg: 18 x 30 x 10 cm',
      size_width: '18 cm',
      size_height: '30 cm',
      gusset_size: '10 cm',
      material_structure_text: 'PET12/AL7/PE100',
      thickness_total: '120 mic',
      printing_colors: '4-5 colors',
      surface_finish: 'matte',
      zipper_required: 1,
      artwork_status: 'ready',
      evidence: ['email_ai_analysis#701']
    }),
    JSON.stringify({
      size: '500g: 15 x 25 x 8 cm; 1kg: 18 x 30 x 10 cm',
      size_width: '18 cm',
      size_height: '30 cm',
      gusset_size: '10 cm',
      material_structure_text: 'PET12/AL7/PE100',
      thickness_total: '120 mic',
      printing_colors: '4-5 colors',
      surface_finish: 'matte',
      zipper_required: 1,
      artwork_status: 'ready',
      evidence: ['email_ai_analysis#701']
    }),
    '[]',
    'AI spec candidate for stand-up pouch size',
    'AI parsed thread',
    tsHints,
    tsHints
  );
  dbQuoteHints.prepare(`
    INSERT INTO crm_import_suggestions (
      source_type, source_id, suggestion_type, status, confidence, matched_customer_id, matched_inquiry_id,
      extracted_json, suggested_updates_json, risk_flags, summary, raw_input, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'email_ai_analysis',
    702,
    'specification',
    'pending',
    'high',
    rollCustomerId,
    rollInquiryId,
    JSON.stringify({
      roll_width: '175 mm',
      repeat_length: '185 mm',
      material_structure_text: 'PET12/Met BOPP15',
      thickness_total: '29 µm',
      printing_colors: '4',
      artwork_status: 'ready',
      evidence: ['email_ai_analysis#702']
    }),
    JSON.stringify({
      roll_width: '175 mm',
      repeat_length: '185 mm',
      material_structure_text: 'PET12/Met BOPP15',
      thickness_total: '29 µm',
      printing_colors: '4',
      artwork_status: 'ready',
      evidence: ['email_ai_analysis#702']
    }),
    '[]',
    'AI spec candidate for roll film width and repeat length',
    'AI parsed thread',
    tsHints,
    tsHints
  );
  dbQuoteHints.close();

  const rollReadinessWithHints = await httpJson(`/api/crm/inquiries/${rollInquiryId}/quote-readiness`, { token: crmAdminLogin.token });
  assert.strictEqual(rollReadinessWithHints.quote_readiness.status, 'need_customer_info', 'roll film without material/thickness should need customer info');
  assert(Array.isArray(rollReadinessWithHints.quote_readiness.pending_ai_candidates) && rollReadinessWithHints.quote_readiness.pending_ai_candidates.length > 0, 'roll film readiness should expose AI candidates');
  assert(Array.isArray(rollReadinessWithHints.quote_readiness.field_candidate_map?.roll_width), 'roll film readiness should map roll_width candidates');

  const blockedWithHints = await httpJson(`/api/crm/inquiries/${Number(blockedDashboardInquiry.id)}/quote-readiness`, { token: crmAdminLogin.token });
  assert.strictEqual(blockedWithHints.quote_readiness.status, 'blocked', 'blocked inquiry should remain blocked');
  assert(Array.isArray(blockedWithHints.quote_readiness.pending_ai_candidates) && blockedWithHints.quote_readiness.pending_ai_candidates.length > 0, 'blocked inquiry should expose pending AI candidates');
  assert(Array.isArray(blockedWithHints.quote_readiness.field_candidate_map?.size), 'blocked inquiry should map size candidates');

  const dashboardReadiness = await httpJson('/api/crm/dashboard', { token: crmAdminLogin.token });
  assert(Number(dashboardReadiness.quote_readiness_blocked || 0) >= 1, 'dashboard should count blocked readiness inquiries');
  assert(Number(dashboardReadiness.quote_readiness_need_customer_info || 0) >= 1, 'dashboard should count need_customer_info readiness inquiries');
  assert(Number(dashboardReadiness.quote_readiness_ready || 0) >= 1, 'dashboard should count ready inquiries');
  assert(Array.isArray(dashboardReadiness.today_tasks) && dashboardReadiness.today_tasks.some(row => String(row.task_type || '').includes('quote_readiness')), 'dashboard should include quote readiness tasks');
  assert(Array.isArray(dashboardReadiness.today_tasks) && dashboardReadiness.today_tasks.some(row => String(row.task_type || '') === 'quote_readiness_pending_ai_candidate'), 'dashboard should include AI candidate quote readiness tasks');

  await httpJson('/api/crm/email/sync-runs', { token: adminToken });
  await httpJson('/api/crm/email/sync-runs', { token: crmAdminLogin.token });
  await httpJson('/api/crm/email/sync-runs', { token: scopedSalesLogin.token, expectedStatus: 403 });
  await httpJson('/api/crm/email/sync-runs', { token: costingLogin.token, expectedStatus: 403 });
  await httpJson('/api/crm/email/sync-runs', { token: freightLogin.token, expectedStatus: 403 });
  const inboxHealth = await httpJson('/api/crm/email/inbox-health', { token: crmAdminLogin.token });
  assert.strictEqual(typeof inboxHealth.configured, 'boolean', 'inbox health should expose configured boolean');
  assert.strictEqual(typeof inboxHealth.pending_jobs, 'number', 'inbox health should expose pending job count');
  for (const forbidden of ['mailbox', 'password', 'token', 'subject', 'message_body', 'filename', 'storage_key']) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(inboxHealth, forbidden), false, `inbox health must not expose ${forbidden}`);
  }
  const configStatus = await httpJson('/api/crm/email/config-status', { token: crmAdminLogin.token, expectedStatus: 400 });
  assert.strictEqual(configStatus.ok, false, 'config status should report missing env in smoke');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(configStatus, 'password'), false, 'config status must not expose password');
  assert(Array.isArray(configStatus.suggestedHosts), 'config status should include suggested hosts');
  const emailSyncMissingEnv = await httpJson('/api/crm/email/sync', {
    method: 'POST',
    token: crmAdminLogin.token,
    expectedStatus: 400,
    body: { folder: 'INBOX', days: 7, limit: 10 }
  });
  assert.strictEqual(emailSyncMissingEnv.ok, false, 'email sync should fail clearly when env is missing');
  assert(!String(emailSyncMissingEnv.error || '').includes('undefined'), 'email sync failure should not expose undefined.length style errors');
  assert(emailSyncMissingEnv.sync_run, 'email sync failure should include structured sync run summary');
  assert(Array.isArray(emailSyncMissingEnv.config_status?.missing), 'missing env response should list missing variables');
  const emailSyncSentMissingEnv = await httpJson('/api/crm/email/sync', {
    method: 'POST',
    token: crmAdminLogin.token,
    expectedStatus: 400,
    body: { folder: 'Sent', days: 7, limit: 10 }
  });
  assert.strictEqual(emailSyncSentMissingEnv.ok, false, 'sent folder sync should also fail clearly when env is missing');
  assert(emailSyncSentMissingEnv.sync_run?.folder === 'Sent', 'sent folder sync should preserve requested folder in summary');

  const db = new Database(dbPath);
  const seedTs = '2026-06-24 11:00:00';
  const emailInsert = db.prepare(`
    INSERT INTO email_messages (
      mailbox, folder, message_uid, message_id, thread_id, in_reply_to, references_header,
      from_email, from_name, to_emails, cc_emails, bcc_emails, subject, text_body, html_body,
      cleaned_text, attachments_json, sent_at, received_at, direction, processing_status,
      normalized_subject, conversation_key, email_domain, contact_email, contact_name,
      quote_detected, inquiry_detected, customer_detected, parsed_at,
      matched_customer_id, matched_inquiry_id, raw_headers_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'sales@example.com',
    'INBOX',
    '1001',
    '<msg-1001@example.com>',
    '<msg-1001@example.com>',
    '',
    '',
    'alice@example.com',
    'Alice',
    'sales@example.com',
    '',
    '',
    'Need 50000 pouch quotation',
    'Hello, we need 50000 pouch pcs to Thailand CIF Bangkok.',
    '',
    'Hello, we need 50000 pouch pcs to Thailand CIF Bangkok.',
    '[]',
    seedTs,
    seedTs,
    'inbound',
    'new',
    'need 50000 pouch quotation',
    'thread:<msg-1001@example.com>',
    'example.com',
    'alice@example.com',
    'Alice',
    0,
    0,
    0,
    '',
    crmCustomerId,
    inquiryId,
    '{}',
    seedTs,
    seedTs
  );
  const seededEmailId = Number(emailInsert.lastInsertRowid);
  db.close();

  const emailList = await httpJson('/api/crm/email/messages?matched_customer_id=' + crmCustomerId, { token: crmAdminLogin.token });
  assert(emailList.rows.some(row => Number(row.id) === seededEmailId), 'email list should include seeded email');
  await httpJson('/api/crm/email/messages', { token: scopedSalesLogin.token, expectedStatus: 403 });

  const parsedEmail = await httpJson(`/api/crm/email/messages/${seededEmailId}/parse`, {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {}
  });
  assert.strictEqual(parsedEmail.ok, true, 'email parse should succeed');
  assert(Array.isArray(parsedEmail.suggestion_ids), 'email parse should return suggestion ids');
  assert(parsedEmail.suggestion_ids.length > 0, 'email parse should create suggestions');
  const suggestionId = Number(parsedEmail.suggestion_ids[0]);

  const suggestionDetailBefore = await httpJson(`/api/crm/import-suggestions/${suggestionId}`, { token: crmAdminLogin.token });
  assert.strictEqual(Number(suggestionDetailBefore.suggestion.matched_customer_id), crmCustomerId, 'suggestion should match customer');
  const suggestionPreview = await httpJson(`/api/crm/import-suggestions/${suggestionId}/preview`, { token: crmAdminLogin.token });
  assert.strictEqual(suggestionPreview.ok, true, 'suggestion preview should succeed');
  assert(Array.isArray(suggestionPreview.diff), 'suggestion preview should include diff');
  await httpJson(`/api/crm/import-suggestions/${suggestionId}/preview`, { token: scopedSalesLogin.token, expectedStatus: 403 });
  const quoteSuggestions = await httpJson('/api/crm/email/quote-suggestions', { token: crmAdminLogin.token });
  assert(quoteSuggestions.rows.some(row => Number(row.source_id) === seededEmailId), 'quote suggestion list should include parsed quotation draft');
  const dashboardAfterEmailParse = await httpJson('/api/crm/dashboard', { token: crmAdminLogin.token });
  assert.strictEqual(dashboardAfterEmailParse.ok, true, 'crm dashboard should return ok');
  assert(Number(dashboardAfterEmailParse.summary?.pending_import_suggestions || 0) >= 1, 'dashboard should count pending import suggestions');
  assert(Number(dashboardAfterEmailParse.summary?.pending_quotation_drafts || 0) >= 1, 'dashboard should count pending quotation drafts');
  assert(Array.isArray(dashboardAfterEmailParse.today_tasks), 'dashboard should return today tasks');
  assert(Array.isArray(dashboardAfterEmailParse.quotation_drafts), 'dashboard should return quotation draft rows');
  const dbDashboard = new Database(dbPath);
  const quotationTableAfterDashboard = dbDashboard.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='quotations'`).get();
  dbDashboard.close();
  assert(!quotationTableAfterDashboard, 'dashboard should not create formal quotations table');
  const emailThread = await httpJson(`/api/crm/email/messages/${seededEmailId}/thread`, { token: crmAdminLogin.token });
  assert(Array.isArray(emailThread.rows), 'email thread should return rows');
  await httpJson('/api/crm/import-suggestions', { token: scopedSalesLogin.token, expectedStatus: 403 });

  const dbAi = new Database(dbPath);
  const tableExists = dbAi.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='email_ai_analysis_runs'`).get();
  assert(tableExists, 'email_ai_analysis_runs table should exist');
  const aiEmailInsert = dbAi.prepare(`
    INSERT INTO email_messages (
      mailbox, folder, message_uid, message_id, thread_id, in_reply_to, references_header,
      from_email, from_name, to_emails, cc_emails, bcc_emails, subject, text_body, html_body,
      cleaned_text, attachments_json, sent_at, received_at, direction, processing_status,
      normalized_subject, conversation_key, email_domain, contact_email, contact_name,
      noise_level, business_relevance, detected_signals_json, parser_hints_json,
      quote_detected, inquiry_detected, customer_detected, parsed_at,
      matched_customer_id, matched_inquiry_id, raw_headers_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'sales@gdhspack.com',
    'INBOX',
    '2001',
    '<msg-2001@example.com>',
    '<msg-2001@example.com>',
    '',
    '',
    'testbuyer@acmefoods.com',
    'Test Buyer',
    'sales@gdhspack.com',
    '',
    '',
    'RFQ for 1kg zipper pouch to Dubai',
    'We are ACME Foods LLC in UAE. Need 1kg zipper pouch, 50000 pcs, CIF Dubai. Please quote.',
    '',
    'We are ACME Foods LLC in UAE. Need 1kg zipper pouch, 50000 pcs, CIF Dubai. Please quote.',
    '[]',
    seedTs,
    seedTs,
    'inbound',
    'new',
    '',
    'thread:<msg-2001@example.com>',
    'acmefoods.com',
    'testbuyer@acmefoods.com',
    'Test Buyer',
    'low',
    'high',
    '{}',
    '{}',
    1,
    1,
    1,
    '',
    null,
    null,
    '{}',
    seedTs,
    seedTs
  );
  const aiEmailId = Number(aiEmailInsert.lastInsertRowid);
  dbAi.close();

  const prepareScript = spawnSync(process.execPath, ['scripts/prepare-email-ai-batches.js', '--contact', 'testbuyer@acmefoods.com', '--limit', '5'], {
    cwd: root,
    env: { ...process.env, DB_PATH: dbPath },
    encoding: 'utf8'
  });
  assert.strictEqual(prepareScript.status, 0, `prepare-email-ai-batches.js should succeed: ${prepareScript.stderr}`);
  const prepareJson = JSON.parse(prepareScript.stdout);
  assert(prepareJson.prepared_runs >= 1, 'prepare script should create at least one AI batch');
  const preparedRun = prepareJson.runs[0];
  assert(fs.existsSync(preparedRun.prompt_path), 'prepare script should write prompt file');

  const dbAiImport = new Database(dbPath);
  dbAiImport.prepare(`
    UPDATE email_ai_analysis_runs
    SET status = 'completed', result_json = ?, output_path = ?, updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify({
      customer_profile: {
        company_name: 'ACME Foods LLC',
        contact_person: 'Test Buyer',
        email: 'testbuyer@acmefoods.com',
        whatsapp: null,
        phone: null,
        country: 'UAE',
        city: null,
        website: 'https://acmefoods.com',
        customer_summary: 'Potential UAE pouch buyer.',
        next_action: 'Confirm exact material structure.',
        confidence: 'high',
        evidence: [aiEmailId]
      },
      communications: [{ summary: 'RFQ for zipper pouch', direction: 'inbound', email_id: aiEmailId, date: seedTs, key_points: ['50000 pcs', 'CIF Dubai'] }],
      inquiries: [{ inquiry_title: 'RFQ for 1kg zipper pouch to Dubai', product_type: 'zipper pouch', packaging_type: 'stand up pouch', quantity: '50000 pcs', destination_country: 'UAE', destination_port: 'Dubai', trade_term_requested: 'CIF', customer_questions: [], missing_info: [], next_action: 'Confirm artwork', confidence: 'high', evidence: [aiEmailId] }],
      specifications: [{ bag_type: 'stand up zipper pouch', film_type: '', size: '', material_structure_text: 'PET/PE', layers: [], thickness_total: '', printing_colors: '', surface_finish: '', special_features: ['zipper'], notes: '', confidence: 'medium', evidence: [aiEmailId] }],
      quotation_drafts: [{ quoted_by_us: null, quote_currency: 'USD', quote_unit: 'pcs', trade_term: 'CIF', unit_price: '', total_amount: '', quantity: '50000 pcs', tooling_fee: '', freight_cost: '', clearance_cost: '', payment_terms: '', lead_time: '', validity_date: '', remarks: '', confidence: 'low', evidence: [aiEmailId] }],
      risk_flags: [],
      recommended_apply_order: ['customer_profile', 'communication_log', 'inquiry', 'specification', 'quotation_draft']
    }),
    path.join(root, 'data', 'email-ai-outputs', `${preparedRun.run_code}.json`),
    seedTs,
    preparedRun.id
  );
  dbAiImport.close();

  const importScript = spawnSync(process.execPath, ['scripts/import-email-ai-results.js', '--id', String(preparedRun.id)], {
    cwd: root,
    env: { ...process.env, DB_PATH: dbPath },
    encoding: 'utf8'
  });
  assert.strictEqual(importScript.status, 0, `import-email-ai-results.js should succeed: ${importScript.stderr}`);
  const importJson = JSON.parse(importScript.stdout);
  assert(importJson.imported_runs[0].created_suggestion_ids.length >= 4, 'import script should create pending suggestions from AI result');
  const dbAiVerify = new Database(dbPath);
  const importedRun = dbAiVerify.prepare(`SELECT status FROM email_ai_analysis_runs WHERE id = ?`).get(preparedRun.id);
  const aiSuggestions = dbAiVerify.prepare(`SELECT suggestion_type, status FROM crm_import_suggestions WHERE source_type = 'email_ai_analysis' AND source_id = ? ORDER BY id ASC`).all(preparedRun.id);
  dbAiVerify.close();
  assert.strictEqual(importedRun.status, 'imported', 'AI analysis run should move to imported');
  assert(aiSuggestions.some(row => row.suggestion_type === 'quotation_draft'), 'AI import should create quotation_draft suggestion');
  assert(aiSuggestions.every(row => row.status === 'pending'), 'AI-imported suggestions should remain pending');

  const customerBeforeSuggestionStatus = await httpJson(`/api/crm/customers/${crmCustomerId}`, { token: crmAdminLogin.token });
  await httpJson(`/api/crm/import-suggestions/${suggestionId}`, {
    method: 'PATCH',
    token: crmAdminLogin.token,
    body: { status: 'rejected' }
  });
  const customerAfterSuggestionStatus = await httpJson(`/api/crm/customers/${crmCustomerId}`, { token: crmAdminLogin.token });
  assert.strictEqual(customerAfterSuggestionStatus.customer.company_name, customerBeforeSuggestionStatus.customer.company_name, 'suggestion status update must not overwrite customer profile');
  assert(Array.isArray(customerAfterSuggestionStatus.relatedEmails), 'customer detail should include related emails');
  assert(Array.isArray(customerAfterSuggestionStatus.importSuggestions), 'customer detail should include related suggestions');

  const db2 = new Database(dbPath);
  const applyTs = '2026-06-24 13:00:00';
  const customerProfileSuggestionId = Number(db2.prepare(`
    INSERT INTO crm_import_suggestions (
      source_type, source_id, suggestion_type, status, confidence, matched_customer_id, matched_inquiry_id,
      extracted_json, suggested_updates_json, risk_flags, summary, raw_input, created_at, updated_at
    ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'manual_text',
    0,
    'customer_profile',
    'high',
    crmCustomerId,
    null,
    JSON.stringify({
      company_name: 'CRM 守护客户升级版',
      website: 'https://crm-guardian.example.com',
      customer_summary: '客户通过邮件确认需要 stand up pouch 报价。',
      priority: 'D'
    }),
    '{}',
    '[]',
    'customer profile apply test',
    'manual',
    applyTs,
    applyTs
  ).lastInsertRowid);
  const commSuggestionId = Number(db2.prepare(`
    INSERT INTO crm_import_suggestions (
      source_type, source_id, suggestion_type, status, confidence, matched_customer_id, matched_inquiry_id,
      extracted_json, suggested_updates_json, risk_flags, summary, raw_input, created_at, updated_at
    ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'email',
    seededEmailId,
    'communication_log',
    'high',
    crmCustomerId,
    inquiryId,
    JSON.stringify({
      direction: 'inbound',
      sender: 'alice@example.com',
      recipient: 'sales@example.com',
      subject: 'Follow up on pouch quotation',
      raw_content: 'Customer asked to confirm zipper pouch details.',
      ai_summary: '客户跟进拉链袋询价',
      received_at: applyTs,
      message_id: '<msg-1001@example.com>',
      thread_id: 'thread:<msg-1001@example.com>'
    }),
    '{}',
    '[]',
    'communication log apply test',
    'manual',
    applyTs,
    applyTs
  ).lastInsertRowid);
  const inquiryApplySuggestionId = Number(db2.prepare(`
    INSERT INTO crm_import_suggestions (
      source_type, source_id, suggestion_type, status, confidence, matched_customer_id, matched_inquiry_id,
      extracted_json, suggested_updates_json, risk_flags, summary, raw_input, created_at, updated_at
    ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'manual_text',
    0,
    'inquiry',
    'high',
    crmCustomerId,
    null,
    JSON.stringify({
      inquiry_title: 'Imported oatmeal pouch inquiry',
      product_type: 'stand up pouch',
      packaging_type: 'zipper pouch',
      quantity: '30000 pcs',
      destination_country: 'Bangladesh',
      trade_term_requested: 'FOB',
      next_action: 'Confirm artwork'
    }),
    '{}',
    '[]',
    'inquiry apply test',
    'manual',
    applyTs,
    applyTs
  ).lastInsertRowid);
  const specificationSuggestionId = Number(db2.prepare(`
    INSERT INTO crm_import_suggestions (
      source_type, source_id, suggestion_type, status, confidence, matched_customer_id, matched_inquiry_id,
      extracted_json, suggested_updates_json, risk_flags, summary, raw_input, created_at, updated_at
    ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'manual_text',
    0,
    'specification',
    'high',
    crmCustomerId,
    inquiryId,
    JSON.stringify({
      product_type: 'stand up pouch',
      bag_type: 'stand up zipper pouch',
      size_width: '180',
      size_height: '260',
      thickness_total: '120',
      thickness_unit: 'micron',
      material_structure_text: 'PET12/PE108',
      printing_colors: '8',
      notes: 'Applied from import suggestion',
      layers: [
        { layer_order: 1, material_name: 'PET', thickness: '12', thickness_unit: 'micron', layer_role: 'print' },
        { layer_order: 2, material_name: 'PE', thickness: '108', thickness_unit: 'micron', layer_role: 'seal' }
      ]
    }),
    '{}',
    '[]',
    'specification apply test',
    'manual',
    applyTs,
    applyTs
  ).lastInsertRowid);
  const quotationSuggestionId = Number(db2.prepare(`
    INSERT INTO crm_import_suggestions (
      source_type, source_id, suggestion_type, status, confidence, matched_customer_id, matched_inquiry_id,
      extracted_json, suggested_updates_json, risk_flags, summary, raw_input, created_at, updated_at
    ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'email',
    seededEmailId,
    'quotation_draft',
    'medium',
    crmCustomerId,
    inquiryId,
    JSON.stringify({
      trade_term: 'EXW',
      quote_currency: 'USD',
      unit_price: '0.12',
      quantity: '30000 pcs',
      payment_terms: '30% deposit',
      lead_time: '15 days'
    }),
    '{}',
    '[]',
    'quotation draft apply test',
    'manual',
    applyTs,
    applyTs
  ).lastInsertRowid);
  db2.close();

  const customerApplyRet = await httpJson(`/api/crm/import-suggestions/${customerProfileSuggestionId}/apply`, {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      apply_fields: ['company_name', 'website', 'customer_summary', 'priority'],
      allow_update_customer: true,
      apply_priority: false,
      review_note: 'apply customer profile'
    }
  });
  assert.strictEqual(customerApplyRet.ok, true, 'customer profile apply should succeed');
  await httpJson(`/api/crm/import-suggestions/${customerProfileSuggestionId}/apply`, {
    method: 'POST',
    token: scopedSalesLogin.token,
    expectedStatus: 403,
    body: {
      apply_fields: ['company_name'],
      allow_update_customer: true
    }
  });
  const customerAfterApply = await httpJson(`/api/crm/customers/${crmCustomerId}`, { token: crmAdminLogin.token });
  assert.strictEqual(customerAfterApply.customer.company_name, 'CRM 守护客户升级版', 'customer apply should update company_name');
  assert.strictEqual(customerAfterApply.customer.website, 'https://crm-guardian.example.com', 'customer apply should update website');
  assert.strictEqual(customerAfterApply.customer.priority, 'B', 'priority should remain unchanged when apply_priority=false');

  const dbCreateProfile = new Database(dbPath);
  const createProfileSuggestionId = Number(dbCreateProfile.prepare(`
    INSERT INTO crm_import_suggestions (
      source_type, source_id, suggestion_type, status, confidence, matched_customer_id, matched_inquiry_id,
      extracted_json, suggested_updates_json, risk_flags, summary, raw_input, created_at, updated_at
    ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'manual_text',
    0,
    'customer_profile',
    'high',
    null,
    null,
    JSON.stringify({
      company_name: 'Selective Apply Customer',
      contact_person: 'Selective Contact',
      email: 'selective@example.com',
      country: 'Malaysia',
      city: 'Kuala Lumpur',
      source_channel: 'email',
      customer_summary: 'Should only apply selected fields.'
    }),
    '{}',
    '[]',
    'customer profile create selective apply test',
    'manual',
    applyTs,
    applyTs
  ).lastInsertRowid);
  dbCreateProfile.close();
  const createProfileRet = await httpJson(`/api/crm/import-suggestions/${createProfileSuggestionId}/apply`, {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      apply_fields: ['company_name', 'contact_person', 'email', 'country', 'customer_summary'],
      allow_create_customer: true,
      allow_update_customer: true,
      apply_priority: false,
      review_note: 'selective create customer profile'
    }
  });
  assert.strictEqual(createProfileRet.ok, true, 'customer profile create apply should succeed');
  const selectiveCustomer = await httpJson(`/api/crm/customers/${createProfileRet.created.customer_id}`, { token: crmAdminLogin.token });
  assert.strictEqual(selectiveCustomer.customer.company_name, 'Selective Apply Customer', 'created customer should include selected company_name');
  assert.strictEqual(selectiveCustomer.customer.city || '', '', 'created customer should not apply unselected city');
  assert.strictEqual(selectiveCustomer.customer.source_channel || '', '', 'created customer should not apply unselected source_channel');

  const customerAppliedSuggestion = await httpJson(`/api/crm/import-suggestions/${customerProfileSuggestionId}`, { token: crmAdminLogin.token });
  assert.strictEqual(customerAppliedSuggestion.suggestion.status, 'applied', 'customer profile suggestion should be applied');

  const commApplyRet = await httpJson(`/api/crm/import-suggestions/${commSuggestionId}/apply`, {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      apply_fields: ['subject', 'raw_content'],
      allow_create_communication_log: true,
      review_note: 'apply communication log'
    }
  });
  assert.strictEqual(commApplyRet.ok, true, 'communication log apply should succeed');

  const inquiryApplyRet = await httpJson(`/api/crm/import-suggestions/${inquiryApplySuggestionId}/apply`, {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      apply_fields: ['inquiry_title', 'product_type', 'packaging_type', 'quantity', 'destination_country', 'trade_term_requested', 'next_action'],
      allow_create_inquiry: true,
      review_note: 'apply inquiry'
    }
  });
  assert.strictEqual(inquiryApplyRet.ok, true, 'inquiry apply should succeed');
  assert(Number(inquiryApplyRet.created?.inquiry_id) > 0, 'inquiry apply should create inquiry');
  const importedInquiryId = Number(inquiryApplyRet.created.inquiry_id);
  const customerAfterInquiryApply = await httpJson(`/api/crm/customers/${crmCustomerId}`, { token: crmAdminLogin.token });
  assert.strictEqual(Number(customerAfterInquiryApply.customer.latest_inquiry_id), importedInquiryId, 'apply inquiry should update customer latest_inquiry_id');

  const specApplyRet = await httpJson(`/api/crm/import-suggestions/${specificationSuggestionId}/apply`, {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      apply_fields: ['product_type', 'bag_type', 'size_width', 'size_height', 'thickness_total', 'thickness_unit', 'material_structure_text', 'printing_colors', 'notes'],
      allow_create_specification: true,
      review_note: 'apply specification'
    }
  });
  assert.strictEqual(specApplyRet.ok, true, 'specification apply should succeed');
  const importedSpecId = Number(specApplyRet.created?.specification_id);
  const inquiryAfterSpecApply = await httpJson(`/api/crm/inquiries/${inquiryId}`, { token: crmAdminLogin.token });
  assert.strictEqual(Number(inquiryAfterSpecApply.inquiry.latest_specification_id), importedSpecId, 'specification apply should update inquiry latest spec');
  const specHistoryAfterApply = await httpJson(`/api/crm/inquiries/${inquiryId}/specifications`, { token: crmAdminLogin.token });
  const importedSpec = specHistoryAfterApply.rows.find(row => Number(row.id) === importedSpecId);
  const previousCurrent = specHistoryAfterApply.rows.find(row => Number(row.id) === Number(specTwo.id));
  assert.strictEqual(Number(importedSpec.is_current), 1, 'applied specification should be current');
  assert.strictEqual(Number(previousCurrent.is_current), 0, 'previous current spec should be cleared');
  const importedSpecDetail = await httpJson(`/api/crm/specifications/${importedSpecId}`, { token: crmAdminLogin.token });
  assert(Array.isArray(importedSpecDetail.specification?.layers) && importedSpecDetail.specification.layers.length === 2, 'applied specification should create layers');

  const quotationApplyRet = await httpJson(`/api/crm/import-suggestions/${quotationSuggestionId}/apply`, {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      apply_fields: ['trade_term', 'unit_price', 'quantity'],
      allow_create_quotation: true,
      review_note: 'attempt quotation apply'
    }
  });
  assert.strictEqual(quotationApplyRet.ok, true, 'quotation suggestion apply should return structured response');
  assert.strictEqual(quotationApplyRet.applied, false, 'quotation apply should not create quotation when table is unavailable');
  assert(Array.isArray(quotationApplyRet.warnings) && quotationApplyRet.warnings.some(row => String(row).includes('Quotation table not available yet')), 'quotation apply should return table warning');

  const db3 = new Database(dbPath);
  const auditRow = db3.prepare(`SELECT action, detail FROM audit_logs WHERE action = 'apply_import_suggestion' ORDER BY id DESC LIMIT 1`).get();
  const communicationRow = db3.prepare(`SELECT COUNT(*) AS total FROM communication_logs WHERE subject = 'Follow up on pouch quotation'`).get();
  db3.close();
  assert(auditRow, 'apply flow should write audit log');
  assert(Number(communicationRow.total) > 0, 'communication log apply should create communication row');

  const inquiryWithoutSpec = await httpJson('/api/crm/inquiries', {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      customer_id: crmCustomerId,
      inquiry_title: 'No spec inquiry',
      product_type: 'film',
      quantity: '1000'
    }
  });
  await httpJson(`/api/crm/inquiries/${inquiryWithoutSpec.id}/costing-requests`, {
    method: 'POST',
    token: crmAdminLogin.token,
    body: { assigned_to: 'father_costing_guard' },
    expectedStatus: 400
  });

  await httpJson('/api/crm/costing-requests', { token: adminToken });
  await httpJson('/api/crm/costing-requests', { token: scopedSalesLogin.token, expectedStatus: 403 });

  const costingRequest = await httpJson(`/api/crm/inquiries/${inquiryId}/costing-requests`, {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      assigned_to: 'father_costing_guard',
      assigned_to_user_id: costingMe.user.id,
      request_note: '请按 EXW 核价',
      required_quote_terms: 'EXW',
      required_currency: 'RMB',
      required_unit: 'pcs',
      target_margin: '12%',
      urgency: 'urgent',
      due_at: '2026-06-25 18:00:00'
    }
  });
  assert.strictEqual(costingRequest.ok, true);
  assert(Number(costingRequest.costing_request?.id) > 0, 'costing request id should be > 0');
  assert.strictEqual(Number(costingRequest.costing_request.customer_id), crmCustomerId);
  assert.strictEqual(Number(costingRequest.costing_request.inquiry_id), inquiryId);
  assert.strictEqual(Number(costingRequest.costing_request.specification_id), importedSpecId);
  assert(Array.isArray(costingRequest.layers) && costingRequest.layers.length > 0, 'costing request should include specification layers');
  const costingRequestId = Number(costingRequest.costing_request.id);

  const inquiryAfterCosting = await httpJson(`/api/crm/inquiries/${inquiryId}`, { token: crmAdminLogin.token });
  assert.strictEqual(Number(inquiryAfterCosting.inquiry.costing_required), 1, 'inquiry should be marked costing_required');
  assert.strictEqual(inquiryAfterCosting.inquiry.status, 'costing', 'inquiry should move to costing status');

  const costingListForCrm = await httpJson('/api/crm/costing-requests?status=pending', { token: crmAdminLogin.token });
  assert(costingListForCrm.rows.some(row => Number(row.id) === costingRequestId), 'crm admin should see created costing request');

  const costingListForAssigned = await httpJson('/api/crm/costing-requests', { token: costingLogin.token });
  assert(costingListForAssigned.rows.some(row => Number(row.id) === costingRequestId), 'assigned costing user should see own request');
  assert(costingListForAssigned.rows.every(row => row.email === undefined && row.whatsapp === undefined && row.raw_content === undefined), 'costing list should hide sensitive fields');

  const costingDetailForAssigned = await httpJson(`/api/crm/costing-requests/${costingRequestId}`, { token: costingLogin.token });
  assert.strictEqual(Number(costingDetailForAssigned.costing_request.id), costingRequestId);
  assert(Array.isArray(costingDetailForAssigned.specification_layers), 'costing detail should include specification layers');
  assert(costingDetailForAssigned.specification_layers.some(row => row.material_name === 'PET'), 'costing detail should include material layer');
  assert(!('email' in costingDetailForAssigned.customer), 'costing user customer summary should hide email');
  assert(!('whatsapp' in costingDetailForAssigned.customer), 'costing user customer summary should hide whatsapp');
  assert(!JSON.stringify(costingDetailForAssigned).includes('Need 50000 stand up pouches'), 'costing user detail should not include raw communication content');

  const costingPrefill = await httpJson(`/api/crm/inquiries/${inquiryId}/costing-prefill`, { token: costingLogin.token });
  assert.strictEqual(costingPrefill.suggested_cost_input.quantity, '50000');
  assert.strictEqual(costingPrefill.suggested_cost_input.material_structure_text, 'PET12/PE108');
  assert(Array.isArray(costingPrefill.suggested_cost_input.layers), 'costing prefill should include layers');

  await httpJson(`/api/crm/costing-requests/${costingRequestId}`, {
    method: 'PATCH',
    token: costingLogin.token,
    body: { status: 'in_progress' }
  });
  const completedCosting = await httpJson(`/api/crm/costing-requests/${costingRequestId}`, {
    method: 'PATCH',
    token: costingLogin.token,
    body: { status: 'completed' }
  });
  assert.strictEqual(completedCosting.ok, true);
  assert.strictEqual(completedCosting.costing_request.status, 'completed');

  await httpJson('/api/crm/freight-quotes', { token: adminToken });
  await httpJson('/api/crm/freight-quotes', { token: scopedSalesLogin.token, expectedStatus: 403 });
  await httpJson('/api/crm/freight-quotes', { token: costingLogin.token, expectedStatus: 403 });

  const freightQuoteOne = await httpJson(`/api/crm/inquiries/${inquiryId}/freight-quotes`, {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      assigned_to: 'freight_guard',
      assigned_to_user_id: freightMe.user.id,
      quote_source: 'manual',
      forwarder_name: 'Freight A',
      forwarder_contact: 'forwarder-a@example.com',
      shipping_mode: 'sea',
      origin_port: 'Shenzhen',
      destination_country: 'Thailand',
      destination_port: 'Bangkok',
      destination_address: 'Bangkok warehouse',
      container_type: 'LCL',
      cargo_weight: '1200kg',
      cargo_volume: '8cbm',
      package_type: 'carton',
      package_count: '200',
      trade_term: 'CIF',
      currency: 'RMB',
      ocean_freight: '3500',
      trucking_origin: '600',
      trucking_destination: '900',
      documentation_fee: '200',
      thc_origin: '300',
      thc_destination: '450',
      customs_clearance_fee: '500',
      duty_tax_estimate: '1200',
      destination_local_charge: '800',
      delivery_fee: '700',
      insurance_fee: '150',
      other_fee: '100',
      valid_until: '2026-07-01',
      notes: 'first freight quote',
      status: 'received'
    }
  });
  assert.strictEqual(freightQuoteOne.ok, true);
  const freightQuoteOneId = Number(freightQuoteOne.freight_quote.id);
  assert(freightQuoteOneId > 0, 'freight quote id should be > 0');
  assert.strictEqual(Number(freightQuoteOne.freight_quote.customer_id), crmCustomerId);
  assert.strictEqual(Number(freightQuoteOne.freight_quote.inquiry_id), inquiryId);
  assert(Number(freightQuoteOne.freight_quote.total_freight_cost || 0) > 0, 'freight total should be calculated when empty');

  const freightQuoteTwo = await httpJson(`/api/crm/inquiries/${inquiryId}/freight-quotes`, {
    method: 'POST',
    token: crmAdminLogin.token,
    body: {
      assigned_to: 'freight_guard',
      assigned_to_user_id: freightMe.user.id,
      forwarder_name: 'Freight B',
      shipping_mode: 'sea',
      destination_country: 'Thailand',
      destination_port: 'Bangkok',
      currency: 'RMB',
      ocean_freight: '3200',
      total_freight_cost: '5000',
      status: 'received'
    }
  });
  assert.strictEqual(freightQuoteTwo.ok, true);
  const freightQuoteTwoId = Number(freightQuoteTwo.freight_quote.id);

  const inquiryFreight = await httpJson(`/api/crm/inquiries/${inquiryId}/freight-quotes`, { token: crmAdminLogin.token });
  assert(inquiryFreight.rows.some(row => Number(row.id) === freightQuoteOneId), 'inquiry freight list should include first quote');
  assert(inquiryFreight.rows.some(row => Number(row.id) === freightQuoteTwoId), 'inquiry freight list should include second quote');

  const freightListForAssigned = await httpJson('/api/crm/freight-quotes', { token: freightLogin.token });
  assert(freightListForAssigned.rows.some(row => Number(row.id) === freightQuoteOneId), 'assigned freight user should see assigned quote');
  assert(freightListForAssigned.rows.every(row => row.email === undefined && row.whatsapp === undefined && row.raw_content === undefined), 'freight list should hide sensitive fields');

  const freightDetailForAssigned = await httpJson(`/api/crm/freight-quotes/${freightQuoteOneId}`, { token: freightLogin.token });
  assert.strictEqual(Number(freightDetailForAssigned.freight_quote.id), freightQuoteOneId);
  assert(!('email' in freightDetailForAssigned.customer), 'freight user customer summary should hide email');
  assert(!('whatsapp' in freightDetailForAssigned.customer), 'freight user customer summary should hide whatsapp');
  assert(!JSON.stringify(freightDetailForAssigned).includes('Need 50000 stand up pouches'), 'freight user detail should not include raw communication content');

  await httpJson(`/api/crm/freight-quotes/${freightQuoteTwoId}`, {
    method: 'PATCH',
    token: freightLogin.token,
    body: { status: 'selected', notes: 'selected forwarder' }
  });
  const freightAfterSelect = await httpJson(`/api/crm/inquiries/${inquiryId}/freight-quotes`, { token: crmAdminLogin.token });
  const selectedFreight = freightAfterSelect.rows.find(row => Number(row.id) === freightQuoteTwoId);
  const oldFreight = freightAfterSelect.rows.find(row => Number(row.id) === freightQuoteOneId);
  assert.strictEqual(Number(selectedFreight.is_current), 1, 'selected freight quote should be current');
  assert.strictEqual(Number(oldFreight.is_current), 0, 'other freight quotes should no longer be current');

  const freightPrefill = await httpJson(`/api/crm/inquiries/${inquiryId}/freight-prefill`, { token: crmAdminLogin.token });
  assert.strictEqual(freightPrefill.suggested_freight_input.destination_country, 'Thailand');
  assert.strictEqual(freightPrefill.suggested_freight_input.quantity, '50000');

  const costCalc = await httpJson('/api/cost/calculate', {
    method: 'POST',
    token: costLogin.token,
    body: {
      costType: 'eight_side_seal',
      withTrace: true,
      input: {
        ba_chang: 20,
        ba_kuang: 12,
        ba_di: 5,
        thick: [3, 4, 5, 0],
        price: [9500, 12000, 13500, 0],
        proportion: [0.92, 1.02, 1.12, 0],
        jgf: 18,
        zxyf: 200,
        sh: 0.05,
        lr: 0.12,
        ba_zdf: 50
      }
    }
  });
  assert.strictEqual(costCalc.ok, true);
  assert(Number(costCalc.result?.finalQuote) > 0, 'cost finalQuote should be > 0');

  const standCostCalc = await httpJson('/api/cost/calculate', {
    method: 'POST',
    token: costLogin.token,
    body: {
      costType: 'stand_zipper_bag',
      withTrace: true,
      input: {
        quote_qty: 30000,
        quote_customer: '成本基准客户',
        quote_product_name: '自立袋样例',
        ba_chang: 26,
        ba_kuang: 18,
        ba_di: 4,
        thick: [12, 7, 60, 0],
        proportion: [1.38, 2.7, 0.92, 0],
        price: [9800, 18000, 9000, 0],
        jgf: 35,
        zxyf: 260,
        sh: 0.02,
        lr: 0.08,
        lldj: 0.15
      }
    }
  });
  assert.strictEqual(standCostCalc.ok, true);
  assert(Number(standCostCalc.result?.finalQuote) > 0, 'stand zipper cost finalQuote should be > 0');

  const backSealCostCalc = await httpJson('/api/cost/calculate', {
    method: 'POST',
    token: costLogin.token,
    body: {
      costType: 'back_seal',
      withTrace: true,
      input: {
        quote_qty: 18000,
        quote_customer: '成本基准客户',
        quote_product_name: '背封袋样例',
        ba_chang: 22,
        ba_kuang: 14,
        ba_ce: 3,
        thick: [12, 60, 0, 0],
        proportion: [1.38, 0.92, 0, 0],
        price: [9800, 9000, 0, 0],
        jgf: 0.16,
        zxyf: 260,
        sh: 0.02,
        lr: 0.08,
        lldj: 0.12
      }
    }
  });
  assert.strictEqual(backSealCostCalc.ok, true);
  assert(Number(backSealCostCalc.result?.finalQuote) > 0, 'back seal cost finalQuote should be > 0');

  const autoBagCostCalc = await httpJson('/api/cost/calculate', {
    method: 'POST',
    token: costLogin.token,
    body: {
      costType: 'auto_bag',
      withTrace: true,
      input: {
        quote_qty: 50000,
        quote_customer: '成本基准客户',
        quote_product_name: '自动包样例',
        thick: [12, 60, 0, 0],
        proportion: [1.38, 0.92, 0, 0],
        price: [9800, 9000, 0, 0],
        jgf: 0.21,
        fqfy: 120,
        yf: 200,
        zt: 30,
        btzt: 20,
        sh: 0.02,
        lr: 0.08,
        roll_w: 32,
        roll_l: 150
      }
    }
  });
  assert.strictEqual(autoBagCostCalc.ok, true);
  assert(Number(autoBagCostCalc.result?.finalQuote) > 0, 'auto bag cost finalQuote should be > 0');

  const createOrder = await httpJson('/api/orders', {
    method: 'POST',
    token: adminToken,
    body: {
      customerName: '功能守护客户',
      bagType: '八边封袋',
      useCase: '烟测',
      size: { length: 20, width: 12, bottom: 5 },
      urgency: 1,
      assignedPrintWorker: 'worker_print_guard',
      assignedLaminationWorker: 'worker_film_guard',
      assignedBaggingWorker: 'worker_bag_guard',
      assignedShippingWorker: 'worker_ship_guard',
      orderQty: '12000',
      orderSpec: '20*12*5'
    }
  });
  assert.strictEqual(createOrder.ok, true);
  const orderId = Number(createOrder.id);
  assert(orderId > 0, 'created order id should be > 0');

  const workerLogin = await login('worker_print_guard', 'guard123');
  assert(workerLogin?.token, 'worker login should return token');
  const workerMe = await httpJson('/api/auth/me', { token: workerLogin.token });
  assert.strictEqual(workerMe.user.role, 'worker_print');
  assert.deepStrictEqual(workerMe.user.permissions, {
    modules: {
      orders: true,
      workorder: false,
      board: true,
      cost: false,
      stats: false,
      admin: false,
      crm: false
    },
    ordersStages: ['印刷'],
    boardStages: ['印刷'],
    capabilities: { matrixSend: false }
  });
  const workerOrders = await httpJson('/api/orders', { token: workerLogin.token });
  assert(workerOrders.some(row => Number(row.id) === orderId), 'worker should see assigned order');

  const nextRes = await httpJson(`/api/orders/${orderId}/next`, {
    method: 'PATCH',
    token: workerLogin.token,
    body: { source: '1号机', qty: 1200 }
  });
  assert.strictEqual(nextRes.ok, true);
  assert.strictEqual(nextRes.from, '印刷');
  assert.strictEqual(nextRes.to, '复膜');
  const orderDetailAfterComplete = await httpJson(`/api/orders/${orderId}/detail`, { token: adminToken });
  assert(Array.isArray(orderDetailAfterComplete.operation_logs), 'order detail should include operation logs');
  assert(orderDetailAfterComplete.operation_logs.some(log => log.operated_by === 'worker_print_guard'), 'operation logs should carry operated_by username');

  const auditLogs = await httpJson('/api/system/audit-logs', { token: adminToken });
  assert(Array.isArray(auditLogs), 'system audit logs should return rows');
  assert(
    auditLogs.some(log => log.user_name === 'worker_print_guard' && log.action === 'advance_order_status' && String(log.detail || '').includes('印刷 -> 复膜')),
    'audit logs should preserve operator username'
  );

  await httpJson(`/api/orders/${orderId}/next`, {
    method: 'PATCH',
    token: workerLogin.token,
    body: { source: '1号机', qty: 1200 },
    expectedStatus: 403
  });

  const adminOrders = await httpJson('/api/orders?q=功能守护客户', { token: adminToken });
  const target = adminOrders.find(row => Number(row.id) === orderId);
  assert(target, 'admin order list should include created order');
  assert.strictEqual(target.status, '复膜');

  const legacyStyleOrder = await httpJson('/api/orders', {
    method: 'POST',
    token: adminToken,
    body: {
      customerName: '旧版映射客户',
      bagType: '三边封袋',
      useCase: '品名：手撕牛肉；规格：16*24；滚筒：80+；备注：旧版字段映射校验',
      size: { length: 16, width: 24 },
      orderQty: '8888',
      orderSpec: '16*24'
    }
  });
  assert.strictEqual(legacyStyleOrder.ok, true);
  const legacyStyleId = Number(legacyStyleOrder.id);
  assert(legacyStyleId > 0, 'legacy style order id should be > 0');

  const legacyStyleOrders = await httpJson('/api/orders?q=旧版映射客户', { token: adminToken });
  const legacyStyleRow = legacyStyleOrders.find(row => Number(row.id) === legacyStyleId);
  assert(legacyStyleRow, 'legacy style order should appear in orders list');
  assert.strictEqual(legacyStyleRow.product_name, '手撕牛肉');
  assert.strictEqual(legacyStyleRow.roller, '80+');

  const legacyStyleDetail = await httpJson(`/api/orders/${legacyStyleId}/detail`, { token: adminToken });
  assert.strictEqual(legacyStyleDetail.product_name, '手撕牛肉');
  assert.strictEqual(legacyStyleDetail.roller, '80+');

  await httpJson(`/api/orders/${legacyStyleId}/subscribe`, {
    method: 'POST',
    token: adminToken
  });
  const subscribedList = await httpJson('/api/orders?q=旧版映射客户', { token: adminToken });
  const subscribedListRow = subscribedList.find(row => Number(row.id) === legacyStyleId);
  assert.strictEqual(Number(subscribedListRow?.my_subscribed || 0), 1, 'orders list should reflect subscribed state');
  const subscribedDetail = await httpJson(`/api/orders/${legacyStyleId}/detail`, { token: adminToken });
  assert.strictEqual(Number(subscribedDetail.my_subscribed || 0), 1, 'order detail should reflect subscribed state');
  await httpJson(`/api/orders/${legacyStyleId}/subscribe`, {
    method: 'DELETE',
    token: adminToken
  });
  const unsubscribedDetail = await httpJson(`/api/orders/${legacyStyleId}/detail`, { token: adminToken });
  assert.strictEqual(Number(unsubscribedDetail.my_subscribed || 0), 0, 'order detail should reflect unsubscribed state');

  const workOrderCreate = await httpJson('/api/work-orders', {
    method: 'POST',
    token: adminToken,
    body: {
      salespersonId: 1,
      customerName: '摘要联调客户',
      productName: '柠檬凤爪',
      bagType: '自立拉链',
      spec: '18*26*8',
      quantity: '30000',
      deliveryDate: '2026-05-20',
      roller: 'HS-ROLL-01',
      processRequirements: {
        printMold: 'PET',
        printFilmSize: '44*12c',
        printFilmQty: 500,
        printFilmUnit: '米',
        printQty: '500米',
        refColor: '黄/黑',
        inkRequirement: '食品级',
        filmType: '双组',
        layer1: 'PET',
        l1Size: '44*12c',
        l1Weight: '12kg'
      },
      syncToOrder: true
    }
  });
  assert.strictEqual(workOrderCreate.ok, true);
  assert(Number(workOrderCreate.orderId) > 0, 'work order should sync to a real order');

  const summaryOrders = await httpJson('/api/orders?q=摘要联调客户', { token: adminToken });
  const summaryOrder = summaryOrders.find(row => Number(row.id) === Number(workOrderCreate.orderId));
  assert(summaryOrder, 'synced work order should appear in orders list');
  assert.strictEqual(summaryOrder.product_name, datedProductName);
  assert.strictEqual(summaryOrder.source_work_no, workOrderCreate.workNo);
  assert(summaryOrder.work_order_summary, 'orders list should include work order summary');
  assert.strictEqual(summaryOrder.work_order_summary.productName, datedProductName);
  assert.strictEqual(summaryOrder.work_order_summary.printMold, 'PET');
  assert.strictEqual(summaryOrder.work_order_summary.printFilmSize, '44*12c');
  assert.strictEqual(summaryOrder.work_order_summary.roller, 'HS-ROLL-01');
  assert.strictEqual(summaryOrder.roller, 'HS-ROLL-01');

  const workOrderList = await httpJson('/api/work-orders?q=摘要联调客户', { token: adminToken });
  assert(Array.isArray(workOrderList.rows), 'work order list should return rows');
  const createdWorkOrderRow = workOrderList.rows.find(row => Number(row.id) === Number(workOrderCreate.id));
  assert(createdWorkOrderRow, 'created work order should appear in work order list');
  assert.strictEqual(Number(createdWorkOrderRow.order_id || 0), Number(workOrderCreate.orderId), 'created work order should sync order_id back to list');
  assert(['sent', 'send_failed', 'pending'].includes(String(createdWorkOrderRow.email_status || '')), 'created work order should expose email status');

  const previewPdf = await httpResponse('/api/work-orders/preview.pdf', {
    method: 'POST',
    token: adminToken,
    body: {
      salespersonId: 1,
      customerName: '预览联调客户',
      productName: '风味鸭掌',
      bagType: '自立拉链',
      spec: '20*30*8',
      quantity: '5000',
      deliveryDate: '2026-05-21',
      roller: '80+',
      processRequirements: {
        printMold: 'PET',
        printFilmSize: '44*12c',
        printFilmQty: 500,
        printFilmUnit: '米'
      }
    }
  });
  assert(previewPdf.headers.get('content-type')?.includes('application/pdf'), 'preview pdf should return pdf');
  assert(previewPdf.buffer.length > 1000, 'preview pdf should have content');

  const previewDrafts = await httpJson('/api/work-orders/preview-drafts', { token: adminToken });
  assert(Array.isArray(previewDrafts.rows), 'preview drafts should return rows');
  const savedPreviewDraft = previewDrafts.rows.find(row => row.customer_name === '预览联调客户');
  assert(savedPreviewDraft, 'preview draft should be saved');
  const previewDraftDetail = await httpJson(`/api/work-orders/preview-drafts/${savedPreviewDraft.id}`, { token: adminToken });
  assert.strictEqual(previewDraftDetail.row.payload_json.customerName, '预览联调客户', 'preview draft detail should expose reusable payload');
  const savedPreviewPdf = await httpResponse(`/api/work-orders/preview-drafts/${savedPreviewDraft.id}/preview.pdf`, { token: adminToken });
  assert(savedPreviewPdf.headers.get('content-type')?.includes('application/pdf'), 'saved preview draft should use dedicated PDF endpoint');
  assert(savedPreviewPdf.buffer.length > 1000, 'saved preview draft PDF should have content');

  const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const imageResult = await httpJson(`/api/orders/${workOrderCreate.orderId}/image`, {
    method: 'POST', token: adminToken, body: { imageDataUrl: onePixelPng }
  });
  assert(String(imageResult.imageUrl || '').startsWith('/uploads/orders/'), 'real image upload should persist a local URL');

  const workOrderPdf = await httpResponse(`/api/work-orders/${workOrderCreate.id}/export.pdf`, {
    token: adminToken
  });
  assert(workOrderPdf.headers.get('content-type')?.includes('application/pdf'), 'work order export pdf should return pdf');

  const workOrderXls = await httpResponse(`/api/work-orders/${workOrderCreate.id}/export.xls`, {
    token: adminToken
  });
  assert(workOrderXls.headers.get('content-type')?.includes('application/vnd.ms-excel'), 'work order export xls should return excel');

  const historySnapshot = await httpJson('/api/cost/snapshots', {
    method: 'POST',
    token: costLogin.token,
    body: {
      kind: 'history',
      costType: 'eight_side_seal',
      input: { ba_chang: 20, ba_kuang: 12, ba_di: 5 },
      result: costCalc.result
    }
  });
  assert.strictEqual(historySnapshot.ok, true);
  const caseSnapshot = await httpJson('/api/cost/snapshots', {
    method: 'POST',
    token: costLogin.token,
    body: {
      kind: 'case',
      name: '八边封基准样例',
      costType: 'eight_side_seal',
      input: { ba_chang: 20, ba_kuang: 12, ba_di: 5 },
      result: costCalc.result
    }
  });
  assert.strictEqual(caseSnapshot.ok, true);
  const caseList = await httpJson('/api/cost/snapshots?kind=case', { token: costLogin.token });
  assert(caseList.some(row => Number(row.id) === Number(caseSnapshot.id)), 'case snapshot should be listed');
  await httpJson(`/api/cost/snapshots/${caseSnapshot.id}`, {
    method: 'PATCH',
    token: costLogin.token,
    body: { name: '八边封已改名样例' }
  });
  const historyList = await httpJson('/api/cost/snapshots?kind=history', { token: costLogin.token });
  assert(historyList.some(row => Number(row.id) === Number(historySnapshot.id)), 'history snapshot should be listed');
  assert(historyList.some(row => Number(row.input?.ba_chang || 0) === 20 && Number(row.input?.ba_kuang || 0) === 12), 'history snapshots should preserve original calculate input for UI replay');

  const costExportXls = await httpResponse('/api/cost/export.xls', {
    method: 'POST',
    token: costLogin.token,
    body: { costType: 'eight_side_seal', input: { ba_chang: 20, ba_kuang: 12, ba_di: 5, thick: [3,4,5,0], proportion: [0.92,1.02,1.12,0], price: [9500,12000,13500,0], jgf: 18, zxyf: 200, sh: 0.05, lr: 0.12, ba_zdf: 50 }, result: costCalc.result }
  });
  assert(costExportXls.headers.get('content-type')?.includes('application/vnd.ms-excel'), 'cost export xls should return excel');

  const costExportPdf = await httpResponse('/api/cost/export.pdf', {
    method: 'POST',
    token: costLogin.token,
    body: { costType: 'eight_side_seal', input: { ba_chang: 20, ba_kuang: 12, ba_di: 5, thick: [3,4,5,0] }, result: costCalc.result }
  });
  assert(costExportPdf.headers.get('content-type')?.includes('application/pdf'), 'cost export pdf should return pdf');

  const queuedMail = await httpJson('/api/cost/send-email', {
    method: 'POST',
    token: costLogin.token,
    body: { costType: 'eight_side_seal', to: 'qa@example.com', cc: 'cc@example.com', input: { ba_chang: 20, ba_kuang: 12, ba_di: 5 }, result: costCalc.result }
  });
  assert.strictEqual(queuedMail.ok, true);
  const emailLogs = await httpJson('/api/cost/email-logs', { token: costLogin.token });
  assert(Array.isArray(emailLogs.rows), 'cost email logs should return rows');
  assert(emailLogs.rows.some(row => Number(row.id) === Number(queuedMail.id)), 'queued cost email should be listed');
  await httpJson(`/api/cost/snapshots/${caseSnapshot.id}`, {
    method: 'DELETE',
    token: costLogin.token
  });

  const createSortProbe = async (name, urgency = 0) => {
    const ret = await httpJson('/api/orders', {
      method: 'POST',
      token: adminToken,
      body: {
        customerName: `排序联调客户-${name}`,
        bagType: '自立袋',
        useCase: `品名：${name}`,
        size: { length: 12, width: 18 },
        urgency,
        orderQty: '1000',
        orderSpec: '12*18'
      }
    });
    return Number(ret.id);
  };

  const stagePrintUrgent = await createSortProbe('印刷加急', 1);
  const stagePrintNormal = await createSortProbe('印刷普通', 0);
  const stageFilm = await createSortProbe('复膜普通', 0);
  const stageBag = await createSortProbe('制袋普通', 0);
  const stageShip = await createSortProbe('发货普通', 0);
  const stageDone = await createSortProbe('完成普通', 0);

  await httpJson(`/api/orders/${stageFilm}/next`, {
    method: 'PATCH',
    token: adminToken,
    body: { source: '1号机', qty: 1000 }
  });
  await httpJson(`/api/orders/${stageBag}/next`, {
    method: 'PATCH',
    token: adminToken,
    body: { source: '2号机', qty: 1000 }
  });
  await httpJson(`/api/orders/${stageBag}/next`, {
    method: 'PATCH',
    token: adminToken,
    body: { source: '干复 1 号', qty: 1000 }
  });
  await httpJson(`/api/orders/${stageShip}/next`, {
    method: 'PATCH',
    token: adminToken,
    body: { source: '3号机', qty: 1000 }
  });
  await httpJson(`/api/orders/${stageShip}/next`, {
    method: 'PATCH',
    token: adminToken,
    body: { source: '干复 2 号', qty: 1000 }
  });
  await httpJson(`/api/orders/${stageShip}/next`, {
    method: 'PATCH',
    token: adminToken,
    body: { source: '厂内1 号', qty: 1000 }
  });
  await httpJson(`/api/orders/${stageDone}/next`, {
    method: 'PATCH',
    token: adminToken,
    body: { source: '源天外加工1', qty: 1000 }
  });
  await httpJson(`/api/orders/${stageDone}/next`, {
    method: 'PATCH',
    token: adminToken,
    body: { source: '无溶 1 号', qty: 1000 }
  });
  await httpJson(`/api/orders/${stageDone}/next`, {
    method: 'PATCH',
    token: adminToken,
    body: { source: '厂内 2 号', qty: 1000 }
  });
  await httpJson(`/api/orders/${stageDone}/next`, {
    method: 'PATCH',
    token: adminToken,
    body: { source: '发货口1', qty: 1 }
  });

  const todayPaged = await httpJson(`/api/orders?q=${encodeURIComponent('排序联调客户')}&updatedFrom=${encodeURIComponent(todayStartSql)}&sortBy=today_stage&page=1&pageSize=5`, {
    token: adminToken
  });
  assert.strictEqual(todayPaged.total, 6);
  assert.deepStrictEqual(
    todayPaged.rows.map(row => `${row.customer_name}:${row.status}:${row.urgency}`).slice(0, 5),
    [
      '排序联调客户-印刷加急:印刷:1',
      '排序联调客户-印刷普通:印刷:0',
      '排序联调客户-复膜普通:复膜:0',
      '排序联调客户-制袋普通:制袋:0',
      '排序联调客户-发货普通:发货:0'
    ]
  );
  const todayPagedSecond = await httpJson(`/api/orders?q=${encodeURIComponent('排序联调客户')}&updatedFrom=${encodeURIComponent(todayStartSql)}&sortBy=today_stage&page=2&pageSize=5`, {
    token: adminToken
  });
  assert.strictEqual(todayPagedSecond.rows.length, 1);
  assert.strictEqual(todayPagedSecond.rows[0].customer_name, '排序联调客户-完成普通');
  assert.strictEqual(todayPagedSecond.rows[0].status, '完成');

  const summary = await httpJson(`/api/orders/summary?q=${encodeURIComponent('排序联调客户')}&updatedFrom=${encodeURIComponent(todayStartSql)}`, {
    token: adminToken
  });
  assert.strictEqual(summary.total, 6);
  assert.strictEqual(summary.urgentCount, 1);
  assert.strictEqual(summary.stageCounts['印刷'], 2);
  assert.strictEqual(summary.stageCounts['复膜'], 1);
  assert.strictEqual(summary.stageCounts['制袋'], 1);
  assert.strictEqual(summary.stageCounts['发货'], 1);
  assert.strictEqual(summary.stageCounts['完成'], 1);

  const abnormalOrder = await httpJson('/api/orders', {
    method: 'POST',
    token: adminToken,
    body: {
      customerName: '高级筛选客户-异常',
      bagType: '自立袋',
      useCase: '备注：字段缺失异常单',
      size: { length: 10, width: 20 },
      urgency: 0,
      orderQty: '',
      orderSpec: ''
    }
  });
  assert.strictEqual(abnormalOrder.ok, true);

  const rollerUrgentOrders = await httpJson(`/api/orders?q=${encodeURIComponent('排序联调客户')}&roller=${encodeURIComponent('HS-ROLL-01')}&urgentOnly=true`, {
    token: adminToken
  });
  assert.strictEqual(rollerUrgentOrders.length, 0, 'roller + urgentOnly should apply across list results');

  const rollerSummary = await httpJson(`/api/orders/summary?q=${encodeURIComponent('摘要联调客户')}&roller=${encodeURIComponent('HS-ROLL-01')}`, {
    token: adminToken
  });
  assert.strictEqual(rollerSummary.total, 1, 'summary should honor roller filter');
  assert.strictEqual(rollerSummary.urgentCount, 0, 'summary urgent count should honor roller filter scope');

  const stayFiltered = await httpJson(`/api/orders?q=${encodeURIComponent('高级筛选客户')}&stayMinDays=999`, {
    token: adminToken
  });
  assert.strictEqual(stayFiltered.length, 0, 'stayMinDays should filter list results on backend');

  const abnormalFiltered = await httpJson(`/api/orders?q=${encodeURIComponent('高级筛选客户')}&abnormal=true`, {
    token: adminToken
  });
  assert.strictEqual(abnormalFiltered.length, 1, 'abnormal filter should keep only abnormal orders');
  assert.strictEqual(Number(abnormalFiltered[0].id), Number(abnormalOrder.id), 'abnormal filter should return the abnormal order');

  const abnormalSummary = await httpJson(`/api/orders/summary?q=${encodeURIComponent('高级筛选客户')}&abnormal=true`, {
    token: adminToken
  });
  assert.strictEqual(abnormalSummary.total, 1, 'summary should honor abnormal filter');
  assert.strictEqual(abnormalSummary.stageCounts['印刷'], 1, 'abnormal summary should aggregate only abnormal rows');

  const boardPanel = await httpJson('/api/orders/board/panel', { token: adminToken });
  assert(Array.isArray(boardPanel.rows), 'board panel should return rows');
  assert(Array.isArray(boardPanel.summary), 'board panel should return summary');
  assert(boardPanel.rows.some(row => row.customer_name === '排序联调客户-印刷加急' && row.status === '印刷'), 'board panel should include active print orders');
  assert(boardPanel.rows.some(row => row.customer_name === '排序联调客户-发货普通' && row.status === '发货'), 'board panel should include active ship orders');
  const boardPrintSummary = boardPanel.summary.find(item => item.status === '印刷');
  assert(boardPrintSummary && Number(boardPrintSummary.total) >= 2, 'board panel summary should count print stage totals');

  const workerBoardPanel = await httpJson('/api/orders/board/panel', { token: workerLogin.token });
  assert(workerBoardPanel.rows.every(row => row.status === '印刷' && row.assigned_print_worker === 'worker_print_guard'), 'worker board panel should be scoped to assigned print rows');

  console.log('SMOKE PASS');
}

main()
  .catch(err => {
    console.error('SMOKE FAIL');
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

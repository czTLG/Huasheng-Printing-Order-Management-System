const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

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

async function login(username, password, expectedStatus = 200) {
  return httpJson('/api/auth/login', {
    method: 'POST',
    expectedStatus,
    body: { username, password }
  });
}

async function main() {
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
      FORCE_HTTPS: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', chunk => { stdout += String(chunk); });
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  child.on('exit', code => {
    if (code !== 0) stderr += `\n[server-exit] code=${code}`;
  });

  await waitForHealth();

  await login('admin', 'wrong-password', 401);
  const adminLogin = await login('admin', 'admin');
  assert(adminLogin?.token, 'admin login should return token');
  const adminToken = adminLogin.token;

  const me = await httpJson('/api/auth/me', { token: adminToken });
  assert.strictEqual(me.user.username, 'admin');
  assert.strictEqual(me.user.role, 'super_admin');

  await httpJson('/api/orders', { expectedStatus: 401 });

  await httpJson('/api/auth/register', {
    method: 'POST',
    body: { username: 'chenyongjie', password: 'guard123', fullName: '成本守护' }
  });
  await httpJson('/api/auth/register', {
    method: 'POST',
    body: { username: 'worker_print_guard', password: 'guard123', fullName: '印刷守护' }
  });

  const pending = await httpJson('/api/auth/users/pending', { token: adminToken });
  const costUser = pending.find(row => row.username === 'chenyongjie');
  const workerUser = pending.find(row => row.username === 'worker_print_guard');
  assert(costUser, 'pending cost user should exist');
  assert(workerUser, 'pending worker user should exist');

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

  const costLogin = await login('chenyongjie', 'guard123');
  assert(costLogin?.token, 'cost user login should return token');
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
  const workerOrders = await httpJson('/api/orders', { token: workerLogin.token });
  assert(workerOrders.some(row => Number(row.id) === orderId), 'worker should see assigned order');

  const nextRes = await httpJson(`/api/orders/${orderId}/next`, {
    method: 'PATCH',
    token: workerLogin.token,
    body: { source: '1号印刷机', qty: 1200 }
  });
  assert.strictEqual(nextRes.ok, true);
  assert.strictEqual(nextRes.from, '印刷');
  assert.strictEqual(nextRes.to, '复膜');

  await httpJson(`/api/orders/${orderId}/next`, {
    method: 'PATCH',
    token: workerLogin.token,
    body: { source: '1号印刷机', qty: 1200 },
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
  assert.strictEqual(summaryOrder.product_name, '柠檬凤爪 04.29');
  assert.strictEqual(summaryOrder.source_work_no, workOrderCreate.workNo);
  assert(summaryOrder.work_order_summary, 'orders list should include work order summary');
  assert.strictEqual(summaryOrder.work_order_summary.productName, '柠檬凤爪 04.29');
  assert.strictEqual(summaryOrder.work_order_summary.printMold, 'PET');
  assert.strictEqual(summaryOrder.work_order_summary.printFilmSize, '44*12c');
  assert.strictEqual(summaryOrder.work_order_summary.roller, 'HS-ROLL-01');
  assert.strictEqual(summaryOrder.roller, 'HS-ROLL-01');

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

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

function todayMd() {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
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

  // Extract randomly generated admin password from server stdout
  const pwMatch = stdout.match(/\[db\] Created default admin account\. username=admin password=(\S+)/);
  const adminPwd = pwMatch ? pwMatch[1] : 'admin';

  await login('admin', 'wrong-password', 401);
  const adminLogin = await login('admin', adminPwd);
  assert(adminLogin?.token, 'admin login should return token');
  const adminToken = adminLogin.token;

  const me = await httpJson('/api/auth/me', { token: adminToken });
  assert.strictEqual(me.user.username, 'admin');
  assert.strictEqual(me.user.role, 'super_admin');
  assert.deepStrictEqual(me.user.permissions, { all: true });

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

  const pending = await httpJson('/api/auth/users/pending', { token: adminToken });
  const costUser = pending.find(row => row.username === 'chenyongjie');
  const workerUser = pending.find(row => row.username === 'worker_print_guard');
  const scopedSalesUser = pending.find(row => row.username === 'sales_scope_guard');
  assert(costUser, 'pending cost user should exist');
  assert(workerUser, 'pending worker user should exist');
  assert(scopedSalesUser, 'pending scoped sales user should exist');

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

  const costLogin = await login('chenyongjie', 'guard123');
  assert(costLogin?.token, 'cost user login should return token');
  const scopedSalesLogin = await login('sales_scope_guard', 'guard123');
  const scopedSalesMe = await httpJson('/api/auth/me', { token: scopedSalesLogin.token });
  assert.deepStrictEqual(scopedSalesMe.user.permissions, {
    modules: { orders: true, workorder: true, board: false, cost: false, stats: false, admin: false },
    ordersStages: ['印刷', '复膜', '制袋', '发货', '完成', '全部'],
    boardStages: []
  });
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
      admin: false
    },
    ordersStages: ['印刷'],
    boardStages: ['印刷']
  });
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
  assert(previewDrafts.rows.some(row => row.customer_name === '预览联调客户'), 'preview draft should be saved');

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
    body: { source: '印刷机A', qty: 1000 }
  });
  await httpJson(`/api/orders/${stageBag}/next`, {
    method: 'PATCH',
    token: adminToken,
    body: { source: '印刷机B', qty: 1000 }
  });
  await httpJson(`/api/orders/${stageBag}/next`, {
    method: 'PATCH',
    token: adminToken,
    body: { source: '复膜机A', qty: 1000 }
  });
  await httpJson(`/api/orders/${stageShip}/next`, {
    method: 'PATCH',
    token: adminToken,
    body: { source: '印刷机C', qty: 1000 }
  });
  await httpJson(`/api/orders/${stageShip}/next`, {
    method: 'PATCH',
    token: adminToken,
    body: { source: '复膜机B', qty: 1000 }
  });
  await httpJson(`/api/orders/${stageShip}/next`, {
    method: 'PATCH',
    token: adminToken,
    body: { source: '制袋机A', qty: 1000 }
  });
  await httpJson(`/api/orders/${stageDone}/next`, {
    method: 'PATCH',
    token: adminToken,
    body: { source: '印刷机D', qty: 1000 }
  });
  await httpJson(`/api/orders/${stageDone}/next`, {
    method: 'PATCH',
    token: adminToken,
    body: { source: '复膜机C', qty: 1000 }
  });
  await httpJson(`/api/orders/${stageDone}/next`, {
    method: 'PATCH',
    token: adminToken,
    body: { source: '制袋机B', qty: 1000 }
  });
  await httpJson(`/api/orders/${stageDone}/next`, {
    method: 'PATCH',
    token: adminToken,
    body: { source: '发货台A', qty: 1 }
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

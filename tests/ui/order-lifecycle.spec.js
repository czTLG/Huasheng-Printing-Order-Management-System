const { test, expect } = require('@playwright/test');

async function login(page) {
  await page.goto('./');
  await page.getByPlaceholder('请输入系统账号').fill(process.env.E2E_USERNAME);
  await page.getByPlaceholder('请输入系统密码').fill(process.env.E2E_PASSWORD);
  await page.getByRole('button', { name: '登录进入系统' }).click();
  await expect(page.getByRole('button', { name: '订单中心' })).toBeVisible();
}

async function api(page, method, url, data) {
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const response = await page.request.fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  expect(response.ok(), `${method} ${url}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

function orderCard(page, productName) {
  return page.getByText(productName, { exact: true })
    .locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " group ")][1]');
}

async function expandCard(page, productName) {
  const card = orderCard(page, productName);
  await expect(card).toBeVisible();
  if (await card.getByRole('button', { name: '详情' }).count() === 0) {
    await card.locator('button').first().click();
  }
  await expect(card.getByRole('button', { name: '详情' })).toBeVisible();
  return card;
}

async function completeStage(page, productName, actionName, heading, source, qty) {
  const card = await expandCard(page, productName);
  await card.getByRole('button', { name: actionName }).click();
  const modal = page.getByText(heading, { exact: true }).locator('..').locator('..');
  await modal.locator('select').selectOption(source);
  await modal.locator('input[type="number"]').fill(String(qty));
  await modal.getByRole('button', { name: '确认完成' }).click();
  await expect(page.getByText(heading, { exact: true })).toBeHidden();
}

test('开单同步订单、图片、状态、成本和历史形成闭环', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  test.skip(testInfo.project.name !== 'desktop-chrome', '完整生命周期使用桌面端执行');
  await login(page);

  const unique = Date.now();
  const customerName = `回归客户${unique}`;
  const productName = `闭环产品${unique}`;

  const meta = await api(page, 'GET', '/api/work-orders/meta');
  const salesperson = meta.salespersons[0];
  expect(salesperson?.id).toBeTruthy();

  const customer = await api(page, 'POST', '/api/work-orders/customers', {
    salespersonId: salesperson.id,
    name: customerName,
    defaultBagType: '三边封',
    defaultSpec: '20×30cm',
    defaultRoller: '测试压辊',
  });

  const created = await api(page, 'POST', '/api/work-orders', {
    salespersonId: salesperson.id,
    customerId: customer.id,
    customerName,
    productName,
    bagType: '三边封',
    spec: '20×30cm',
    quantity: '10000',
    roller: '测试压辊',
    remark: 'E2E 生命周期回归',
    syncToOrder: true,
    processRequirements: {
      printMold: 'PET',
      printFilmSize: '620mm',
      printFilmQty: '1000',
      printFilmUnit: '米',
      inkRequirement: '里印',
      layer1: 'PET',
      l1Size: '12μm',
      layer2: 'PE',
      l2Size: '80μm',
    },
  });
  expect(created.id).toBeTruthy();
  expect(created.orderId).toBeTruthy();

  await page.getByRole('button', { name: '开单管理' }).click();
  await page.waitForTimeout(500);
  const workSearch = page.getByPlaceholder('搜索开单号、客户、品名、规格...');
  await workSearch.fill(created.workNo);
  await workSearch.press('Enter');
  await expect(page.getByText(created.workNo, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(created.productNameSaved, { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: '订单中心' }).click();
  await page.waitForTimeout(500);
  await page.getByPlaceholder('搜索(客户/袋型/备注/规格)...').fill(customerName);
  await (await expandCard(page, created.productNameSaved)).getByRole('button', { name: '详情' }).click();
  const imageResponse = page.waitForResponse((response) => response.url().includes(`/api/orders/${created.orderId}/image`) && response.request().method() === 'POST');
  await page.locator('input[type="file"][accept*="image/png"]').setInputFiles({
    name: 'matrix.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nkwAAAAASUVORK5CYII=', 'base64'),
  });
  expect((await imageResponse).ok()).toBeTruthy();
  await expect(page.locator('img[alt="Bag Ref"]')).toBeVisible();

  await page.reload();
  await page.getByPlaceholder('搜索(客户/袋型/备注/规格)...').fill(customerName);
  await (await expandCard(page, created.productNameSaved)).getByRole('button', { name: '完成印刷' }).click();
  const processModal = page.getByText('印刷完成登记', { exact: true }).locator('..').locator('..');
  await processModal.locator('select').selectOption('1号机');
  await processModal.locator('input[type="number"]').fill('1000');
  await processModal.locator('textarea').fill('自动化完成印刷');
  await processModal.getByRole('button', { name: '确认完成' }).click();

  const detail = await api(page, 'GET', `/api/orders/${created.orderId}/detail`);
  expect(detail.status).toBe('复膜');
  const stageLogs = await api(page, 'GET', `/api/orders/${created.orderId}/stage-logs`);
  expect(stageLogs.logs.some((log) => log.stage === '印刷' && log.source === '1号机' && log.qty === 1000)).toBeTruthy();

  const token = await page.evaluate(() => localStorage.getItem('token'));
  const invalidSource = await page.request.patch(`/api/orders/${created.orderId}/next`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { source: '不存在的机台', qty: 900 },
  });
  expect(invalidSource.status()).toBe(400);
  expect((await invalidSource.json()).error).toContain('来源不在系统配置清单中');

  await page.getByPlaceholder('搜索(客户/袋型/备注/规格)...').fill(customerName);
  await (await expandCard(page, created.productNameSaved)).getByRole('button', { name: '追溯' }).click();
  await expect(page.getByText('生产追溯记录', { exact: true })).toBeVisible();
  await expect(page.getByText('来源: 1号机', { exact: true })).toBeVisible();
  await expect(page.getByText('数量: 1000 米', { exact: true })).toBeVisible();
  await page.getByText('生产追溯记录', { exact: true }).locator('..').locator('..').getByRole('button').click();

  await (await expandCard(page, created.productNameSaved)).getByRole('button', { name: '回退印刷' }).click();
  const rollbackModal = page.getByText('工序完成回退', { exact: true }).locator('..').locator('..');
  await expect(rollbackModal.locator('button[type="submit"]')).toBeEnabled();
  await rollbackModal.locator('button[type="submit"]').click();

  const rolledBackDetail = await api(page, 'GET', `/api/orders/${created.orderId}/detail`);
  expect(rolledBackDetail.status).toBe('印刷');
  const rolledBackLogs = await api(page, 'GET', `/api/orders/${created.orderId}/stage-logs`);
  expect(rolledBackLogs.logs.some((log) => log.eventType === 'ROLLBACK' && log.rollbackReason === '')).toBeTruthy();

  await completeStage(page, created.productNameSaved, '完成印刷', '印刷完成登记', '2号机', 980);
  await completeStage(page, created.productNameSaved, '完成覆膜', '复膜完成登记', '干复 1 号', 960);
  await completeStage(page, created.productNameSaved, '完成制袋', '制袋完成登记', '厂内1 号', 9500);
  await completeStage(page, created.productNameSaved, '完成发货', '发货完成登记', '发货口1', 1);

  const completedDetail = await api(page, 'GET', `/api/orders/${created.orderId}/detail`);
  expect(completedDetail.status).toBe('完成');
  const completedLogs = await api(page, 'GET', `/api/orders/${created.orderId}/stage-logs`);
  const activeCompletions = completedLogs.logs.filter((log) => log.eventType === 'COMPLETE' && !log.rolledBack);
  expect(activeCompletions.map((log) => log.stage).sort()).toEqual(['制袋', '印刷', '发货', '复膜'].sort());
  expect(activeCompletions.find((log) => log.stage === '印刷')?.source).toBe('2号机');
  expect(activeCompletions.find((log) => log.stage === '复膜')?.source).toBe('干复 1 号');
  expect(activeCompletions.find((log) => log.stage === '制袋')?.qty).toBe(9500);
  expect(activeCompletions.find((log) => log.stage === '发货')?.qty).toBe(1);

  const completedCard = await expandCard(page, created.productNameSaved);
  await expect(completedCard.getByText('完成', { exact: true }).first()).toBeVisible();
  await completedCard.getByRole('button', { name: '追溯' }).click();
  await expect(page.getByText('生产追溯记录', { exact: true })).toBeVisible();
  await expect(page.getByText('来源: 2号机', { exact: true })).toBeVisible();
  await expect(page.getByText('来源: 干复 1 号', { exact: true })).toBeVisible();
  await expect(page.getByText('数量: 9500 袋', { exact: true })).toBeVisible();
  await expect(page.getByText('来源: 发货口1', { exact: true })).toBeVisible();
  await page.getByText('生产追溯记录', { exact: true }).locator('..').locator('..').getByRole('button').click();

  const calculation = await api(page, 'POST', '/api/cost/calculate', {
    costType: 'stand_zipper_bag',
    withTrace: true,
    input: {
      ba_chang: 20, ba_kuang: 12, ba_di: 5,
      thick: [60, 15, 12, 0], proportion: [0.92, 1.14, 1.38, 0],
      price: [9000, 12500, 9800, 0], jgf: 18, zxyf: 600,
      sh: 0.1, lr: 0.12, lldj: 2.2,
    },
  });
  const snapshot = await api(page, 'POST', '/api/cost/snapshots', {
    kind: 'history',
    costType: 'stand_zipper_bag',
    input: { customerName, productName: created.productNameSaved },
    result: calculation.result,
    orderId: created.orderId,
    workOrderId: created.id,
  });
  expect(snapshot.id).toBeTruthy();

  const histories = await api(page, 'GET', '/api/cost/snapshots?kind=history');
  const linked = histories.find((row) => row.id === snapshot.id);
  expect(linked.orderId).toBe(created.orderId);
  expect(linked.workOrderId).toBe(created.id);

  await page.getByRole('button', { name: '成本核算' }).click();
  await page.waitForTimeout(600);
  await expect(page.locator('option').filter({ hasText: `订单#${created.orderId}` })).toHaveCount(1);
});

const { test, expect } = require('@playwright/test');

test('真实域名健康接口与新版登录页可用', async ({ page, request }) => {
  const base = new URL(process.env.PRODUCTION_BASE_URL || 'https://cahs.top/new/');
  const health = await request.get(`${base.origin}/health`);
  expect(health.ok()).toBeTruthy();
  expect(await health.json()).toMatchObject({ ok: true });

  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`));

  const response = await page.goto('./', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByPlaceholder('请输入系统账号')).toBeVisible();
  await expect(page.getByPlaceholder('请输入系统密码')).toBeVisible();
  await expect(page.getByRole('button', { name: '登录进入系统' })).toBeVisible();

  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 2);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  expect(failedRequests, failedRequests.join('\n')).toEqual([]);
});

test('专用账号登录后的核心页面只读冒烟', async ({ page, request }, testInfo) => {
  const username = process.env.PRODUCTION_SMOKE_USERNAME;
  const password = process.env.PRODUCTION_SMOKE_PASSWORD;
  test.skip(!username || !password, '未配置生产只读冒烟账号');

  await page.goto('./');
  await page.getByPlaceholder('请输入系统账号').fill(username);
  await page.getByPlaceholder('请输入系统密码').fill(password);
  await page.getByRole('button', { name: '登录进入系统' }).click();
  await expect(page.getByRole('button', { name: '订单中心' })).toBeVisible();

  if (testInfo.project.name === 'production-mobile') {
    await page.waitForTimeout(400);
    await page.locator('header button').first().click();
  }
  if (await page.getByRole('button', { name: '开单管理' }).count()) {
    await page.getByRole('button', { name: '开单管理' }).click();
    await page.waitForTimeout(500);
    await expect(page.getByText('开单管理作业', { exact: true })).toBeVisible();
  }

  const token = await page.evaluate(() => localStorage.getItem('token'));
  const denied = await request.post(`${new URL(process.env.PRODUCTION_BASE_URL || 'https://cahs.top/new/').origin}/api/work-orders`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {},
  });
  expect(denied.status()).toBe(403);
});

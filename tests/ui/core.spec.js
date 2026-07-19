const { test, expect } = require('@playwright/test');

async function login(page) {
  await page.goto('./');
  await page.getByPlaceholder('请输入系统账号').fill(process.env.E2E_USERNAME);
  await page.getByPlaceholder('请输入系统密码').fill(process.env.E2E_PASSWORD);
  await page.getByRole('button', { name: '登录进入系统' }).click();
  await expect(page.getByRole('button', { name: '订单中心' })).toBeVisible();
}

async function expectNoPageOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 2);
}

async function openMobileMenu(page) {
  await page.waitForTimeout(400);
  await page.locator('header button').first().click();
  await expect(page.getByRole('button', { name: '订单中心' })).toBeVisible();
}

test('管理员登录和核心模块导航可用', async ({ page }, testInfo) => {
  const unauthorized = [];
  page.on('response', (response) => {
    if (response.status() === 401) {
      unauthorized.push(`${response.request().method()} ${response.url()} auth=${response.request().headers().authorization ? 'yes' : 'no'}`);
    }
  });
  await login(page);

  expect(await page.evaluate(() => localStorage.getItem('savedPassword'))).toBeNull();
  await expectNoPageOverflow(page);

  if (testInfo.project.name === 'mobile-chrome') {
    await openMobileMenu(page);
  }
  await page.getByRole('button', { name: '开单管理' }).click();
  await page.waitForTimeout(500);
  await expect(page.getByText('开单管理作业', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /立即创建排产开单/ })).toBeVisible();
  await expectNoPageOverflow(page);

  if (testInfo.project.name === 'mobile-chrome') {
    await openMobileMenu(page);
  }
  await page.getByRole('button', { name: '成本核算' }).click();
  await page.waitForTimeout(500);
  expect(unauthorized, unauthorized.join('\n')).toEqual([]);
  await expect(page.getByText('传统成本核算', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '填充示例' })).toHaveCount(1);
  await expectNoPageOverflow(page);
});

test('核算示例可以完成计算并显示结果', async ({ page }, testInfo) => {
  await login(page);
  if (testInfo.project.name === 'mobile-chrome') {
    await openMobileMenu(page);
  }
  await page.getByRole('button', { name: '成本核算' }).click();
  await page.waitForTimeout(600);
  await expect(page.getByRole('button', { name: /BOPP · 比重0\.91 · ¥9200/ })).toBeVisible();
  await page.getByRole('button', { name: '填充示例' }).click();
  await page.waitForTimeout(200);
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/cost/calculate'));
  await page.getByRole('button', { name: '开始计算' }).click({ force: true });
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect(page.getByText('计算结果', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /运算过程追踪/ }).click();
  await expect(page.getByRole('cell', { name: '展开长度', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: '最终报价', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'z_chang', exact: true })).toHaveCount(0);
  await expectNoPageOverflow(page);
});

test('手机端菜单和开单表单保持可操作', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome', '仅验证手机端交互');
  await login(page);
  await openMobileMenu(page);
  await page.getByRole('button', { name: '开单管理' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /立即创建排产开单/ }).click({ force: true });
  await expect(page.getByText('排产开单管理', { exact: true })).toBeVisible();

  const controls = page.locator('input:visible, select:visible, textarea:visible, button:visible');
  expect(await controls.count()).toBeGreaterThan(5);
  await expectNoPageOverflow(page);
});

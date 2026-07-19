const { test, expect } = require('@playwright/test');

async function login(page) {
  await page.goto('./');
  await page.getByPlaceholder('请输入系统账号').fill(process.env.E2E_USERNAME);
  await page.getByPlaceholder('请输入系统密码').fill(process.env.E2E_PASSWORD);
  await page.getByRole('button', { name: '登录进入系统' }).click();
  await expect(page.getByRole('button', { name: '订单中心' })).toBeVisible();
}

function field(page, label, selector = 'input') {
  return page.locator('label').filter({ hasText: label }).locator('..')
    .filter({ has: page.locator(selector) }).first().locator(selector).first();
}

async function openMobileMenu(page) {
  await page.waitForTimeout(400);
  await page.locator('header button').first().click();
  await expect(page.getByRole('button', { name: '订单中心' })).toBeVisible();
}

async function expectNoPageOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 2);
}

test('新版表单全浏览器创建开单并同步订单', async ({ page }, testInfo) => {
  test.setTimeout(60_000);

  const unique = Date.now();
  const customerName = `表单客户${unique}`;
  const productName = `表单产品${unique}`;

  await login(page);
  if (testInfo.project.name === 'mobile-chrome') await openMobileMenu(page);
  await page.getByRole('button', { name: '开单管理' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /立即创建排产开单/ }).click();
  await expect(page.getByText('排产开单管理', { exact: true })).toBeVisible();
  await expectNoPageOverflow(page);

  const salespersonSelect = field(page, '业务员', 'select');
  const salesperson = await salespersonSelect.locator('option').nth(1).getAttribute('value');
  expect(salesperson).toBeTruthy();
  await salespersonSelect.selectOption(salesperson);

  await page.getByRole('button', { name: /新增客户\/商品/ }).click();
  const newPanel = page.getByText('新增客户/商品（手工建档）', { exact: true }).locator('..');
  await newPanel.getByPlaceholder('输入新客户名称').fill(customerName);
  await newPanel.getByPlaceholder('可先录入一个商品名').fill(productName);
  const customerResponse = page.waitForResponse((response) => response.url().includes('/api/work-orders/customers') && response.request().method() === 'POST');
  await newPanel.getByRole('button', { name: '保存客户' }).click();
  expect((await customerResponse).ok()).toBeTruthy();

  await field(page, '客户', 'select').selectOption(customerName);
  await field(page, '品名').fill(productName);
  await field(page, '规格').fill('20*30cm');
  await field(page, '要求数量').fill('10000');
  const materialSelect = field(page, '印膜材料', 'select');
  await expect.poll(() => materialSelect.locator('option').count()).toBeGreaterThan(1);
  const material = await materialSelect.locator('option').nth(1).getAttribute('value');
  expect(material).toBeTruthy();
  await materialSelect.selectOption(material);
  await field(page, '印膜尺寸').fill('55*10c');
  await field(page, '印膜数量').fill('1200');
  await field(page, '印膜单位', 'select').selectOption('米');
  await field(page, '压辊', 'select').selectOption('55');
  await field(page, '袋型', 'select').selectOption('三边封');
  await field(page, '备注').fill('新版表单浏览器回归');

  await field(page, '上传袋型图片', 'input[type="file"]').setInputFiles({
    name: 'form-matrix.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nkwAAAAASUVORK5CYII=', 'base64'),
  });

  const syncCheckbox = page.getByText('同步生成订单并发邮件', { exact: true }).first().locator('..').locator('input[type="checkbox"]');
  if (!(await syncCheckbox.isChecked())) await syncCheckbox.check();

  const createResponse = page.waitForResponse((response) => response.url().endsWith('/api/work-orders') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '提交开单', exact: true }).click();
  expect((await createResponse).ok()).toBeTruthy();

  await expect(page.getByText('开单管理作业', { exact: true })).toBeVisible();
  await page.getByPlaceholder('搜索开单号、客户、品名、规格...').fill(customerName);
  await page.getByPlaceholder('搜索开单号、客户、品名、规格...').press('Enter');
  if (testInfo.project.name === 'desktop-chrome') {
    await expect(page.getByText(customerName, { exact: true }).first()).toBeVisible();
  }
  const listedProduct = testInfo.project.name === 'mobile-chrome'
    ? page.getByText(new RegExp(productName)).last()
    : page.getByText(new RegExp(productName)).first();
  await expect(listedProduct).toBeVisible();
  await expectNoPageOverflow(page);

  if (testInfo.project.name === 'mobile-chrome') await openMobileMenu(page);
  await page.getByRole('button', { name: '订单中心' }).click();
  await page.waitForTimeout(500);
  await page.getByPlaceholder('搜索(客户/袋型/备注/规格)...').fill(customerName);
  const productHeading = page.getByText(new RegExp(productName)).first();
  await expect(productHeading).toBeVisible();
  const card = productHeading.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " group ")][1]');
  await expect(card).toBeVisible();
  if (await card.getByRole('button', { name: '详情' }).count() === 0) {
    await card.locator('button').first().click();
  }
  await card.getByRole('button', { name: '详情' }).click();
  await expect(page.locator('img[alt="Bag Ref"]')).toBeVisible();
  await expectNoPageOverflow(page);
});

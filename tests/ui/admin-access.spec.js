const { test, expect } = require('@playwright/test');

async function login(page, username, password) {
  await page.goto('./');
  await page.getByPlaceholder('请输入系统账号').fill(username);
  await page.getByPlaceholder('请输入系统密码').fill(password);
  await page.getByRole('button', { name: '登录进入系统' }).click();
  await expect(page.getByRole('button', { name: '订单中心' })).toBeVisible();
}

test('管理员可审核用户、分配权限并重置密码', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', '管理操作使用桌面端执行');

  const username = `matrix_user_${Date.now()}`;
  const initialPassword = 'Start-123456';
  const resetPassword = 'Reset-654321';

  const registration = await page.request.post('/api/auth/register', {
    data: { username, password: initialPassword, fullName: '自动回归用户' },
  });
  expect(registration.ok(), await registration.text()).toBeTruthy();

  await login(page, process.env.E2E_USERNAME, process.env.E2E_PASSWORD);
  await page.getByRole('button', { name: '系统管理' }).click();
  await page.waitForTimeout(500);

  const userRow = page.locator('tbody tr').filter({ hasText: username });
  await expect(userRow).toBeVisible();
  await userRow.getByTitle('审核并分配权限').click();
  const approvalModal = page.getByText('审核用户并分配权限', { exact: true }).locator('..').locator('..');
  await approvalModal.locator('select').selectOption('worker_ship');
  await approvalModal.getByRole('button', { name: '审核通过并启用' }).click();
  await expect(userRow.getByText('启用', { exact: true })).toBeVisible();

  await userRow.getByTitle('重置密码').click();
  const resetModal = page.getByText(`重置 ${username} 的密码`, { exact: true }).locator('..').locator('..');
  await resetModal.locator('input[type="password"]').fill(resetPassword);
  await resetModal.getByRole('button', { name: '确认重置' }).click();
  await expect(resetModal).toBeHidden();

  await page.getByTitle('退出登录').click();
  await login(page, username, resetPassword);

  await expect(page.getByRole('button', { name: '订单中心' })).toBeVisible();
  await expect(page.getByRole('button', { name: '生产看板' })).toBeVisible();
  await expect(page.getByRole('button', { name: '开单管理' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '成本核算' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '系统管理' })).toHaveCount(0);

  const token = await page.evaluate(() => localStorage.getItem('token'));
  const forbidden = await page.request.get('/api/auth/users', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(forbidden.status()).toBe(403);
});

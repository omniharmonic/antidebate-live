import { expect, test } from '@playwright/test';

test('a visitor cannot host; a host signs in and reaches the key step', async ({ page }) => {
  await page.goto('/host/new');
  await expect(page).toHaveURL(/\/host\/login\?next=%2Fhost%2Fnew/);
  await page.getByLabel('Host password').fill('wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText('That password is not right.');
  await page.getByLabel('Host password').fill(process.env.HOST_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/host\/new/);
  await page.route('https://api.anthropic.com/**', (r) =>
    r.fulfill({
      status: 401,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid' } }),
    }),
  );
  await page.goto('/host/key');
  await page.getByLabel('Anthropic API key').fill('sk-ant-fake');
  await page.getByRole('button', { name: 'Check and save' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("That key wasn't accepted");
});

test('the public home lists no live sessions and has a host link', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Host a session' })).toBeVisible();
  await expect(page.getByText('Live', { exact: true })).toHaveCount(0);
});

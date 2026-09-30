import { expect, test } from '@playwright/test';

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

test('right-only stereo audio reaches a mixed feed while separate tracks retain their channels', async ({ page, context }) => {
  await context.addCookies([{ name: 'adl_host', value: process.env.HOST_COOKIE!, url: process.env.E2E_BASE_URL ?? 'http://localhost:3000' }]);
  await page.goto('/host/lab');
  await page.waitForFunction(() => !!window.__adlLab?.captureProbe);
  const levels = await page.evaluate(() => window.__adlLab!.captureProbe());
  expect(levels.mono['0']).toBeGreaterThan(-20);
  expect(Object.keys(levels.mono)).toEqual(['0']);
  expect(levels.tracks['0']).toBeLessThan(-80);
  expect(levels.tracks['1']).toBeGreaterThan(-10);
});

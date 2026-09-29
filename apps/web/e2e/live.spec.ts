// Live setup with Chrome's fake devices: a WAV file plays as the microphone.
//
// FAKE_AUDIO_WAV: 30 s of a fixture as 16 kHz mono WAV, for example
//   ffmpeg -ss 60 -t 30 -i fixtures/antidebate/open-source-ai/audio.16k.wav -ac 1 -ar 16000 /tmp/fake-30s.wav
// HOST_COOKIE: a signed host cookie for the server's HOST_SIGNING_SECRET, for example (from apps/web)
//   node --experimental-strip-types -e "import('./lib/host-auth.ts').then(async (m) => console.log(await m.signHostCookie(process.env.HOST_SIGNING_SECRET, Date.now())))"
// E2E_BASE_URL: the running app (default http://localhost:3000).
import { expect, test } from '@playwright/test';

const base = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${process.env.FAKE_AUDIO_WAV}`] } });

test('room-mic setup reaches enrollment, rejects a short clip and accepts a real one', async ({ page, context }) => {
  test.setTimeout(90_000);
  await context.addCookies([{ name: 'adl_host', value: process.env.HOST_COOKIE!, url: base }]);
  await page.addInitScript(() => localStorage.setItem('adl.anthropicKey', 'sk-ant-fake'));
  await page.goto('/host/new?kind=live');
  await page.getByLabel('Title').fill('E2E live');
  await page.getByLabel('Name', { exact: false }).first().fill('Ann');
  await page.getByLabel('Name', { exact: false }).nth(1).fill('Bo');
  await page.getByText('One mic in the room').click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('button', { name: 'Use this device' }).click();
  await expect(page.getByRole('meter', { name: 'Input 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('Ask Ann to talk for about 20 seconds')).toBeVisible();
  await page.getByRole('button', { name: 'Record' }).click();
  await page.waitForTimeout(2_000);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText('We heard less than 10 seconds of speech from Ann. Record again.');

  // The fake mic plays speech: about 20 seconds of it passes and moves on to the next person.
  await page.getByRole('button', { name: 'Record' }).click();
  await page.waitForTimeout(22_000);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('Ask Bo to talk for about 20 seconds')).toBeVisible();
});

test('a live session opened where it was not started gets the live view, and its links open in a new tab', async ({ page, context }) => {
  await context.addCookies([{ name: 'adl_host', value: process.env.HOST_COOKIE!, url: base }]);
  const res = await page.request.post('/api/host/session', {
    data: { title: 'E2E live elsewhere', format: 'anti-debate', participants: [{ key: 'A', displayName: 'Ann', role: 'debater' }, { key: 'B', displayName: 'Bo', role: 'debater' }], source: { kind: 'live' } },
  });
  const { sessionId } = (await res.json()) as { sessionId: string };
  // No local entry for the session: the page routes by its session.started source.
  await page.addInitScript(() => localStorage.setItem('adl.anthropicKey', 'sk-ant-fake'));
  await page.goto(`/host/s/${encodeURIComponent(sessionId)}`);
  await expect(page.getByRole('heading', { name: 'E2E live elsewhere' })).toBeVisible();
  await expect(page.getByText('This session was set up on another laptop. Open it there to keep listening.')).toBeVisible();
  // Until the session has ended, leaving this page would stop capture: the links open a new tab.
  await expect(page.getByRole('link', { name: 'Open the map' })).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('link', { name: 'Open the cockpit' })).toHaveAttribute('target', '_blank');
});

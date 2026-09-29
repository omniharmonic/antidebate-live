// The e2e run needs a dev server started with HOST_PASSWORD and HOST_SIGNING_SECRET in its
// environment (and HOST_PASSWORD in the environment of this command). E2E_BASE_URL sets the target.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

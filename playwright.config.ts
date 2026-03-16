import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 15000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3457',
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: {
    command: 'npx serve e2e/fixtures -l 3457 --no-clipboard',
    port: 3457,
    reuseExistingServer: true,
  },
});

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
  webServer: [
    {
      command: 'npx serve e2e/fixtures -l 3457 --no-clipboard',
      port: 3457,
      reuseExistingServer: true,
    },
    // The SSR site built by e2e/ssr/build.sh (compiler + forma walker +
    // FormaJS), served with each page's own headers. e2e/ssr/regressions.spec.ts.
    {
      command: 'node e2e/ssr/serve.mjs 3458',
      url: 'http://127.0.0.1:3458/sw.js',
      reuseExistingServer: true,
    },
  ],
});

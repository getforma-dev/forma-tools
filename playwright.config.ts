import { defineConfig } from '@playwright/test';
import { SSR_ORIGIN, SSR_PORT } from './e2e/ssr/origin';

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
    // FormaJS), served with each page's own headers, for
    // e2e/ssr/regressions.spec.ts. A server already on the port is reused, so
    // the spec checks /__site names THIS clone's site (FORMA_SSR_E2E_PORT
    // gives a clone its own port).
    {
      command: `node e2e/ssr/serve.mjs ${SSR_PORT}`,
      url: `${SSR_ORIGIN}/__site`,
      reuseExistingServer: true,
    },
  ],
});

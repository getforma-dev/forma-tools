import { existsSync } from 'node:fs';
import { chromium, defineConfig } from '@playwright/test';

const hasChrome = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
].some((path) => existsSync(path));

export default defineConfig({
  testDir: './browser-tests',
  timeout: 30_000,
  workers: 1,
  use: {
    channel: process.env.FORMA_BROWSER_CHANNEL
      ?? (!existsSync(chromium.executablePath()) && hasChrome ? 'chrome' : undefined),
    headless: true,
    serviceWorkers: 'allow',
  },
});

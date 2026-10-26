// Browser tests on an iPhone sized screen, in WebKit (Safari's engine) and Chromium, with the
// invented play only. Run: npx playwright test
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90000,
  expect: { timeout: 10000 },
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173/off-script/' },
  webServer: { command: 'node tools/serve.mjs 4173', url: 'http://localhost:4173/off-script/', reuseExistingServer: true },
  projects: [
    { name: 'webkit', use: { ...devices['iPhone 15'] } },
    { name: 'chromium', use: { browserName: 'chromium', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  ],
});

import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  maxFailures: 1,
  timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:4176', reducedMotion: 'reduce', trace: 'retain-on-failure' },
  outputDir: '.qa/browser',
  reporter: [['list'], ['html', { outputFolder: '.qa/report', open: 'never' }]],
  projects: [
    { name: 'chromium-desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 960 } } },
    { name: 'chromium-mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'webkit-tablet', use: { browserName: 'webkit', viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true } },
    { name: 'webkit-mobile', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: 'node scripts/qa-server.mjs', url: 'http://127.0.0.1:4176/api/content', reuseExistingServer: false },
});

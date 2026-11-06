import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/demo-browser', workers: 1, timeout: 30000,
  outputDir: '.qa/demo-browser', reporter: [['list'], ['html', { outputFolder: '.qa/demo-report', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4187', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium-desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
    { name: 'webkit-mobile', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: 'node scripts/synthetic-booking-demo.mjs', env: { BOOKING_DEMO_MODE: 'synthetic-only' }, url: 'http://127.0.0.1:4187/booking-demo.html', reuseExistingServer: false },
});

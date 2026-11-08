import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';

export default defineConfig({
  ...base,
  maxFailures: 0,
  testDir: './tests/composition',
  outputDir: '.qa/composition',
  reporter: [['list'], ['html', { outputFolder: '.qa/composition-report', open: 'never' }]],
  projects: [
    { name: 'chromium-desktop-1440', use: { browserName: 'chromium', viewport: { width: 1440, height: 960 } } },
    { name: 'chromium-mobile-320', use: { browserName: 'chromium', viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
    { name: 'webkit-mobile-390', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ...[[768, 1024], [820, 1180], [1024, 1366], [1024, 768]].map(([width, height]) => ({
      name: `webkit-tablet-${width}x${height}`,
      use: { browserName: 'webkit', viewport: { width, height }, isMobile: true, hasTouch: true },
    })),
  ],
});

import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser-contact', workers: 1, timeout: 45000,
  use: { ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } } : {}), baseURL: 'http://127.0.0.1:4184', reducedMotion: 'reduce', trace: 'retain-on-failure' },
  outputDir: '.qa/contact-browser', reporter: [['list'], ['html', { outputFolder: '.qa/contact-report', open: 'never' }]],
  projects: [
    {name:'contact-chromium-desktop',use:{browserName:'chromium',...(process.env.BOOKING_SYSTEM_CHROME==='1'?{channel:'chrome'}:{}),viewport:{width:1440,height:960}}},
    {name:'contact-chromium-small',use:{browserName:'chromium',...(process.env.BOOKING_SYSTEM_CHROME==='1'?{channel:'chrome'}:{}),viewport:{width:320,height:740},isMobile:true,hasTouch:true}},
    {name:'contact-webkit-mobile',use:{browserName:'webkit',viewport:{width:390,height:844},isMobile:true,hasTouch:true}},
  ],
  webServer: {command:'node scripts/qa-contact-server.mjs',url:'http://127.0.0.1:4184/api/contact/config',reuseExistingServer:false},
});

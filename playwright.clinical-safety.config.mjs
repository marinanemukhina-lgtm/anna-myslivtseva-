import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/clinical-safety-browser', workers:1, timeout:30000,
  outputDir:'.qa/clinical-safety',
  use:{baseURL:'http://127.0.0.1:4176',trace:'retain-on-failure'},
  projects:[
    {name:'clinical-chromium',use:{browserName:'chromium',launchOptions:process.env.CLINICAL_CHROMIUM ? {executablePath:process.env.CLINICAL_CHROMIUM} : {}}},
    {name:'clinical-webkit',use:{browserName:'webkit'}},
  ],
  webServer:{command:'node scripts/qa-server.mjs',url:'http://127.0.0.1:4176/api/content',reuseExistingServer:false},
});

import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'./tests/browser', testMatch:'contact-editorial.spec.mjs', workers:1,
 use:{baseURL:'http://127.0.0.1:4176', reducedMotion:'reduce', trace:'retain-on-failure'},
 outputDir:'.qa/contact-editorial-browser',
 timeout:60000,
 reporter:[['list'],['html',{outputFolder:'.qa/editorial-report',open:'never'}]],
 projects:[
  {name:'landscape844',use:{browserName:'chromium',viewport:{width:844,height:390},isMobile:true,hasTouch:true}},
  {name:'desktop1440',use:{browserName:'chromium',viewport:{width:1440,height:960}}},
  {name:'mobile320',use:{browserName:'chromium',viewport:{width:320,height:740},isMobile:true,hasTouch:true}},
  {name:'mobile390',use:{browserName:'webkit',viewport:{width:390,height:844},isMobile:true,hasTouch:true}},
  {name:'tablet820',use:{browserName:'webkit',viewport:{width:820,height:1180},isMobile:true,hasTouch:true}},
 ],
 webServer:{command:'node scripts/qa-server.mjs',url:'http://127.0.0.1:4176/api/content',reuseExistingServer:false},
});

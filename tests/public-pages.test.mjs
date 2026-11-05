import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPublicPage} from '../server/public-pages.mjs';
import {initialContent} from '../shared/content.mjs';
const template='<title>Initial</title><div id="root"></div>';
test('published content is readable, escaped, and drafts stay private',()=>{
 const raw=structuredClone(initialContent);
 raw.news=[{id:'visible',title:'Visible <script>',body:'Published',published:true},{id:'secret',title:'SECRET',body:'SECRET',published:false}];
 const page=renderPublicPage(template,'/news',raw);
 assert.equal(page.status,200);assert.match(page.html,/Visible &lt;script&gt;/);assert.doesNotMatch(page.html,/SECRET/);
 assert.equal(renderPublicPage(template,'/news/secret',raw).status,404);
 assert.equal(renderPublicPage(template,'/news/visible',raw).status,200);
});
test('unknown paths return 404 and administrative pages are noindex',()=>{
 assert.equal(renderPublicPage(template,'/missing',initialContent).status,404);
 assert.equal(renderPublicPage(template,'/admin',initialContent).noindex,true);
 assert.doesNotMatch(renderPublicPage(template,'/admin',initialContent).html,/canonical/);
 assert.match(renderPublicPage(template,'/',initialContent).html,/Анна Мысливцева/);
});

test('trailing-slash normalization never redirects to another origin', async () => {
 const {default: express} = await import('express');
 const {request} = await import('node:http');
 const {registerPublicPages} = await import('../server/public-pages.mjs');
 const app = express(); registerPublicPages(app);
 const server = app.listen(0, '127.0.0.1');
 await new Promise(resolve => server.once('listening', resolve));
 try {
  const result = await new Promise((resolve, reject) => {
   request({host:'127.0.0.1',port:server.address().port,path:'//example.com/'}, response => {
    response.resume(); resolve({status:response.statusCode,location:response.headers.location});
   }).on('error',reject).end();
  });
  assert.equal(result.status,308); assert.equal(result.location,'/example.com');
 } finally { await new Promise(resolve => server.close(resolve)); }
});

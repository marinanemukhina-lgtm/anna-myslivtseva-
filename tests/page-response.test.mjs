import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createPageHandler } from '../server/page-response.mjs';
import { initialContent } from '../shared/content.mjs';
const template = await readFile(new URL('../index.html',import.meta.url),'utf8');
const fixture = structuredClone(initialContent);
fixture.news=[{id:'published',title:'Test <script>bad</script> "quoted"',body:'Visible',published:true},{id:'secret',title:'SECRET DRAFT',body:'SECRET',published:false}];
fixture.profile.name='</script><script>alert(1)</script>';
test('real HTTP document adapter: route identity, drafts, methods, metadata, escaping and storage failure',async t=>{
 let fail=false;
 const app=express();
 app.get('/assets/existing.js',(_req,res)=>res.type('js').send('/* asset */'));
 app.use(createPageHandler({loadData:async()=>{if(fail)throw Error('db');return fixture;},loadTemplate:async()=>template,siteUrl:()=> 'https://example.test'}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 const get=(path,options={})=>new Promise((resolve,reject)=>{const req=request(base+path,{...options,headers:{host:'example.test',...options.headers}},res=>{let body='';res.setEncoding('utf8');res.on('data',x=>body+=x);res.on('end',()=>resolve({status:res.statusCode,headers:{get:key=>res.headers[key]},text:async()=>body}));});req.on('error',reject);req.end();});
 const r=await get('/news/published?utm=test');assert.equal(r.status,200);const html=await r.text();
 assert.ok(html.includes('https://example.test/news/published'));assert.ok(!html.includes('utm=test'));
 assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));assert.ok(html.includes('\\u003c/script>'));assert.ok(!html.includes('SECRET'));
 assert.equal(r.headers.get('cache-control'),'no-store');
 assert.ok(html.includes('https://example.test/media/anna-portrait.jpg'));
 assert.ok(!html.includes('<script>alert(1)</script>'));
 for(const path of ['/news/secret','/news/missing','/not-a-page','/news%2fpublished','/bad%zz']){const r=await get(path);assert.equal(r.status,404,path);assert.match(r.headers.get('x-robots-tag'),/noindex/);}
 const empty=await get('/services');assert.equal(empty.status,200);assert.match(empty.headers.get('x-robots-tag'),/noindex/);
 const head=await get('/about',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
 const admin=await get('/admin/setup');assert.equal(admin.status,200);assert.match(admin.headers.get('x-robots-tag'),/noindex/);
 const preview=await get('/about',{headers:{host:'preview.test'}});assert.match(preview.headers.get('x-robots-tag'),/noindex/);assert.ok((await preview.text()).includes('https://example.test/about'));
 for(const path of ['/assets/missing.js','/api/missing','/favicon.ico']){const r=await get(path);assert.equal(r.status,404);assert.ok(!r.headers.get('content-type').includes('html'));}
 assert.equal((await get('/assets/existing.js')).status,200);
 const post=await get('/about',{method:'POST'});assert.equal(post.status,404);assert.ok(!(await post.text()).includes('<html'));
 fail=true;const unavailable=await get('/about');assert.equal(unavailable.status,503);assert.match(unavailable.headers.get('x-robots-tag'),/noindex/);
});

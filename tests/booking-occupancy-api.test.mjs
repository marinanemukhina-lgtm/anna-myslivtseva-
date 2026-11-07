import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {scryptSync} from 'node:crypto';
import http from 'node:http';

test('private occupancy requires login, preview confirmation and protects CMS without anonymous access',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'anna-private-occupancy-'));process.env.DATA_DIR=dir;
 delete process.env.VERCEL;delete process.env.VERCEL_ENV;delete process.env.DATABASE_URL;
 process.env.ADMIN_PASSWORD_HASH='fixture:'+scryptSync('synthetic-private-password','fixture',64).toString('hex');
 const {createApp}=await import('../server/app.mjs');const server=createApp().listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;let cookie='';
 const req=(url,method='GET',body,headers={})=>new Promise((resolve,reject)=>{
   const request=http.request(base+url,{method,headers:{origin:base,'content-type':'application/json',cookie,...headers}},response=>{
     const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));
   });request.on('error',reject);request.end(body===undefined?undefined:JSON.stringify(body));
 });
 for(const [url,method]of[['occupancy','GET'],['free-availability','GET'],['coverage','PUT'],['busy','POST'],['reservations','POST'],['import/preview','POST'],['import/apply','POST'],['records/'+'1'.repeat(32)+'/cancel','POST']]) assert.equal((await req('/api/admin/booking/'+url,method,method==='GET'?undefined:{})).status,401);
 const captured=[];const originalError=console.error;console.error=(...args)=>captured.push(args.join(' '));
 try {
   const malformed=await fetch(base+'/api/admin/booking/busy',{method:'POST',headers:{'content-type':'application/json'},body:'{"private":"SYNTHETIC_DO_NOT_LOG" broken'});
   assert.equal(malformed.status,400);assert.equal((await malformed.text()).includes('SYNTHETIC_DO_NOT_LOG'),false);
 } finally {console.error=originalError;}
 assert.deepEqual(captured,['API: INVALID_JSON']);
 const login=await req('/api/session' ,'POST',{password:'synthetic-private-password'});cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await (await req('/api/admin/booking/free-availability?serviceId=fixture&date=2026-11-07')).json()).ready,false);
 let state=await(await req('/api/admin/booking/occupancy')).json();assert.equal(state.occupancy.coverage,null);assert.deepEqual(state.occupancy.records,[]);
 const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10), start=date+'T09:00:00.000Z',end=date+'T10:00:00.000Z';
 const input={expectedVersion:state.version,sourceSha256:'a'.repeat(64),intervals:[{start,end}]};
 let response=await req('/api/admin/booking/import/preview','POST',input);assert.equal(response.status,200);const preview=await response.json();assert.equal(preview.applied,false);assert.equal(preview.requiresConfirmation,true);
 assert.equal((await(await req('/api/admin/booking/occupancy')).json()).version,state.version);
 const apply={...input,previewDigest:preview.previewDigest,confirmed:true,operationKey:'b'.repeat(32)};
 assert.equal((await req('/api/admin/booking/import/apply','POST',{...apply,confirmed:false})).status,400);
 assert.equal((await req('/api/admin/booking/import/apply','POST',{...apply,previewDigest:'c'.repeat(64)})).status,400);
 assert.equal((await req('/api/admin/booking/import/preview','POST',{...input,notes:'synthetic private content'})).status,400);
 assert.equal((await req('/api/admin/booking/import/preview','POST',{...input,intervals:[{start,end,name:'synthetic'}]})).status,400);
 response=await req('/api/admin/booking/import/apply','POST',apply);assert.equal(response.status,200);const applied=await response.json();assert.equal(applied.records.length,1);
 assert.equal((await req('/api/admin/booking/import/apply','POST',apply)).status,200); // same operation, not another booking
 state=await(await req('/api/admin/booking/occupancy')).json();assert.equal(state.occupancy.records.length,1);
 const privateVersion=state.version;
 assert.equal((await(await req('/api/content')).json()).bookingOccupancy,undefined);
 // Anonymous content access must remain closed even when the request uses the production host.
 process.env.VERCEL='1';process.env.VERCEL_ENV='production';cookie='';
 const headers={host:'anna-myslivtseva.vercel.app',origin:'https://anna-myslivtseva.vercel.app'};
 response=await req('/api/admin/content','GET',undefined,headers);assert.equal(response.status,401);
 assert.equal((await req('/api/admin/booking/occupancy','GET',undefined,headers)).status,401);
 assert.equal((await req('/api/admin/content','PUT',{},headers)).status,401);
 delete process.env.VERCEL;delete process.env.VERCEL_ENV;
 const again=await req('/api/session','POST',{password:'synthetic-private-password'});cookie=again.headers.get('set-cookie').split(';')[0];
 state=await(await req('/api/admin/booking/occupancy')).json();assert.equal(state.occupancy.records.length,1);assert.equal(state.version,privateVersion);
 assert.equal((await req(`/api/admin/booking/records/${applied.records[0].id}/cancel`,'POST',{expectedVersion:privateVersion-1})).status,409);
 response=await req(`/api/admin/booking/records/${applied.records[0].id}/cancel`,'POST',{expectedVersion:state.version});assert.equal(response.status,200);assert.equal((await response.json()).records[0].status,'cancelled');
 assert.equal((await req('/api/booking/appointments','POST',{name:'synthetic'})).status,503);
 assert.equal((await(await req('/api/booking/config')).json()).ready,false);
});

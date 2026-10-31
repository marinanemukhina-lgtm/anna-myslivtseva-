import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {scryptSync} from 'node:crypto';

test('schedule preparation persists safely while intake stays closed',async(t)=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'anna-preparation-'));process.env.DATA_DIR=dir;
 process.env.ADMIN_PASSWORD_HASH='salt:'+scryptSync('synthetic-password','salt',64).toString('hex');
 const {createApp}=await import('../server/app.mjs');const server=createApp().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;let cookie='';
 const req=(p,method='GET',body,extra={})=>fetch(base+p,{method,headers:{origin:base,'content-type':'application/json',cookie,...extra},body:body===undefined?undefined:JSON.stringify(body)});
 t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 let response=await req('/api/booking/config');assert.equal(response.status,200);assert.equal((await response.json()).ready,false);
 assert.equal((await req('/api/admin/booking')).status,401);
 assert.equal((await req('/api/admin/booking/availability?serviceId=synthetic&date=2026-10-20')).status,401);
 const login=await req('/api/session','POST',{password:'synthetic-password'});cookie=login.headers.get('set-cookie').split(';')[0];
 let state=await(await req('/api/admin/booking')).json();assert.equal(state.mode,'preparation');assert.equal(state.activationBlocked,true);assert.equal(state.settings.timezone,'');assert.deepEqual(state.settings.services,[]);assert.equal(state.settings.enabled,undefined);
 let cms=await(await req('/api/admin/content')).json();
 cms.data.services=[{id:'synthetic',title:'Synthetic draft service',body:'',image:'',published:false,price:'',duration:'display only',category:''}];
 cms=await(await req('/api/admin/content','PUT',cms)).json();
 state=await(await req('/api/admin/booking')).json();assert.equal(state.serviceCatalog[0].published,false);
 const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
 const settings={...state.settings,timezone:'Europe/Moscow',services:[{serviceId:'synthetic',durationMinutes:60,bufferMinutes:15,enabled:true}],overrides:[{date,closed:false,windows:[{start:'09:00',end:'12:00'}]}]};
 response=await req('/api/admin/booking','PUT',{settings,version:state.version});assert.equal(response.status,200);let saved=await response.json();assert.equal(saved.version,state.version+1);assert.equal(saved.conflicts,undefined);
 assert.deepEqual((await(await req('/api/admin/booking')).json()).settings,settings);
 const preview=await(await req('/api/admin/booking/availability?serviceId=synthetic&date='+date)).json();assert.equal(preview.preview,true);assert.equal(preview.slots[0].start,date+'T06:00:00.000Z');assert.equal(preview.slots.length,8);
 assert.equal((await(await req('/api/content')).json()).bookingSchedule,undefined);assert.equal((await(await req('/api/booking/config')).json()).services.length,0);
 // Ordinary CMS editor cannot accidentally overwrite the dedicated schedule.
 let after=await(await req('/api/admin/content')).json();after.data.profile.about='CMS draft';delete after.data.bookingSchedule;
 const general=await(await req('/api/admin/content','PUT',after)).json();assert.deepEqual(general.data.bookingSchedule,settings);
 // External CMS save races local unsaved profile + stale schedule edit.
 const localDraft=structuredClone(general);localDraft.data.profile.about='Unsent local profile';
 const external=structuredClone(general);external.data.profile.about='External profile update';
 const externalResult=await(await req('/api/admin/content','PUT',external)).json();
 response=await req('/api/admin/booking','PUT',{settings:{...settings,timezone:'UTC'},version:localDraft.version});assert.equal(response.status,409);
 assert.equal(localDraft.data.profile.about,'Unsent local profile');assert.equal(localDraft.version,general.version);
 let actual=await(await req('/api/admin/content')).json();assert.equal(actual.data.profile.about,'External profile update');assert.deepEqual(actual.data.bookingSchedule,settings);assert.equal(actual.version,externalResult.version);
 assert.equal((await req('/api/admin/content','PUT',localDraft)).status,409);
 // Date closure genuinely persists; there are no patient records or fake conflicts.
 state=await(await req('/api/admin/booking')).json();state.settings.overrides=[{date,closed:true,windows:[]}];
 response=await req('/api/admin/booking','PUT',{settings:state.settings,version:state.version});assert.equal(response.status,200);saved=await response.json();
 assert.equal((await(await req('/api/admin/booking/availability?serviceId=synthetic&date='+date)).json()).slots.length,0);
 assert.equal((await req('/api/admin/booking','PUT',{settings:{...saved.settings,timezone:'Not/AZone'},version:saved.version})).status,400);
 assert.equal((await req('/api/admin/booking','PUT',{settings:{...saved.settings,enabled:true},version:saved.version})).status,400);
 assert.equal((await req('/api/admin/booking','PUT',{settings:{...saved.settings,services:[{serviceId:'unknown',durationMinutes:60,bufferMinutes:0,enabled:true}]},version:saved.version})).status,400);
 assert.equal((await req('/api/admin/booking','PUT',{settings:saved.settings,version:saved.version},{origin:'https://evil.test'})).status,403);
 assert.equal((await req('/api/admin/booking/availability?serviceId=synthetic&date=2026-02-31')).status,400);
 assert.equal((await req('/api/admin/booking/availability?serviceId=synthetic&date='+date+'&name=secret')).status,400);
 // Same-version concurrent schedule updates cannot both succeed.
 const parallel=await Promise.all([
  req('/api/admin/booking','PUT',{settings:{...saved.settings,slotStepMinutes:10},version:saved.version}),
  req('/api/admin/booking','PUT',{settings:{...saved.settings,slotStepMinutes:20},version:saved.version}),
 ]);assert.deepEqual(parallel.map(x=>x.status).sort(),[200,409]);
 // Verify a separate SQLite reader sees durable CMS storage, not a module cache.
 const {DatabaseSync}=await import('node:sqlite');const reader=new DatabaseSync(path.join(dir,'content.sqlite'));
 const persisted=JSON.parse(reader.prepare("SELECT body FROM content WHERE id='main'").get().body);reader.close();
 assert.equal(persisted.bookingSchedule.overrides[0].closed,true);
 // Intake is closed before JSON parsing, even if old draft environment flags exist.
 process.env.BOOKING_DATA_APPROVED='true';process.env.BOOKING_POSTGRES_VERIFIED='true';
 for(const body of ['{',JSON.stringify({name:'synthetic',contact:'synthetic@example.test'}),'x'.repeat(5*1024*1024)]){
  const closed=await fetch(base+'/api/booking/appointments',{method:'POST',headers:{'content-type':'application/json'},body});assert.equal(closed.status,503);assert.equal((await closed.json()).code,'BOOKING_NOT_CONNECTED');
 }
 assert.equal((await(await req('/api/booking/config')).json()).ready,false);
 assert.equal((await req('/api/admin/booking/appointments?from='+date+'&to='+date)).status,404);
 // Deleting a service must not strand an invisible orphan in schedule settings.
 const beforeDelete=await(await req('/api/admin/content')).json();
 const retainedWindows=structuredClone(beforeDelete.data.bookingSchedule.overrides);
 beforeDelete.data.services=[];
 const afterDelete=await(await req('/api/admin/content','PUT',beforeDelete)).json();
 assert.deepEqual(afterDelete.data.bookingSchedule.services,[]);
 assert.deepEqual(afterDelete.data.bookingSchedule.overrides,retainedWindows);
 const pruned=await(await req('/api/admin/booking')).json();
 assert.equal((await req('/api/admin/booking','PUT',{settings:{...pruned.settings,slotStepMinutes:30},version:pruned.version})).status,200);
 const {database}=await import('../server/db.mjs');const db=await database();const tables=await db.query("SELECT name FROM sqlite_master WHERE type='table'");assert.equal(tables.some(x=>x.name==='appointments'||x.name==='booking_state'),false);
});

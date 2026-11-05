import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaults } from '../shared/booking.mjs';
import { createPrivateBookingManager,emptyBookingOccupancy,bookingOccupancySchema } from '../server/private-booking-state.mjs';
const receiptOnly=({rebasedFromVersion,settings,...receipt})=>receipt;
const key=n=>n.toString(16).padStart(32,'0');
const clock=Date.parse('2026-11-05T00:00:00.000Z');
const instant=t=>`2026-11-05T${t}:00.000Z`;
const coverage={start:instant('08:00'),end:instant('18:00'),verifiedUntil:instant('23:00')};
const request=(n,start='09:00',expectedVersion=1)=>({expectedVersion,operationKey:key(n),serviceId:'synthetic',date:'2026-11-05',start:instant(start)});
const error=(p,code)=>assert.rejects(p,{code});
const settings=()=>({...defaults(),timezone:'UTC',services:[{serviceId:'synthetic',durationMinutes:60,bufferMinutes:15,enabled:true}],overrides:[{date:'2026-11-05',closed:false,windows:[{start:'08:00',end:'18:00'}]}]});
async function fixture(t){
 const dir=await mkdtemp(path.join(tmpdir(),'private-booking-test-')),file=path.join(dir,'synthetic.sqlite');
 const dbs=[new DatabaseSync(file),new DatabaseSync(file)];
 dbs.forEach(db=>db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;'));
 t.after(async()=>{dbs.forEach(db=>db.close());await rm(dir,{recursive:true,force:true});});
 dbs[0].exec('CREATE TABLE content(id TEXT PRIMARY KEY,body TEXT NOT NULL,version INTEGER NOT NULL)');
 dbs[0].prepare('INSERT INTO content VALUES(?,?,?)').run('main',JSON.stringify({bookingSchedule:settings(),bookingOccupancy:{...emptyBookingOccupancy(),coverage},services:[{id:'synthetic',title:'Synthetic fixture',published:true}],other:'preserve'}),1);
 let gate;
 const queries=dbs.map(db=>async(sql,args=[])=>{const stmt=db.prepare(sql.replace(/\$\d+/g,'?'));return stmt.columns().length?stmt.all(...args):stmt.run(...args);});
 const reads=queries.map(query=>async()=>{
  const [r]=await query('SELECT body,version FROM content WHERE id=$1',['main']);
  if(gate){const g=gate;if(++g.count===2){gate=undefined;g.release();}await g.promise;}
  return {data:JSON.parse(r.body),version:Number(r.version)};
 });
 const managers=queries.map((query,i)=>createPrivateBookingManager({query,readContent:reads[i],now:()=>clock}));
 return {file,dbs,queries,reads,managers,race(){let release;const promise=new Promise(r=>release=r);gate={count:0,release,promise};},async edit(fn){const s=await reads[0]();fn(s.data);return queries[0]('UPDATE content SET body=$1,version=version+1 WHERE id=$2 AND version=$3 RETURNING version',[JSON.stringify(s.data),'main',s.version]);}};
}

test('different-start overlapping requests on independent connections: one winner, refresh still busy',async t=>{
 const f=await fixture(t);f.race();
 const rs=await Promise.allSettled([f.managers[0].reserve(request(1)),f.managers[1].reserve(request(2,'09:30'))]);
 assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);assert.equal(rs.find(r=>r.status==='rejected').reason.code,'STALE_VERSION');
 const snap=await f.managers[0].snapshot();assert.equal(snap.occupancy.records.length,1);
 const loser=snap.occupancy.records[0].start===instant('09:00')?'09:30':'09:00';
 await error(f.managers[0].reserve(request(3,loser,2)),'WINDOW_BUSY');
});

test('nonoverlapping simultaneous requests still refresh their common revision before retry',async t=>{
 const f=await fixture(t);f.race();
 const rs=await Promise.allSettled([f.managers[0].reserve(request(1)),f.managers[1].reserve(request(2,'12:00'))]);
 assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);
 const loser=rs[0].status==='rejected'?request(1,'09:00',2):request(2,'12:00',2);
 await f.managers[0].reserve(loser);assert.equal((await f.managers[0].snapshot()).occupancy.records.length,2);
});

test('same operation key races produce one receipt; changed payload conflicts',async t=>{
 const f=await fixture(t);f.race();
 const [a,b]=await Promise.all(f.managers.map(m=>m.reserve(request(1))));assert.deepEqual(receiptOnly(a),receiptOnly(b));assert.equal([a,b].filter(r=>Object.hasOwn(r,'rebasedFromVersion')).length,1);
 assert.deepEqual(await f.managers[0].reserve(request(1)),receiptOnly(a));
 await error(f.managers[0].reserve(request(1,'12:00',2)),'IDEMPOTENCY_CONFLICT');
 assert.equal((await f.managers[0].snapshot()).occupancy.records.length,1);
});

test('settings writer and reservation CAS the same content version without lost updates',async t=>{
 const f=await fixture(t);f.race();
 const rs=await Promise.allSettled([f.managers[0].reserve(request(1)),(async()=>{
  const s=await f.reads[1]();s.data.bookingSchedule.overrides=[{date:'2026-11-05',closed:true,windows:[]}];
  const rows=await f.queries[1]('UPDATE content SET body=$1,version=version+1 WHERE id=$2 AND version=$3 RETURNING version',[JSON.stringify(s.data),'main',s.version]);
  if(!rows.length)throw Object.assign(Error(),{code:'STALE_VERSION'});return rows;
 })()]);
 assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);assert.equal(rs.find(r=>r.status==='rejected').reason.code,'STALE_VERSION');
 const s=await f.reads[0]();assert.equal(s.version,2);assert.equal(s.data.other,'preserve');
 assert.equal(s.data.bookingOccupancy.records.length+Number(s.data.bookingSchedule.overrides[0].closed),1);
});

test('cancel frees buffered slot, stale cancellation is rejected, retries never recreate cancelled booking',async t=>{
 const f=await fixture(t),m=f.managers[0];const booked=await m.reserve(request(1));
 await error(m.cancel({expectedVersion:1,id:booked.records[0].id}),'STALE_VERSION');
 await error(m.reserve(request(2,'10:00',2)),'WINDOW_BUSY');
 const cancelled=await m.cancel({expectedVersion:2,id:booked.records[0].id});assert.equal(cancelled.records[0].status,'cancelled');
 assert.deepEqual(await m.cancel({expectedVersion:3,id:booked.records[0].id}),receiptOnly(cancelled));
 assert.equal((await m.reserve(request(1))).records[0].status,'cancelled');
 const next=await m.reserve(request(2,'10:00',3));assert.equal(next.version,4);
 await error(m.cancel({expectedVersion:3,id:next.records[0].id}),'STALE_VERSION');
});

test('busy batches allow overlaps, are repeat-safe, and cannot overwrite active reservations',async t=>{
 const f=await fixture(t),m=f.managers[0],p={expectedVersion:1,operationKey:key(1),intervals:[{start:instant('09:00'),end:instant('10:00')},{start:instant('09:30'),end:instant('10:30')}]};
 const added=await m.addBusy(p);assert.equal(added.records.length,2);assert.deepEqual(await m.addBusy(p),receiptOnly(added));
 await error(m.reserve(request(2,'10:00',2)),'WINDOW_BUSY');
 const booking=await m.reserve(request(3,'12:00',2));
 await error(m.addBusy({expectedVersion:3,operationKey:key(4),intervals:[{start:instant('12:30'),end:instant('14:00')}]}),'WINDOW_BUSY');
 assert.equal(booking.version,3);
});

test('coverage absent, expired or incomplete fails closed; fresh explicit coverage enables reservation',async t=>{
 const f=await fixture(t),m=f.managers[0];await f.edit(d=>d.bookingOccupancy.coverage=null);
 await error(m.reserve(request(1,'09:00',2)),'SOURCE_NOT_VERIFIED');
 await error(m.setCoverage({expectedVersion:2,...coverage,verifiedUntil:'2026-11-07T00:00:00.000Z'}),'INVALID_VERIFICATION_EXPIRY');
 await m.setCoverage({expectedVersion:2,...coverage,end:instant('10:00')});
 await error(m.reserve(request(1,'09:00',3)),'OUTSIDE_VERIFIED_COVERAGE');
 await m.setCoverage({expectedVersion:3,...coverage});await m.reserve(request(1,'09:00',4));
 await f.edit(d=>d.bookingOccupancy.coverage.verifiedUntil='2026-11-04T00:00:00.000Z');
 await error(m.reserve(request(2,'12:00',6)),'SOURCE_NOT_VERIFIED');
});

test('service publishing, enabled settings and actual schedule are required',async t=>{
 const f=await fixture(t),m=f.managers[0];await f.edit(d=>d.services[0].published=false);
 await error(m.reserve(request(1,'09:00',2)),'SERVICE_UNAVAILABLE');
 await f.edit(d=>{d.services[0].published=true;d.bookingSchedule.services[0].enabled=false;});
 await error(m.reserve(request(1,'09:00',3)),'SERVICE_UNAVAILABLE');
 await f.edit(d=>{d.bookingSchedule.services[0].enabled=true;d.bookingSchedule.overrides=[];});
 await error(m.reserve(request(1,'09:00',4)),'WINDOW_UNAVAILABLE');
});

test('strict schema disallows PII/notes and corrupt persisted occupancy',async t=>{
 const f=await fixture(t),m=f.managers[0];await error(m.reserve({...request(1),name:'forbidden'}),'INVALID_INPUT');
 await error(m.addBusy({expectedVersion:1,operationKey:key(2),intervals:[{start:instant('09:00'),end:instant('10:00'),notes:'forbidden'}]}),'INVALID_INPUT');
 assert.equal(bookingOccupancySchema.safeParse({...emptyBookingOccupancy(),phone:'forbidden'}).success,false);
 await f.edit(d=>d.bookingOccupancy.records=[{name:'forbidden'}]);await error(m.snapshot(),'STORAGE_INVALID');
});

test('storage failure and post-commit uncertainty return errors; restart and same-key retry recover committed state',async t=>{
 const f=await fixture(t);
 const bad=createPrivateBookingManager({readContent:f.reads[0],query:async()=>{throw Error('offline');},now:()=>clock});
 await error(bad.reserve(request(1)),'STORAGE_UNAVAILABLE');assert.equal((await f.reads[0]()).version,1);
 const ambiguous=createPrivateBookingManager({readContent:f.reads[0],query:async(s,a)=>{await f.queries[0](s,a);throw Error('lost commit response');},now:()=>clock});
 await error(ambiguous.reserve(request(1)),'STORAGE_UNAVAILABLE');
 const reopened=new DatabaseSync(f.file);t.after(()=>reopened.close());
 const manager=createPrivateBookingManager({readContent:async()=>{const r=reopened.prepare('SELECT * FROM content').get();return {data:JSON.parse(r.body),version:r.version};},query:async()=>{throw Error('retry must not write');},now:()=>clock});
 const recovered=await manager.reserve(request(1));assert.equal(recovered.version,2);assert.equal((await manager.snapshot()).occupancy.records.length,1);
});

test('private availability removes partial overlaps with service buffers and cancellation restores candidates',async t=>{
 const f=await fixture(t),m=f.managers[0],query={serviceId:'synthetic',date:'2026-11-05'};
 const initial=await m.available(query);assert.equal(initial.ready,true);assert.equal(initial.timezone,'UTC');assert.equal(initial.reason,null);
 assert.ok(initial.slots.some(s=>s.start===instant('09:00')));
 const booking=await m.reserve(request(1));
 const busy=await m.available(query);assert.equal(busy.version,2);
 assert.ok(!busy.slots.some(s=>s.start===instant('08:00')),'candidate service buffer crosses reservation start');
 assert.ok(!busy.slots.some(s=>s.start===instant('09:30')),'different-start partial overlap removed');
 assert.ok(!busy.slots.some(s=>s.start===instant('10:00')),'reservation buffer blocks candidate');
 assert.ok(busy.slots.some(s=>s.start===instant('10:15')),'exact occupied-end boundary remains free');
 for(const slot of busy.slots)assert.deepEqual(Object.keys(slot).sort(),['end','start']);
 assert.deepEqual(Object.keys(busy).sort(),['observedAt','ready','reason','slots','timezone','validUntil','version']);
 await m.cancel({expectedVersion:2,id:booking.records[0].id});
 assert.deepEqual((await m.available(query)).slots,initial.slots);
});

test('private availability requires fresh coverage and the full candidate buffer within its boundaries',async t=>{
 const f=await fixture(t),m=f.managers[0],query={serviceId:'synthetic',date:'2026-11-05'};
 await f.edit(d=>d.bookingOccupancy.coverage=null);
 assert.deepEqual(await m.available(query),{version:2,timezone:'UTC',ready:false,reason:'SOURCE_NOT_VERIFIED',slots:[]});
 await f.edit(d=>d.bookingOccupancy.coverage={...coverage,verifiedUntil:'2026-11-05T00:00:00.000Z'});
 assert.equal((await m.available(query)).ready,false);
 await m.setCoverage({expectedVersion:3,...coverage,start:instant('09:00'),end:instant('10:15')});
 assert.deepEqual((await m.available(query)).slots,[{start:instant('09:00'),end:instant('10:00')}]);
 await m.setCoverage({expectedVersion:4,...coverage,start:instant('09:00'),end:instant('10:00')});
 const incomplete=await m.available(query);assert.equal(incomplete.ready,false);assert.equal(incomplete.reason,'OUTSIDE_VERIFIED_COVERAGE');assert.deepEqual(incomplete.slots,[]);
});

test('private availability is strict, read-only, service-gated and fail closed on storage errors',async t=>{
 const f=await fixture(t),m=f.managers[0],query={serviceId:'synthetic',date:'2026-11-05'};
 await error(m.available({...query,notes:'forbidden'}),'INVALID_INPUT');
 await error(m.available({...query,date:'2026-02-31'}),'INVALID_INPUT');
 await m.available(query);assert.equal((await f.reads[0]()).version,1);
 await f.edit(d=>d.services[0].published=false);assert.equal((await m.available(query)).reason,'SERVICE_UNAVAILABLE');
 await f.edit(d=>{d.services[0].published=true;d.bookingSchedule.services[0].enabled=false;});assert.equal((await m.available(query)).reason,'SERVICE_UNAVAILABLE');
 await f.edit(d=>{d.bookingSchedule.services[0].enabled=true;d.bookingSchedule.timezone='';});assert.equal((await m.available(query)).reason,'SCHEDULE_UNAVAILABLE');
 const offline=createPrivateBookingManager({readContent:async()=>{throw Error('offline');},query:f.queries[0]});
 await error(offline.available(query),'STORAGE_UNAVAILABLE');
});

test('private availability distinguishes valid fully busy or closed day from missing verification',async t=>{
 const f=await fixture(t),m=f.managers[0],query={serviceId:'synthetic',date:'2026-11-05'};
 await m.addBusy({expectedVersion:1,operationKey:key(1),intervals:[{start:instant('08:00'),end:instant('18:00')}]});
 assert.deepEqual(await m.available(query),{version:2,timezone:'UTC',ready:true,reason:null,slots:[],observedAt:new Date(clock).toISOString(),validUntil:new Date(clock+60000).toISOString()});
 await f.edit(d=>d.bookingSchedule.overrides=[{date:'2026-11-05',closed:true,windows:[]}]);
 const closed=await m.available(query);assert.equal(closed.ready,true);assert.deepEqual(closed.slots,[]);
});

test('only acknowledged mutations carry atomic rebase markers; later read-only replays cannot rebase',async t=>{
 const f=await fixture(t),m=f.managers[0];
 const booked=await m.reserve(request(1));
 assert.equal(booked.rebasedFromVersion,1);assert.equal(booked.version,2);assert.deepEqual(booked.settings,settings());
 await f.edit(d=>{d.bookingSchedule.slotStepMinutes=30;d.other='intervening content';});
 const replay=await m.reserve(request(1));assert.equal(replay.version,3);
 assert.equal(Object.hasOwn(replay,'rebasedFromVersion'),false);assert.equal(Object.hasOwn(replay,'settings'),false);
 const busy=await m.addBusy({expectedVersion:3,operationKey:key(2),intervals:[{start:instant('14:00'),end:instant('15:00')}]});
 assert.equal(busy.rebasedFromVersion,3);assert.equal(busy.settings.slotStepMinutes,30);
 const cancelled=await m.cancel({expectedVersion:4,id:booked.records[0].id});
 assert.equal(cancelled.rebasedFromVersion,4);assert.equal(cancelled.version,5);assert.equal(cancelled.settings.slotStepMinutes,30);
 const repeatCancel=await m.cancel({expectedVersion:5,id:booked.records[0].id});
 assert.equal(Object.hasOwn(repeatCancel,'rebasedFromVersion'),false);assert.equal(Object.hasOwn(repeatCancel,'settings'),false);
 const verified=await m.setCoverage({expectedVersion:5,...coverage});assert.equal(verified.rebasedFromVersion,5);assert.equal(verified.version,6);assert.equal(verified.settings.slotStepMinutes,30);
});

test('mutation markers use default settings if the content row has none',async t=>{
 const f=await fixture(t);await f.edit(d=>{delete d.bookingSchedule;});
 const result=await f.managers[0].setCoverage({expectedVersion:2,...coverage});
 assert.equal(result.rebasedFromVersion,2);assert.deepEqual(result.settings,defaults());
});

test('availability freshness expires at earliest of one minute, coverage expiry and first returned start',async t=>{
 const f=await fixture(t),query={serviceId:'synthetic',date:'2026-11-05'};
 const normal=await f.managers[0].available(query);
 assert.equal(normal.observedAt,new Date(clock).toISOString());assert.equal(normal.validUntil,new Date(clock+60000).toISOString());
 const beforeSlot=Date.parse('2026-11-05T07:59:30.000Z');
 const nearSlot=createPrivateBookingManager({readContent:f.reads[0],query:f.queries[0],now:()=>beforeSlot});
 const imminent=await nearSlot.available(query);
 assert.equal(imminent.observedAt,'2026-11-05T07:59:30.000Z');assert.equal(imminent.validUntil,instant('08:00'));
 await f.edit(d=>d.bookingOccupancy.coverage.verifiedUntil='2026-11-05T07:59:45.000Z');
 const expiring=await nearSlot.available(query);assert.equal(expiring.validUntil,'2026-11-05T07:59:45.000Z');
 const expired=createPrivateBookingManager({readContent:f.reads[0],query:f.queries[0],now:()=>Date.parse(expiring.validUntil)});
 const stale=await expired.available(query);assert.equal(stale.ready,false);assert.deepEqual(stale.slots,[]);
 assert.equal(Object.hasOwn(stale,'observedAt'),false);assert.equal(Object.hasOwn(stale,'validUntil'),false);
});

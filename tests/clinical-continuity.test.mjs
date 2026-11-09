import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { emptyClinicalDemo as empty, exampleClinicalDemo as example, restoreClinicalDemo as restore, addDemoClient, addDemoVisit, addDemoPhoto, PERSONAS, PROCEDURES, ANGLES } from '../shared/clinical-demo.mjs';
import { parseClinicalJSON } from '../shared/clinical-json.mjs';
import { CLINICAL_KEY as KEY, LEGACY_BACKUP_KEY as BACKUP, openClinicalStorage, mergeClinicalArchive, encodeRawClinicalBackup, decodeRawClinicalBackup, restoreRawClinicalBackup } from '../src/clinical-storage.mjs';
import { createZip, exportClinicalHistory, importClinicalHistory } from '../src/clinical-archive.mjs';
const make = n => {
  let s=addDemoClient(empty(),PERSONAS[n]);
  s=addDemoVisit(s,{clientId:s.clients[0].id,date:'2026-11-09',procedure:PROCEDURES[0],note:'  Synthetic only\n\ud800  '});
  return addDemoPhoto(s,{visitId:s.visits[0].id,angle:ANGLES[0],data:'data:image/png;base64,aGVsbG8='});
};
function memory(raw) {
  const data=new Map(raw===undefined?[]:[[KEY,raw]]);
  return {data,writes:[],getItem:k=>data.get(k)??null,setItem(k,v){this.writes.push(k);data.set(k,v)}};
}
function mutex() {
  let q=Promise.resolve();
  return {request(name,f){assert.equal(name,KEY+':write');const p=q.then(f);q=p.catch(()=>{});return p;}};
}
const open=(storage,locks=mutex())=>openClinicalStorage({storage,locks,restore,empty,example});
const codeUnits=s=>Array.from({length:s.length},(_,i)=>s.charCodeAt(i));
for (const [pain,mobility] of [[0,0],[10,100],[-0,-0]]) {
  test('v1 metrics '+pain+'/'+mobility+' survive exact raw backup, Blob, restore and reload',async()=>{
    const s=make(0),old={schema:'anna-open-synthetic-clinical-v1',clients:s.clients,visits:s.visits.map(v=>({...v,pain,mobility}))};
    let raw=JSON.stringify(old,null,2);
    if(Object.is(pain,-0))raw=raw.replace('"pain": 0','"pain": -0').replace('"mobility": 0','"mobility": -0');
    // Also test literal lone surrogate, not only an escaped JSON sequence.
    raw=raw.replace('\\ud800','\ud800');
    const storage=memory(raw),session=open(storage);
    assert.equal(session.exportAllowed,true);assert.equal(storage.writes.length,0);
    const bytes=new Blob([encodeRawClinicalBackup(session.raw())]);
    const envelope=await bytes.text();assert.deepEqual(codeUnits(decodeRawClinicalBackup(envelope).raw),codeUnits(raw));
    await session.save(session.state);assert.equal(storage.getItem(BACKUP),raw);
    const reloaded=open(storage);assert.equal(reloaded.legacyRaw(),raw);
    assert.equal(Object.is(JSON.parse(reloaded.legacyRaw()).visits[0].pain,pain),true);
    const target=memory();await restoreRawClinicalBackup({storage:target,locks:mutex()},envelope);
    assert.deepEqual(codeUnits(target.getItem(KEY)),codeUnits(raw));
    assert.deepEqual(open(target).state,session.state);
    await assert.rejects(restoreRawClinicalBackup({storage:target,locks:mutex()},envelope),{code:'RESTORE_REQUIRES_EMPTY_STORAGE'});
  });
}
test('duplicate JSON keys at every depth and escaped aliases fail closed',async()=>{
  const normal=JSON.stringify(make(0));
  for(const raw of [normal.replace('"schema":','"schema":"future","schema":'),normal.replace('"note":','"note":"discard me","note":'),normal.replace('"note":','"no\\u0074e":"discard me","note":')]){
    assert.throws(()=>parseClinicalJSON(raw),/JSON_DUPLICATE_KEY/);
    const storage=memory(raw),session=open(storage);assert.equal(session.blocked,true);assert.equal(session.exportAllowed,false);
    assert.throws(()=>session.currentExport(session.state),{code:'EXPORT_BLOCKED'});
    await assert.rejects(session.save(empty()));assert.equal(storage.getItem(KEY),raw);assert.equal(storage.writes.length,0);
    assert.equal(decodeRawClinicalBackup(await new Blob([encodeRawClinicalBackup(raw)]).text()).raw,raw);
  }
});
test('unique escaped keys, nested arrays and quoted braces parse correctly',()=>{
  for(const raw of ['{"a":[{"x":"\\\" } , ["},{"x":1}],"b":null}','{"a":1,"\\u0062":2}','[true,false,null,-0,3e2,"\\\\"]'])
    assert.deepEqual(parseClinicalJSON(raw),JSON.parse(raw));
});
test('invalid JSON/schema/unknown properties stay byte-for-code-unit unchanged and never become exportable demo',async()=>{
  const valid=make(0);
  for(const raw of ['','null','{bad\ud800','[]',JSON.stringify({...valid,extra:'keep me'}),JSON.stringify({...valid,schema:'future'}),JSON.stringify({...valid,visits:[{...valid.visits[0],extra:'keep me'}]}),JSON.stringify({...valid,photos:[{...valid.photos[0],extra:'keep me'}]})]){
    const storage=memory(raw),session=open(storage);assert.equal(session.exportAllowed,false);
    await assert.rejects(session.save(example()));assert.equal(storage.getItem(KEY),raw);
    const target=memory(),envelope=await new Blob([encodeRawClinicalBackup(raw)]).text();
    await restoreRawClinicalBackup({storage:target,locks:mutex()},envelope);
    assert.deepEqual(codeUnits(target.getItem(KEY)),codeUnits(raw));assert.equal(open(target).exportAllowed,false);
  }
});
test('v2 note whitespace and lone surrogate survive save, current JSON, ZIP import and reload',async()=>{
  const s=make(0),storage=memory(JSON.stringify(s)),session=open(storage);
  await session.save(session.state);
  assert.deepEqual(open(storage).state,s);
  assert.deepEqual(JSON.parse(JSON.stringify(session.currentExport(s))),s);
  const incoming=restore(importClinicalHistory(exportClinicalHistory(s,s.clients[0].id)));
  assert.deepEqual(incoming,s);
});
test('two tabs: stale tab retains its own valid current exports after conflict and notification',async()=>{
  const s=make(0),storage=memory(JSON.stringify(s)),locks=mutex(),a=open(storage,locks),b=open(storage,locks);
  const changed=addDemoVisit(s,{clientId:s.clients[0].id,date:'2026-11-09',procedure:PROCEDURES[1],note:'new synthetic'});
  await a.save(changed);await assert.rejects(b.save(s),{code:'STORAGE_CONFLICT'});
  b.invalidate();assert.deepEqual(b.currentExport(s),s);assert.equal(b.exportAllowed,true);
  assert.deepEqual(restore(importClinicalHistory(exportClinicalHistory(b.currentExport(s),s.clients[0].id))),s);
  assert.deepEqual(open(storage).state,changed);
});
test('ZIP merge persists whole dataset on reload and concurrent stale import cannot replace winner',async()=>{
  const a=make(0),b=make(1),c=make(2),storage=memory(JSON.stringify(a)),locks=mutex();
  const first=open(storage,locks),stale=open(storage,locks);
  const incoming=restore(importClinicalHistory(exportClinicalHistory(b,b.clients[0].id)));
  const both=mergeClinicalArchive(first.state,incoming,restore);
  await first.save(both);assert.deepEqual(open(storage).state,both);
  assert.deepEqual(open(storage).state.photos,[...a.photos,...b.photos]);
  const attempted=mergeClinicalArchive(stale.state,c,restore);
  await assert.rejects(stale.save(attempted),{code:'STORAGE_CONFLICT'});
  assert.deepEqual(open(storage).state,both);assert.deepEqual(stale.currentExport(stale.state),a);
  const three=mergeClinicalArchive(both,c,restore); await first.save(three); assert.deepEqual(open(storage).state,three);
});
test('three-card merge cap, visit cap, duplicate labels/IDs never change existing data',()=>{
  const a=make(0),b=make(1),before=structuredClone(a),both=mergeClinicalArchive(a,b,restore);
  assert.throws(()=>mergeClinicalArchive(a,a,restore),{code:'IMPORT_CONFLICT'});
  assert.throws(()=>mergeClinicalArchive(a,{...b,clients:[{...b.clients[0],label:a.clients[0].label}]},restore),{code:'IMPORT_CONFLICT'});
  const full=mergeClinicalArchive(both,make(2),restore);
  assert.throws(()=>mergeClinicalArchive(full,make(2),restore));
  const many={...a,visits:Array.from({length:300},(_,i)=>({...a.visits[0],id:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0')})),photos:[]};
  assert.throws(()=>mergeClinicalArchive(many,b,restore));assert.deepEqual(a,before);
});
test('quota during legacy backup, primary write, and raw restore never reports success',async()=>{
  const s=make(0),raw=JSON.stringify({schema:'anna-open-synthetic-clinical-v1',clients:s.clients,visits:s.visits.map(v=>({...v,pain:0,mobility:100}))});
  for(const failingKey of [BACKUP,KEY]){
    const storage=memory(raw),set=storage.setItem;
    storage.setItem=function(k,v){if(k===failingKey)throw Error('QuotaExceededError');set.call(this,k,v);};
    const session=open(storage);await assert.rejects(session.save(session.state),/QuotaExceededError/);
    assert.equal(storage.getItem(KEY),raw);assert.equal(session.exportAllowed,true);
  }
  const target=memory();target.setItem=()=>{throw Error('QuotaExceededError')};
  await assert.rejects(restoreRawClinicalBackup({storage:target,locks:mutex()},encodeRawClinicalBackup(raw)),/QuotaExceededError/);
  assert.equal(target.getItem(KEY),null);
});
test('post-write readback mismatch blocks later writes and preserves export permission',async()=>{
  const s=make(0),storage=memory(JSON.stringify(s)),session=open(storage);
  storage.setItem=function(k,v){this.data.set(k,'foreign-writer')};
  await assert.rejects(session.save(s),{code:'WRITE_UNVERIFIED'});
  assert.equal(session.blocked,true);assert.deepEqual(session.currentExport(s),s);
  const target=memory();target.setItem=(k,v)=>target.data.set(k,'foreign-writer');
  await assert.rejects(restoreRawClinicalBackup({storage:target,locks:mutex()},encodeRawClinicalBackup('x')),{code:'WRITE_UNVERIFIED'});
});
test('missing locks yields read-only valid session, still permits valid exports; no storage access does not',async()=>{
  const s=make(0),storage=memory(JSON.stringify(s)),session=open(storage,null);
  assert.equal(session.blocked,true);assert.deepEqual(session.currentExport(s),s);
  await assert.rejects(session.save(s),{code:'LOCKS_UNAVAILABLE'});assert.equal(storage.writes.length,0);
  await assert.rejects(restoreRawClinicalBackup({storage,locks:null},encodeRawClinicalBackup('x')),{code:'LOCKS_UNAVAILABLE'});
  const inaccessible=open({getItem(){throw Error('SecurityError')},setItem(){assert.fail()}});
  assert.equal(inaccessible.exportAllowed,false);
});
test('raw restore validates envelope; never treats ordinary export, duplicate keys or foreign source as backup',async()=>{
  const good=encodeRawClinicalBackup('x');
  for(const text of [JSON.stringify(make(0)),good.replace('"version":1','"version":2'),good.replace('"raw":"x"','"raw":"first","raw":"x"'),good.replace('"raw":"x"','"raw":null'),good.replace(KEY,'foreign')]){
    const target=memory();await assert.rejects(restoreRawClinicalBackup({storage:target,locks:mutex()},text));assert.equal(target.writes.length,0);
  }
  for(const raw of ['',JSON.stringify(empty()),'{corrupt']){
    const storage=memory(raw);await assert.rejects(restoreRawClinicalBackup({storage,locks:mutex()},good),{code:'RESTORE_REQUIRES_EMPTY_STORAGE'});assert.equal(storage.getItem(KEY),raw);
  }
});
test('simultaneous raw restore and save use same lock; one succeeds and the other cannot overwrite',async()=>{
  const target=memory(),locks=mutex(),session=open(target,locks),s=make(0),raw=JSON.stringify(s);
  const result=await Promise.allSettled([restoreRawClinicalBackup({storage:target,locks},encodeRawClinicalBackup(raw)),session.save(empty())]);
  assert.equal(result[0].status,'fulfilled');assert.equal(result[1].status,'rejected');assert.equal(target.getItem(KEY),raw);
});
test('unknown archive fields and duplicate manifest keys reject without stripping data',()=>{
  const s=make(0),m={format:'anna-synthetic-history-v1',schema:s.schema,client:s.clients[0],visits:s.visits,photos:[]};
  for(const text of [JSON.stringify({...m,unknown:'do not strip'}),JSON.stringify(m).replace('"schema":','"schema":"future","schema":')]){
    const zip=createZip([{name:'manifest.json',data:new TextEncoder().encode(text)}]);
    assert.throws(()=>importClinicalHistory(zip));
  }
});
test('UI exports are gated by opening validity, not later write blocking; raw uses envelope',async()=>{
  const source=await readFile(new URL('../src/ClinicalDemo.jsx',import.meta.url),'utf8');
  assert.match(source,/new Blob\(\[encodeRawClinicalBackup\(/);assert.doesNotMatch(source,/new Blob\(\[raw\]/);
  assert.match(source,/disabled=\{!session.exportAllowed\} onClick=\{downloadSelectedArchive\}/);
  assert.match(source,/disabled=\{!session.exportAllowed\} onClick=\{download\}/);
  assert.match(source,/session.currentExport\(state\)/);assert.match(source,/restoreRawClinicalBackup\(/);
  assert.doesNotMatch(source,/Исходные данные не заменены этой операцией/);
});
test('ZIP cannot duplicate a photo reference and silently discard an unreferenced file',()=>{
  const s=make(0),p=s.photos[0],name='photos/001.png';
  const m={format:'anna-synthetic-history-v1',schema:s.schema,client:s.clients[0],visits:s.visits,photos:[
    {id:p.id,visitId:p.visitId,angle:p.angle,name},
    {id:crypto.randomUUID(),visitId:p.visitId,angle:p.angle,name}
  ]};
  const zip=createZip([{name:'manifest.json',data:new TextEncoder().encode(JSON.stringify(m))},{name,data:new Uint8Array([1])},{name:'photos/002.png',data:new Uint8Array([2])}]);
  assert.throws(()=>importClinicalHistory(zip),/UNEXPECTED_ARCHIVE_ENTRY/);
});
test('unknown photo metadata, including falsy malformed id, is not stripped by ZIP import',()=>{
  const s=make(0),p=s.photos[0],name='photos/001.png';
  const photo={id:p.id,visitId:p.visitId,angle:p.angle,name};
  for(const modified of [{...photo,unknown:'keep'},{...photo,id:null}]){
    const m={format:'anna-synthetic-history-v1',schema:s.schema,client:s.clients[0],visits:s.visits,photos:[modified]};
    const zip=createZip([{name:'manifest.json',data:new TextEncoder().encode(JSON.stringify(m))},{name,data:new Uint8Array([1])}]);
    assert.throws(()=>restore(importClinicalHistory(zip)));
  }
});
test('readback exception after write is uncertain, blocks session, and remains exportable',async()=>{
  const s=make(0),storage=memory(JSON.stringify(s)),session=open(storage),get=storage.getItem;
  storage.setItem=function(k,v){this.data.set(k,v);this.getItem=()=>{throw Error('SecurityError')}};
  await assert.rejects(session.save(s),{code:'WRITE_UNVERIFIED'});
  assert.equal(session.blocked,true);assert.equal(session.exportAllowed,true);assert.equal(get(KEY),JSON.stringify(s));
});
test('UI freezes note during saving and does not erase a newer draft',async()=>{
  const source=await readFile(new URL('../src/ClinicalDemo.jsx',import.meta.url),'utf8');
  assert.match(source,/current\[selected\] === note/);
  assert.match(source,/disabled=\{photoBusy \|\| importBusy \|\| saving \|\| storageBlocked\} onBusy=\{setVoiceBusy\}/);
});
test('raw restoration invalidates placeholder exports until reload, unlike ordinary tab conflict',()=>{
  const storage=memory(),session=open(storage);assert.equal(session.exportAllowed,true);
  session.invalidate({exports:true});assert.equal(session.exportAllowed,false);
  assert.throws(()=>session.currentExport(session.state),{code:'EXPORT_BLOCKED'});
});
test('legacy ZIP is rejected rather than silently discarding pain and mobility',()=>{
  const s=make(0),m={format:'anna-synthetic-history-v1',schema:'anna-open-synthetic-clinical-v1',client:s.clients[0],visits:s.visits.map(v=>({...v,pain:10,mobility:100})),photos:[]};
  const zip=createZip([{name:'manifest.json',data:new TextEncoder().encode(JSON.stringify(m))}]);
  assert.throws(()=>importClinicalHistory(zip),/UNSUPPORTED_ARCHIVE_SCHEMA/);
});
test('opening legacy snapshot remains exportable after external clear or corruption',()=>{
  for(const raw of ['{corrupt\ud800','original valid bytes']){
    const storage=memory(JSON.stringify(make(0)));storage.data.set(BACKUP,raw);const session=open(storage);
    storage.data.clear();session.invalidate();assert.equal(session.legacyRaw(),raw);
    storage.data.set(BACKUP,'foreign');assert.equal(session.legacyRaw(),raw);
    assert.equal(decodeRawClinicalBackup(encodeRawClinicalBackup(session.legacyRaw(),BACKUP)).raw,raw);
  }
});
test('own migration captures legacy snapshot even if external backup later disappears',async()=>{
  const s=make(0),raw=JSON.stringify({schema:'anna-open-synthetic-clinical-v1',clients:s.clients,visits:s.visits.map(v=>({...v,pain:0,mobility:100}))});
  const storage=memory(raw),session=open(storage);assert.equal(session.legacyRaw(),null);
  await session.save(session.state);storage.data.delete(BACKUP);session.invalidate();
  assert.equal(session.legacyRaw(),raw);
});
test('all 65,536 UTF-16 code units survive actual Blob bytes and raw restore exactly',async()=>{
  const raw=Array.from({length:65536},(_,n)=>String.fromCharCode(n)).join('');
  assert.notEqual(await new Blob([raw]).text(),raw,'control: raw Blob is demonstrably lossy');
  const envelope=await new Blob([encodeRawClinicalBackup(raw)]).text(),target=memory();
  assert.deepEqual(codeUnits(decodeRawClinicalBackup(envelope).raw),codeUnits(raw));
  await restoreRawClinicalBackup({storage:target,locks:mutex()},envelope);
  assert.deepEqual(codeUnits(target.getItem(KEY)),codeUnits(raw));
});
test('an old non-cooperating writer after readback remains outside the protection guarantee',async()=>{
  const s=make(0),storage=memory(JSON.stringify(s)),session=open(storage);
  const other=make(1);await session.save(s);
  storage.data.set(KEY,JSON.stringify(other)); // Simulates old-version direct setItem.
  assert.deepEqual(open(storage).state,other);assert.deepEqual(session.currentExport(s),s);
  await assert.rejects(session.save(s),{code:'STORAGE_CONFLICT'});
});
test('legacy view explicitly distinguishes transformed normal exports from exact source',async()=>{
  const s=make(0),raw=JSON.stringify({schema:'anna-open-synthetic-clinical-v1',clients:s.clients,visits:s.visits.map(v=>({...v,pain:10,mobility:0}))});
  const session=open(memory(raw));assert.equal(session.sourceIsLegacy,true);
  assert.equal('pain' in session.currentExport(session.state).visits[0],false);
  assert.equal(JSON.parse(decodeRawClinicalBackup(encodeRawClinicalBackup(session.raw())).raw).visits[0].pain,10);
  const source=await readFile(new URL('../src/ClinicalDemo.jsx',import.meta.url),'utf8');
  assert.match(source,/session.sourceIsLegacy/);assert.match(source,/не входят в обычные JSON, ZIP и PDF/);
});

test('pending navigation warning is scoped to saving with cleanup',async()=>{
 const source=await readFile(new URL('../src/ClinicalDemo.jsx',import.meta.url),'utf8');
 assert.match(source,/if \(!saving\) return;/);
 assert.match(source,/addEventListener\('beforeunload', warn\)/);
 assert.match(source,/return \(\) => window.removeEventListener\('beforeunload', warn\);\n  }, \[saving\]\)/);
 assert.match(source,/Сохраняем… Не закрывайте страницу до подтверждения/);
});

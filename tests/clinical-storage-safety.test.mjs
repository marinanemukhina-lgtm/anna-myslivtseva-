import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CLINICAL_KEY as KEY, LEGACY_BACKUP_KEY as BACKUP, openClinicalStorage, mergeClinicalArchive } from '../src/clinical-storage.mjs';
const empty = () => ({schema:'anna-open-synthetic-clinical-v2',clients:[],visits:[],photos:[]});
const example = () => ({...empty(), clients:[{id:'example',label:'example'}]});
// Dependency-free storage contract test. Real Zod restore is tested separately in full repo CI.
const restore = value => {
  if (!['anna-open-synthetic-clinical-v1','anna-open-synthetic-clinical-v2'].includes(value?.schema)) throw Error('SCHEMA');
  if (value.clients.length > 3) throw Error('LIMIT');
  return {...structuredClone(value),schema:'anna-open-synthetic-clinical-v2',visits:value.visits.map(({pain,mobility,...v})=>v)};
};
function memory(raw) {
  const data = new Map(raw === undefined ? [] : [[KEY,raw]]);
  return { data, getItem:key=>data.get(key)??null, setItem:(key,value)=>data.set(key,value) };
}
function mutex() {
  let queue = Promise.resolve();
  return {request(_name, callback) { const next=queue.then(callback); queue=next.catch(()=>{}); return next; }};
}
const open = (storage, locks=mutex()) => openClinicalStorage({storage,locks,restore,empty,example});
for (const raw of ['{broken','{"schema":"unknown","clients":[],"visits":[],"photos":[]}']) {
  test('bad or unknown data is blocked, exported unchanged, never seeded: '+raw.slice(0,12), async()=>{
    const storage=memory(raw), session=open(storage);
    assert.equal(session.blocked,true); assert.deepEqual(session.state,empty()); assert.equal(session.raw(),raw);
    await assert.rejects(session.save(example()),{code:'STORAGE_BLOCKED'});
    assert.equal(storage.getItem(KEY),raw); assert.equal(storage.data.size,1);
  });
}
test('opening valid/absent state performs no writes',()=>{
  const storage=memory(), session=open(storage); assert.deepEqual(session.state,example()); assert.equal(storage.data.size,0);
});
test('unreadable storage fails closed',async()=>{
  const session=open({getItem(){throw Error('SecurityError')},setItem(){assert.fail()}});
  assert.equal(session.blocked,true); await assert.rejects(session.save(empty()),{code:'STORAGE_BLOCKED'});
});
test('legacy original bytes and removed metrics survive first and later saves',async()=>{
  const raw=JSON.stringify({...empty(),schema:'anna-open-synthetic-clinical-v1',visits:[{id:'v',pain:7,mobility:40,note:'synthetic'}]},null,2);
  const storage=memory(raw), session=open(storage);
  assert.equal(storage.data.size,1); await session.save(session.state);
  assert.equal(storage.getItem(BACKUP),raw); assert.equal(session.raw(),raw);
  await session.save(empty()); assert.equal(storage.getItem(BACKUP),raw);
});
test('failed legacy backup cannot replace main',async()=>{
  const raw=JSON.stringify({...empty(),schema:'anna-open-synthetic-clinical-v1'}), storage=memory(raw);
  storage.setItem=(key,value)=>{if(key===BACKUP)throw Error('QUOTA');storage.data.set(key,value)};
  await assert.rejects(open(storage).save(empty())); assert.equal(storage.getItem(KEY),raw);
});
test('different original backup is never overwritten',async()=>{
  const raw=JSON.stringify({...empty(),schema:'anna-open-synthetic-clinical-v1'}), storage=memory(raw);
  storage.data.set(BACKUP,'older original'); await assert.rejects(open(storage).save(empty()),{code:'BACKUP_CONFLICT'});
  assert.equal(storage.getItem(KEY),raw); assert.equal(storage.getItem(BACKUP),'older original');
});
test('simultaneous tabs: one writer wins, stale writer blocked',async()=>{
  const storage=memory(JSON.stringify(empty())),locks=mutex(),a=open(storage,locks),b=open(storage,locks);
  const first={...empty(),clients:[{id:'a',label:'a'}]},second={...empty(),clients:[{id:'b',label:'b'}]};
  const result=await Promise.allSettled([a.save(first),b.save(second)]);
  assert.equal(result[0].status,'fulfilled');assert.equal(result[1].reason.code,'STORAGE_CONFLICT');
  assert.deepEqual(JSON.parse(storage.getItem(KEY)),first); assert.equal(b.blocked,true);
});
test('explicit missing locks and externally invalidated session never write',async()=>{
  const storage=memory(),session=open(storage,null);await assert.rejects(session.save(empty()),{code:'LOCKS_UNAVAILABLE'});
  const other=open(storage);other.invalidate();await assert.rejects(other.save(empty()),{code:'STORAGE_BLOCKED'});assert.equal(storage.data.size,0);
});
test('quota failure preserves original and retry remains possible',async()=>{
  const raw=JSON.stringify(empty()),storage=memory(raw),session=open(storage),set=storage.setItem;
  storage.setItem=()=>{throw Error('QUOTA')};await assert.rejects(session.save(example()));assert.equal(storage.getItem(KEY),raw);
  storage.setItem=set;await session.save(example());assert.deepEqual(JSON.parse(storage.getItem(KEY)),example());
});
test('archive merge preserves all existing entities and rejects conflicting identities or limit',()=>{
  const current={...empty(),clients:[{id:'a',label:'a'}],visits:[{id:'v',clientId:'a',note:'synthetic'}],photos:[{id:'p',visitId:'v',data:'synthetic'}]};
  const incoming={...empty(),clients:[{id:'b',label:'b'}]},before=structuredClone(current);
  const merged=mergeClinicalArchive(current,incoming,restore);assert.equal(merged.clients.length,2);assert.deepEqual(merged.photos,current.photos);assert.deepEqual(current,before);
  assert.throws(()=>mergeClinicalArchive(current,current,restore),{code:'IMPORT_CONFLICT'});
  assert.throws(()=>mergeClinicalArchive(current,{...incoming,clients:[{id:'b',label:'a'}]},restore),{code:'IMPORT_CONFLICT'});
  assert.throws(()=>mergeClinicalArchive(current,{...incoming,clients:['b','c','d'].map(id=>({id,label:id}))},restore),/LIMIT/);
});
test('UI guard wiring: one session, add-only import, original export, no direct setItem save',async()=>{
  const source=await readFile(new URL('../src/ClinicalDemo.jsx',import.meta.url),'utf8');
  assert.match(source,/await session\.save\(next\)/);assert.match(source,/mergeClinicalArchive\(state,incoming,restoreClinicalDemo\)/);
  assert.match(source,/function example\(\) \{ if\(!confirm/);assert.match(source,/session\.raw\(\)/);assert.match(source,/session\.invalidate\(\)/);
  assert.doesNotMatch(source,/catch \{ return exampleClinicalDemo|Заменить ВСЕ тестовые карты/);
});

test('legacy backup export after save and reload retains exact original metrics/bytes',async()=>{
  const raw=JSON.stringify({...empty(),schema:'anna-open-synthetic-clinical-v1',visits:[{id:'v',pain:7,mobility:40,note:'synthetic'}]},null,2);
  const storage=memory(raw),first=open(storage); await first.save(first.state);
  const reloaded=open(storage);
  assert.notEqual(reloaded.raw(),raw); assert.equal(reloaded.legacyRaw(),raw);
  assert.equal(JSON.parse(reloaded.legacyRaw()).visits[0].pain,7);
  assert.equal(JSON.parse(reloaded.legacyRaw()).visits[0].mobility,40);
});
test('corrupt/conflicting backup is exportable verbatim and never repaired or overwritten',async()=>{
  const raw=JSON.stringify({...empty(),schema:'anna-open-synthetic-clinical-v1'});
  for(const backup of ['{corrupt',JSON.stringify({...empty(),schema:'anna-open-synthetic-clinical-v1',extra:'other copy'})]){
    const storage=memory(raw);storage.data.set(BACKUP,backup);const session=open(storage);
    assert.equal(session.legacyRaw(),backup);
    await assert.rejects(session.save(session.state),{code:'BACKUP_CONFLICT'});
    assert.equal(storage.getItem(KEY),raw);assert.equal(storage.getItem(BACKUP),backup);
  }
});
test('legacy snapshot is immutable; backup unreadable at opening is reported without writes',()=>{
  const storage=memory();assert.equal(open(storage).legacyRaw(),null);
  const session=open(storage);storage.getItem=()=>{throw Error('SecurityError')};assert.equal(session.legacyRaw(),null);
  assert.throws(()=>open(storage).legacyRaw());assert.equal(storage.data.size,0);
});

test('empty cabin can import and then add another distinct archive',()=>{
  const a={...empty(),clients:[{id:'a',label:'a'}]},b={...empty(),clients:[{id:'b',label:'b'}]};
  const first=mergeClinicalArchive(empty(),a,restore),both=mergeClinicalArchive(first,b,restore);
  assert.deepEqual(first,a);assert.deepEqual(both.clients,[...a.clients,...b.clients]);
});
test('ZIP import control exists outside selected-client conditional',async()=>{
  const source=await readFile(new URL('../src/ClinicalDemo.jsx',import.meta.url),'utf8');
  const controls=source.slice(source.indexOf('<div className="clinical-actions">'));
  assert.ok(controls.indexOf('clinical-archive-upload')>=0);
  assert.ok(controls.indexOf('clinical-archive-upload')<controls.indexOf('{client && <>'));
  assert.match(source,/onClick=\{\(\)=>downloadOriginal\(true\)\}/);
});

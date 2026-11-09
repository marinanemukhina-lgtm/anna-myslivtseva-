import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreClinicalDemo,emptyClinicalDemo,exampleClinicalDemo,addDemoClient,addDemoVisit,addDemoPhoto,PERSONAS,PROCEDURES,ANGLES} from '../shared/clinical-demo.mjs';
import {CLINICAL_KEY,LEGACY_BACKUP_KEY,openClinicalStorage,mergeClinicalArchive} from '../src/clinical-storage.mjs';
const make = (n) => {
  let state=addDemoClient(emptyClinicalDemo(),PERSONAS[n]);
  state=addDemoVisit(state,{clientId:state.clients[0].id,date:'2026-11-08',procedure:PROCEDURES[0],note:'Synthetic test only'});
  return addDemoPhoto(state,{visitId:state.visits[0].id,angle:ANGLES[0],data:'data:image/png;base64,aGVsbG8='});
};
const open = data => openClinicalStorage({storage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},locks:{request:async(_n,f)=>f()},restore:restoreClinicalDemo,empty:emptyClinicalDemo,example:exampleClinicalDemo});
test('real Zod legacy migration preserves original metrics in downloadable raw backup after reload',async()=>{
  const current=make(0), legacy={schema:'anna-open-synthetic-clinical-v1',clients:current.clients,visits:current.visits.map(v=>({...v,pain:5,mobility:60}))};
  const raw=JSON.stringify(legacy,null,2),data=new Map([[CLINICAL_KEY,raw]]),session=open(data);
  assert.equal(session.blocked,false);await session.save(session.state);
  assert.equal(open(data).legacyRaw(),raw);assert.equal(data.get(LEGACY_BACKUP_KEY),raw);
});
test('real Zod valid histories and photos survive add-only merge and storage roundtrip',async()=>{
  const a=make(0),b=make(1),merged=mergeClinicalArchive(emptyClinicalDemo(),a,restoreClinicalDemo);
  const both=mergeClinicalArchive(merged,b,restoreClinicalDemo),data=new Map(),session=open(data);await session.save(both);
  assert.deepEqual(open(data).state,both);assert.deepEqual(both.photos,[...a.photos,...b.photos]);
  assert.throws(()=>mergeClinicalArchive(both,a,restoreClinicalDemo),{code:'IMPORT_CONFLICT'});
});
test('real Zod future and unknown fields fail closed without changing raw input',async()=>{
  for(const value of [{...make(0),schema:'future'}, {...make(0),unknown:'do not lose'}]){
    const raw=JSON.stringify(value),data=new Map([[CLINICAL_KEY,raw]]),session=open(data);
    assert.equal(session.blocked,true);await assert.rejects(session.save(emptyClinicalDemo()));assert.equal(data.get(CLINICAL_KEY),raw);
  }
});

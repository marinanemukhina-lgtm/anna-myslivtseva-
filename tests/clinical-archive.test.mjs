import test from 'node:test';
import assert from 'node:assert/strict';
import {createZip,readZip,exportClinicalHistory,importClinicalHistory} from '../src/clinical-archive.mjs';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jUuUAAAAASUVORK5CYII=';
const id='00000000-0000-4000-8000-000000000001',vid='00000000-0000-4000-8000-000000000002';
const state={schema:'anna-open-synthetic-clinical-v2',clients:[{id,label:'Демо-клиент 001'}],visits:[{id:vid,clientId:id,date:'2026-11-07',procedure:'Демонстрационная процедура',note:'Вымышленная заметка'}],photos:[{id:'00000000-0000-4000-8000-000000000003',visitId:vid,angle:'Спереди',data:png}]};
test('ZIP export and import roundtrip a synthetic history and photo',()=>{
 const archive=exportClinicalHistory(state,id);
 assert.equal(String.fromCharCode(...archive.subarray(0,2)),'PK');
 assert.deepEqual(importClinicalHistory(archive),state);
 assert.deepEqual([...readZip(archive).keys()],['manifest.json','photos/001.png']);
});
test('CRC catches tampering',()=>{
 const bytes=exportClinicalHistory(state,id);bytes[50]^=1;
 assert.throws(()=>importClinicalHistory(bytes),/ARCHIVE_CORRUPT|INVALID_ZIP/);
});
test('traversal, duplicates, unknown client and nonarchives are refused',()=>{
 assert.throws(()=>createZip([{name:'../secret',data:new Uint8Array(1)}]),/ARCHIVE_ENTRY/);
 assert.throws(()=>createZip([{name:'manifest.json',data:new Uint8Array(1)},{name:'manifest.json',data:new Uint8Array(1)}]),/ARCHIVE_DUPLICATE/);
 assert.throws(()=>exportClinicalHistory(state,'unknown'),/CLIENT_NOT_FOUND/);
 assert.throws(()=>readZip(new Uint8Array([1,2,3])),/INVALID_ARCHIVE_SIZE/);
});
test('selected client export omits the other client',()=>{
 const otherId='00000000-0000-4000-8000-000000000004';
 const s={...state,clients:[...state.clients,{id:otherId,label:'Демо-клиент 002'}],visits:[...state.visits,{...state.visits[0],id:'00000000-0000-4000-8000-000000000005',clientId:otherId,note:'Private other record'}]};
 const imported=importClinicalHistory(exportClinicalHistory(s,id));
 assert.equal(imported.clients.length,1);assert.equal(imported.visits.length,1);
 assert.equal(JSON.stringify(imported).includes('Private other record'),false);
});

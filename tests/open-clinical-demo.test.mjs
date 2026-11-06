import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyClinicalDemo, exampleClinicalDemo, clinicalStateSchema, addDemoClient, addDemoVisit, setDemoPhoto, restoreClinicalDemo, PERSONAS, NOTES, PROCEDURES } from '../shared/clinical-demo.mjs';
import { renderPublicPage } from '../server/public-pages.mjs';
import { initialContent } from '../shared/content.mjs';
const id = '00000000-0000-4000-8000-000000000100';
test('empty cabinet → synthetic card → visit → serializable history', () => {
  let s = addDemoClient(emptyClinicalDemo(), PERSONAS[0], () => id);
  s = addDemoVisit(s, { clientId: id, date:'2026-11-06', procedure: PROCEDURES[0], note: NOTES[0] }, () => '00000000-0000-4000-8000-000000000101');
  const restored = clinicalStateSchema.parse(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(restored, s); assert.equal(restored.visits[0].clientId, restored.clients[0].id);
  assert.throws(() => addDemoClient(s, PERSONAS[0]));
});
test('foreign personal fields, invalid dates and orphan visits are rejected', () => {
  const s = exampleClinicalDemo(), v = s.visits[0];
  for (const invalid of [{...v, phone:'not-permitted'}, {...v,date:'2026-02-30'}, {...v,clientId:id}, {...v,pain:1}, {...v,note:'x'.repeat(4001)}]) {
    assert.equal(clinicalStateSchema.safeParse({...s,visits:[invalid]}).success, false);
  }
  assert.throws(() => addDemoClient(emptyClinicalDemo(), 'Произвольное имя'));
});
test('example is explicitly synthetic and independent from empty state', () => {
  const s = exampleClinicalDemo(); assert.equal(s.clients.length, 2); assert.equal(s.visits.length, 4);
  assert.ok(s.clients.every(c=>c.label.startsWith('Демо-клиент')));
  s.visits.length = 0; assert.equal(exampleClinicalDemo().visits.length,4);
  assert.deepEqual(emptyClinicalDemo().clients,[]);
});
test('public patient demo routes resolve without authentication and are noindex', () => {
  for (const route of ['/admin/patients','/demo/patients']) {
    const page = renderPublicPage('<title>Demo</title><div id="root"></div>',route,initialContent);
    assert.equal(page.status,200); assert.equal(page.noindex,true);
  }
});

test('legacy cards keep visits but discard unrequested numeric assessments', () => {
 const s=exampleClinicalDemo();
 const old={schema:'anna-open-synthetic-clinical-v1',clients:s.clients,visits:s.visits.map(v=>({...v,pain:4,mobility:65}))};
 const restored=restoreClinicalDemo(old);
 assert.deepEqual(restored,s);assert.equal(JSON.stringify(restored).includes('pain'),false);
});
test('photos are bound to a visit and angle, replace only that pair, and roundtrip', () => {
 const s=exampleClinicalDemo(), data='data:image/png;base64,iVBORw0KGgo=';
 const p={visitId:s.visits[0].id,angle:'Спереди',data};
 const a=setDemoPhoto(s,p), b=setDemoPhoto(a,{...p,angle:'Сбоку'}), c=setDemoPhoto(b,p);
 assert.equal(c.photos.length,2);assert.deepEqual(restoreClinicalDemo(JSON.parse(JSON.stringify(c))),c);
 assert.throws(()=>setDemoPhoto(c,{...p,visitId:id}));
 assert.throws(()=>setDemoPhoto(c,{...p,data:'https://example.com/patient.png'}));
 assert.throws(()=>setDemoPhoto(c,{...p,data:'data:image/svg+xml;base64,PHN2Zz4='}));
});

test('dictated text roundtrips without changing photo or client references', () => {
 const s=exampleClinicalDemo();
 const note='Тестовая заметка.\nСинтетическое наблюдение <b>текст</b>.';
 const next=addDemoVisit(s,{clientId:s.clients[0].id,date:'2026-11-06',procedure:PROCEDURES[0],note});
 assert.equal(restoreClinicalDemo(JSON.parse(JSON.stringify(next))).visits.at(-1).note,note);
 assert.deepEqual(next.photos,s.photos); assert.deepEqual(next.clients,s.clients);
});

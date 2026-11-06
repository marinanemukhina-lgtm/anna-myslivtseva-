import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyClinicalDemo, exampleClinicalDemo, clinicalStateSchema, addDemoClient, addDemoVisit, PERSONAS, NOTES, PROCEDURES } from '../shared/clinical-demo.mjs';
import { renderPublicPage } from '../server/public-pages.mjs';
import { initialContent } from '../shared/content.mjs';
const id = '00000000-0000-4000-8000-000000000100';
test('empty cabinet → synthetic card → visit → serializable history', () => {
  let s = addDemoClient(emptyClinicalDemo(), PERSONAS[0], () => id);
  s = addDemoVisit(s, { clientId: id, date:'2026-11-06', procedure: PROCEDURES[0], note: NOTES[0], pain:0, mobility:100 }, () => '00000000-0000-4000-8000-000000000101');
  const restored = clinicalStateSchema.parse(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(restored, s); assert.equal(restored.visits[0].clientId, restored.clients[0].id);
  assert.throws(() => addDemoClient(s, PERSONAS[0]));
});
test('foreign personal fields, invalid dates and orphan visits are rejected', () => {
  const s = exampleClinicalDemo(), v = s.visits[0];
  for (const invalid of [{...v, phone:'not-permitted'}, {...v,date:'2026-02-30'}, {...v,clientId:id}, {...v,pain:11}, {...v,note:'free text'}]) {
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

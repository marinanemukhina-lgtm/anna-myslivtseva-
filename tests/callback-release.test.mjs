import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, scryptSync } from 'node:crypto';
import { callbackDocument, callbackConsentSnapshot, readCallbackConsentSnapshot } from '../shared/callbacks.mjs';
import { initialContent, publicContent } from '../shared/content.mjs';
import { renderPublicPage } from '../server/public-pages.mjs';
import { syntheticCallbackConsent } from './helpers/callback-policy.mjs';

const template = '<title>Test</title><div id="root"></div>';
const complete = () => ({ ...structuredClone(initialContent), profile: { ...initialContent.profile, privacy: 'Синтетическая политика. Не для публикации.', callbackConsent: syntheticCallbackConsent() } });

test('old profile and unpublished or partial consent never leak through public content or SSR', () => {
  const old = complete(); delete old.profile.callbackConsent;
  const candidates = [old, complete(), ...['version','operatorName','operatorDetails','text'].map(key => {
    const data = complete(); data.profile.callbackConsent[key] = '  '; return data;
  })];
  candidates[1].profile.callbackConsent.published = false;
  for (const data of candidates) {
    assert.equal(callbackDocument(data.profile), null);
    assert.equal(callbackConsentSnapshot(data.profile), null);
    assert.equal(publicContent(data).profile.callbackConsent, undefined);
    const page = renderPublicPage(template, '/callback-consent', data);
    assert.equal(page.status, 200);
    assert.match(page.html, /пока не опубликовано/);
    assert.doesNotMatch(page.html, /Синтетический оператор|Вымышленные реквизиты|Синтетическое согласие/);
  }
  const data = complete();
  data.profile.callbackConsent.text += '<script>alert(1)</script>';
  const page = renderPublicPage(template, '/callback-consent', data);
  assert.match(page.html, /Синтетический оператор/);
  assert.match(page.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(page.html, /<script>/);
});

test('HTTP release attestation binds exact operator, document and privacy; draft config stays empty', async t => {
  for (const key of ['DATABASE_URL','DATABASE_TLS_CA_PEM','VERCEL','VERCEL_ENV','CONTACT_CALLBACK_ENABLED','CONTACT_CALLBACK_DATA_APPROVED','CONTACT_CALLBACK_RELEASE_VERSION']) delete process.env[key];
  process.env.DATABASE_DRIVER = 'sqlite';
  const dir = await mkdtemp(join(tmpdir(), 'anna-callback-release-'));
  process.env.DATA_DIR = dir;
  process.env.ADMIN_PASSWORD_HASH = 'synthetic-release:' + scryptSync('synthetic-only', 'synthetic-release', 64).toString('hex');
  const { createApp } = await import('../server/app.mjs');
  const { database } = await import('../server/db.mjs');
  const { callbackReleaseRevision } = await import('../server/callbacks.mjs');
  const db = await database();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {server.once('listening', resolve); server.once('error', reject);});
  t.after(async () => {await new Promise(resolve => server.close(resolve)); await rm(dir,{recursive:true,force:true});});
  const origin = `http://127.0.0.1:${server.address().port}`;
  const req = (route, body) => fetch(origin + route, {method:body === undefined ? 'GET':'POST',headers:{origin,'content-type':'application/json'},...(body === undefined ? {}:{body:JSON.stringify(body)})});
  const put = data => db.query('UPDATE content SET body=$1,version=version+1 WHERE id=$2',[JSON.stringify(data),'main']);
  const config = async () => (await req('/api/contact/config')).json();
  const data = complete();
  await put(data);
  const approved = callbackReleaseRevision(data.profile);
  process.env.CONTACT_CALLBACK_ENABLED = 'true'; process.env.CONTACT_CALLBACK_DATA_APPROVED = 'true';
  const body = {phone:'+447700900001',consent:true,consentVersion:approved.version,requestId:randomUUID(),website:''};
  const assertClosed = async () => {
    const value = await config();
    assert.equal(value.enabled,false); assert.equal(value.consentText,''); assert.equal(value.consentVersion,'');
    assert.doesNotMatch(JSON.stringify(value),/Синтетический оператор|Вымышленные реквизиты|Синтетическое согласие/);
    assert.equal((await req('/api/contact/callback',body)).status,503);
  };
  for (const release of ['', 'wrong', '0'.repeat(64)]) {process.env.CONTACT_CALLBACK_RELEASE_VERSION=release; await assertClosed();}
  process.env.CONTACT_CALLBACK_RELEASE_VERSION=approved.version;
  for (const field of ['version','operatorName','operatorDetails','text']) {
    const changed = structuredClone(data); changed.profile.callbackConsent[field] += ' Изменено'; await put(changed); await assertClosed();
    const partial = structuredClone(data); partial.profile.callbackConsent[field]=' '; await put(partial); await assertClosed();
    const published = await (await req('/api/content')).json(); assert.equal(published.profile.callbackConsent,undefined);
  }
  const privacyChanged=structuredClone(data);privacyChanged.profile.privacy+=' Изменено';await put(privacyChanged);await assertClosed();
  const draft=structuredClone(data);draft.profile.callbackConsent.published=false;await put(draft);await assertClosed();
  assert.equal((await (await req('/api/content')).json()).profile.callbackConsent,undefined);
  const old=structuredClone(data);delete old.profile.callbackConsent;await put(old);await assertClosed();
  await put(data);
  const active=await config();assert.equal(active.enabled,true);assert.match(active.consentText,/Оператор: Синтетический оператор/);
  assert.equal(active.consentUrl,'/callback-consent');assert.equal(active.privacyUrl,'/privacy');
  assert.equal((await req('/api/contact/callback',body)).status,201);
  const [row]=await db.query('SELECT * FROM callback_consents WHERE version=$1',[active.consentVersion]);
  assert.equal(row.privacy_text,data.profile.privacy);assert.deepEqual(readCallbackConsentSnapshot(row.consent_text),approved.snapshot);
  // Existing immutable plaintext revisions are not rewritten by the v2 rollout.
  const legacy='Синтетический старый текст';
  await db.query('INSERT INTO callback_consents VALUES ($1,$2,$3,$4)',['legacy-synthetic','old synthetic privacy',legacy,1]);
  await config();const [legacyRow]=await db.query('SELECT consent_text FROM callback_consents WHERE version=$1',['legacy-synthetic']);
  assert.equal(legacyRow.consent_text,legacy);assert.deepEqual(readCallbackConsentSnapshot(legacyRow.consent_text),{format:'legacy-text',checkboxText:legacy});
  delete process.env.CONTACT_CALLBACK_ENABLED;await assertClosed();
  assert.equal((await db.query('SELECT id FROM callback_requests')).length,1,'closing intake does not erase owner queue');
  // Deletion is lazy access-time housekeeping, not a scheduler or backup SLA.
  const source=await readFile(new URL('../server/callbacks.mjs',import.meta.url),'utf8');
  assert.match(source,/Opportunistic deletion only/);assert.match(source,/provider backups/);
});

test('SSR preserves city/home-visit data and uses only explicit office routing and uploaded hero', () => {
  const data=complete(); data.profile.address='Синтетический город и выезд';data.profile.mapUrl='https://example.com/old-map';
  let html=renderPublicPage(template,'/contact',data).html;
  assert.match(html,/Синтетический город и выезд/);assert.doesNotMatch(html,/Построить маршрут|old-map/);
  data.profile.officeAddress='Синтетический кабинет';data.profile.directionsUrl='javascript:alert(1)';
  html=renderPublicPage(template,'/contact',data).html;assert.match(html,/Синтетический кабинет/);assert.doesNotMatch(html,/Построить маршрут|javascript:/);
  data.profile.directionsUrl='https://example.com/confirmed-route';html=renderPublicPage(template,'/contact',data).html;assert.match(html,/https:\/\/example.com\/confirmed-route/);
  data.profile.heroPortrait='/api/media/synthetic-hero';assert.match(renderPublicPage(template,'/',data).html,/src="\/api\/media\/synthetic-hero"/);
});

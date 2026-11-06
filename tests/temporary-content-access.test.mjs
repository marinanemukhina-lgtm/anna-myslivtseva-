import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { scryptSync } from 'node:crypto';
import { temporaryContentAccess, temporaryCalendarAccess } from '../server/temporary-content-access.mjs';

const host = 'anna-myslivtseva.vercel.app';

test('temporary access is restricted to the exact production host and environment', () => {
  const env = { VERCEL: '1', VERCEL_ENV: 'production' };
  assert.equal(temporaryContentAccess({headers:{host}}, env), true);
  assert.equal(temporaryCalendarAccess({headers:{host}}, env), true);
  assert.equal(temporaryCalendarAccess({headers:{host}}, {...env, VERCEL_ENV:'preview'}), false);
  assert.equal(temporaryCalendarAccess({headers:{host}}, {}), false);
  assert.equal(temporaryContentAccess({headers:{host}}, {...env, VERCEL_ENV:'preview'}), false);
  assert.equal(temporaryContentAccess({headers:{host}}, {}), false);
  for (const other of ['localhost', 'anna-preview.vercel.app', `${host}.example.com`]) {
    assert.equal(temporaryContentAccess({headers:{host:other, 'x-forwarded-host':host}}, env), false);
    assert.equal(temporaryCalendarAccess({headers:{host:other, 'x-forwarded-host':host}}, env), false);
  }
});

test('disabling either opt-in closes temporary calendar access', async () => {
  const source = await readFile(new URL('../server/temporary-content-access.mjs', import.meta.url), 'utf8');
  for (const flag of ['TEMPORARY_CONTENT_ACCESS_ENABLED', 'TEMPORARY_CALENDAR_ACCESS_ENABLED']) {
    const disabled = source.replace(`export const ${flag} = true;`, `export const ${flag} = false;`);
    assert.notEqual(disabled,source);
    const module = await import('data:text/javascript;base64,'+Buffer.from(disabled).toString('base64'));
    assert.equal(module.temporaryCalendarAccess({headers:{host}}, {VERCEL:'1',VERCEL_ENV:'production'}),false);
  }
});

test('open content editor preserves protected schedule and does not create authentication', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'anna-open-content-'));
  process.env.DATA_DIR = dir;
  delete process.env.VERCEL;
  delete process.env.DATABASE_URL;
  const { database, readContent } = await import('../server/db.mjs');
  const { defaults } = await import('../shared/booking.mjs');
  const { query } = await database();
  const fixture = (await readContent()).data;
  fixture.services = [{id:'fixture-service',title:'Test service',body:'',image:'',published:false,price:'',duration:'',category:''}];
  fixture.bookingOccupancy = {schemaVersion:1,coverage:null,records:[{
    id:'a'.repeat(32), operationKey:'b'.repeat(32), type:'busy', status:'active', serviceId:null,
    start:'2026-11-06T09:00:00.000Z', end:'2026-11-06T10:00:00.000Z',
    occupiedStart:'2026-11-06T09:00:00.000Z', occupiedEnd:'2026-11-06T10:00:00.000Z',
  }]};
  fixture.bookingSchedule = {...defaults(), timezone:'Europe/Moscow', services:[{serviceId:'fixture-service',durationMinutes:30,bufferMinutes:5,enabled:true}]};
  await query('UPDATE content SET body=$1 WHERE id=$2', [JSON.stringify(fixture),'main']);
  const { createApp } = await import('../server/app.mjs');
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening',r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, method='GET', body, extra={}) => new Promise((resolve,reject) => {
    const req = http.request(base+route, {
      method, headers: {'content-type':'application/json',host,origin:`https://${host}`,...extra},
    }, res => {
      const chunks=[];
      res.on('data',chunk => chunks.push(chunk));
      res.on('end',() => resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
    });
    req.on('error',reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  t.after(async () => {delete process.env.VERCEL; delete process.env.VERCEL_ENV; await new Promise(r => server.close(r)); await rm(dir,{recursive:true,force:true});});
  assert.equal((await request('/api/admin/content')).status,401);
  process.env.VERCEL = '1';
  process.env.VERCEL_ENV = 'production';
  const session = await request('/api/session');
  assert.equal(session.headers.get('set-cookie'),null);
  const flags = await session.json();
  assert.equal(flags.authenticated,false);
  assert.equal(flags.temporaryContentAccess,true);
  assert.equal(flags.temporaryCalendarAccess,true);
  let content = await (await request('/api/admin/content')).json();
  assert.equal('bookingSchedule' in content.data,false);
  content.data.profile.about = 'Local test only';
  content.data.bookingSchedule = defaults();
  assert.equal((await request('/api/admin/content','PUT',content,{origin:'https://unrelated.example'})).status,403);
  const saved = await request('/api/admin/content','PUT',content);
  assert.equal(saved.status,200);
  const result = await saved.json();
  assert.equal('bookingSchedule' in result.data,false);
  assert.equal(result.data.profile.about,'Local test only');
  assert.deepEqual((await readContent()).data.bookingSchedule,fixture.bookingSchedule);
  assert.equal((await request('/api/admin/content','PUT',content)).status,409);
  result.data.services=[];
  assert.equal((await request('/api/admin/content','PUT',result)).status,409);
  assert.deepEqual((await readContent()).data.bookingSchedule,fixture.bookingSchedule);
  for (const route of ['/api/admin/booking/occupancy','/api/admin/booking/free-availability?serviceId=fixture-service&date=2026-11-06','/api/admin/booking/availability?serviceId=fixture-service&date=2026-11-06']) {
    assert.equal((await request(route)).status,401);
  }
  for (const [route,method] of [['coverage','PUT'],['busy','POST'],['reservations','POST'],['records/fixture/cancel','POST'],['import/preview','POST'],['import/apply','POST']]) {
    assert.equal((await request('/api/admin/booking/'+route,method,{})).status,401);
  }
  const calendar = await (await request('/api/admin/booking')).json();
  assert.equal(calendar.temporaryCalendarAccess,true);
  assert.equal('bookingOccupancy' in calendar,false);
  const settings = {...calendar.settings, horizonDays:45};
  assert.equal((await request('/api/admin/booking','PUT',{settings,version:calendar.version},{origin:'https://unrelated.example'})).status,403);
  const scheduleSave = await request('/api/admin/booking','PUT',{settings,version:calendar.version});
  assert.equal(scheduleSave.status,200);
  assert.equal((await scheduleSave.json()).temporaryCalendarAccess,true);
  assert.deepEqual((await readContent()).data.bookingOccupancy,fixture.bookingOccupancy);
  assert.equal((await readContent()).data.bookingSchedule.horizonDays,45);
  assert.equal((await request('/api/admin/booking','PUT',{settings,version:calendar.version})).status,409);
  assert.equal((await request('/api/admin/booking','PUT',{settings,version:calendar.version+10})).status,409);
  assert.deepEqual((await readContent()).data.bookingOccupancy,fixture.bookingOccupancy);

  assert.equal((await request('/api/admin/marketing','PUT',{})).status,400);
  for (const route of ['/admin/marketing','/api/admin/marketing','/api/admin/marketing/seed','/api/admin/marketing/materials','/api/admin/marketing/assets/materials','/api/admin/marketing/assets/safety','/api/admin/marketing/assets/styles']) assert.equal((await request(route)).status,200);
  assert.equal((await query('SELECT id FROM content WHERE id=$1',['marketing'])).length,0,'Opening marketing must not create a database row');
  const materials=await (await request('/api/admin/marketing/materials')).json();
  assert.equal(materials.publishingEnabled,false);
  assert.equal(materials.editorialPlan.length,4);
  assert.equal('bookingSchedule' in materials,false);
  assert.equal('bookingOccupancy' in materials,false);
  const marketing=await (await request('/api/admin/marketing')).json();
  assert.equal(marketing.version,1);
  assert.equal((await request('/api/admin/marketing','PUT',marketing,{origin:'https://unrelated.example'})).status,403);
  const body={data:marketing.data,version:marketing.version};
  const writes=await Promise.all([request('/api/admin/marketing','PUT',body),request('/api/admin/marketing','PUT',body)]);
  assert.deepEqual(writes.map(x=>x.status).sort(),[200,409]);
  const bad=structuredClone(marketing.data);bad.telegramIdentityAccountId='not-a-real-token';
  assert.equal((await request('/api/admin/marketing','PUT',{data:bad,version:2})).status,400);
  assert.equal((await (await request('/api/session')).json()).authenticated,false);
  assert.equal((await request('/api/admin/marketing/publish','POST',{})).status,401);
  assert.equal((await request('/api/booking/appointments','POST',{})).status,503);
  const upload = await request('/api/media','POST',{name:'local-fixture.png',type:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO/a2nQAAAAASUVORK5CYII='});
  assert.equal(upload.status,201);
  const media = await upload.json();
  assert.equal((await request(media.url)).status,200);
  assert.equal((await request('/api/media','POST',{name:'bad.svg',type:'image/svg+xml',base64:'PHN2Zz4='})).status,400);
  const sessions = await query('SELECT count(*) AS count FROM sessions');
  assert.equal(Number(sessions[0].count),0);
  // The public content mode must not prevent a real password-authenticated
  // owner session, and that session must still be required for private occupancy.
  const previousHash = process.env.ADMIN_PASSWORD_HASH;
  process.env.ADMIN_PASSWORD_HASH = 'owner-fixture:' + scryptSync('synthetic-owner-password', 'owner-fixture', 64).toString('hex');
  try {
    const wrong = await request('/api/session', 'POST', {password:'synthetic-wrong-password'});
    assert.equal(wrong.status,401);
    assert.equal(wrong.headers.get('set-cookie'),null);
    assert.equal((await request('/api/admin/booking/occupancy')).status,401);
    const login = await request('/api/session', 'POST', {password:'synthetic-owner-password'});
    assert.equal(login.status,200);
    const setCookie = login.headers.get('set-cookie');
    assert.match(setCookie,/HttpOnly/i);assert.match(setCookie,/Secure/i);assert.match(setCookie,/SameSite=Strict/i);
    const owner = {cookie:setCookie.split(';')[0]};
    const signedIn = await (await request('/api/session','GET',undefined,owner)).json();
    assert.equal(signedIn.authenticated,true);assert.equal(signedIn.temporaryContentAccess,true);
    assert.equal((await (await request('/api/admin/booking','GET',undefined,owner)).json()).temporaryCalendarAccess,false);
    assert.equal((await request('/api/admin/booking/occupancy','GET',undefined,owner)).status,200);
    assert.ok((await (await request('/api/admin/content','GET',undefined,owner)).json()).data.bookingSchedule);
    assert.equal((await request('/api/session','DELETE',undefined,owner)).status,200);
    assert.equal((await (await request('/api/session','GET',undefined,owner)).json()).authenticated,false);
    assert.equal((await request('/api/admin/booking/occupancy','GET',undefined,owner)).status,401);
    assert.equal((await (await request('/api/admin/booking','GET',undefined,owner)).json()).temporaryCalendarAccess,true);
    const publicAgain = await request('/api/admin/content','GET',undefined,owner);
    assert.equal(publicAgain.status,200);assert.equal('bookingSchedule' in (await publicAgain.json()).data,false);
  } finally {
    if(previousHash === undefined) delete process.env.ADMIN_PASSWORD_HASH; else process.env.ADMIN_PASSWORD_HASH = previousHash;
  }
  process.env.VERCEL_ENV = 'preview';
  assert.equal((await request('/api/admin/booking')).status,401);
  assert.equal((await request('/api/admin/booking','PUT',{settings,version:calendar.version})).status,401);
  assert.equal((await request('/api/admin/content')).status,401);
  assert.equal((await request(media.url)).status,404);
});

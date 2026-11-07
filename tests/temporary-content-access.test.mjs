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
  assert.equal(temporaryContentAccess({headers:{host}}, env), false);
  assert.equal(temporaryCalendarAccess({headers:{host}}, env), false);
  assert.equal(temporaryCalendarAccess({headers:{host}}, {...env, VERCEL_ENV:'preview'}), false);
  assert.equal(temporaryCalendarAccess({headers:{host}}, {}), false);
  assert.equal(temporaryContentAccess({headers:{host}}, {...env, VERCEL_ENV:'preview'}), false);
  assert.equal(temporaryContentAccess({headers:{host}}, {}), false);
  for (const other of ['localhost', 'anna-preview.vercel.app', `${host}.example.com`]) {
    assert.equal(temporaryContentAccess({headers:{host:other, 'x-forwarded-host':host}}, env), false);
    assert.equal(temporaryCalendarAccess({headers:{host:other, 'x-forwarded-host':host}}, env), false);
  }
});

test('disabled temporary access stays closed across production, preview and local', () => {
  for (const env of [{VERCEL:'1',VERCEL_ENV:'production'},{VERCEL:'1',VERCEL_ENV:'preview'},{}]) {
    assert.equal(temporaryContentAccess({headers:{host}},env),false);
    assert.equal(temporaryCalendarAccess({headers:{host}},env),false);
  }
});

test('anonymous admin endpoints remain protected after handoff', async (t) => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'anna-owner-only-'));
  const previous={DATA_DIR:process.env.DATA_DIR,VERCEL:process.env.VERCEL,VERCEL_ENV:process.env.VERCEL_ENV,DATABASE_URL:process.env.DATABASE_URL,ADMIN_PASSWORD_HASH:process.env.ADMIN_PASSWORD_HASH};
  process.env.DATA_DIR=dir;delete process.env.VERCEL;delete process.env.DATABASE_URL;
  const {createApp}=await import('../server/app.mjs');
  const server=createApp().listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await rm(dir,{recursive:true,force:true});});
  const request=(route,method='GET',body,headers={})=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:route,method,headers:{host,origin:'https://'+host,'content-type':'application/json',...headers}},res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
  const session=await(await request('/api/session')).json();
  assert.equal(session.authenticated,false);assert.equal(session.temporaryContentAccess,false);assert.equal(session.temporaryCalendarAccess,false);
  for(const route of ['/api/admin/content','/api/admin/booking','/api/admin/marketing','/admin/marketing','/api/admin/booking/occupancy'])assert.equal((await request(route)).status,401,route);
  for(const [route,method] of [['/api/admin/content','PUT'],['/api/admin/booking','PUT'],['/api/admin/marketing','PUT'],['/api/media','POST']])assert.equal((await request(route,method,{})).status,401,route);
  const salt='owner-fixture';process.env.ADMIN_PASSWORD_HASH=salt+':'+scryptSync('synthetic-owner-password',salt,64).toString('hex');
  assert.equal((await request('/api/session','POST',{password:'wrong'})).status,401);
  const login=await request('/api/session','POST',{password:'synthetic-owner-password'});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly/i);assert.match(cookie,/SameSite=Strict/i);
  assert.equal((await request('/api/admin/content','GET',undefined,{cookie:cookie.split(';')[0]})).status,200);
  assert.equal((await request('/api/session','DELETE',undefined,{cookie:cookie.split(';')[0]})).status,200);
  assert.equal((await request('/api/admin/content','GET',undefined,{cookie:cookie.split(';')[0]})).status,401);
});

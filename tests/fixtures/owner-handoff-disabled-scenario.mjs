// Fresh process and exclusively synthetic local SQLite state for every matrix cell.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scryptSync, createHash } from 'node:crypto';

const state = process.argv[2];
const baselineRoot=process.argv[3];
const sourceURL=relative => baselineRoot ? pathToFileURL(path.join(baselineRoot,relative)) : new URL('../../'+relative,import.meta.url);
assert.ok(['missing','empty','unclaimed','claimed','corrupt','incompatible'].includes(state));
const dir = await mkdtemp(path.join(tmpdir(), 'anna-disabled-matrix-'));
process.env.DATA_DIR = dir;
delete process.env.DATABASE_URL;
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
const password = 'synthetic-disabled-legacy-password';
const encoded = 'a'.repeat(64) + ':' + scryptSync(password, 'a'.repeat(64), 64).toString('hex');
process.env.ADMIN_PASSWORD_HASH = encoded;
const rawPrepare = DatabaseSync.prototype.prepare;
const rawExec = DatabaseSync.prototype.exec;
const fixture = new DatabaseSync(path.join(dir, 'content.sqlite'));
const snapshot = () => {
  const schema = rawPrepare.call(fixture, "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name LIKE 'owner_%' OR tbl_name LIKE 'owner_%' ORDER BY name").all();
  const rows = schema.filter(r => r.type === 'table').map(r => [r.name,rawPrepare.call(fixture, `SELECT * FROM "${r.name}" ORDER BY rowid`).all()]);
  return JSON.stringify({schema,rows});
};
if (state === 'incompatible') {
  fixture.exec("CREATE TABLE owner_security (sentinel TEXT); CREATE TABLE owner_sessions (unrelated BLOB); INSERT INTO owner_security VALUES ('incompatible-do-not-touch'); INSERT INTO owner_sessions VALUES (X'010203');");
} else if (state !== 'missing') {
  fixture.exec('CREATE TABLE owner_security (id TEXT PRIMARY KEY, password_hash TEXT NOT NULL, epoch BIGINT NOT NULL, complete INTEGER NOT NULL, temporary_open INTEGER NOT NULL, invitation_hash TEXT, invitation_expires BIGINT); CREATE TABLE owner_sessions (id TEXT PRIMARY KEY, expires BIGINT NOT NULL, epoch BIGINT NOT NULL);');
  if (state !== 'empty') {
    fixture.prepare('INSERT INTO owner_security VALUES (?,?,?,?,?,?,?)').run('owner',state==='corrupt'?'malformed-synthetic-hash':encoded,state==='corrupt'?-7:9,state==='unclaimed'?0:1,state==='unclaimed'?1:0,state==='corrupt'?'bad':null,null);
    fixture.prepare('INSERT INTO owner_sessions VALUES (?,?,?)').run('sentinel-session-do-not-touch',1,9);
  }
}
const before = snapshot();
const ownerSQL = [];
const allSQL = [];
for (const [name, original] of [['prepare',rawPrepare],['exec',rawExec]]) {
  DatabaseSync.prototype[name] = function(sql, ...args) {
    allSQL.push(String(sql));
    if (/\bowner_(?:security|sessions)\b/i.test(sql)) {
      ownerSQL.push(String(sql));
      throw new Error('DISABLED_RELEASE_EXECUTED_OWNER_SQL: ' + sql);
    }
    return original.call(this,sql,...args);
  };
}
let server;
try {
  if (!baselineRoot) {
    const { OWNER_HANDOFF_MODE, OWNER_HANDOFF_ACTIVE } = await import(sourceURL('shared/owner-handoff-mode.mjs'));
    assert.equal(OWNER_HANDOFF_MODE,'disabled');
    assert.equal(OWNER_HANDOFF_ACTIVE,false);
  }
  const { database,readContent } = await import(sourceURL('server/db.mjs'));
  const { createApp } = await import(sourceURL('server/app.mjs'));
  const { query } = await database();
  // A session created before this release must continue to work and expire normally.
  const oldToken = 'b'.repeat(64);
  const oldId = createHash('sha256').update(oldToken).digest('hex');
  await query('INSERT INTO sessions (id,expires) VALUES ($1,$2)',[oldId,Date.now()+600000]);
  server = createApp().listen(0,'127.0.0.1');
  await new Promise(r => server.once('listening',r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const host = 'anna-myslivtseva.vercel.app';
  const httpResults=[];
  const req = (route,method='GET',body,extra={}) => new Promise((resolve,reject) => {
    const request = http.request(base+route,{method,headers:{host,origin:`https://${host}`,'content-type':'application/json',...extra}}, response => {
      const chunks=[];
      response.on('data',c => chunks.push(c));
      response.on('end',() => {
        const body=Buffer.concat(chunks);
        httpResults.push({route,method,status:response.statusCode,body:body.toString(),contentType:response.headers['content-type'],cacheControl:response.headers['cache-control']});
        resolve(new Response(body,{status:response.statusCode,headers:response.headers}));
      });
    });
    request.on('error',reject);
    request.end(body===undefined?undefined:JSON.stringify(body));
  });
  assert.equal((await req('/api/admin/content')).status,401);
  assert.equal((await req('/api/admin/content','GET',undefined,{cookie:`anna_admin=${oldToken}`})).status,200);
  await query('UPDATE sessions SET expires=$1 WHERE id=$2',[Date.now()-1,oldId]);
  assert.equal((await req('/api/admin/content','GET',undefined,{cookie:`anna_admin=${oldToken}`})).status,401);
  const localFlags=await (await req('/api/session')).json();
  assert.deepEqual(localFlags,{authenticated:false,temporaryContentAccess:false,temporaryCalendarAccess:false,configured:true});
  for (const [route,method,body] of [['/api/owner-handoff','GET'],['/api/owner-handoff/redeem','POST',{}],['/api/admin/owner-invitation','POST',{}],['/api/admin/owner-invitation','DELETE',{}]]) {
    assert.equal((await req(route,method,body)).status,404,`${method} ${route} must not register`);
  }
  process.env.VERCEL='1'; process.env.VERCEL_ENV='production'; // Only host-gating simulation; all network stays loopback.
  const session = await req('/api/session');
  assert.equal(session.headers.get('set-cookie'),null);
  assert.deepEqual(await session.json(),{authenticated:false,temporaryContentAccess:true,temporaryCalendarAccess:true,configured:false});
  let cms = await (await req('/api/admin/content')).json();
  assert.equal('bookingSchedule' in cms.data,false);
  cms.data.profile.about='Synthetic disabled-release parity edit';
  assert.equal((await req('/api/admin/content','PUT',cms,{origin:'https://unrelated.example'})).status,403);
  const saved=await req('/api/admin/content','PUT',cms);
  assert.equal(saved.status,200);
  assert.equal((await saved.json()).data.profile.about,cms.data.profile.about);
  assert.equal((await req('/api/admin/content','PUT',cms)).status,409);
  const calendar=await (await req('/api/admin/booking')).json();
  assert.equal(calendar.temporaryCalendarAccess,true);
  const settings={...calendar.settings,horizonDays:45};
  assert.equal((await req('/api/admin/booking','PUT',{settings,version:calendar.version})).status,200);
  assert.equal((await req('/api/admin/booking','PUT',{settings,version:calendar.version})).status,409);
  assert.equal((await readContent()).data.bookingSchedule.horizonDays,45);
  for (const route of ['/admin/marketing','/api/admin/marketing','/api/admin/marketing/seed','/api/admin/marketing/assets/safety','/api/admin/marketing/assets/styles','/api/admin/booking/occupancy','/api/admin/booking/free-availability?serviceId=synthetic&date=2026-11-06','/api/admin/booking/availability?serviceId=synthetic&date=2026-11-06']) {
    assert.equal((await req(route)).status,401,route);
  }
  for (const [route,method] of [['coverage','PUT'],['busy','POST'],['reservations','POST'],['records/fixture/cancel','POST'],['import/preview','POST'],['import/apply','POST']]) {
    assert.equal((await req('/api/admin/booking/'+route,method,{})).status,401,route);
  }
  assert.equal((await req('/api/admin/marketing','PUT',{})).status,401);
  assert.equal((await req('/api/admin/marketing/publish','POST',{})).status,401);
  assert.equal((await req('/api/booking/appointments','POST',{})).status,503);
  assert.equal(Number((await query('SELECT count(*) AS count FROM sessions'))[0].count),1);
  const bad=await req('/api/session','POST',{password:'synthetic-wrong-password'});
  assert.equal(bad.status,401);assert.equal(bad.headers.get('set-cookie'),null);
  const login=await req('/api/session','POST',{password});
  assert.equal(login.status,200);
  const setCookie=login.headers.get('set-cookie');
  assert.match(setCookie,/HttpOnly/i);assert.match(setCookie,/Secure/i);assert.match(setCookie,/SameSite=Strict/i);
  const authenticated={cookie:setCookie.split(';')[0]};
  assert.equal(Number((await query('SELECT count(*) AS count FROM sessions'))[0].count),1);
  assert.equal((await (await req('/api/session','GET',undefined,authenticated)).json()).authenticated,true);
  assert.equal((await req('/api/admin/booking/occupancy','GET',undefined,authenticated)).status,200);
  assert.equal((await req('/api/admin/marketing','GET',undefined,authenticated)).status,200);
  assert.ok((await (await req('/api/admin/content','GET',undefined,authenticated)).json()).data.bookingSchedule);
  assert.equal((await (await req('/api/admin/booking','GET',undefined,authenticated)).json()).temporaryCalendarAccess,false);
  assert.equal((await req('/api/session','DELETE',undefined,authenticated)).status,200);
  assert.equal(Number((await query('SELECT count(*) AS count FROM sessions'))[0].count),0);
  assert.equal((await (await req('/api/session','GET',undefined,authenticated)).json()).authenticated,false);
  assert.equal((await req('/api/admin/booking/occupancy','GET',undefined,authenticated)).status,401);
  process.env.VERCEL_ENV='preview';
  assert.equal((await req('/api/admin/content')).status,401);
  assert.equal((await req('/api/admin/booking')).status,401);
  delete process.env.VERCEL;delete process.env.VERCEL_ENV;
  delete process.env.ADMIN_PASSWORD_HASH;
  assert.equal((await req('/api/session','POST',{password})).status,503);
  assert.equal((await (await req('/api/session')).json()).configured,false);
  assert.deepEqual(ownerSQL,[],'No owner SQL may reach SQLite prepare or exec');
  assert.ok(allSQL.some(sql => /INSERT INTO sessions/i.test(sql)),'Legacy session insert was exercised');
  assert.equal(snapshot(),before,'Owner tables, schema and sentinel rows must remain untouched');
  if(!baselineRoot) {
    const init=fileURLToPath(sourceURL('scripts/init-owner-handoff.mjs'));
    const preload=fileURLToPath(new URL('./owner-handoff-disabled-init-preload.mjs',import.meta.url));
    await assert.rejects(promisify(execFile)(process.execPath,['--import',preload,init,'--initialize-existing-owner'],{cwd:dir,env:{PATH:process.env.PATH,DATA_DIR:dir,ADMIN_PASSWORD_HASH:encoded,OWNER_HANDOFF_REQUIRED:'1'},timeout:10000}),error=>{
      assert.equal(error.code,1);assert.match(error.stderr+error.stdout,/Owner handoff initialization is unavailable in this disabled release\./);
      assert.doesNotMatch(error.stdout+error.stderr,/DISABLED_INIT_ATTEMPTED/);
      return true;
    });
    assert.equal(snapshot(),before,'Disabled init must leave all existing owner state untouched');
  }
  console.log(JSON.stringify({state,required:process.env.OWNER_HANDOFF_REQUIRED??'unset',ownerSQL:ownerSQL.length,legacyParity:true,httpResults,dbResults:{content:await query('SELECT id,body,version FROM content ORDER BY id'),sessions:await query('SELECT count(*) AS count FROM sessions'),attempts:await query('SELECT count(*) AS count FROM attempts'),media:await query('SELECT count(*) AS count FROM media')}}));
} finally {
  DatabaseSync.prototype.prepare=rawPrepare;
  DatabaseSync.prototype.exec=rawExec;
  if(server) await new Promise(r => server.close(r));
  fixture.close();
  await rm(dir,{recursive:true,force:true});
}

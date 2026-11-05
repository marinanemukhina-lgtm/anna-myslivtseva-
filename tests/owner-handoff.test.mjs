import test from 'node:test';
import {createActiveOwnerSource} from './helpers/active-owner-source.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

test('synthetic durable handoff: fail closed, one winner, session revocation and guarded editors', async t=>{
  const source=await createActiveOwnerSource(t);
  const dir=await mkdtemp(path.join(os.tmpdir(),'anna-handoff-test-'));
  delete process.env.DATABASE_URL; delete process.env.VERCEL;
  process.env.DATA_DIR=dir; process.env.OWNER_HANDOFF_REQUIRED='1';
  const {createApp}=await source.import('server/app.mjs');
  const {database,accessContext,guardMutation,OWNER_SESSION_INSERT}=await source.import('server/db.mjs');
  const {encodePassword,digest,securityState,temporaryAllowed,enabled}=await source.import('server/owner-handoff.mjs');
  const oldPassword='synthetic-old-password',newPassword='synthetic-new-password';
  const encoded=encodePassword(oldPassword); process.env.ADMIN_PASSWORD_HASH=encoded;
  const {query}=await database();
  const server=createApp().listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  let cookie='';
  const req=(route,method='GET',body,extra={})=>fetch(base+route,{method,headers:{'content-type':'application/json',origin:base,cookie,...extra},body:body===undefined?undefined:JSON.stringify(body)});
  const login=async(password)=>{const r=await req('/api/session','POST',{password}); if(r.ok)cookie=r.headers.get('set-cookie').split(';')[0]; return r;};
  assert.equal((await login(oldPassword)).status,503);
  assert.deepEqual(await (await req('/api/owner-handoff')).json(),{enabled:true,configured:false,complete:false,mayIssue:false});
  assert.equal(await temporaryAllowed(),false);
  for(const flag of [undefined,'0','1']){
    if(flag===undefined)delete process.env.OWNER_HANDOFF_REQUIRED;else process.env.OWNER_HANDOFF_REQUIRED=flag;
    assert.equal(await enabled(),true);
    assert.equal(await temporaryAllowed(),false);
    assert.equal((await login(oldPassword)).status,503,'missing initial state never uses env password');
  }
  await query("INSERT INTO owner_security (id,password_hash,epoch,complete,temporary_open) VALUES ('owner',$1,1,0,1)",[encoded]);
  const publicReq=async(route,method='GET',body)=>{
    process.env.VERCEL='1';process.env.VERCEL_ENV='production';
    try{return await new Promise((resolve,reject)=>{
      const r=http.request(base+route,{method,headers:{'content-type':'application/json',host:'anna-myslivtseva.vercel.app',origin:'https://anna-myslivtseva.vercel.app'}},response=>{
        const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));
      });r.on('error',reject);r.end(body===undefined?undefined:JSON.stringify(body));
    });}
    finally{delete process.env.VERCEL;delete process.env.VERCEL_ENV;}
  };
  assert.equal((await publicReq('/api/admin/content')).status,200);
  assert.equal((await publicReq('/api/admin/booking')).status,200);
  assert.equal((await login(oldPassword)).status,200);
  const oldCookie=cookie, sessionId=digest(cookie.split('=')[1]);
  const context={epoch:1,sessionId};
  await query('UPDATE owner_sessions SET expires=$1 WHERE id=$2',[Date.now()-1,sessionId]);
  assert.equal((await req('/api/admin/owner-invitation','POST',{password:oldPassword})).status,401);
  await query('UPDATE owner_sessions SET expires=$1 WHERE id=$2',[Date.now()+600000,sessionId]);
  assert.equal((await req('/api/admin/owner-invitation','POST',{password:'bad'})).status,401);
  assert.equal((await req('/api/admin/owner-invitation','POST',{password:oldPassword,extra:true})).status,400);
  let issue=await (await req('/api/admin/owner-invitation','POST',{password:oldPassword})).json();
  assert.match(issue.invitation,/^[a-f0-9]{64}$/);assert.equal((await securityState()).invitation_hash,digest(issue.invitation));
  assert.equal((await req('/api/admin/owner-invitation','DELETE',{password:oldPassword})).status,200);
  assert.equal((await req('/api/owner-handoff/redeem','POST',{invitation:issue.invitation,password:newPassword})).status,409);
  issue=await (await req('/api/admin/owner-invitation','POST',{password:oldPassword})).json();
  await query("UPDATE owner_security SET invitation_expires=$1 WHERE id='owner'",[Date.now()-1]);
  assert.equal((await req('/api/owner-handoff/redeem','POST',{invitation:issue.invitation,password:newPassword})).status,409);
  issue=await (await req('/api/admin/owner-invitation','POST',{password:oldPassword})).json();
  assert.equal((await req('/api/owner-handoff/redeem','POST',{invitation:randomBytes(32).toString('hex'),password:newPassword})).status,409);
  const current=await (await req('/api/admin/content')).json();
  const update='UPDATE content SET body=$1,version=version+1 WHERE id=$2 AND version=$3 RETURNING version';
  const temporary={temporary:true,epoch:1};
  const before=await accessContext.run(temporary,()=>query(update,[JSON.stringify(current.data),'main',current.version]));assert.equal(before.length,1);
  const mediaId='12345678-1234-1234-1234-123456789012';
  const media='INSERT INTO media (id,mime,body,name) VALUES ($1,$2,$3,$4)';
  assert.equal((await accessContext.run(temporary,()=>query(media,[mediaId,'application/pdf',Buffer.from('%PDF-test').toString('base64'),'synthetic']))).length,1);
  assert.equal((await publicReq('/api/media/'+mediaId)).status,200);
  const winners=await Promise.all([1,2].map(()=>req('/api/owner-handoff/redeem','POST',{invitation:issue.invitation,password:newPassword})));
  assert.deepEqual(winners.map(r=>r.status).sort(),[200,409]);
  assert.equal((await securityState()).epoch,2);assert.equal(await temporaryAllowed(),false);
  assert.equal((await publicReq('/api/admin/content')).status,401);
  assert.equal((await publicReq('/api/admin/booking')).status,401);
  assert.equal((await publicReq('/api/media/'+mediaId)).status,404);
  assert.equal((await publicReq('/api/media','POST',{})).status,401);
  assert.equal((await req('/api/admin/content')).status,401);
  assert.equal((await req('/api/admin/booking')).status,401);
  assert.equal((await req('/api/media/'+mediaId)).status,404);
  assert.equal((await req('/api/media','POST',{})).status,401);
  assert.equal((await req('/api/admin/owner-invitation','POST',{password:oldPassword})).status,401);
  assert.equal((await login(oldPassword)).status,401);
  assert.equal((await accessContext.run(temporary,()=>query(update,[JSON.stringify(current.data),'main',current.version+1]))).length,0);
  assert.equal((await accessContext.run(context,()=>query(update,[JSON.stringify(current.data),'main',current.version+1]))).length,0);
  assert.equal((await accessContext.run(temporary,()=>query(media,[randomBytes(16).toString('hex'),'application/pdf','','synthetic']))).length,0);
  const seed='INSERT INTO content (id,body,version) VALUES ($1,$2,1) ON CONFLICT (id) DO NOTHING';
  assert.equal((await accessContext.run(context,()=>query(seed,['late-seed','{}']))).length,0);
  assert.equal((await query(OWNER_SESSION_INSERT,['stale',Date.now()+60000,1,encoded])).length,0);
  assert.throws(()=>guardMutation('DELETE FROM media WHERE id=$1',[mediaId],context),/UNGUARDED_WRITE/);
  assert.equal((await login(newPassword)).status,200);
  assert.equal((await req('/api/admin/content')).status,200);
  assert.equal((await req('/api/owner-handoff/redeem','POST',{invitation:issue.invitation,password:newPassword})).status,409);
  await query('DELETE FROM attempts');
  for(let i=0;i<8;i++) assert.equal((await req('/api/owner-handoff/redeem','POST',{invitation:issue.invitation,password:newPassword})).status,409);
  assert.equal((await req('/api/owner-handoff/redeem','POST',{invitation:issue.invitation,password:newPassword})).status,429);
  delete process.env.OWNER_HANDOFF_REQUIRED;
  assert.equal(await temporaryAllowed(),false);
  assert.equal((await req('/api/admin/content','GET',undefined,{cookie:oldCookie})).status,401);
  assert.equal((await login(oldPassword)).status,401);
  assert.equal((await login(newPassword)).status,200);
  await query("UPDATE owner_security SET invitation_expires=1 WHERE id='owner'");
  assert.equal(await securityState(),null);assert.equal(await temporaryAllowed(),false);
  assert.equal((await req('/api/admin/content')).status,401);
  assert.equal((await login(newPassword)).status,503);
  // A genuine legacy-session row and its cookie must never become a fallback.
  const legacyToken=randomBytes(32).toString('hex');
  await query('INSERT INTO sessions (id,expires) VALUES ($1,$2)',[digest(legacyToken),Date.now()+600000]);
  const legacyCookie='anna_admin='+legacyToken;
  async function closed(label){
    for(const flag of [undefined,'0','1']){
      if(flag===undefined)delete process.env.OWNER_HANDOFF_REQUIRED;else process.env.OWNER_HANDOFF_REQUIRED=flag;
      assert.equal(await enabled(),true,label);
      assert.equal(await temporaryAllowed(),false,label);
      assert.equal((await login(oldPassword)).status,503,label+' old password');
      assert.equal((await login(newPassword)).status,503,label+' new password');
      for(const route of ['/api/admin/content','/api/admin/booking']){
        const legacyResponse=await req(route,'GET',undefined,{cookie:legacyCookie});
        assert.ok([401,503].includes(legacyResponse.status),label+' legacy cookie');
        const temporaryResponse=await publicReq(route);
        assert.ok([401,503].includes(temporaryResponse.status),label+' temporary editor');
      }
      const guarded=guardMutation(update,['{}','main',1],{legacy:true});
      assert.match(guarded.statement,/1=0/,label);
    }
  }
  await closed('corrupt invitation state');
  await query("UPDATE owner_security SET invitation_expires=NULL,password_hash='invalid' WHERE id='owner'");
  await closed('corrupt password hash');
  await query("UPDATE owner_security SET password_hash=$1,epoch=0 WHERE id='owner'",[encoded]);
  await closed('invalid epoch');
  await query("DELETE FROM owner_security WHERE id='owner'");
  await closed('deleted owner row');
  await query('DROP TABLE owner_security');
  await closed('missing owner schema');
  await query('CREATE TABLE owner_security (id TEXT PRIMARY KEY)');
  await query("INSERT INTO owner_security (id) VALUES ('owner')");
  await closed('incompatible owner schema');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {scryptSync} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const run=promisify(execFile);
const script=fileURLToPath(new URL('../scripts/init-owner-handoff.mjs',import.meta.url));
const legacy=fileURLToPath(new URL('../scripts/setup.mjs',import.meta.url));
const salt='a'.repeat(64),encoded=salt+':'+scryptSync('synthetic-init-only-password',salt,64).toString('hex');
async function fixture(t){const dir=await mkdtemp(path.join(tmpdir(),'owner-init-synthetic-'));t.after(()=>rm(dir,{recursive:true,force:true}));return {dir,env:{PATH:process.env.PATH,DATA_DIR:dir,ADMIN_PASSWORD_HASH:encoded}};}
test('initialization requires explicit opt-in and never prints a hash',async t=>{
 const {dir,env}=await fixture(t);
 for(const [args,settings] of [[[],env],[['--initialize-existing-owner'],env],[[],{...env,OWNER_HANDOFF_REQUIRED:'1'}]]){
  await assert.rejects(run(process.execPath,[script,...args],{cwd:dir,env:settings}),e=>e.code===1&&!e.stdout.includes(encoded)&&!e.stderr.includes(encoded));
 }
 await assert.rejects(access(path.join(dir,'content.sqlite')));
});
test('synthetic initialization preserves a completed durable owner on repeat',async t=>{
 const {dir,env}=await fixture(t),settings={...env,OWNER_HANDOFF_REQUIRED:'1'};
 const r=await run(process.execPath,[script,'--initialize-existing-owner'],{cwd:dir,env:settings});
 assert.doesNotMatch(r.stdout,/invitation.*[a-f0-9]{64}/i);assert.ok(!r.stdout.includes(encoded));
 const db=new DatabaseSync(path.join(dir,'content.sqlite'));t.after(()=>db.close());
 const before=db.prepare("SELECT * FROM owner_security WHERE id='owner'").get();
 assert.equal(before.password_hash,encoded);assert.equal(before.epoch,1);assert.equal(before.invitation_hash,null);
 db.prepare("UPDATE owner_security SET epoch=2,complete=1,temporary_open=0 WHERE id='owner'").run();
 await assert.rejects(run(process.execPath,[script,'--initialize-existing-owner'],{cwd:dir,env:settings}),e=>e.code===1);
 const after=db.prepare("SELECT * FROM owner_security WHERE id='owner'").get();assert.equal(after.epoch,2);assert.equal(after.complete,1);assert.equal(after.temporary_open,0);
 // An initialized database remains authoritative even after removing its opt-in.
 await assert.rejects(run(process.execPath,[legacy],{cwd:dir,env}),e=>e.code===1&&e.stderr.includes('Legacy setup cannot reset'));
 await assert.rejects(access(path.join(dir,'.env')));
});

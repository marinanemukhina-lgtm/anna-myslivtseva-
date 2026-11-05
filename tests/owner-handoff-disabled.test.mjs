import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readdir, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scryptSync } from 'node:crypto';

const run=promisify(execFile);
const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=fileURLToPath(new URL('./fixtures/owner-handoff-disabled-scenario.mjs',import.meta.url));
const initPreload=fileURLToPath(new URL('./fixtures/owner-handoff-disabled-init-preload.mjs',import.meta.url));
const init=fileURLToPath(new URL('../scripts/init-owner-handoff.mjs',import.meta.url));
// Never inherit production credentials, dotenv settings or runtime Node hooks.
const cleanEnv=required => ({PATH:process.env.PATH,HOME:tmpdir(),NODE_NO_WARNINGS:'1',...(required==='unset'?{}:{OWNER_HANDOFF_REQUIRED:required}),OWNER_HANDOFF_MODE:'active',OWNER_HANDOFF_ACTIVE:'true'});
let baselineRoot;
let baselineDirectory;
before(async()=>{
  // This is a read-only check of a local commit, never a fetch or remote access.
  try { await run('git',['cat-file','-e','f74255d513d4cdbdb1f210b546435a3d744714ab^{commit}'],{cwd:root}); }
  catch {
    if (process.env.CI) throw new Error('CI requires baseline f74255d513d4cdbdb1f210b546435a3d744714ab for mandatory differential checks; fetch full read-only history.');
    return;
  }
  baselineDirectory=await mkdtemp(path.join(tmpdir(),'anna-disabled-baseline-'));
  baselineRoot=baselineDirectory;
  const archive=path.join(baselineDirectory,'baseline.tar');
  await run('git',['archive','--format=tar','--output',archive,'f74255d513d4cdbdb1f210b546435a3d744714ab'],{cwd:root});
  await run('tar',['-xf',archive,'-C',baselineDirectory]);
  await rm(archive);
  await symlink(path.join(root,'node_modules'),path.join(baselineDirectory,'node_modules'),'dir');
});
after(async()=>{if(baselineDirectory)await rm(baselineDirectory,{recursive:true,force:true});});
for(const state of ['missing','empty','unclaimed','claimed','corrupt','incompatible']) {
  for(const required of ['unset','0','1']) {
    test(`disabled release: ${state} owner tables × OWNER_HANDOFF_REQUIRED=${required}`,{timeout:30000},async t=>{
      const result=await run(process.execPath,[fixture,state],{cwd:root,env:cleanEnv(required),timeout:25000,maxBuffer:1024*1024});
      const actual=JSON.parse(result.stdout.trim());
      assert.equal(actual.state,state);assert.equal(actual.required,required);assert.equal(actual.ownerSQL,0);assert.equal(actual.legacyParity,true);
      if(baselineRoot) {
        const baseline=await run(process.execPath,[fixture,state,baselineRoot],{cwd:baselineRoot,env:cleanEnv(required),timeout:25000,maxBuffer:1024*1024});
        assert.deepEqual(actual,JSON.parse(baseline.stdout.trim()),'Actual HTTP response bodies/statuses and legacy database rows must match baseline f74255d5');
      } else t.diagnostic('Baseline f74255d5 unavailable locally: independent legacy expectations ran; differential comparison not run.');
    });
  }
}

test('disabled operator initialization exits before creating any data or files, regardless of environment opt-in',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'anna-disabled-init-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const salt='c'.repeat(64);
  const encoded=salt+':'+scryptSync('synthetic-init-disabled-password',salt,64).toString('hex');
  for(const required of ['unset','0','1']) {
    for(const args of [[],['--initialize-existing-owner']]) {
      await assert.rejects(run(process.execPath,['--import',initPreload,init,...args],{cwd:dir,env:{...cleanEnv(required),DATA_DIR:path.join(dir,'must-not-be-created'),ADMIN_PASSWORD_HASH:encoded},timeout:10000}),error=>{
        assert.equal(error.code,1);
        assert.match(error.stdout+error.stderr,/Owner handoff initialization is unavailable in this disabled release\./);
        assert.doesNotMatch(error.stdout+error.stderr,/DISABLED_INIT_ATTEMPTED/);
        assert.ok(!(error.stdout+error.stderr).includes(encoded));
        return true;
      });
      assert.deepEqual(await readdir(dir),[],'Disabled init must not create SQLite, DATA_DIR or dotenv files');
    }
  }
});

test('source mode cannot be activated by runtime environment or storage',async()=>{
  const source=await readFile(new URL('../shared/owner-handoff-mode.mjs',import.meta.url),'utf8');
  assert.match(source,/export const OWNER_HANDOFF_MODE\s*=\s*['"]disabled['"]/);
  assert.match(source,/export const OWNER_HANDOFF_ACTIVE\s*=\s*OWNER_HANDOFF_MODE\s*===\s*['"]active['"]/);
  assert.doesNotMatch(source,/process\.env|import\.meta\.env/);
});


test('disabled legacy setup preserves baseline and does not eagerly load dotenv or owner storage',async t=>{
  const setup=fileURLToPath(new URL('../scripts/setup.mjs',import.meta.url));
  const source=await readFile(setup,'utf8');
  assert.doesNotMatch(source,/dotenv/);
  if(baselineRoot){
    const baseline=await readFile(path.join(baselineRoot,'scripts/setup.mjs'),'utf8');
    assert.equal(source.slice(source.indexOf('import { scryptSync')),baseline);
  }
  const dir=await mkdtemp(path.join(tmpdir(),'anna-disabled-setup-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  for(const required of ['unset','0','1']){
    await assert.rejects(run(process.execPath,['--import',initPreload,setup],{cwd:dir,env:{...cleanEnv(required),DATA_DIR:path.join(dir,'must-not-be-created')}}),error=>{
      assert.equal(error.code,1);
      assert.match(error.stderr,/Запустите npm run setup в интерактивном терминале/);
      assert.doesNotMatch(error.stdout+error.stderr,/DISABLED_INIT_ATTEMPTED/);
      return true;
    });
    assert.deepEqual(await readdir(dir),[]);
  }
});

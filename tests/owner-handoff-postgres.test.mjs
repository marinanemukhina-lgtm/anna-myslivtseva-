import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

// Opt-in integration checks against a disposable PostgreSQL 16 database only.
// Never calls database(), reads .env, or falls back to DATABASE_URL.
// Imports only pure SQL/constants after the disposable endpoint is verified.
// Run with psql on PATH and these two dedicated variables:
// OWNER_HANDOFF_POSTGRES_TEST_ALLOW_WRITE=synthetic-only
// OWNER_HANDOFF_POSTGRES_TEST_URL=postgresql://booking_synthetic:booking-synthetic-only@127.0.0.1:55432/booking_synthetic
// Without them the database suite explicitly skips, not a PostgreSQL pass.
const urlVariable = 'OWNER_HANDOFF_POSTGRES_TEST_URL';
const optInVariable = 'OWNER_HANDOFF_POSTGRES_TEST_ALLOW_WRITE';
const testUrl = 'postgresql://booking_synthetic:booking-synthetic-only@127.0.0.1:55432/booking_synthetic';
const casSql = 'UPDATE content SET body=$1,version=version+1 WHERE id=$2 AND version=$3 RETURNING version';

function configuration(env) {
  assert.equal(env[optInVariable], 'synthetic-only', `${optInVariable}=synthetic-only is required`);
  assert.ok(!env.DATABASE_URL, 'Refusing a process with DATABASE_URL set; use a clean synthetic-only environment');
  assert.ok(env[urlVariable], `${urlVariable} must explicitly name the disposable database`);
  let url;
  try { url = new URL(env[urlVariable]); } catch { throw new Error('Invalid dedicated synthetic PostgreSQL URL'); }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'Only PostgreSQL URLs are allowed');
  assert.ok(['127.0.0.1', '[::1]'].includes(url.hostname), 'Only literal loopback endpoints are allowed');
  assert.ok(url.port && Number(url.port) >= 1024, 'An explicit unprivileged test port is required');
  // Boolean assertions deliberately avoid echoing an accidentally supplied URL
  // component (especially a real password) in a failing test's diagnostic.
  assert.ok(url.username === 'booking_synthetic', 'Only the dedicated synthetic role is allowed');
  assert.ok(url.password === 'booking-synthetic-only', 'Only the fixed non-secret synthetic password is allowed');
  assert.ok(url.pathname === '/booking_synthetic', 'Only the dedicated synthetic database is allowed');
  assert.ok(url.search === '', 'Connection options and endpoint overrides are forbidden');
  assert.ok(url.hash === '', 'URL fragments are forbidden');
  return {
    host: url.hostname === '[::1]' ? '::1' : url.hostname,
    port: url.port,
  };
}

// Byte encoding avoids shell interpolation, psql substitution, quote escaping,
// backslash handling and standard_conforming_strings dependencies for data.
const sqlText = value => {
  assert.equal(typeof value, 'string');
  assert.ok(!value.includes('\0'), 'PostgreSQL text cannot contain NUL');
  return `convert_from(decode('${Buffer.from(value, 'utf8').toString('hex')}','hex'),'UTF8')`;
};
const envelope = relation => `SELECT json_build_object('backendPid',pg_backend_pid(),'rows',COALESCE(json_agg(result),'[]'::json)) FROM (${relation}) AS result;`;

function runner(config) {
  return async sql => {
    // Do not inherit PG*, service files, credentials, dotenv or app configuration.
    // psql -X also disables user/system psqlrc. Every command is a new real
    // PostgreSQL connection; concurrent CAS calls use independent backends.
    const env = {
      PATH: process.env.PATH,
      LC_ALL: 'C',
      PGHOST: config.host,
      PGPORT: config.port,
      PGDATABASE: 'booking_synthetic',
      PGUSER: 'booking_synthetic',
      PGPASSWORD: 'booking-synthetic-only',
      PGPASSFILE: '/dev/null',
      PGSERVICEFILE: '/dev/null',
      PGCONNECT_TIMEOUT: '5',
      PGSSLMODE: 'disable',
      PGAPPNAME: 'owner-handoff-synthetic-test',
      PGCLIENTENCODING: 'UTF8',
    };
    return new Promise((resolve, reject) => {
      const child = spawn('psql', ['--no-psqlrc', '--no-password', '--quiet', '--no-align', '--tuples-only', '--set', 'ON_ERROR_STOP=1', '--file', '-'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', settled = false;
      const timeout = setTimeout(() => finish(new Error('Synthetic psql command timed out')), 12_000);
      function finish(error, result) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) { child.kill('SIGKILL'); reject(error); } else resolve(result);
      }
      child.on('error', () => finish(new Error('Cannot start psql: configured PostgreSQL checks require the PostgreSQL client')));
      child.stdin.on('error', () => finish(new Error('Cannot send synthetic SQL to psql')));
      child.stdout.on('data', chunk => {
        stdout += chunk;
        if (stdout.length > 4 * 1024 * 1024) finish(new Error('Synthetic psql output exceeded its limit'));
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
      child.on('close', code => {
        if (code !== 0) return finish(new Error(`Synthetic PostgreSQL command failed (exit ${code}): ${stderr.trim()}`));
        // Resolve only after psql exits successfully, not when RETURNING arrives:
        // the manager's adapter contract requires commit acknowledgement.
        try {
          const result = JSON.parse(stdout.trim());
          assert.ok(Number.isInteger(result.backendPid));
          assert.ok(Array.isArray(result.rows));
          finish(null, result);
        } catch { finish(new Error('Synthetic psql did not return one valid JSON result')); }
      });
      child.stdin.end(`SET statement_timeout='5s'; SET lock_timeout='3s';\n${sql}\n`);
    });
  };
}

test('PostgreSQL test configuration refuses production/default connections and endpoint overrides', () => {
  const valid = { [urlVariable]: testUrl, [optInVariable]: 'synthetic-only' };
  assert.deepEqual(configuration(valid), { host: '127.0.0.1', port: '55432' });
  assert.throws(() => configuration({ DATABASE_URL: testUrl }));
  assert.throws(() => configuration({ ...valid, DATABASE_URL: 'postgresql://production.invalid/live' }));
  assert.throws(() => configuration({ ...valid, [optInVariable]: '' }));
  assert.throws(() => configuration({ ...valid, [urlVariable]: '' }));
  for (const unsafe of [
    testUrl.replace('127.0.0.1', 'production.invalid'),
    testUrl.replace('127.0.0.1', 'localhost'),
    testUrl.replace('postgresql:', 'https:'),
    testUrl.replace(':55432', ''),
    testUrl.replace(':55432', ':443'),
    testUrl.replace('/booking_synthetic', '/postgres'),
    testUrl.replace('booking_synthetic:', 'postgres:'),
    testUrl.replace('booking-synthetic-only', 'real-password'),
    `${testUrl}?host=production.invalid`,
    `${testUrl}#ignored`,
  ]) assert.throws(() => configuration({ ...valid, [urlVariable]: unsafe }));
});

const configured = Object.hasOwn(process.env,urlVariable)||Object.hasOwn(process.env,optInVariable);
test('real PostgreSQL 16: synthetic owner transfer and commit-time fencing',{
 skip:configured?false:`Not run: set ${urlVariable} and ${optInVariable} for disposable loopback PostgreSQL 16`,timeout:120000,
},async t=>{
 const run=runner(configuration(process.env));
 const {rows:[identity]}=await run(envelope(`SELECT current_database() AS database,current_user AS role,current_setting('server_version_num')::integer AS version,(SELECT count(*)::integer FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_schema !~ '^booking_test_[a-f0-9]{24}$') AS foreign_tables`));
 assert.equal(identity.database,'booking_synthetic');assert.equal(identity.role,'booking_synthetic');assert.ok(identity.version>=160000&&identity.version<170000);assert.equal(identity.foreign_tables,0);
 const {guardMutation,OWNER_SECURITY_DDL,OWNER_SESSIONS_DDL,OWNER_SESSION_INSERT}=await import('../server/db.mjs');
 const {OWNER_REDEEM_SQL,encodePassword,digest}=await import('../server/owner-handoff.mjs');
 const oldHash=encodePassword('synthetic-old-password'),newHash=encodePassword('synthetic-new-password');
 const token='a'.repeat(64),now=Date.now(),session='b'.repeat(64);
 function literal(value){if(value===null)return 'NULL';if(typeof value==='number'){assert.ok(Number.isSafeInteger(value));return String(value);}return sqlText(value);}
 const bind=(sql,args)=>sql.replace(/\$(\d+)/g,(_,n)=>{assert.ok(Number(n)>=1&&Number(n)<=args.length);return literal(args[Number(n)-1]);});
 const changed=sql=>`WITH changed AS (${sql}) ${envelope('SELECT * FROM changed')}`;
 const lock="DO $gate$ BEGIN PERFORM id FROM owner_security WHERE id='owner' FOR UPDATE; END $gate$;";
 async function fixture(context,{initialized=true}={}){
  const schema='booking_test_'+randomBytes(12).toString('hex');assert.match(schema,/^booking_test_[a-f0-9]{24}$/);
  await run(`CREATE SCHEMA "${schema}"; ${envelope('SELECT 1 AS created')}`);
  context.after(()=>run(`DROP SCHEMA "${schema}" CASCADE; ${envelope('SELECT 1 AS cleaned')}`));
  const raw=sql=>run(`SET search_path TO "${schema}",pg_catalog;\n${sql}`);
  await raw(`${OWNER_SECURITY_DDL}; ${OWNER_SESSIONS_DDL};
   CREATE TABLE content(id TEXT PRIMARY KEY,body TEXT NOT NULL,version INTEGER NOT NULL);
   CREATE TABLE media(id TEXT PRIMARY KEY,mime TEXT NOT NULL,body TEXT NOT NULL,name TEXT NOT NULL);
   ${initialized ? `INSERT INTO owner_security VALUES('owner',${sqlText(oldHash)},1,0,1,${sqlText(digest(token))},${now+900000});
   INSERT INTO owner_sessions VALUES(${sqlText(session)},${now+3600000},1);` : ''}
   INSERT INTO content VALUES('main','{"synthetic":true}',1);
   ${envelope('SELECT 1 AS seeded')}`);
  const redeem=()=>changed(bind(OWNER_REDEEM_SQL,[newHash,1,digest(token),now,oldHash,1]));
  const mutation=(context={temporary:true,epoch:1},version=1)=>{const g=guardMutation(casSql,['{"synthetic":"changed"}','main',version],context);return changed(bind(g.statement,g.args));};
  return {raw,redeem,mutation};
 }
 async function marker(f,key){
  for(let i=0;i<100;i++){
   const {rows:[row]}=await f.raw(envelope(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=${key} AND granted) AS ready`));
   if(row.ready)return;
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.fail('Synthetic transaction did not acquire its synchronization marker');
 }
 const hold=key=>`DO $hold$ BEGIN PERFORM pg_advisory_xact_lock(${key}); PERFORM pg_sleep(1); END $hold$;`;
 await t.test('inactive legacy mode with empty owner tables preserves content, media and marketing writes',async context=>{
  const previous=process.env.OWNER_HANDOFF_REQUIRED;
  delete process.env.OWNER_HANDOFF_REQUIRED;
  context.after(()=>{if(previous===undefined)delete process.env.OWNER_HANDOFF_REQUIRED;else process.env.OWNER_HANDOFF_REQUIRED=previous;});
  const f=await fixture(context,{initialized:false});
  const stateSql="SELECT (SELECT count(*)::integer FROM owner_security) AS owners,(SELECT count(*)::integer FROM owner_sessions) AS sessions";
  const before=(await f.raw(envelope(stateSql))).rows;
  assert.deepEqual(before,[{owners:0,sessions:0}]);
  // An empty SELECT FOR UPDATE is a valid first result, not an auth failure.
  const emptyLock=await f.raw(`BEGIN ISOLATION LEVEL READ COMMITTED; ${envelope("SELECT id FROM owner_security WHERE id='owner' FOR UPDATE")} COMMIT;`);
  assert.deepEqual(emptyLock.rows,[]);
  for(const [sql,args,expected] of [
   [casSql,['{"synthetic":"legacy-changed"}','main',1],[{version:2}]],
   ['INSERT INTO media (id,mime,body,name) VALUES ($1,$2,$3,$4)',['legacy-media','image/png','synthetic','Synthetic'],[{id:'legacy-media'}]],
   ['INSERT INTO content (id,body,version) VALUES ($1,$2,1) ON CONFLICT (id) DO NOTHING',['marketing','{"synthetic":"legacy-marketing"}'],[{id:'marketing'}]],
  ]){
   const g=guardMutation(sql,args,{legacy:true});
   assert.match(g.statement,/NOT EXISTS \(SELECT 1 FROM owner_security WHERE id='owner'\)/);
   assert.deepEqual((await f.raw(`BEGIN ISOLATION LEVEL READ COMMITTED; ${lock} ${changed(bind(g.statement,g.args))} COMMIT;`)).rows,expected);
  }
  assert.deepEqual((await f.raw(envelope("SELECT id,body,version FROM content ORDER BY id"))).rows,[
   {id:'main',body:'{"synthetic":"legacy-changed"}',version:2},
   {id:'marketing',body:'{"synthetic":"legacy-marketing"}',version:1},
  ]);
  assert.deepEqual((await f.raw(envelope('SELECT id,mime,body,name FROM media'))).rows,[{id:'legacy-media',mime:'image/png',body:'synthetic',name:'Synthetic'}]);
  assert.deepEqual((await f.raw(envelope(stateSql))).rows,before,'legacy writes must not initialize owner state, create sessions or activate handoff');
  assert.equal(process.env.OWNER_HANDOFF_REQUIRED,undefined);
 });
 await t.test('parallel redemption consumes one invitation and fences old login/session writes',async context=>{
  const f=await fixture(context);
  const results=await Promise.all([f.raw(f.redeem()),f.raw(f.redeem())]);
  assert.equal(new Set(results.map(x=>x.backendPid)).size,2);assert.deepEqual(results.map(x=>x.rows.length).sort(),[0,1]);
  const {rows:[state]}=await f.raw(envelope('SELECT epoch,complete,temporary_open,invitation_hash,invitation_expires FROM owner_security'));
  assert.deepEqual(state,{epoch:2,complete:1,temporary_open:0,invitation_hash:null,invitation_expires:null});
  assert.equal((await f.raw(f.redeem())).rows.length,0);
  assert.equal((await f.raw(`BEGIN ISOLATION LEVEL READ COMMITTED; ${lock} ${f.mutation({epoch:1,sessionId:session})} COMMIT;`)).rows.length,0);
  const login=hash=>changed(bind(OWNER_SESSION_INSERT,['c'.repeat(64),now+3600000,hash===oldHash?1:2,hash]));
  assert.equal((await f.raw(`BEGIN ISOLATION LEVEL READ COMMITTED; ${lock} ${login(oldHash)} COMMIT;`)).rows.length,0);
  assert.equal((await f.raw(`BEGIN ISOLATION LEVEL READ COMMITTED; ${lock} ${login(newHash)} COMMIT;`)).rows.length,1);
 });
 await t.test('public mutation holds security lock until commit before transfer can finish',async context=>{
  const f=await fixture(context),key=100000+Math.floor(Math.random()*1000000000);
  const write=f.raw(`BEGIN ISOLATION LEVEL READ COMMITTED; ${lock} ${hold(key)} ${f.mutation()} COMMIT;`);
  await marker(f,key);
  const transfer=f.raw(f.redeem());
  assert.equal((await write).rows.length,1);assert.equal((await transfer).rows.length,1);
  assert.equal((await f.raw(`BEGIN ISOLATION LEVEL READ COMMITTED; ${lock} ${f.mutation({temporary:true,epoch:1},2)} COMMIT;`)).rows.length,0);
 });
 await t.test('queued public mutation sees transferred security state after row-lock wait',async context=>{
  const f=await fixture(context),key=100000+Math.floor(Math.random()*1000000000);
  const transfer=f.raw(`BEGIN ISOLATION LEVEL READ COMMITTED; ${f.redeem()} ${hold(key)} COMMIT;`);
  await marker(f,key);
  const write=f.raw(`BEGIN ISOLATION LEVEL READ COMMITTED; ${lock} ${f.mutation()} COMMIT;`);
  assert.equal((await transfer).rows.length,1);assert.equal((await write).rows.length,0);
  const {rows:[row]}=await f.raw(envelope("SELECT version,body FROM content WHERE id='main'"));
  assert.equal(row.version,1);assert.equal(row.body,'{"synthetic":true}');
 });
 await t.test('stale owner cannot create media or seed marketing after transfer',async context=>{
  const f=await fixture(context);await f.raw(f.redeem());
  for(const [sql,args] of [
   ['INSERT INTO media (id,mime,body,name) VALUES ($1,$2,$3,$4)',['synthetic-media','image/png','synthetic','Synthetic']],
   ['INSERT INTO content (id,body,version) VALUES ($1,$2,1) ON CONFLICT (id) DO NOTHING',['marketing','{"synthetic":true}']],
  ]){
   const g=guardMutation(sql,args,{epoch:1,sessionId:session});
   assert.equal((await f.raw(`BEGIN ISOLATION LEVEL READ COMMITTED; ${lock} ${changed(bind(g.statement,g.args))} COMMIT;`)).rows.length,0);
  }
 });
});

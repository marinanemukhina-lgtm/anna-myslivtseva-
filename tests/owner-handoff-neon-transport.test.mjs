// Transport contract tests only. Mock responses do NOT prove PostgreSQL locking,
// SQL execution, isolation, durability, or real Neon deployment compatibility.
// This file starts a clean-environment child. No .env or real credentials are read.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const childFlag='--synthetic-neon-transport-child';
if (!process.argv.includes(childFlag)) {
  test('real Neon client with network-free synthetic transport (not PostgreSQL integration)',async()=>{
    const {stdout}=await promisify(execFile)(process.execPath,[fileURLToPath(import.meta.url),childFlag],{env:{},timeout:30000});
    assert.match(stdout,/fail 0/);
  });
} else {
  // Global fetch is a tripwire, never a fallback to the network.
  globalThis.fetch=async()=>{throw new Error('NETWORK_FORBIDDEN_IN_SYNTHETIC_TEST');};
  const {neonConfig}=await import('@neondatabase/serverless');
  const syntheticUrl='postgresql://synthetic:synthetic-only@handoff.invalid/synthetic';
  process.env.DATABASE_URL=syntheticUrl;
  process.env.OWNER_HANDOFF_REQUIRED='1';
  const calls=[];
  const result=(name='version',rows=[['2']],type=23)=>({fields:[{name,dataTypeID:type}],rows,command:'UPDATE',rowCount:rows.length});
  const lock=result('id',[['owner']],25);
  let respond=async body=>({ok:true,json:async()=>body.queries?{results:[lock,result()]}:result('id',[],25)});
  neonConfig.fetchFunction=async(url,options)=>{
    assert.equal(url,'https://api.invalid/sql');
    assert.equal(options.method,'POST');
    assert.equal(options.headers['Neon-Connection-String'],syntheticUrl);
    assert.equal(options.headers['Neon-Raw-Text-Output'],'true');
    assert.equal(options.headers['Neon-Array-Mode'],'true');
    const body=JSON.parse(options.body);
    calls.push({body,headers:options.headers});
    return respond(body);
  };
  const {database,accessContext,OWNER_SESSION_INSERT}=await import('../server/db.mjs');
  const {query}=await database();
  assert.equal(calls.length,7,'only schema/initial content preparation occurs');
  assert.ok(calls.every(call=>!call.body.queries && !/INSERT INTO owner_security/.test(call.body.query)));
  const update='UPDATE content SET body=$1,version=version+1 WHERE id=$2 AND version=$3 RETURNING version';
  const temporary={temporary:true,epoch:1};
  const owner={epoch:1,sessionId:'synthetic-session-digest'};
  function takeBatch(before){
    assert.equal(calls.length,before+1,'lock and mutation must use one batched HTTP request');
    const call=calls.at(-1);
    assert.equal(call.headers['Neon-Batch-Isolation-Level'],'ReadCommitted');
    assert.equal(call.body.queries.length,2);
    assert.equal(call.body.queries[0].query,"SELECT id FROM owner_security WHERE id='owner' FOR UPDATE");
    assert.deepEqual(call.body.queries[0].params,[]);
    return call.body.queries[1];
  }
  test('actual db adapter batches the security lock before each whitelisted write and login',async()=>{
    const forms=[
      [temporary,update,['{}','main',1],/complete=0 AND temporary_open=1 AND epoch=\$4/],
      [owner,update,['{}','marketing',1],/owner_sessions.id=\$5 AND owner_sessions.expires>\$6/],
      [temporary,'INSERT INTO media (id,mime,body,name) VALUES ($1,$2,$3,$4)',['synthetic-id','image/png','','synthetic'],/SELECT \$1,\$2,\$3,\$4 WHERE EXISTS/],
      [owner,'INSERT INTO content (id,body,version) VALUES ($1,$2,1) ON CONFLICT (id) DO NOTHING',['marketing','{}'],/ON CONFLICT \(id\) DO NOTHING RETURNING id/],
      [undefined,OWNER_SESSION_INSERT,['synthetic-session-digest',123456,1,'synthetic-hash'],/epoch=\$3 AND password_hash=\$4/],
    ];
    for(const [context,sql,args,pattern] of forms){
      const before=calls.length;
      const rows=await accessContext.run(context,()=>query(sql,args));
      assert.deepEqual(rows,[{version:2}]);
      const mutation=takeBatch(before);assert.match(mutation.query,pattern);
      assert.deepEqual(mutation.params.slice(0,args.length),args.map(String));
    }
  });
  test('unknown contextual mutation fails before reaching mock transport',async()=>{
    const before=calls.length;
    await assert.rejects(accessContext.run(owner,()=>query('DELETE FROM media WHERE id=$1',['synthetic-id'])),/UNGUARDED_WRITE/);
    assert.equal(calls.length,before);
  });
  test('write remains pending until acknowledgement body is received and parsed',async()=>{
    let acknowledge,received;
    const started=new Promise(r=>received=r);
    respond=async()=>({ok:true,json:()=>{received();return new Promise(r=>acknowledge=r);}});
    let settled=false;
    const pending=accessContext.run(temporary,()=>query(update,['{}','main',1])).then(rows=>{settled=true;return rows;});
    await started;await new Promise(r=>setImmediate(r));assert.equal(settled,false);
    acknowledge({results:[lock,result()]});assert.deepEqual(await pending,[{version:2}]);
  });
  test('zero-row CAS is returned as an empty result, never promoted to a successful mutation',async()=>{
    respond=async()=>({ok:true,json:async()=>({results:[lock,result('version',[])]})});
    assert.deepEqual(await accessContext.run(temporary,()=>query(update,['{}','main',1])),[]);
  });
  test('network, PostgreSQL, HTTP and malformed acknowledgements reject without retry',async()=>{
    const cases=[
      async()=>{throw new Error('synthetic lost acknowledgement');},
      async()=>({ok:false,status:400,json:async()=>({message:'synthetic transaction aborted',code:'40001'})}),
      async()=>({ok:false,status:503,text:async()=>'synthetic unavailable'}),
      async()=>({ok:true,json:async()=>{throw new SyntaxError('synthetic broken JSON');}}),
      async()=>({ok:true,json:async()=>({unexpected:true})}),
    ];
    for(const response of cases){
      respond=response;const before=calls.length;
      await assert.rejects(accessContext.run(temporary,()=>query(update,['{}','main',1])));
      assert.equal(calls.length,before+1,'uncertain outcomes must not be silently retried');
    }
  });
  test('truncated or oversized batch acknowledgement must not resolve a media write as success',async()=>{
    for(const results of [[lock],[lock,result(),result()]]) {
      respond=async()=>({ok:true,json:async()=>({results})});
      await assert.rejects(accessContext.run(temporary,()=>query('INSERT INTO media (id,mime,body,name) VALUES ($1,$2,$3,$4)',['synthetic-id','image/png','','synthetic'])));
    }
  });
  test('actual media handler does not report 201 after a truncated transaction response',async()=>{
    // Invoke Express's registered handler directly: no sockets or browser needed.
    const {createApp}=await import('../server/app.mjs');
    const app=createApp();
    const route=app.router.stack.find(layer=>layer.route?.path==='/api/media' && layer.route.methods.post);
    const handler=route.route.stack.at(-1).handle;
    const errorHandler=app.router.stack.at(-1).handle;
    respond=async body=>({ok:true,json:async()=>body.queries?{results:[lock]}:result('total',[['0']],20)});
    const statuses=[];let body,error;
    const response={status(code){statuses.push(code);return this;},json(value){body=value;return this;}};
    const request={body:{base64:Buffer.from('%PDF-synthetic-only').toString('base64'),type:'application/pdf',name:'synthetic'}};
    await accessContext.run(temporary,()=>handler(request,response,e=>{error=e;}));
    assert.equal(error?.message,'INVALID_TRANSACTION_ACKNOWLEDGEMENT');
    assert.ok(!statuses.includes(201));assert.equal(body,undefined);
    errorHandler(error,request,response,()=>{});
    assert.deepEqual(statuses,[503]);assert.equal(typeof body.error,'string');
    assert.ok(!JSON.stringify(body).includes('INVALID_TRANSACTION_ACKNOWLEDGEMENT'));
  });

  test('inactive legacy mode accepts empty lock result for content, media and marketing without activating owner state',async()=>{
    delete process.env.OWNER_HANDOFF_REQUIRED;
    const {enabled,temporaryAllowed,securityState}=await import('../server/owner-handoff.mjs');
    const start=calls.length;
    const emptyLock=result('id',[],25);
    // This is a synthetic empty-state transport fixture, not a SQL engine.
    const contents=new Map([['main',{body:'{}',version:1}]]),media=new Map();
    respond=async body=>{
      if(!body.queries){
        assert.ok(["SELECT id FROM owner_security WHERE id='owner'","SELECT * FROM owner_security WHERE id='owner'",'SELECT id FROM owner_sessions'].includes(body.query));
        return {ok:true,json:async()=>result('id',[],25)};
      }
      assert.equal(body.queries.length,2);
      assert.equal(body.queries[0].query,"SELECT id FROM owner_security WHERE id='owner' FOR UPDATE");
      const {query:sql,params}=body.queries[1];
      assert.match(sql,/NOT EXISTS \(SELECT 1 FROM owner_security WHERE id='owner'\)/);
      let acknowledged;
      if(sql.startsWith('UPDATE content ')){
        assert.equal(contents.get(params[1]).version,Number(params[2]));
        contents.set(params[1],{body:params[0],version:2});acknowledged=result('version',[['2']]);
      }else if(sql.startsWith('INSERT INTO media ')){
        media.set(params[0],params.slice(1));acknowledged=result('id',[[params[0]]],25);
      }else{
        assert.ok(sql.startsWith('INSERT INTO content '));
        contents.set(params[0],{body:params[1],version:1});acknowledged=result('id',[[params[0]]],25);
      }
      return {ok:true,json:async()=>({results:[emptyLock,acknowledged]})};
    };
    try{
      const status=async()=>({enabled:await enabled(),temporaryAllowed:await temporaryAllowed(),state:await securityState(),sessions:await query('SELECT id FROM owner_sessions')});
      const before=await status();assert.deepEqual(before,{enabled:false,temporaryAllowed:true,state:null,sessions:[]});
      for(const [sql,args,expected] of [
        [update,['{"synthetic":"legacy"}','main',1],[{version:2}]],
        ['INSERT INTO media (id,mime,body,name) VALUES ($1,$2,$3,$4)',['legacy-media','image/png','synthetic','Synthetic'],[{id:'legacy-media'}]],
        ['INSERT INTO content (id,body,version) VALUES ($1,$2,1) ON CONFLICT (id) DO NOTHING',['marketing','{"synthetic":"legacy-marketing"}'],[{id:'marketing'}]],
      ]){
        const offset=calls.length;
        assert.deepEqual(await accessContext.run({legacy:true},()=>query(sql,args)),expected);
        takeBatch(offset);
      }
      assert.deepEqual(await status(),before,'inactive access status remains unchanged');
      assert.deepEqual([...contents],[['main',{body:'{"synthetic":"legacy"}',version:2}],['marketing',{body:'{"synthetic":"legacy-marketing"}',version:1}]]);
      assert.deepEqual([...media],[['legacy-media',['image/png','synthetic','Synthetic']]]);
      const statements=calls.slice(start).flatMap(call=>call.body.queries??[call.body]).map(q=>q.query);
      assert.ok(statements.every(sql=>!/(?:INSERT INTO|UPDATE|DELETE FROM) owner_(?:security|sessions)\b/.test(sql)),'no owner state or session mutation sent');
      assert.equal(process.env.OWNER_HANDOFF_REQUIRED,undefined);
    }finally{process.env.OWNER_HANDOFF_REQUIRED='1';}
  });

}

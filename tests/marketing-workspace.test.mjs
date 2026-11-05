// Executes the actual inline script in node:vm with minimal DOM/storage stubs.
// This is logic coverage, not browser rendering, focus or interaction QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import safety from '../server/marketing-assets/channel-safety.cjs';
import {marketingSeed} from '../server/marketing.mjs';
const html=await readFile(new URL('../server/marketing-assets/workspace.html',import.meta.url),'utf8');
const code=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
const KEY='anna_warmup_channel_v4',DRAFT_KEY=KEY+'_working_draft';
function withDraft(text='Server working text'){
 const data=marketingSeed();data.workingDraft={post:{id:'working-draft',type:'discovery',status:'draft',text,sources:{primaryChapter:marketingSeed().chapters[0].id,secondaryChapters:[],concepts:[]},trace:{seen:'',withheld:''},review:{}},editingId:null,central:'not_introduced',concepts:{}};return safety.migrate(data);
}
function harness({data=withDraft(),stored={},get}={}){
 const storage=new Map(Object.entries(stored)),elements=new Map(),listeners=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{id,value:id==='type'?'discovery':'',textContent:'',innerHTML:'',checked:false,disabled:false,inert:false,style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},removeAttribute(){},focus(){},click(){},querySelector(){return null;},querySelectorAll(){return [];}});return elements.get(id);};
 const document={getElementById:element,querySelector:s=>s==='.modal.on'?null:element(s.startsWith('#')?s.slice(1):s),querySelectorAll:()=>[],addEventListener(){},activeElement:null};
 const window={addEventListener:(name,fn)=>listeners.set(name,fn),scrollTo(){}};
 const puts=[];
 const context=vm.createContext({document,window,ChannelSafety:safety,console,structuredClone,Date,URL,Blob,AbortSignal,crypto:webcrypto,CSS:{escape:x=>x},setTimeout:()=>0,clearTimeout(){},confirm:()=>true,location:{hash:''},history:{pushState(){}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},fetch:async(url,options={})=>{
  if(url.endsWith('/seed'))return {ok:true,json:async()=>marketingSeed()};
  if(options.method==='PUT'){puts.push(JSON.parse(options.body));return {ok:true,json:async()=>({version:8})};}
  const response=get?await get():{data,version:7};return {ok:true,json:async()=>response};
 }});
 const ready=vm.runInContext(code,context);
 return {context,ready,storage,element,listeners,puts,run:source=>vm.runInContext(source,context)};
}

test('initial hydration restores and retains validated server working draft',async()=>{
 const h=harness();await h.ready;
 assert.equal(h.element('text').value,'Server working text');
 assert.equal(JSON.parse(h.storage.get(DRAFT_KEY)).post.text,'Server working text');
 assert.equal(h.run('serverVersion'),7);assert.equal(h.element('.shell').inert,false);
 await h.element('serverSave').onclick();assert.equal(h.puts.length,1);assert.equal(h.puts[0].data.workingDraft.post.text,'Server working text');
});

test('opening with existing local work does not overwrite it',async()=>{
 const local=withDraft('Local working text');const stored={[KEY]:JSON.stringify(local),[DRAFT_KEY]:JSON.stringify(local.workingDraft)};
 const h=harness({stored});await h.ready;
 assert.equal(h.element('text').value,'Local working text');assert.equal(h.storage.get(KEY),stored[KEY]);assert.equal(h.storage.get(DRAFT_KEY),stored[DRAFT_KEY]);assert.equal(h.run('serverVersion'),null);
});

test('other-tab draft update blocks write and main save without overwriting either',async()=>{
 const h=harness();await h.ready;const main=h.storage.get(KEY);const external=JSON.stringify(withDraft('Other tab').workingDraft);h.storage.set(DRAFT_KEY,external);
 h.element('text').value='This tab';assert.equal(h.run('saveWorking()'),false);assert.equal(h.storage.get(DRAFT_KEY),external);
 assert.throws(()=>h.run('save()'),/другой вкладке/);assert.equal(h.storage.get(KEY),main);assert.equal(h.element('text').value,'This tab');
 await h.element('serverSave').onclick();assert.equal(h.puts.length,0);
});

test('initial hydration detects a draft created while server response is pending',async()=>{
 let release;const response=new Promise(r=>release=r);const h=harness({get:()=>response});
 await new Promise(r=>setImmediate(r));assert.equal(h.element('.shell').inert,true);
 const external=JSON.stringify(withDraft('Created while loading').workingDraft);h.storage.set(DRAFT_KEY,external);
 release({data:withDraft(),version:7});await h.ready;
 assert.equal(h.storage.get(DRAFT_KEY),external);assert.equal(h.storage.has(KEY),false);assert.equal(h.run('serverVersion'),null);assert.equal(h.element('.shell').inert,false);
});

test('explicit server reload backs up local work and restores server draft',async()=>{
 const local=withDraft('Local working text'),stored={[KEY]:JSON.stringify(local),[DRAFT_KEY]:JSON.stringify(local.workingDraft)};
 const h=harness({stored});await h.ready;await h.element('serverLoad').onclick();
 assert.equal(h.storage.get(KEY+'_before_server_load'),stored[KEY]);assert.equal(h.storage.get(DRAFT_KEY+'_before_server_load'),stored[DRAFT_KEY]);
 assert.equal(h.element('text').value,'Server working text');assert.equal(h.run('serverVersion'),7);
});

test('review rendering enum-restricts injected attributes independently of import validation',async()=>{
 const h=harness();await h.ready;h.run(`renderChecks({entry:'"><img src=x onerror="alert(1)">'})`);
 assert.doesNotMatch(h.element('checks').innerHTML,/<img|onerror/);assert.match(h.element('checks').innerHTML,/data-state="empty"/);
});

test('cancel-edit click removes working draft even when passed a DOM event',async()=>{
 const h=harness();await h.ready;
 h.element('cancelEdit').onclick({type:'click'});
 assert.equal(h.storage.has(DRAFT_KEY),false);assert.equal(h.element('text').value,'');assert.equal(h.run('draftDirty'),false);
});

test('cancel-edit click preserves current form when another tab changed draft',async()=>{
 const h=harness();await h.ready;const external=JSON.stringify(withDraft('Other tab').workingDraft);h.storage.set(DRAFT_KEY,external);
 h.element('cancelEdit').onclick({type:'click'});
 assert.equal(h.storage.get(DRAFT_KEY),external);assert.equal(h.element('text').value,'Server working text');assert.equal(h.run('draftDirty'),true);
});

test('cleared editing draft cannot become an orphan when the saved post is scheduled',async()=>{
 const data=withDraft();data.posts=[{...structuredClone(data.workingDraft.post),id:'existing-post',status:'ready'}];data.workingDraft.editingId='existing-post';
 const h=harness({data});await h.ready;
 h.run("clearPost();statusPostId='existing-post'");h.element('statusDate').value='2026-12-01T10:00';
 h.run('scheduleCurrent()');
 const stored=JSON.parse(h.storage.get(KEY));assert.equal(stored.posts[0].status,'scheduled');
 assert.equal(stored.workingDraft??null,null);assert.doesNotThrow(()=>safety.migrate(stored));
 h.element('text').value='New draft after scheduling';assert.equal(h.run('saveWorking()'),true);
 assert.equal(h.run('state.workingDraft.post.text'),'New draft after scheduling');
});

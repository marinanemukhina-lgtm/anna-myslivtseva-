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


function topicHarness(h){
 const fields=['title','distinction','habit','reveals','images','tensions','recognition','forbidden','introduces','requires','factCheck','factNote','sourceText'].map(key=>Object.assign(h.element('cf-'+key),{dataset:{cf:key},type:key==='factCheck'?'checkbox':'text'}));
 h.context.document.querySelectorAll=selector=>selector==='[data-cf]'?fields:[];
 h.context.document.querySelector=selector=>selector.includes(':checked')?null:h.element(selector);
 h.element('chapterModal').querySelector=()=>h.element('cf-title');
 return fields;
}
test('topic modal cancellation is non-mutating; save adds once and preserves working text',async()=>{
 const h=harness();await h.ready;topicHarness(h);const initial=h.run('state.chapters.length');const original=h.storage.get(DRAFT_KEY);
 h.run('openChapter(true)');assert.equal(h.run('state.chapters.length'),initial);h.run("closeModal('chapterModal')");h.run('saveChapter()');assert.equal(h.run('state.chapters.length'),initial);assert.equal(h.storage.get(DRAFT_KEY),original);
 h.run('openChapter(true)');h.run('saveChapter()');assert.equal(h.run('state.chapters.length'),initial);assert.match(h.element('banner').textContent,/название/);
 h.element('cf-title').value='Synthetic new topic';h.run('saveChapter()');h.run('saveChapter()');assert.equal(h.run('state.chapters.length'),initial+1);assert.equal(h.run('state.chapters.at(-1).title'),'Synthetic new topic');assert.equal(h.run('state.chapters.at(-1).sourceText'),'');assert.equal(h.element('text').value,'Server working text');assert.equal(JSON.parse(h.storage.get(DRAFT_KEY)).post.text,'Server working text');
 h.run('openChapter(false)');h.element('cf-title').value='Edited original';h.run('saveChapter()');assert.equal(h.run('state.chapters[0].title'),'Edited original');assert.equal(h.element('text').value,'Server working text');
});
test('switching topics asks and preserves the old post as a draft before changing source',async()=>{
 const h=harness();await h.ready;topicHarness(h);h.run('openChapter(true)');h.element('cf-title').value='Second';h.run('saveChapter()');
 const original=h.run('chapterId');h.context.confirm=()=>false;h.run('switchChapter(state.chapters.at(-1).id)');assert.equal(h.run('chapterId'),original);assert.equal(h.element('text').value,'Server working text');assert.equal(h.run('state.posts.length'),0);
 h.context.confirm=()=>true;h.run('switchChapter(state.chapters.at(-1).id)');assert.notEqual(h.run('chapterId'),original);assert.equal(h.run('state.posts.length'),1);assert.equal(h.run('state.posts[0].text'),'Server working text');assert.equal(h.run('state.posts[0].sources.primaryChapter'),original);assert.equal(h.element('text').value,'');
});
test('conflicting storage prevents adding or switching topics without erasing work',async()=>{
 const h=harness();await h.ready;topicHarness(h);h.run('openChapter(true)');h.element('cf-title').value='Blocked';const initial=h.run('state.chapters.length');h.storage.set(DRAFT_KEY,JSON.stringify(withDraft('Other tab').workingDraft));
 assert.throws(()=>h.run('saveChapter()'),/конфликт/);assert.equal(h.run('state.chapters.length'),initial);assert.equal(h.element('text').value,'Server working text');assert.equal(JSON.parse(h.storage.get(DRAFT_KEY)).post.text,'Other tab');
});
test('seed merge adds only missing stable ids and preserves edited topics and working text',async()=>{
 const data=withDraft();data.chapters[0].title='My edited topic';const h=harness({data});await h.ready;
 const seed=marketingSeed();seed.chapters.push({...seed.chapters[0],id:'synthetic-extra-topic',title:'Synthetic extra'});
 const oldFetch=h.context.fetch;h.context.fetch=async(url,options)=>url.endsWith('/seed')?{ok:true,json:async()=>seed}:oldFetch(url,options);
 const initial=h.run('state.chapters.length');await h.run('addTopicSeeds()');await h.run('addTopicSeeds()');assert.equal(h.run('state.chapters.length'),initial+1);assert.equal(h.run('state.chapters[0].title'),'My edited topic');assert.equal(h.element('text').value,'Server working text');assert.equal(h.puts.length,0);
});
test('seed merge declines when working text changes while the fetch is pending',async()=>{
 const h=harness();await h.ready;let release;const pending=new Promise(r=>release=r);const oldFetch=h.context.fetch;h.context.fetch=async(url,options)=>url.endsWith('/seed')?pending:oldFetch(url,options);
 const before=h.run('state.chapters.length');const saving=h.run('addTopicSeeds()');h.element('text').value='New local edit';assert.equal(h.run('saveWorking()'),true);release({ok:true,json:async()=>marketingSeed()});await saving;assert.equal(h.run('state.chapters.length'),before);assert.match(h.element('banner').textContent,/изменились/);assert.equal(h.element('text').value,'New local edit');
});

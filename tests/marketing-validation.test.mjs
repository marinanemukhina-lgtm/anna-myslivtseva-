import test from 'node:test';
import assert from 'node:assert/strict';
import safety from '../server/marketing-assets/channel-safety.cjs';
import {marketingSeed} from '../server/marketing.mjs';

function draft(){return {id:'p-test',type:'discovery',status:'draft',text:'Synthetic draft',sources:{primaryChapter:marketingSeed().chapters[0].id,secondaryChapters:[],concepts:[]},trace:{seen:'',withheld:''},review:{entry:'checked'}};}
function workspace(){const x=marketingSeed();x.posts=[draft()];x.concepts=[{id:'c-test',title:'Synthetic concept',status:'not_mentioned'}];x.workingDraft={post:draft(),editingId:'p-test',central:'not_introduced',concepts:{'c-test':'mentioned'}};return x;}

test('seed and current drafts migrate without mutating source or losing content',()=>{
 assert.deepEqual(safety.migrate(marketingSeed()),marketingSeed());
 const original=workspace(),before=structuredClone(original),clean=safety.migrate(original);
 assert.deepEqual(original,before);
 assert.equal(clean.workingDraft.post.text,'Synthetic draft');
 assert.equal(clean.workingDraft.post.review.entry,'checked');
 assert.equal(clean.workingDraft.post.review.spoken,'empty');
 assert.equal(clean.workingDraft.post.addressee,'');
 assert.deepEqual(safety.migrate(clean),clean);
});

test('known version 3 aliases migrate for posts and working drafts',()=>{
 const x=workspace();x.schemaVersion=3;
 delete x.chapters[0].centralDistinctionStatus;x.chapters[0].cdStatus='partial';
 for(const p of [x.posts[0],x.workingDraft.post]){
   p.sources={primary_chapter:marketingSeed().chapters[0].id,secondary_chapters:[],concepts:['c-test']};
   p.leads_to_shoulders=true;p.leads_to_book=false;p.source_quote_confirmed=true;
   p.review={r0:'checked',r11:'signal'};
 }
 const clean=safety.migrate(x);
 assert.equal(clean.schemaVersion,4);assert.equal(clean.chapters[0].centralDistinctionStatus,'partial');
 for(const p of [clean.posts[0],clean.workingDraft.post]){
   assert.equal(p.sources.primaryChapter,marketingSeed().chapters[0].id);assert.equal(p.leadsToShoulders,true);
   assert.equal(p.sourceQuoteConfirmed,true);assert.equal(p.review.entry,'checked');assert.equal(p.review.spoken,'signal');
 }
});

test('malicious review HTML is rejected in both posts and working drafts',()=>{
 for(const target of ['post','draft']){
  const x=workspace();(target==='post'?x.posts[0]:x.workingDraft.post).review.entry='"><img src=x onerror="alert(1)">';
  assert.throws(()=>safety.migrate(x),/состояние проверки/);
 }
});

test('unknown nested data including synthetic secret fields is rejected, not discarded',()=>{
 const mutations=[
  x=>x.chapters[0].apiKey='FAKE_TEST_ONLY',
  x=>x.concepts[0].token='FAKE_TEST_ONLY',
  x=>x.posts[0].password='FAKE_TEST_ONLY',
  x=>x.posts[0].sources.secret='FAKE_TEST_ONLY',
  x=>x.posts[0].trace.secret='FAKE_TEST_ONLY',
  x=>x.posts[0].review.secret='FAKE_TEST_ONLY',
  x=>x.workingDraft.secret='FAKE_TEST_ONLY',
  x=>x.workingDraft.post.token='FAKE_TEST_ONLY',
  x=>x.workingDraft.concepts.secret='mentioned',
  x=>x.measures=[{postId:'p-test',token:'FAKE_TEST_ONLY'}],
  x=>x.enabled=true,
 ];
 for(const mutate of mutations){const x=workspace();mutate(x);const before=structuredClone(x);assert.throws(()=>safety.migrate(x),/Неизвестное поле/);assert.deepEqual(x,before);}
});

test('working drafts require valid references, types and metadata',()=>{
 const mutations=[
  x=>x.workingDraft.post.sources.primaryChapter='missing',
  x=>x.workingDraft.post.sources.concepts=['missing'],
  x=>x.workingDraft.post.text={},
  x=>x.workingDraft.editingId='missing',
  x=>x.workingDraft.post.status='ready',
  x=>x.workingDraft.central='unknown',
  x=>x.workingDraft.concepts['c-test']='unknown',
  x=>x.workingDraft.post.trace.seen={},
  x=>x.workingDraft.post.review=[],
  x=>x.telegramIdentityAccountId='FAKE_ACCOUNT_ONLY',
 ];
 for(const mutate of mutations){const x=workspace();mutate(x);assert.throws(()=>safety.migrate(x));}
 const x=workspace();x.workingDraft.editingId=null;x.workingDraft.post.id='working-draft';x.workingDraft.post.text='';
 assert.equal(safety.migrate(x).workingDraft.post.text,'');
 x.workingDraft=null;assert.equal(safety.migrate(x).workingDraft,null);
});

test('valid scheduled, published and measured content is retained',()=>{
 const x=workspace();x.workingDraft=null;x.posts[0].status='published';x.posts[0].publishedAt='2026-11-01T10:00';x.posts[0].publicationUrl='https://example.com/synthetic';
 x.concepts[0].firstPublishedAt='2026-11-01T10:00';
 x.measures=[{postId:'p-test',recordedAt:'2026-11-02T10:00:00.000Z',subscribersBefore:1,subscribersAfter24h:2,saves:0}];
 const clean=safety.migrate(x);assert.deepEqual(clean.measures,x.measures);assert.equal(clean.posts[0].publicationUrl,x.posts[0].publicationUrl);
 x.posts=[{...draft(),status:'scheduled',scheduledAt:'2026-12-01T10:00'}];x.measures=[];
 assert.equal(safety.migrate(x).posts[0].scheduledAt,'2026-12-01T10:00');
});


test('source-based topics remain editable, contain no posts and do not invent a certificate',()=>{
 const seed=marketingSeed();assert.equal(seed.chapters.length,12);
 assert.equal(new Set(seed.chapters.map(x=>x.id)).size,12);
 assert.deepEqual(seed.posts,[]);assert.deepEqual(seed.concepts,[]);assert.deepEqual(seed.measures,[]);
 for(const topic of seed.chapters){
  for(const key of ['distinction','habit','reveals','recognition','sourceText'])assert.equal(topic[key],'');
  assert.equal(topic.factCheck,true);assert.match(topic.factNote,/https:\/\/usovaosteoschool\.ru\//);
  assert.match(topic.factNote,/сверьте конкретный документ/);
 }
 seed.chapters[0].title='Любая собственная тема — Ω';seed.chapters[0].reveals='Собственная редактура';
 const result=safety.migrate(seed);assert.equal(result.chapters[0].title,'Любая собственная тема — Ω');
 assert.equal(result.chapters[0].reveals,'Собственная редактура');
 assert.equal(marketingSeed().chapters[0].title,'Здоровое тело');
});

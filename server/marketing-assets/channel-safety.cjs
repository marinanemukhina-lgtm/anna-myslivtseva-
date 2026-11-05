(function (root) {
  'use strict';
  const status = ['draft','ready','scheduled','published'];
  const types = ['discovery','shift','distinction','tension','mechanism','image','link','opening'];
  const conceptStates = ['not_mentioned','mentioned','introduced','explained','connected'];
  const keys = ['entry','tension','image','selfDiminishment','conversionGesture','metaTransition','staircaseProse','escalation','internalLocus','notBut','termContext','spoken'];
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const text = v => typeof v === 'string';
  const id = v => text(v) && /^[a-zA-Z0-9_\-]{1,128}$/.test(v) && !['__proto__','constructor','prototype'].includes(v);
  const list = v => Array.isArray(v) && v.every(text);
  const date = v => {
    if (!text(v) || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(v)) return false;
    const [y,m,d] = v.slice(0,10).split('-').map(Number);
    const exact = new Date(Date.UTC(y,m-1,d));
    return exact.getUTCFullYear()===y && exact.getUTCMonth()===m-1 && exact.getUTCDate()===d && Number.isFinite(Date.parse(v));
  };
  function https(v) { try { const u = new URL(v); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password; } catch { return false; } }
  function day(v) { const d = v instanceof Date ? v : new Date(v); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); }
  function gain(m) { return Number.isFinite(m.subscribersBefore) && Number.isFinite(m.subscribersAfter24h) ? m.subscribersAfter24h-m.subscribersBefore : null; }
  // Reject extra data rather than silently retaining credentials/settings or
  // silently deleting fields from an imported workspace.
  function fields(value, allowed, section) {
    assert(value && typeof value === 'object' && !Array.isArray(value), 'Повреждён раздел: '+section);
    assert(Object.keys(value).every(k=>allowed.includes(k)), 'Неизвестное поле: '+section);
  }
  const chapterFields=['id','title','distinction','habit','reveals','images','tensions','recognition','forbidden','introduces','requires','factCheck','factNote','centralDistinctionStatus','cdStatus','sourceText'];
  const postFields=['id','sources','type','text','addressee','trace','status','leadsToShoulders','leads_to_shoulders','leadsToBook','leads_to_book','sourceQuoteConfirmed','source_quote_confirmed','factCheckCleared','review','scheduledAt','publishedAt','publicationUrl'];
  const reviewStates=['empty','checked','signal'];
  function checkPostShape(p) {
    fields(p,postFields,'пост');
    if(p.sources!==undefined){
      fields(p.sources,['primaryChapter','primary_chapter','secondaryChapters','secondary_chapters','concepts'],'источники поста');
      for(const k of ['primaryChapter','primary_chapter'])assert(p.sources[k]===undefined||id(p.sources[k]),'Неверный источник поста.');
      for(const k of ['secondaryChapters','secondary_chapters','concepts'])assert(p.sources[k]===undefined||list(p.sources[k]),'Неверный список источников поста.');
    }
    if(p.trace!==undefined){fields(p.trace,['seen','withheld'],'след поста');assert(Object.values(p.trace).every(text),'Повреждено поле следа.');}
    if(p.review!==undefined){
      fields(p.review,[...keys,...keys.map((_,i)=>'r'+i)],'проверка поста');
      assert(Object.values(p.review).every(v=>reviewStates.includes(v)), 'Некорректное состояние проверки.');
    }
    for(const k of ['leadsToShoulders','leads_to_shoulders','leadsToBook','leads_to_book','sourceQuoteConfirmed','source_quote_confirmed','factCheckCleared'])assert(p[k]===undefined||typeof p[k]==='boolean','Повреждено логическое поле поста.');
    for(const k of ['scheduledAt','publishedAt'])assert(p[k]===undefined||date(p[k]),'Некорректная дата поста.');
    assert(p.publicationUrl===undefined||p.publicationUrl===''||https(p.publicationUrl),'Некорректная ссылка публикации.');
  }
  function migrate(input) {
    assert(input && [3,4].includes(input.schemaVersion), 'Поддерживаются только базы версий 3 и 4.');
    const x = JSON.parse(JSON.stringify(input));
    fields(x,['schemaVersion','seedId','book','telegramIdentityAccountId','chapters','concepts','posts','measures','workingDraft'],'база');
    for(const k of ['seedId','book','telegramIdentityAccountId'])assert(x[k]===undefined||text(x[k]),'Повреждено поле базы.');
    assert(!x.telegramIdentityAccountId,'Подключение аккаунтов в этой версии не поддерживается.');
    for (const k of ['chapters','concepts','posts']) assert(Array.isArray(x[k]) && x[k].length <= 10000, 'Повреждён раздел базы: '+k);
    assert(x.chapters.length>0, 'В базе нет глав.');
    x.chapters.forEach(c=>{
      fields(c,chapterFields,'глава');
      assert(c.factCheck===undefined||typeof c.factCheck==='boolean','Повреждено поле факт-чека.');
      assert(c.cdStatus===undefined||['not_introduced','partial','introduced'].includes(c.cdStatus),'Некорректное состояние различения.');
    });
    x.concepts.forEach(c=>{
      fields(c,['id','title','status','firstPublishedAt'],'понятие');
      assert(c.firstPublishedAt===undefined||date(c.firstPublishedAt),'Некорректная дата понятия.');
    });
    x.posts.forEach(checkPostShape);
    x.schemaVersion=4; x.telegramIdentityAccountId=x.telegramIdentityAccountId||'';
    const unique = (items) => { const seen=new Set(); items.forEach(c=>{assert(id(c.id)&&!seen.has(c.id),'Некорректный или повторяющийся идентификатор.');seen.add(c.id);});return seen; };
    x.chapters=x.chapters.map(c=>({ ...c, centralDistinctionStatus:c.centralDistinctionStatus||c.cdStatus||'not_introduced', sourceText:c.sourceText||'' }));
    const chapters=unique(x.chapters);
    x.chapters.forEach(c=>{for(const k of ['title','distinction','habit','reveals','recognition','forbidden','factNote','sourceText'])assert(text(c[k]??''),'Повреждено поле главы.');for(const k of ['images','tensions','introduces','requires'])assert(list(c[k]||[]),'Повреждён список главы.');assert(['not_introduced','partial','introduced'].includes(c.centralDistinctionStatus),'Некорректное состояние различения.');});
    x.concepts=x.concepts.map((c,i)=>({...c,id:c.id||'c'+i,status:c.status||'not_mentioned'}));
    const concepts=unique(x.concepts);
    x.concepts.forEach(c=>assert(text(c.title)&&conceptStates.includes(c.status),'Повреждено понятие.'));
    x.posts=x.posts.map(p=>({...p,sources:{primaryChapter:p.sources?.primaryChapter||p.sources?.primary_chapter||x.chapters[0].id,secondaryChapters:p.sources?.secondaryChapters||p.sources?.secondary_chapters||[],concepts:p.sources?.concepts||[]},addressee:p.addressee||'',trace:{seen:p.trace?.seen||'',withheld:p.trace?.withheld||''},leadsToShoulders:!!(p.leadsToShoulders??p.leads_to_shoulders),leadsToBook:!!(p.leadsToBook??p.leads_to_book),sourceQuoteConfirmed:!!(p.sourceQuoteConfirmed??p.source_quote_confirmed),factCheckCleared:!!p.factCheckCleared,review:Object.fromEntries(keys.map((k,i)=>[k,['empty','checked','signal'].includes(p.review?.[k]||p.review?.['r'+i])?(p.review[k]||p.review['r'+i]):'empty']))}));
    const posts=unique(x.posts);
    x.posts.forEach(p=>{assert(status.includes(p.status)&&types.includes(p.type)&&text(p.text)&&(p.status==='draft'||!!p.text.trim())&&text(p.addressee)&&text(p.trace.seen)&&text(p.trace.withheld),'Повреждён пост.');assert(chapters.has(p.sources.primaryChapter)&&list(p.sources.secondaryChapters)&&p.sources.secondaryChapters.every(v=>chapters.has(v)&&v!==p.sources.primaryChapter)&&list(p.sources.concepts)&&p.sources.concepts.every(v=>concepts.has(v)),'Нарушены ссылки поста на главы или понятия.');if(p.status==='scheduled')assert(date(p.scheduledAt),'У запланированного поста нет даты.');if(p.status==='published')assert(date(p.publishedAt)&&https(p.publicationUrl),'У опубликованного поста нет корректной даты или ссылки.');});
    x.measures=x.measures||[]; assert(Array.isArray(x.measures),'Повреждены замеры.');const measured=new Set();
    x.measures.forEach(m=>{fields(m,['postId','recordedAt','subscribersBefore','subscribersAfter24h','shouldersTransitions','bookTransitions','saves','reactions'],'замер');assert(m.recordedAt===undefined||date(m.recordedAt),'Некорректная дата замера.');assert(posts.has(m.postId)&&!measured.has(m.postId)&&x.posts.find(p=>p.id===m.postId).status==='published','Замер не связан с публикацией или повторяется.');measured.add(m.postId);for(const k of ['subscribersBefore','subscribersAfter24h','shouldersTransitions','bookTransitions','saves','reactions'])assert(m[k]===undefined||(Number.isSafeInteger(m[k])&&m[k]>=0),'Замеры должны быть целыми неотрицательными числами.');});
    if(x.workingDraft!==undefined&&x.workingDraft!==null){
      const w=x.workingDraft;
      fields(w,['post','editingId','central','concepts'],'рабочий черновик');
      checkPostShape(w.post);
      assert(w.post.status==='draft','Рабочий текст должен быть черновиком.');
      assert(w.editingId===undefined||w.editingId===null||(id(w.editingId)&&x.posts.some(p=>p.id===w.editingId&&['draft','ready'].includes(p.status))),'Неверная ссылка рабочего черновика.');
      assert(w.central===undefined||['not_introduced','partial','introduced'].includes(w.central),'Некорректное состояние рабочего различения.');
      if(w.concepts!==undefined){
        fields(w.concepts,[...concepts],'понятия рабочего черновика');
        assert(Object.values(w.concepts).every(v=>conceptStates.includes(v)),'Некорректное состояние рабочего понятия.');
      }
      // Reuse exactly the normal post migration and reference validation. The
      // nested candidate has no working draft, so this cannot recurse again.
      const candidate={...x,posts:[w.post],measures:[]};
      delete candidate.workingDraft;
      w.post=migrate(candidate).posts[0];
    }
    return x;
  }
  const api={migrate,day,gain,https,date};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ChannelSafety=api;
})(typeof window!=='undefined'?window:this);

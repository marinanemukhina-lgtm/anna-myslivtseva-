import test from 'node:test';
import assert from 'node:assert/strict';
import { initialContent } from '../shared/content.mjs';
import { SITE_ORIGIN, indexablePaths, metadataFor, sitemapXml } from '../shared/seo.mjs';
import { renderPublicPage } from '../server/public-pages.mjs';
const data = () => structuredClone(initialContent);
const template = '<html><head><title>Old</title><meta name="description" content="old"><meta name="robots" content="old"><link rel="canonical" href="https://old.example"></head><body><div id="root"></div></body></html>';
test('sitemap includes populated public pages, excludes drafts and empty sections, and follows publication changes', () => {
  const raw = data(); raw.profile.phone = '+79085023853'; raw.profile.privacy = 'Опубликованная политика';
  raw.services = [{id:'service',published:true}]; raw.diplomas = [{id:'diploma',published:true}];
  raw.news = [{id:'draft',published:false,title:'PRIVATE'}];
  assert.deepEqual(indexablePaths(raw), ['/', '/about', '/services', '/diplomas', '/contact', '/privacy']);
  assert.doesNotMatch(sitemapXml(raw), /vercel|draft|terms|admin|demo|news/);
  raw.news[0].published = true; raw.profile.terms = 'Опубликованные условия';
  assert.ok(indexablePaths(raw).includes('/news/draft'));
  assert.ok(indexablePaths(raw).includes('/news'));
  assert.ok(indexablePaths(raw).includes('/terms'));
  assert.match(sitemapXml(raw), /https:\/\/osteopatrostov.ru\/news\/draft/);
  raw.news[0].published = false;
  assert.ok(!indexablePaths(raw).includes('/news/draft'));
});
test('empty public pages allow link following; private, synthetic and missing pages stay excluded', () => {
  for (const path of ['/news','/offers','/terms']) {
    const meta = metadataFor(path, data());
    assert.equal(meta.robots, 'noindex, follow'); assert.equal(meta.canonical, SITE_ORIGIN + path);
  }
  for (const path of ['/admin','/admin/setup','/admin/patients','/demo/booking','/demo/patients','/missing','/news/draft']) {
    const meta = metadataFor(path, data());
    assert.equal(meta.robots, 'noindex, nofollow'); assert.equal(meta.canonical, null);
  }
});
test('initial HTML replaces stale head once, escapes CMS text and preserves visible heading', () => {
  const raw = data(); raw.profile.name = 'Анна <script>"&'; raw.profile.about = 'Описание <script> & "';
  const page = renderPublicPage(template, '/about', raw);
  assert.equal((page.html.match(/name="description"/g) || []).length, 1);
  assert.equal((page.html.match(/rel="canonical"/g) || []).length, 1);
  assert.equal((page.html.match(/name="robots"/g) || []).length, 1);
  assert.match(page.html, /href="https:\/\/osteopatrostov.ru\/about"/);
  assert.match(page.html, /<h1>Об Анне<\/h1>/);
  assert.match(page.html, /Описание &lt;script&gt; &amp; &quot;/);
  assert.doesNotMatch(page.html, /<script>|old.example|content="old"/);
});
test('server home and about expose existing editorial copy and only the first three published training cards', () => {
  const raw = data();
  raw.diplomas = [{id:'draft',published:false,title:'PRIVATE'}, ...[1,2,3,4].map(n => ({id:String(n),published:true,title:'Training '+n,body:'Body '+n}))];
  const about = renderPublicPage(template, '/about', raw).html;
  for (const n of [1,2,3]) assert.match(about, new RegExp('Training '+n));
  assert.doesNotMatch(about, /PRIVATE|Training 4/);
  assert.match(renderPublicPage(template, '/', raw).html, /Прежде чем записаться — познакомьтесь со специалистом и его образованием/);
});
test('published articles have consistent identity and withdrawn articles return 404', () => {
  const raw = data(); raw.news = [{id:'article',published:true,title:'Заголовок',body:'Текст публикации'}];
  const meta = metadataFor('/news/article', raw);
  assert.equal(meta.title,'Заголовок'); assert.equal(meta.description,'Текст публикации');
  assert.equal(meta.robots,'index, follow'); assert.equal(meta.canonical,SITE_ORIGIN+'/news/article');
  raw.news[0].published = false;
  const page = renderPublicPage(template, '/news/article', raw);
  assert.equal(page.status,404); assert.doesNotMatch(page.html,/Заголовок|Текст публикации|canonical/);
});

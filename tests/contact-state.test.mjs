import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Render the real Contact tree with a CMS context, stubbing only browser animation setup.
fs.mkdirSync('.qa', { recursive: true });
await build({
  stdin: {
    contents: fs.readFileSync('src/App.jsx', 'utf8') + '\nexport {Contact, Footer, About, Diplomas, Video, Site};',
    resolveDir: path.resolve('src'),
    loader: 'jsx',
  },
  plugins: [{
    name: 'ssr-animation-noop',
    setup(builder) {
      builder.onResolve({ filter: /^gsap/ }, args => ({ path: args.path, namespace: 'animation' }));
      builder.onLoad({ filter: /.*/, namespace: 'animation' }, () => ({
        contents: 'export default {registerPlugin(){}}; export const ScrollTrigger = {};',
        loader: 'js',
      }));
    },
  }],
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['react', 'react-dom', 'react-dom/server'],
  loader: { '.css': 'empty' },
  outfile: '.qa/contact-render.mjs',
});
const { Contact, Footer, About, Diplomas, Video, Site } = await import('../.qa/contact-render.mjs');
const renderContact = profile => renderToStaticMarkup(React.createElement(Site.Provider, {
  value: { data: { profile }, navigate: () => {}, motion: false },
}, React.createElement(Contact)));

for (const [name, profile, href] of [
  ['phone', { phone: '  +79000000001  ' }, 'tel:+79000000001'],
  ['email', { email: ' test@example.invalid ' }, 'mailto:test@example.invalid'],
  ['social', { socialUrl: ' https://example.invalid/social ' }, 'https://example.invalid/social'],
  ['booking', { bookingUrl: ' https://example.invalid/book ' }, 'https://example.invalid/book'],
]) {
  test(`contact integration: ${name} renders an actionable link`, () => {
    const html = renderContact(profile);
    assert.ok(html.includes(`href="${href}"`));
    assert.ok(!html.includes('Контакты для записи скоро появятся.'));
    assert.ok(!html.includes('Онлайн-календарь'));
    assert.equal((html.match(/class="contact-intro"/g) || []).length, 1);
    assert.ok(!html.includes('<form'));
  });
}
for (const [name, profile] of [
  ['empty', {}],
  ['whitespace', { phone: '  ', email: '\t', socialUrl: '\n', bookingUrl: ' ' }],
  ['address and hours only', { address: 'Synthetic address', hours: 'Synthetic hours' }],
]) {
  test(`contact integration: ${name} does not suggest unavailable contact methods`, () => {
    const html = renderContact(profile);
    assert.ok(html.includes('Телефон для связи пока не опубликован.'));
    assert.ok(!html.includes('Онлайн-календарь'));
    assert.ok(!html.includes('href="tel:'));
    assert.ok(!html.includes('href="mailto:'));
    assert.ok(!html.includes('Социальная сеть'));
    assert.ok(!html.includes('<form'));
  });
}


const renderFooter = (profile, path = '/') => renderToStaticMarkup(React.createElement(Site.Provider, {
  value: {data: {profile}, path, navigate: () => {}, motion: false, setMotion: () => {}},
}, React.createElement(Footer)));
test('footer completes the contact page without repeating its actions or details', () => {
  const profile = {name: 'Имя из CMS',role: 'Роль из CMS',phone: '+79000000001',address: 'Тестовый адрес',hours: 'Тестовые часы',socialLinks:{telegram:'https://t.me/synthetic'}};
  for (const path of ['/contact','/contact/']) {
    const html = renderFooter(profile,path);
    assert.doesNotMatch(html, /tel:|sms:|Тестовый адрес|Тестовые часы|footer-invitation|footer-marquee/);
    for (const href of ['/diplomas','/privacy','/terms','/admin']) assert.ok(html.includes(`href="${href}"`));
    assert.match(html, /Имя из CMS/);
    assert.match(html, /Роль из CMS/);
    assert.match(html, /Анимация: выкл/);
  }
  const regular = renderFooter(profile);
  for (const value of ['tel:+79000000001','sms:+79000000001','Тестовый адрес','Тестовые часы','https://t.me/synthetic']) assert.ok(regular.includes(value));
  assert.equal((regular.match(/class="footer-contact-link"/g) || []).length, 1);
  assert.doesNotMatch(regular, /footer-marquee|>А\.<|>К\.<|>С\.<|>—</);
});
test('empty footer does not render placeholder contact rows or hours', () => {
  const html = renderFooter({name: 'Анна',phone:' ',address:' ',email:' ',hours:' '});
  assert.doesNotMatch(html, /class="contacts|class="hours|Часы приёма|>—</);
  assert.match(html, /Контакты для записи пока не опубликованы/);
  const bookingOnly = renderFooter({name: 'Анна', bookingUrl: 'https://example.invalid/book'});
  assert.doesNotMatch(bookingOnly, /Контакты для записи пока не опубликованы/);
  assert.match(bookingOnly, /class="footer-contact-link"/);
});


const renderPublicSection = (Component, profile = {}, diplomas = [], props = {}) => renderToStaticMarkup(React.createElement(Site.Provider, {
  value: {data: {profile: {name: 'Имя из CMS', role: 'Роль из CMS', ...profile}, diplomas, news: [], offers: []}, navigate: () => {}, motion: false},
}, React.createElement(Component, props)));
test('about uses one full portrait and honest unpublished content without self-links', () => {
  const html = renderPublicSection(About);
  assert.equal((html.match(/<img /g) || []).length, 1);
  assert.equal((html.match(/<h1/g) || []).length, 1);
  assert.match(html, /Биография Анны пока не опубликована/);
  assert.match(html, /Документы об образовании пока не опубликованы/);
  assert.match(html, /href="\/diplomas"/);
  assert.doesNotMatch(html, /href="\/about"|page-hero|page-links|about-portrait|Все документы/);
});
test('about retains published introduction, biography, qualification and diploma gallery', () => {
  const html = renderPublicSection(About, {intro: 'Вступление из CMS', about: 'Биография из CMS', qualification: 'Образование из CMS'}, [{id: 'synthetic-diploma', title: 'Синтетический документ', image: '', body: 'Синтетическое описание'}]);
  for (const value of ['Вступление из CMS', 'Биография из CMS', 'Образование из CMS', 'Синтетический документ', 'Синтетическое описание']) assert.match(html, new RegExp(value));
  assert.match(html, /diploma-grid/);
  assert.doesNotMatch(html, /пока не опубликована|пока не опубликованы/);
});
test('empty diploma page keeps its anchor without promising unavailable documents', () => {
  const empty = renderPublicSection(Diplomas, {qualification: 'Образование из CMS'});
  assert.match(empty, /id="documents"/);
  assert.match(empty, /Образование из CMS/);
  assert.match(empty, /Документы об образовании пока не опубликованы/);
  assert.doesNotMatch(empty, /documents-hero|К документам|<img/);
  const published = renderPublicSection(Diplomas, {}, [{id: 'synthetic-diploma', title: 'Синтетический документ', image: '', body: ''}]);
  assert.match(published, /documents-hero/);
  assert.match(published, /href="\/diplomas#documents"/);
  assert.match(published, /Синтетический документ/);
});
test('session media keeps the original poster layer and both unchanged video sources', () => {
  for (const second of [false, true]) {
    const n = second ? 2 : 1;
    const html = renderPublicSection(Video, {}, [], {second, posterLayer: true});
    assert.match(html, new RegExp('src="/media/session-neutral-0' + n + '.jpg"'));
    assert.match(html, new RegExp('src="/media/anna-session-neutral-0' + n + '.mp4"'));
    assert.match(html, /class="session-poster"/);
    assert.match(html, /class="session-video"/);
    assert.doesNotMatch(html, /is-playing/);
  }
});

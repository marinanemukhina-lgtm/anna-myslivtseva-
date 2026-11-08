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
    contents: fs.readFileSync('src/App.jsx', 'utf8') + '\nexport {Contact, Footer, Site};',
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
const { Contact, Footer, Site } = await import('../.qa/contact-render.mjs');
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

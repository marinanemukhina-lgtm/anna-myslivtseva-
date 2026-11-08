import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const hero = source.slice(source.indexOf('function Hero()'), source.indexOf('function Intro()'));
const compiled = await transform(hero, { loader: 'jsx' });
function render(address, services = []) {
  const Hero = new Function('React', 'useSite', 'Link', 'HeroPortrait', 'ArrowIcon', compiled.code + ';return Hero;')(
    React, () => ({ data: { profile: { name: 'Анна Мысливцева', role: 'Остеопат', address }, services } }),
    ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children),
    () => React.createElement('img', { src: '/media/anna-portrait-smile.png', alt: 'Анна' }),
    () => React.createElement('svg', { 'aria-hidden': true }),
  );
  return renderToStaticMarkup(React.createElement(Hero));
}

test('hero uses CMS location and keeps contact, services and diploma actions', () => {
  const html = render('Новый адрес <проверка>', [{ published: true, price: '1000 ₽' }]);
  assert.match(html, /Новый адрес &lt;проверка&gt;/);
  assert.match(html, /href="\/contact" class="hero-contact"/);
  assert.match(html, /href="\/services" class="hero-services"/);
  assert.match(html, /href="\/diplomas" class="hero-document-link"/);
  assert.doesNotMatch(html, /<form|<input|callback|Awwwards|Ростов/);
});

test('empty location stays empty; static navigation replaces the duplicated carousel', () => {
  assert.doesNotMatch(render(''), /hero-location|Ростов|Выезд/);
  const html = render('');
  const nav = html.slice(html.indexOf('hero-chapters'));
  assert.ok(nav.indexOf('/services') < nav.indexOf('/about'));
  assert.ok(nav.indexOf('/about') < nav.indexOf('/diplomas'));
  assert.ok(nav.indexOf('/diplomas') < nav.indexOf('/contact'));
  assert.doesNotMatch(source, /function FourSteps|<FourSteps/);
  assert.doesNotMatch(source, /home-next|footer-marquee/);
  assert.match(source, /className="footer-contact-link"/);
});

const homeSource = source.slice(source.indexOf('function Home()'), source.indexOf('function EducationFeature()'));
const homeCompiled = await transform(homeSource, { loader: 'jsx' });
const sections = ['Hero', 'Intro', 'Video', 'EducationFeature', 'Editorial', 'Feature', 'FullMedia', 'JournalLinks'];
function renderHome(data) {
  const Home = new Function('React', 'useSite', 'Link', ...sections, homeCompiled.code + ';return Home;')(
    React, () => ({ data }),
    ({ to, children }) => React.createElement('a', { href: to }, children),
    ...sections.map(name => () => React.createElement('section', { 'data-section': name })),
  );
  return renderToStaticMarkup(React.createElement(Home));
}

test('home keeps the identity hero and published updates without repeated footage or empty promotions', () => {
  const html = renderHome({ profile: { name: 'Имя из CMS', role: 'Роль из CMS' }, news: [{ id: 'news-1', title: 'Новость из CMS' }], offers: [{ id: 'offer-1', title: 'Акция из CMS' }] });
  assert.match(html, /data-section="Hero"/);
  assert.match(html, /data-section="Feature"/);
  assert.doesNotMatch(html, /data-section="FullMedia"|hero-second/);
  assert.match(html, /href="\/news\/news-1"/);
  assert.match(html, /Новость из CMS/);
  assert.match(html, /href="\/offers\/offer-1"/);
  assert.match(html, /Акция из CMS/);
  assert.doesNotMatch(html, /home-next/); // The single final contact path is in the shared footer.
  assert.doesNotMatch(html, /data-section="JournalLinks"/);
  const empty = renderHome({ profile: { name: '', role: '' }, news: [], offers: [] });
  assert.doesNotMatch(empty, /data-section="JournalLinks"/); // Empty news and offers remain in navigation, not a giant home section.
  assert.doesNotMatch(empty, /home-updates|Новость из CMS|Акция из CMS/);
});


test('hero services CTA reflects only published entries and actual prices', () => {
  for (const services of [[], [{ published: false, price: '1000 ₽' }]]) {
    const html = render('', services);
    assert.doesNotMatch(html, /class="hero-services"/);
    assert.match(html, /class="hero-contact"/);
    assert.match(html, /class="hero-document-link"/);
    assert.match(html, /href="\/services"/);
  }
  for (const price of ['', '   ']) {
    const html = render('', [{ published: true, price }, { published: false, price: '1000 ₽' }]);
    assert.match(html, /class="hero-services">Услуги<\/a>/);
  }
  assert.match(render('', [{ published: true, price: '1000 ₽' }]), /class="hero-services">Услуги и стоимость<\/a>/);
});


test('hero preserves the portrait and motion controls in a full-frame media region', async () => {
  const css = await readFile(new URL('../src/public-composition.css', import.meta.url), 'utf8');
  assert.match(source, /className="hero-portrait-frame"><HeroPortrait \/>/);
  assert.match(css, /\.hero-portrait-frame \{[^}]*aspect-ratio: 4 \/ 5/);
  assert.match(css, /\.hero-portrait-frame \.hero-image \{[^}]*object-fit: contain/);
  assert.match(source, /Остановить анимацию портрета/);
  assert.doesNotMatch(hero, /hero-shade/);
});


test('home renders a published philosophy once and does not invent a full empty editorial section', () => {
  const base = {profile: {}, news: [], offers: []};
  assert.doesNotMatch(renderHome(base), /data-section="Editorial"/);
  const published = renderHome({...base, profile: {philosophy: 'Текст Анны'}});
  assert.equal((published.match(/data-section="Editorial"/g) || []).length, 1);
});

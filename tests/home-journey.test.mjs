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
  const Hero = new Function('React', 'useSite', 'Link', 'HeroPortrait', compiled.code + ';return Hero;')(
    React, () => ({ data: { profile: { name: 'Анна Мысливцева', role: 'Остеопат', address }, services } }),
    ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children),
    () => React.createElement('img', { src: '/media/anna-portrait-smile.png', alt: 'Анна' }),
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
  assert.match(source, /className="home-next editorial grid"/);
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

test('home keeps supplied identity, published updates and a final contact path', () => {
  const html = renderHome({ profile: { name: 'Имя из CMS', role: 'Роль из CMS' }, news: [{ id: 'news-1', title: 'Новость из CMS' }], offers: [{ id: 'offer-1', title: 'Акция из CMS' }] });
  assert.match(html, /Имя из CMS/);
  assert.match(html, /Роль из CMS/);
  assert.match(html, /href="\/news\/news-1"/);
  assert.match(html, /Новость из CMS/);
  assert.match(html, /href="\/offers\/offer-1"/);
  assert.match(html, /Акция из CMS/);
  assert.match(html, /href="\/contact">Перейти к контактам/);
  assert.doesNotMatch(html, /data-section="JournalLinks"/);
  const empty = renderHome({ profile: { name: '', role: '' }, news: [], offers: [] });
  assert.match(empty, /data-section="JournalLinks"/);
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


test('desktop hero gets a left text scrim without altering the mobile shade or portrait', async () => {
  // Source guard only; rendered contrast and portrait appearance need CI screenshots.
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const desktop = css.match(/@media\(min-width:1024px\)\s*\{\s*\.hero-shade::before\s*\{([^}]+)\}\s*\}/);
  assert.ok(desktop);
  assert.match(desktop[1], /pointer-events:\s*none/);
  assert.match(desktop[1], /linear-gradient\(90deg, rgba\(9,14,24,\.68\), rgba\(9,14,24,\.58\) 28%, transparent 48%\)/);
  assert.equal((css.match(/\.hero-shade::before/g) || []).length, 1);
  assert.match(css, /\.hero-shade \{[^}]*linear-gradient\(0deg, rgba\(9,14,24,\.74\), rgba\(9,14,24,\.08\) 55%, transparent 75%\)/);
  assert.doesNotMatch(desktop[1], /filter:|object-position:|font|transform:/);
});

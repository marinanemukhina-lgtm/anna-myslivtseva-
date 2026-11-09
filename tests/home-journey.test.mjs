import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { loadComponent } from "./load-contact-component.mjs";
const { ContactChoiceDialog } = loadComponent("ContactChoiceDialog.jsx");
const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const hero = source.slice(source.indexOf('function Hero()'), source.indexOf('function Intro()'));
const compiled = await transform(hero, { loader: 'jsx' });
function render(address, services = []) {
  const Hero = new Function('React', 'useSite', 'Link', 'HeroPortrait', 'ContactChoiceDialog', compiled.code + ';return Hero;')(
    React, () => ({ data: { profile: { name: 'Анна Мысливцева', role: 'Остеопат', address }, services } }),
    ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children),
    () => React.createElement('img', { src: '/media/anna-portrait-smile.png', alt: 'Анна' }), ContactChoiceDialog,
  );
  return renderToStaticMarkup(React.createElement(Hero));
}

test('hero uses CMS location and keeps contact, services and diploma actions', () => {
  const html = render('Новый адрес <проверка>', [{ published: true, price: '1000 ₽' }]);
  assert.match(html, /Новый адрес &lt;проверка&gt;/);
  assert.match(html, /class="contact-choice-trigger hero-contact" href="\/contact"/);
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
  assert.match(html, /data-section="Hero"/);
  assert.match(html, /href="\/news\/news-1"/);
  assert.match(html, /Новость из CMS/);
  assert.match(html, /href="\/offers\/offer-1"/);
  assert.match(html, /Акция из CMS/);
  assert.match(html, /href="\/contact">Перейти к контактам/);
  assert.doesNotMatch(html, /data-section="JournalLinks"/);
  const empty = renderHome({ profile: { name: '', role: '' }, news: [], offers: [] });
  assert.doesNotMatch(empty, /data-section="(?:JournalLinks|Video|FullMedia|EducationFeature|Editorial)"/);
  assert.doesNotMatch(empty, /home-updates|Новость из CMS|Акция из CMS/);
});


test('hero services CTA reflects only published entries and actual prices', () => {
  for (const services of [[], [{ published: false, price: '1000 ₽' }]]) {
    const html = render('', services);
    assert.doesNotMatch(html, /class="hero-services"/);
    assert.match(html, /class="contact-choice-trigger hero-contact"/);
    assert.match(html, /class="hero-document-link"/);
    assert.match(html, /href="\/services"/);
  }
  for (const price of ['', '   ']) {
    const html = render('', [{ published: true, price }, { published: false, price: '1000 ₽' }]);
    assert.match(html, /class="hero-services">Услуги<\/a>/);
  }
  assert.match(render('', [{ published: true, price: '1000 ₽' }]), /class="hero-services">Услуги и стоимость<\/a>/);
});


test('approved colour portrait uses dark text and a separate mobile text area', async () => {
  const css = await readFile(new URL('../src/editorial.css', import.meta.url), 'utf8');
  assert.match(css, /--paper: #f3eee7; --ink: #172e39/);
  assert.match(css, /\.hero-shade::before \{ display: none;/);
  assert.match(css, /\.hero-title \{ width: 100%; padding: 30px 24px 24px; background: var\(--paper\)/);
  assert.match(css, /object-position: 72% center/);
  assert.match(css, /overflow-wrap: anywhere/);
});


test('direct header contact shares the hidden-navigation tablet breakpoint', async () => {
  const css = await readFile(new URL('../src/editorial.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 1023px\) \{\s*\.site-header \.header-contact \{ display: inline-block;/);
});

test('menu has an explicit accessible name independent of decorative CSS', () => {
  assert.match(source, /className="small-link menu-trigger"\s+aria-label="Меню"/);
});

test('hero chapter price label requires a published price', () => {
 assert.doesNotMatch(render('', []), /Услуги и цены/);
 assert.doesNotMatch(render('', [{published:true,price:''}]), /Услуги и цены/);
 assert.doesNotMatch(render('', [{published:false,price:'1000'}]), /Услуги и цены/);
 assert.match(render('', [{published:true,price:'1000'}]), /Услуги и цены/);
});
test('portrait link contrast and footer role line boxes do not depend on photo or name size', async () => {
 const css=await readFile(new URL('../src/editorial.css',import.meta.url),'utf8');
 assert.match(css,/\.hero-scroll \{ background: #f4f0e7; color: #123f46;/);
 assert.match(css,/\.footer-tagline>span \{ display: block;[^}]*font: 20px\/1.6/);
});

test('PageLinks price label depends on a published price and retains its route', async () => {
 const section=source.slice(source.indexOf('function PageLinks()'),source.indexOf('function Home()'));
 const code=(await transform(section,{loader:'jsx'})).code;
 const html=services=>{
  const Component=new Function('React','useSite','Link','Portrait',code+';return PageLinks;')(
   React,()=>({data:{profile:{},services}}),({to,children})=>React.createElement('a',{href:to},children),()=>null);
  return renderToStaticMarkup(React.createElement(Component));
 };
 for(const services of [[],[{published:true,price:''}],[{published:false,price:'1000'}]]) {
  assert.doesNotMatch(html(services),/Услуги и цены/);
  assert.match(html(services),/href="\/services"/);
 }
 assert.match(html([{published:true,price:'1000'}]),/Услуги и цены/);
});

test('hero location has no card and long copy stays in the clear portrait area', async () => {
 const css=await readFile(new URL('../src/editorial.css',import.meta.url),'utf8');
 assert.match(css,/\.hero-location \{ background: none; padding: 0;/);
 assert.match(css,/\.hero-role,\.hero-location \{ max-width: 29vw;/);
 assert.match(css,/\.hero-first:has\(\.hero-image--custom\) \.hero-shade/);
});

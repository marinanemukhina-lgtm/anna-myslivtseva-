import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build, transform } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = fs.readFileSync('src/Booking.jsx', 'utf8');
const transformed = await transform(source
  .replace("import React from 'react';", '')
  .replace("import './booking.css';", '')
  .replace('export default function Booking', 'function Booking'), { loader: 'jsx' });
const Booking = new Function('React', transformed.code + ';return Booking;')(React);
const availableMessage = 'Для записи воспользуйтесь контактами ниже.';
const unavailableMessage = 'Контакты для записи ещё не опубликованы.';

for (const [name, profile, available] of [
  ['empty', {}, false],
  ['whitespace', { phone: '  ', email: '\t', socialUrl: '\n', bookingUrl: ' ' }, false],
  ['address alone', { address: 'Synthetic address' }, false],
  ['phone', { phone: ' +000 ' }, true],
  ['email', { email: ' test@example.invalid ' }, true],
  ['social', { socialUrl: ' https://example.invalid ' }, true],
  ['booking', { bookingUrl: ' https://example.invalid/book ' }, true],
]) {
  test(`booking notice: ${name}`, () => {
    const html = renderToStaticMarkup(React.createElement(Booking, { profile }));
    assert.equal(html.includes(availableMessage), available);
    assert.equal(html.includes(unavailableMessage), !available);
    assert.ok(!html.includes('<form'));
  });
}
test('default booking notice does not promise a working calendar', () => {
  const html = renderToStaticMarkup(React.createElement(Booking));
  assert.ok(html.includes('Онлайн-запись пока не открыта.'));
});

// Render the real Contact tree with a CMS context, stubbing only browser animation setup.
fs.mkdirSync('.qa', { recursive: true });
await build({
  stdin: {
    contents: fs.readFileSync('src/App.jsx', 'utf8') + '\nexport {Contact, Contacts, Footer, Site};',
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
const { Contact, Contacts, Footer, Site } = await import('../.qa/contact-render.mjs');
const renderComponent = (Component, profile, props = {}) => renderToStaticMarkup(React.createElement(Site.Provider, {
  value: { data: { profile }, navigate: () => {}, motion: false, setMotion: () => {} },
}, React.createElement(Component, props)));
const renderContact = profile => renderComponent(Contact, profile);

for (const profile of [{}, { address: ' ', mapUrl: '\t', email: '\n', phone: ' ', socialUrl: ' ' }]) {
  test(`empty contact groups are omitted: ${JSON.stringify(profile)}`, () => {
    assert.equal(renderComponent(Contacts, profile), '');
    assert.equal(renderComponent(Contacts, profile, { compact: true }), '');
  });
}

for (const [name, profile, label, href] of [
  ['address', { address: ' Synthetic address ' }, 'А.', null],
  ['map only', { mapUrl: ' https://example.invalid/map ' }, 'А.', 'https://example.invalid/map'],
  ['phone', { phone: ' +000 ' }, 'К.', 'tel:+000'],
  ['email', { email: ' test@example.invalid ' }, 'К.', 'mailto:test@example.invalid'],
  ['social', { socialUrl: ' https://example.invalid/social ' }, 'С.', 'https://example.invalid/social'],
]) {
  test(`only populated contact group is rendered: ${name}`, () => {
    for (const compact of [false, true]) {
      const html = renderComponent(Contacts, profile, { compact });
      assert.equal((html.match(/<span>/g) || []).length, 1);
      assert.ok(html.includes(`<span>${label}</span>`));
      assert.ok(!html.includes('—'));
      assert.ok(!html.includes('<br'));
      if (href) assert.ok(html.includes(`href="${href}"`));
    }
  });
}

test('all supplied contact content survives rendering without changing source values', () => {
  const profile = Object.freeze({
    address: ' Synthetic address ', mapUrl: 'https://example.invalid/map',
    email: 'test@example.invalid', phone: '+000', socialUrl: 'https://example.invalid/social',
  });
  const html = renderComponent(Contacts, profile);
  assert.equal((html.match(/<span>/g) || []).length, 3);
  assert.equal((html.match(/<br/g) || []).length, 2);
  for (const value of Object.values(profile)) assert.ok(html.includes(value.trim()));
  assert.equal(profile.address, ' Synthetic address ');
});

for (const hours of ['', ' \n\t']) {
  test(`footer does not reserve an empty hours column: ${JSON.stringify(hours)}`, () => {
    const html = renderComponent(Footer, { phone: '+000', hours });
    assert.ok(!html.includes('Часы приёма'));
    assert.ok(!html.includes('class="hours"'));
    assert.ok(html.includes('class="footer-grid single-column"'));
    assert.ok(html.includes('href="tel:+000"'));
  });
}
test('footer preserves supplied hours and standalone map', () => {
  const html = renderComponent(Footer, { mapUrl: 'https://example.invalid/map', hours: ' Synthetic hours ' });
  assert.ok(html.includes('class="footer-grid"'));
  assert.ok(html.includes('class="hours"'));
  assert.ok(html.includes('Synthetic hours'));
  assert.ok(html.includes('href="https://example.invalid/map"'));
  assert.ok(!html.includes('Контакты для записи пока не опубликованы.'));
});

for (const [name, profile, href] of [
  ['phone', { phone: '  +000  ' }, 'tel:+000'],
  ['email', { email: ' test@example.invalid ' }, 'mailto:test@example.invalid'],
  ['social', { socialUrl: ' https://example.invalid/social ' }, 'https://example.invalid/social'],
  ['booking', { bookingUrl: ' https://example.invalid/book ' }, 'https://example.invalid/book'],
]) {
  test(`contact integration: ${name} renders an actionable link`, () => {
    const html = renderContact(profile);
    assert.ok(html.includes(`href="${href}"`));
    assert.ok(!html.includes('Контакты для записи скоро появятся.'));
    assert.ok(html.includes(availableMessage));
    assert.ok(!html.includes(unavailableMessage));
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
    assert.ok(html.includes(unavailableMessage));
    assert.ok(html.includes('Контакты для записи скоро появятся.'));
    assert.ok(!html.includes(availableMessage));
    assert.ok(!html.includes('href="tel:'));
    assert.ok(!html.includes('href="mailto:'));
    assert.ok(!html.includes('Социальная сеть'));
    assert.ok(!html.includes('<form'));
  });
}

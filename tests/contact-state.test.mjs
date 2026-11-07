import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build, transform } from 'esbuild';
import React from 'react';
import { contactMethods } from '../src/contact-methods.mjs';
import { publicSocialLinks, safePublicUrl } from '../shared/contact-links.mjs';
import { renderToStaticMarkup } from 'react-dom/server';

const source = fs.readFileSync('src/Booking.jsx', 'utf8');
const transformed = await transform(source
  .replace("import React from 'react';", '')
  .replace("import './booking.css';", '')
  .replace("import { contactMethods } from './contact-methods.mjs';", '')
  .replace("import { publicSocialLinks, safePublicUrl } from '../shared/contact-links.mjs';", '')
  .replace('export default function Booking', 'function Booking'), { loader: 'jsx' });
const Booking = new Function('React', 'contactMethods', 'publicSocialLinks', 'safePublicUrl', transformed.code + ';return Booking;')(React, contactMethods, publicSocialLinks, safePublicUrl);
const availableMessage = 'Для записи воспользуйтесь контактами ниже.';
const unavailableMessage = 'Контакты для записи ещё не опубликованы.';

for (const [name, profile, available] of [
  ['empty', {}, false],
  ['whitespace', { phone: '  ', email: '\t', socialUrl: '\n', bookingUrl: ' ' }, false],
  ['address alone', { address: 'Synthetic address' }, false],
  ['phone', { phone: ' +79000000001 ' }, true],
  ['invalid phone', {phone: '+000'}, false],
  ['structured social', {socialLinks:{telegram:'https://t.me/synthetic'}}, true],
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
    contents: fs.readFileSync('src/App.jsx', 'utf8') + '\nexport {Contact, Site};',
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
const { Contact, Site } = await import('../.qa/contact-render.mjs');
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

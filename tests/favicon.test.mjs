import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { generateIcons } from '../scripts/generate-icons.mjs';
import worker from '../worker/index.js';

const publicDir = new URL('../public/', import.meta.url);
const pngSizes = {
  'favicon-16x16.png': 16,
  'favicon-32x32.png': 32,
  'apple-touch-icon.png': 180,
  'android-chrome-192x192.png': 192,
  'android-chrome-512x512.png': 512,
};
const mimeTypes = {
  ...Object.fromEntries(Object.keys(pngSizes).map(name => [name, /^image\/png/ ])),
  'favicon.svg': /^image\/svg\+xml/,
  'favicon.ico': /^image\/(?:vnd\.microsoft\.icon|x-icon)/,
  'site.webmanifest': /^application\/manifest\+json/,
};
const read = (name, encoding) => readFile(new URL(name, publicDir), encoding);

function pngPixels(bytes, size) {
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
  assert.equal(bytes.readUInt32BE(16), size); assert.equal(bytes.readUInt32BE(20), size);
  assert.equal(bytes[24], 8); assert.equal(bytes[25], 2, 'opaque RGB, including the Apple icon');
  const compressed = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    assert.ok(['IHDR', 'IDAT', 'IEND'].includes(type), 'no timestamps, private or incidental metadata');
    if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(compressed));
  assert.equal(raw.length, size * (size * 3 + 1));
  assert.deepEqual(raw.subarray(1, 4), Buffer.from([255,252,248]));
  assert.ok(raw.some((byte, i) => i % (size * 3 + 1) !== 0 && byte < 100), 'the initials are not blank');
}

test('brand icon has local vector outlines and every PNG has its declared dimensions', async () => {
  const svg = await read('favicon.svg', 'utf8');
  assert.match(svg, /viewBox="0 0 512 512"/);
  assert.match(svg, /Анна Мысливцева/);
  assert.match(svg, /fill="#fffcf8"/); assert.match(svg, /fill="#1e305e"/);
  assert.doesNotMatch(svg, /<(?:script|image|foreignObject|text|style|use)\b|(?:href|src)=|url\(/i);
  for (const [name, size] of Object.entries(pngSizes)) pngPixels(await read(name), size);
});

test('ICO contains real 16, 32 and 48 pixel Windows bitmap entries', async () => {
  const ico = await read('favicon.ico');
  assert.equal(ico.readUInt16LE(0), 0); assert.equal(ico.readUInt16LE(2), 1); assert.equal(ico.readUInt16LE(4), 3);
  let expectedOffset = 54;
  for (const [i, size] of [16, 32, 48].entries()) {
    const entry = 6 + i * 16, length = ico.readUInt32LE(entry + 8), offset = ico.readUInt32LE(entry + 12);
    assert.equal(ico[entry], size); assert.equal(ico[entry + 1], size);
    assert.equal(ico.readUInt16LE(entry + 4), 1); assert.equal(ico.readUInt16LE(entry + 6), 32);
    assert.equal(offset, expectedOffset); expectedOffset += length;
    assert.equal(length, 40 + size * size * 4 + Math.ceil(size / 32) * 4 * size);
    assert.equal(ico.readUInt32LE(offset), 40);
    assert.equal(ico.readInt32LE(offset + 4), size); assert.equal(ico.readInt32LE(offset + 8), size * 2);
    assert.equal(ico.readUInt16LE(offset + 14), 32); assert.equal(ico[offset + 43], 255);
  }
  assert.equal(expectedOffset, ico.length);
});

test('generated PNG/ICO bytes reproduce from the checked-in SVG without tools or fonts', async () => {
  for (const [name, bytes] of generateIcons(await read('favicon.svg', 'utf8'))) assert.deepEqual(await read(name), bytes, name);
});

test('both HTML shells link root icons and manifest stays public, browser-only and brand-consistent', async () => {
  for (const file of ['index.html', 'server/marketing-assets/workspace.html']) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const [rel, href] of [['icon','/favicon.ico'], ['icon','/favicon.svg'], ['icon','/favicon-32x32.png'], ['apple-touch-icon','/apple-touch-icon.png'], ['manifest','/site.webmanifest']]) {
      const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => match[0]);
      assert.ok(links.some(link => link.includes(`rel="${rel}"`) && link.includes(`href="${href}"`)), `${file} is missing ${href}`);
    }
  }
  const manifest = JSON.parse(await read('site.webmanifest', 'utf8'));
  assert.equal(manifest.name, 'Анна Мысливцева'); assert.equal(manifest.short_name, 'Анна'); assert.equal(manifest.lang, 'ru');
  assert.equal(manifest.start_url, '/'); assert.equal(manifest.id, '/'); assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'browser'); assert.equal(manifest.theme_color, '#fffcf8'); assert.equal(manifest.background_color, '#fffcf8');
  assert.deepEqual(Object.keys(manifest).sort(), ['id','name','short_name','lang','start_url','scope','display','background_color','theme_color','icons'].sort());
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512']);
  for (const icon of manifest.icons) {
    assert.equal(icon.type, 'image/png'); assert.equal(icon.purpose, 'any');
    assert.match(icon.src, /^\/android-chrome-\d+x\d+\.png$/);
    pngPixels(await read(icon.src.slice(1)), Number(icon.sizes.split('x')[0]));
  }
});

test('Express production route ordering serves icons with correct MIME and bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anna-favicon-'));
  const previous = Object.fromEntries(['DATA_DIR','DATABASE_URL','VERCEL'].map(key => [key, process.env[key]]));
  process.env.DATA_DIR = directory; delete process.env.DATABASE_URL; delete process.env.VERCEL;
  let server;
  try {
    const { default: express } = await import('express');
    const { createApp } = await import('../server/app.mjs');
    const app = createApp(); app.use(express.static(fileURLToPath(publicDir)));
    app.use((_req, res) => res.status(404).end());
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [name, mime] of Object.entries(mimeTypes)) {
      const response = await fetch(`${base}/${name}`);
      assert.equal(response.status, 200, name); assert.match(response.headers.get('content-type'), mime, name);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), await read(name), name);
      const head = await fetch(`${base}/${name}`, { method: 'HEAD' });
      assert.equal(head.status, 200); assert.match(head.headers.get('content-type'), mime);
      assert.equal(await head.text(), '');
    }
    assert.equal((await fetch(`${base}/missing-icon.png`)).status, 404);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
    await rm(directory, { recursive: true, force: true });
  }
});

test('Sites passes icon and manifest requests through without an HTML fallback', async () => {
  for (const [name, mime] of Object.entries(mimeTypes)) {
    const calls = [], bytes = await read(name);
    const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.ico') ? 'image/vnd.microsoft.icon' : 'application/manifest+json';
    const response = await worker.fetch(new Request(`https://example.test/${name}`), { ASSETS: {
      fetch: async request => {
        calls.push(new URL(request.url).pathname);
        return new Response(bytes, { headers: { 'content-type': type } });
      },
    } });
    assert.equal(response.status, 200); assert.deepEqual(calls, [`/${name}`]);
    assert.match(response.headers.get('content-type'), mime);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  }
});

#!/usr/bin/env node
// Reproduce checked-in icons with Node.js only; no runtime/build dependency.
// Source outlines: Cormorant Garamond Medium, Cyrillic АМ, @fontsource 5.2.8.
// The existing font license is licenses/Cormorant-Garamond-OFL.txt.
// Edit public/favicon.svg, then run node scripts/generate-icons.mjs.
// CI can verify byte-for-byte output with --check. No timestamps are embedded.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const PAPER = [255, 252, 248];
const INK = [30, 48, 94];
const SAMPLES = 8;

function edgesFromSvg(svg) {
  const path = svg.match(/<path fill="#1e305e" d="([^"]+)"\s*\/>/)?.[1];
  if (!path || !svg.includes('viewBox="0 0 512 512"')) throw Error('Expected the 512px brand outline.');
  if (/[^MLQZ\d\s.,-]/.test(path)) throw Error('Only absolute M, L, Q and Z paths are supported.');
  const tokens = path.match(/[MLQZ]|-?\d+(?:\.\d+)?/g);
  const edges = [];
  let i = 0, point, start;
  const next = () => [Number(tokens[i++]), Number(tokens[i++])];
  const line = end => {
    if (point[1] !== end[1]) edges.push([point, end]);
    point = end;
  };
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === 'M') start = point = next();
    else if (command === 'L') line(next());
    else if (command === 'Z') line(start);
    else if (command === 'Q') {
      const from = point, control = next(), end = next();
      // Fixed subdivision is deterministic and finer than a device pixel.
      for (let step = 1; step <= 24; step++) {
        const t = step / 24, u = 1 - t;
        line([u*u*from[0] + 2*u*t*control[0] + t*t*end[0], u*u*from[1] + 2*u*t*control[1] + t*t*end[1]]);
      }
    } else throw Error(`Unsupported path command: ${command}`);
  }
  return edges;
}

function raster(edges, size) {
  const counts = new Uint16Array(size * size);
  const width = size * SAMPLES, scale = width / 512;
  for (let y = 0; y < width; y++) {
    const sourceY = (y + 0.5) / scale;
    const hits = edges.flatMap(([a, b]) => {
      if (sourceY < Math.min(a[1], b[1]) || sourceY >= Math.max(a[1], b[1])) return [];
      return [{ x: (a[0] + (sourceY-a[1]) * (b[0]-a[0]) / (b[1]-a[1])) * scale, delta: b[1] > a[1] ? 1 : -1 }];
    }).sort((a, b) => a.x - b.x);
    let winding = 0;
    for (let h = 0; h < hits.length - 1; h++) {
      winding += hits[h].delta;
      if (!winding) continue;
      const first = Math.max(0, Math.ceil(hits[h].x - 0.5));
      const last = Math.min(width, Math.ceil(hits[h + 1].x - 0.5));
      for (let x = first; x < last; x++) counts[Math.floor(y / SAMPLES) * size + Math.floor(x / SAMPLES)]++;
    }
  }
  const rgb = Buffer.alloc(size * size * 3);
  for (let p = 0; p < counts.length; p++) {
    const coverage = counts[p] / (SAMPLES * SAMPLES);
    for (let c = 0; c < 3; c++) rgb[p * 3 + c] = Math.round(PAPER[c] + (INK[c] - PAPER[c]) * coverage);
  }
  return rgb;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data]);
  const header = Buffer.alloc(4), tail = Buffer.alloc(4);
  header.writeUInt32BE(data.length); tail.writeUInt32BE(crc32(bytes));
  return Buffer.concat([header, bytes, tail]);
}
function png(rgb, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 2; // 8-bit, opaque RGB, suitable for Apple icons.
  const rows = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) rgb.copy(rows, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  const data = images.map(({ size, rgb }, index) => {
    // Uncompressed 32-bit DIB + a padded AND mask for older ICO readers.
    const maskStride = Math.ceil(size / 32) * 4;
    const dib = Buffer.alloc(40 + size * size * 4 + maskStride * size);
    dib.writeUInt32LE(40); dib.writeInt32LE(size, 4); dib.writeInt32LE(size * 2, 8);
    dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14); dib.writeUInt32LE(size * size * 4, 20);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const p = (y * size + x) * 3, target = 40 + ((size - y - 1) * size + x) * 4;
      dib[target] = rgb[p + 2]; dib[target + 1] = rgb[p + 1]; dib[target + 2] = rgb[p]; dib[target + 3] = 255;
    }
    const entry = 6 + index * 16;
    header[entry] = size; header[entry + 1] = size;
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(dib.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += dib.length;
    return dib;
  });
  return Buffer.concat([header, ...data]);
}

export function generateIcons(svg) {
  const edges = edgesFromSvg(svg);
  const pixels = new Map([16, 32, 48, 180, 192, 512].map(size => [size, raster(edges, size)]));
  const files = new Map([
    ['favicon-16x16.png', png(pixels.get(16), 16)],
    ['favicon-32x32.png', png(pixels.get(32), 32)],
    ['apple-touch-icon.png', png(pixels.get(180), 180)],
    ['android-chrome-192x192.png', png(pixels.get(192), 192)],
    ['android-chrome-512x512.png', png(pixels.get(512), 512)],
    ['favicon.ico', ico([16, 32, 48].map(size => ({ size, rgb: pixels.get(size) })))],
  ]);
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const publicDir = new URL('../public/', import.meta.url);
  const files = generateIcons(await readFile(new URL('favicon.svg', publicDir), 'utf8'));
  for (const [name, bytes] of files) {
    const target = new URL(name, publicDir);
    if (process.argv.includes('--check')) {
      if (!(await readFile(target)).equals(bytes)) throw Error(`Regenerate ${name}: node scripts/generate-icons.mjs`);
    } else await writeFile(target, bytes);
  }
  console.log(`${process.argv.includes('--check') ? 'Verified' : 'Generated'} ${files.size} icon files.`);
}

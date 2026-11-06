import { test, expect } from '@playwright/test';

const links = [
  ['icon', '/favicon.ico'],
  ['icon', '/favicon-32x32.png'],
  ['icon', '/favicon.svg'],
  ['apple-touch-icon', '/apple-touch-icon.png'],
  ['manifest', '/site.webmanifest'],
];

test('public, login and workspace HTML keep the same root-relative device icons', async ({ page, baseURL }) => {
  for (const path of ['/', '/diplomas', '/admin', '/admin/setup', '/admin/marketing']) {
    if (path === '/admin/marketing') {
      const login = await page.request.post('/api/session', {
        headers: { origin: baseURL }, data: { password: 'browser-fixture-only-password' },
      });
      expect(login.ok()).toBe(true);
    }
    const response = await page.goto(path);
    expect(response.status()).toBe(200);
    for (const [rel, href] of links) {
      await expect(page.locator(`head link[rel="${rel}"][href="${href}"]`)).toHaveCount(1);
    }
    const manifest = await page.evaluate(async () => {
      const response = await fetch(document.querySelector('link[rel="manifest"]').href);
      return { status: response.status, mime: response.headers.get('content-type'), data: await response.json() };
    });
    expect(manifest.status).toBe(200);
    expect(manifest.mime).toMatch(/^application\/manifest\+json/);
    expect(manifest.data.start_url).toBe('/'); expect(manifest.data.display).toBe('browser');
  }
});

test('browsers request and decode SVG, ICO and Apple/Android PNG assets without private URLs', async ({ page, baseURL }, testInfo) => {
  const requested = new Set(), responded = new Map();
  page.on('request', request => requested.add(request.url()));
  page.on('response', response => responded.set(response.url(), response.status()));
  await page.goto('/diplomas');
  const results = await page.evaluate(async probeId => {
    const urls = ['/favicon.svg', '/favicon.ico', '/favicon-16x16.png', '/favicon-32x32.png', '/apple-touch-icon.png'];
    const manifest = await (await fetch(document.querySelector('link[rel="manifest"]').href, { cache: 'no-store' })).json();
    urls.push(...manifest.icons.map(icon => icon.src));
    return Promise.all(urls.map(async url => {
      try {
        // Keep checking the actual, unmodified public URL and its decoded image.
        const response = await fetch(url, { cache: 'no-store' });
        const bytes = new Uint8Array(await response.arrayBuffer());
        const image = new Image(); image.src = url; await image.decode();
        // Playwright 1.64 suppresses request/response events for URLs ending in
        // /favicon.ico, including explicit fetches. A fresh same-path query is
        // observable and avoids depending on the browser's favicon cache.
        // Compare its body with the canonical response, not just its status.
        const probeUrl = new URL(url, location.href);
        probeUrl.searchParams.set('_icon_probe', probeId);
        const probe = await fetch(probeUrl.href, { cache: 'no-store' });
        const probeBytes = new Uint8Array(await probe.arrayBuffer());
        return {
          url, status: response.status, mime: response.headers.get('content-type'),
          width: image.naturalWidth, height: image.naturalHeight, byteLength: bytes.length,
          probeUrl: probeUrl.href, probeStatus: probe.status, probeMime: probe.headers.get('content-type'),
          probeMatches: bytes.length === probeBytes.length && bytes.every((byte, index) => byte === probeBytes[index]),
        };
      } catch (error) {
        throw new Error(`Icon ${url}: HTTP fetch or image decode failed: ${error.message}`);
      }
    }));
  }, `${testInfo.project.name}-${Date.now()}`);
  const expectedSizes = {
    '/favicon-16x16.png': 16, '/favicon-32x32.png': 32, '/apple-touch-icon.png': 180,
    '/android-chrome-192x192.png': 192, '/android-chrome-512x512.png': 512,
  };
  for (const item of results) {
    const diagnostic = `Icon ${item.url}: ${JSON.stringify(item)}`;
    expect(item.status, diagnostic).toBe(200);
    expect(item.mime, diagnostic).toMatch(/^image\//);
    expect(new URL(item.url, baseURL).origin, diagnostic).toBe(baseURL);
    expect(item.byteLength, diagnostic).toBeGreaterThan(0);
    expect(item.width, diagnostic).toBeGreaterThan(0); expect(item.height, diagnostic).toBe(item.width);
    if (expectedSizes[item.url]) expect(item.width, diagnostic).toBe(expectedSizes[item.url]);
    expect(new URL(item.probeUrl).pathname, diagnostic).toBe(item.url);
    expect(new URL(item.probeUrl).origin, diagnostic).toBe(baseURL);
    expect(item.probeStatus, diagnostic).toBe(200);
    expect(item.probeMime, diagnostic).toBe(item.mime);
    expect(item.probeMatches, diagnostic).toBe(true);
    await expect.poll(() => ({ requested: requested.has(item.probeUrl), status: responded.get(item.probeUrl) }), {
      message: `${diagnostic}; the fresh HTTP probe must emit request and response events`,
    }).toEqual({ requested: true, status: 200 });
  }
  await expect.poll(() => requested.has(new URL('/site.webmanifest', baseURL).href), {
    message: 'The linked public manifest must be requested by the browser',
  }).toBe(true);
  expect(await page.evaluate(async () => navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0)).toBe(0);
});

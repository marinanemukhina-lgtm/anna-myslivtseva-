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

test('browsers request and decode SVG, ICO and Apple/Android PNG assets without private URLs', async ({ page, baseURL }) => {
  const requested = new Set();
  page.on('request', request => requested.add(new URL(request.url()).pathname));
  await page.goto('/diplomas');
  const results = await page.evaluate(async () => {
    const urls = ['/favicon.svg', '/favicon.ico', '/favicon-16x16.png', '/favicon-32x32.png', '/apple-touch-icon.png'];
    const manifest = await (await fetch(document.querySelector('link[rel="manifest"]').href)).json();
    urls.push(...manifest.icons.map(icon => icon.src));
    return Promise.all(urls.map(async url => {
      const response = await fetch(url);
      const image = new Image(); image.src = url; await image.decode();
      return { url, status: response.status, mime: response.headers.get('content-type'), width: image.naturalWidth, height: image.naturalHeight };
    }));
  });
  const expectedSizes = {
    '/favicon-16x16.png': 16, '/favicon-32x32.png': 32, '/apple-touch-icon.png': 180,
    '/android-chrome-192x192.png': 192, '/android-chrome-512x512.png': 512,
  };
  for (const item of results) {
    expect(item.status).toBe(200);
    expect(item.mime).toMatch(/^image\//);
    expect(new URL(item.url, baseURL).origin).toBe(baseURL);
    expect(item.width).toBeGreaterThan(0); expect(item.height).toBe(item.width);
    if (expectedSizes[item.url]) expect(item.width).toBe(expectedSizes[item.url]);
    expect(requested.has(item.url)).toBe(true);
  }
  expect(requested.has('/site.webmanifest')).toBe(true);
  expect(await page.evaluate(async () => navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0)).toBe(0);
});

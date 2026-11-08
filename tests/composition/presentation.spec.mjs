import { test, expect } from '@playwright/test';
import { initialContent } from '../../shared/content.mjs';
import { capture } from './capture.mjs';

// Public fields verified read-only on 2026-11-08. This is a pinned display snapshot,
// not a fetch from production and not a claim that the branch is deployed.
const phone = '+7 (908) 502-38-53';
const address = 'Ростов-на-Дону. Выезд на дом по предварительной записи.';
function publishedSnapshot() {
  const data = structuredClone(initialContent);
  Object.assign(data.profile, {
    name: 'Анна Мысливцева', role: 'Остеопат', phone, address,
    email: '', hours: '', socialUrl: '', socialLinks: {}, mapUrl: '', bookingUrl: '',
  });
  return data;
}

for (const reducedMotion of ['reduce', 'no-preference']) {
  test(`published-snapshot home and contact / motion ${reducedMotion}`, async ({ page, baseURL }, info) => {
    await page.emulateMedia({ reducedMotion });
    const errors = [], forbiddenRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    // All content is local fixture data; refuse writes, other APIs and external traffic.
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (!['GET', 'HEAD'].includes(request.method()) || url.origin !== new URL(baseURL).origin) {
        forbiddenRequests.push(`${request.method()} ${request.url()}`);
        return route.abort();
      }
      if (url.pathname === '/api/content') return route.fulfill({ json: publishedSnapshot() });
      if (url.pathname.startsWith('/api/')) {
        forbiddenRequests.push(`${request.method()} ${request.url()}`);
        return route.abort();
      }
      return route.continue();
    });
    await info.attach('published-snapshot-provenance', {
      body: JSON.stringify({
        verifiedOn: '2026-11-08', scope: 'Published public contact fields, read-only verification',
        phone, address, optionalContactFields: 'Unpublished / empty', services: 0, diplomas: 0,
        source: 'https://anna-myslivtseva.vercel.app/api/content',
        runtimeSource: 'Intercepted local fixture; no request to production',
      }, null, 2),
      contentType: 'application/json',
    });
    const routes = ['/', '/contact', ...([320, 390, 768].includes(page.viewportSize().width) ? ['/about', '/diplomas'] : [])];
    for (const path of routes) {
      await page.goto(path);
      const contact = page.locator(path === '/contact' ? '.contact-primary' : 'footer .contacts');
      await expect(contact.getByText(phone, { exact: true })).toBeVisible();
      await expect(page.locator(reducedMotion === 'reduce' ? '.motion-off' : '.motion-on')).toHaveCount(1);
      await expect(page.locator('a[href="tel:+79085023853"]')).toHaveCount(1);
      await expect(page.locator('a[href="sms:+79085023853"]')).toHaveCount(1);
      await expect(page.locator('form, input, textarea')).toHaveCount(0);
      await expect(page.locator('main .hours, main .social-links, main .contact-email')).toHaveCount(0);
      if (path === '/') {
        if (reducedMotion === 'reduce') expect(await page.locator('.hero-portrait-video').evaluate(video => video.paused)).toBe(true);
        else await expect(page.locator('.hero-portrait-video')).toHaveClass(/is-playing/);
      }
      await capture(page, info, `${path === '/' ? 'home' : path.slice(1)}-published-snapshot-${reducedMotion}`);
    }
    expect(errors).toEqual([]);
    expect(forbiddenRequests).toEqual([]);
  });
}

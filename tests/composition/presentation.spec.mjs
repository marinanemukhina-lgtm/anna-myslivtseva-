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
      const contact = page.locator(path === '/contact' ? 'main .contact-actions' : 'footer .contacts');
      await expect(contact).toHaveCount(1);
      await expect(contact.getByText(phone, { exact: true })).toBeVisible();
      await expect(page.locator(reducedMotion === 'reduce' ? '.motion-off' : '.motion-on')).toHaveCount(1);
      for (const href of ['tel:+79085023853', 'sms:+79085023853']) {
        const action = contact.locator(`a[href="${href}"]`);
        await expect(action).toHaveCount(1);
        await expect(action).toBeVisible();
      }
      await expect(contact.locator('a')).toHaveCount(2);
      if (path === '/contact') await expect(page.locator('footer a[href^="tel:"], footer a[href^="sms:"]')).toHaveCount(0);
      await expect(page.locator('form, input, textarea')).toHaveCount(0);
      await expect(page.locator('main, footer').locator('.hours, .social-links, .contact-email, .contact-map, a[href^="mailto:"]')).toHaveCount(0);
      if (path === '/') {
        if (reducedMotion === 'reduce') expect(await page.locator('.hero-portrait-video').evaluate(video => video.paused)).toBe(true);
        else await expect(page.locator('.hero-portrait-video')).toHaveClass(/is-playing/);
      }
      await capture(page, info, `${path === '/' ? 'home' : path.slice(1)}-published-snapshot-${reducedMotion}`);
      if (path === '/') {
        // The menu intentionally has its own contact links. Check its purpose and visibility separately.
        const panel = page.locator('.menu-panel');
        const trigger = page.getByRole('button', { name: 'Меню', exact: true });
        await expect(panel).toHaveAttribute('aria-hidden', 'true');
        await expect(panel).toHaveAttribute('inert', '');
        await trigger.click();
        await expect(panel).toHaveAttribute('aria-hidden', 'false');
        await expect(panel).not.toHaveAttribute('inert', '');
        const menuContacts = panel.locator('.contacts');
        const menuPhone = menuContacts.getByRole('link', { name: phone, exact: true });
        const menuSms = menuContacts.getByRole('link', { name: 'Написать SMS', exact: true });
        for (const [action, href] of [[menuPhone, 'tel:+79085023853'], [menuSms, 'sms:+79085023853']]) {
          await expect(action).toHaveCount(1);
          await expect(action).toBeVisible();
          await expect(action).toHaveAttribute('href', href);
        }
        await expect(menuContacts.locator('a')).toHaveCount(2);
        await expect(panel.locator('.hours, .social-links, .contact-email, .contact-map, a[href^="mailto:"]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(panel).toHaveAttribute('aria-hidden', 'true');
        await expect(panel).toHaveAttribute('inert', '');
        await expect(trigger).toBeFocused();
      }
    }
    expect(errors).toEqual([]);
    expect(forbiddenRequests).toEqual([]);
  });
}

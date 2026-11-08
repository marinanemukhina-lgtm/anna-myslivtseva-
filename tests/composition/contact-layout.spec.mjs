import { test, expect } from '@playwright/test';
import { initialContent } from '../../shared/content.mjs';

const address = 'Ростов-на-Дону. Выезд на дом по предварительной записи.';
const phone = '+7 (900) 000-00-01';
async function fixture(page, filled = false) {
  const data = structuredClone(initialContent);
  Object.assign(data.profile, { phone, address, socialLinks: {} });
  // Production-shaped is deliberately sparse. Rich data must not disguise empty composition.
  if (filled) Object.assign(data.profile, {
    email: 'anna@example.invalid', hours: 'Пн–Пт: 10:00–18:00\nПо предварительной записи',
    mapUrl: 'https://example.invalid/map', bookingUrl: 'https://example.invalid/booking',
    socialLinks: { telegram: 'https://t.me/synthetic_anna_channel', vk: 'https://vk.com/synthetic_anna' },
  });
  await page.route('**/api/content', route => route.fulfill({ json: data }));
  const errors = [], writes = [], intake = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url());
    if (/^\/api\/(contact|booking)\//.test(new URL(request.url()).pathname)) intake.push(request.url());
  });
  return { errors, writes, intake };
}
async function ready(page, path) {
  await page.goto(path);
  await expect(page.locator(path === '/contact' ? '.contact-primary' : 'footer .contacts').getByText(phone, { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.page-enter')).toHaveCSS('opacity', '1');
}
async function topIsVisible(page) {
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(2);
  const header = await page.locator('.site-header').boundingBox();
  const heading = await page.locator('#contact-title').boundingBox();
  expect(heading.y).toBeGreaterThanOrEqual(header.y + header.height + 12);
}
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  for (const selector of ['.site-header .brand', '.site-header .book-link', '.site-header .menu-trigger', '.contact-actions', '.footer-surface']) {
    const element = page.locator(selector);
    if (!(await element.count())) continue;
    const box = await element.boundingBox();
    expect(box.x, selector).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, selector).toBeLessThanOrEqual(page.viewportSize().width + 1);
    expect(await element.evaluate(el => el.scrollWidth <= el.clientWidth + 1), selector).toBe(true);
  }
  const items = await page.locator('.site-header > *').evaluateAll(elements => elements.map(el => el.getBoundingClientRect()).filter(r => r.width && r.height).sort((a,b) => a.x-b.x).map(r => ({ x:r.x, right:r.right })));
  for (let i=1; i<items.length; i++) expect(items[i].x).toBeGreaterThanOrEqual(items[i-1].right + 4);
}
async function capture(page, info, name) {
  for (const media of await page.locator('main img, main video:not([aria-hidden="true"])').all()) {
    if (!(await media.isVisible())) continue;
    await media.scrollIntoViewIfNeeded();
    await expect.poll(() => media.evaluate(el => el.tagName === 'IMG' ? el.complete && el.naturalWidth > 0 : el.readyState >= 1 && !el.error)).toBe(true);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: info.outputPath(`${name}-full.png`), fullPage: true });
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.screenshot({ path: info.outputPath(`${name}-bottom.png`) });
}

for (const reducedMotion of ['reduce', 'no-preference']) {
  for (const filled of [false, true]) {
    test(`contact ${filled ? 'synthetic-filled' : 'production-shaped-synthetic-phone'} / motion ${reducedMotion}`, async ({ page }, info) => {
      await page.emulateMedia({ reducedMotion });
      const observed = await fixture(page, filled);
      await ready(page, '/contact');
      await topIsVisible(page);
      await expect(page.locator(reducedMotion === 'reduce' ? '.motion-off' : '.motion-on')).toHaveCount(1);
      await noOverflow(page);
      await expect(page.locator('main h1')).toHaveCount(1);
      await expect(page.locator('.contact-intro')).toHaveCount(1);
      await expect(page.locator('.booking-section, .contact-section, .footer-marquee, footer .contacts, footer .footer-contact-link')).toHaveCount(0);
      await expect(page.locator('main')).not.toContainText('Онлайн-календарь');
      await expect(page.locator('.contact-visit')).toContainText(address);
      const call = page.locator('main a[href="tel:+79000000001"]');
      const sms = page.locator('main a[href="sms:+79000000001"]');
      for (const action of [call, sms]) {
        await expect(action).toHaveCount(1);
        expect((await action.boundingBox()).height).toBeGreaterThanOrEqual(44);
      }
      await expect(sms.locator('svg')).toHaveCount(1);
      await expect(sms).not.toContainText('↗');
      if (!filled) {
        await expect(page.locator('.contact-intro a')).toHaveCount(2);
        await expect(page.locator('main .hours, main .social-links, main .contact-email')).toHaveCount(0);
      } else {
        await expect(page.locator('main a[href="mailto:anna@example.invalid"]')).toBeVisible();
        await expect(page.locator('main .hours')).toContainText('Пн–Пт');
        await expect(page.locator('main .social-links a')).toHaveCount(2);
        await expect(page.locator('main a[href="https://example.invalid/map"]')).toBeVisible();
        await expect(page.locator('main a[href="https://example.invalid/booking"]')).toBeVisible();
      }
      const portrait = page.locator('.contact-portrait img');
      await expect(portrait).toBeVisible();
      await expect.poll(() => portrait.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
      const section = await page.locator('.contact-intro').boundingBox();
      const visit = await page.locator('.contact-visit').boundingBox();
      const footer = await page.locator('.footer-surface').boundingBox();
      expect(section.y + section.height - visit.y - visit.height).toBeLessThanOrEqual(58);
      expect(footer.y - section.y - section.height).toBeLessThanOrEqual(2);
      expect((await page.locator('footer').boundingBox()).height).toBeLessThan(page.viewportSize().width <= 700 ? 520 : 400);
      if (!filled) expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(page.viewportSize().width <= 700 ? 2100 : 1500);
      await call.focus();
      await page.keyboard.press('Tab');
      await expect(sms).toBeFocused();
      await expect(page.locator('form, input, textarea')).toHaveCount(0);
      for (const href of ['/diplomas','/privacy','/terms','/admin']) await expect(page.locator(`footer a[href="${href}"]`)).toHaveCount(1);
      await expect(page.locator('footer button')).toHaveText(`Анимация: ${reducedMotion === 'reduce' ? 'выкл.' : 'вкл.'}`);
      await capture(page, info, `contact-${filled ? 'synthetic-filled' : 'production-shaped-synthetic-phone'}-${reducedMotion}`);
      expect(observed).toEqual({ errors: [], writes: [], intake: [] });
    });
  }
  test(`production-shaped-synthetic-phone full home, bottom navigation, Back and Forward / motion ${reducedMotion}`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion });
    const observed = await fixture(page);
    await ready(page, '/');
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement.closest('main')))).toBe(true);
    await ready(page, '/');
    await expect(page.locator(reducedMotion === 'reduce' ? '.motion-off' : '.motion-on')).toHaveCount(1);
    await expect(page.locator('.hero-services, .home-next, .journal-links')).toHaveCount(0);
    const frame = await page.locator('.hero-portrait-frame').boundingBox();
    expect(frame.y).toBeGreaterThanOrEqual((await page.locator('.site-header').boundingBox()).height);
    expect(frame.y + frame.height).toBeLessThanOrEqual(page.viewportSize().height);
    await expect(page.locator('.hero-portrait-frame img')).toHaveCSS('object-fit', 'contain');
    await expect(page.locator('.portrait-motion-toggle')).toBeVisible();
    if (reducedMotion === 'reduce') expect(await page.locator('.hero-portrait-video').evaluate(video => video.paused)).toBe(true);
    else await expect(page.locator('.hero-portrait-video')).toHaveClass(/is-playing/);
    for (const selector of ['.hero-contact', '.hero-document-link']) {
      const box = await page.locator(selector).boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
    }
    // Hash changes are distinct history entries even when pathname stays '/'.
    await page.locator('.hero-scroll').click();
    await expect(page).toHaveURL(/\/#introduction$/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    const introScroll = await page.evaluate(() => window.scrollY);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(2);
    await page.goForward();
    await expect(page).toHaveURL(/\/#introduction$/);
    await expect.poll(() => page.evaluate(target => Math.abs(window.scrollY - target), introScroll)).toBeLessThan(5);
    await page.goBack();
    await expect(page.locator('footer .footer-contact-link')).toHaveCount(1);
    await noOverflow(page);
    await capture(page, info, `home-production-shaped-synthetic-phone-${reducedMotion}`);
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(page.viewportSize().height);
    await page.locator('.site-header .book-link').click();
    await expect(page).toHaveURL(/\/contact$/);
    await topIsVisible(page);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before - 5);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(before + 5);
    await page.goForward();
    await expect(page).toHaveURL(/\/contact$/);
    await topIsVisible(page);
    await page.goBack();
    await page.locator('.footer-contact-link').click();
    await expect(page).toHaveURL(/\/contact$/);
    await topIsVisible(page);
    // Repeated route changes must not complete an older smooth scroll on the new page.
    await page.locator('.site-header .brand').click();
    await page.locator('.site-header .book-link').click();
    await topIsVisible(page);
    const menu = page.getByRole('button', { name: 'Меню', exact: true });
    await menu.click();
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await page.locator('.site-header .book-link').click();
    await topIsVisible(page);
    await noOverflow(page);
    expect(observed).toEqual({ errors: [], writes: [], intake: [] });
  });
  test(`production-shaped-synthetic-phone services, about and diplomas / motion ${reducedMotion}`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion });
    const observed = await fixture(page);
    for (const path of ['/services', '/about', '/diplomas']) {
      await ready(page, path);
      await expect(page.locator('main h1')).toBeVisible();
      await noOverflow(page);
      if (path === '/services') {
        await expect(page.locator('main')).toContainText('Перечень услуг и цены скоро появятся.');
        await expect(page.locator('main video, .service-section')).toHaveCount(0);
        expect((await page.locator('main').boundingBox()).height).toBeLessThan(page.viewportSize().height);
      }
      if (path === '/diplomas') {
        await page.locator('a[href="/diplomas#documents"]').click();
        await expect(page).toHaveURL(/\/diplomas#documents$/);
        const y = await page.evaluate(() => window.scrollY);
        await page.goBack();
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(2);
        await page.goForward();
        await expect.poll(() => page.evaluate(target => Math.abs(window.scrollY - target), y)).toBeLessThan(5);
      }
      await capture(page, info, `${path.slice(1)}-production-shaped-synthetic-phone-${reducedMotion}`);
      await page.locator('footer .footer-contact-link').click();
      await topIsVisible(page);
    }
    // A cold hash target may not exist until CMS hydration completes.
    const delayed = structuredClone(initialContent);
    Object.assign(delayed.profile, { phone, address, socialLinks: {} });
    delayed.services = [{ id: 'synthetic-service', title: 'Тестовая услуга', body: 'Синтетическое описание для проверки навигации.', image: '', price: '', duration: '', category: '', published: true }];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/content', async route => {
      await gate;
      await route.fulfill({ json: delayed });
    });
    await page.goto('/services#services');
    await expect(page.locator('#services')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(2);
    release();
    await expect(page.locator('#services')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    await expect.poll(() => page.locator('#services').evaluate(element => Math.abs(element.getBoundingClientRect().top - parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)))).toBeLessThan(5);
    const anchor = await page.locator('#services').boundingBox();
    const header = await page.locator('.site-header').boundingBox();
    expect(anchor.y).toBeGreaterThanOrEqual(header.y + header.height);
    expect(observed).toEqual({ errors: [], writes: [], intake: [] });
  });

}

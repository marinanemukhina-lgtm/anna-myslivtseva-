import { test, expect } from '@playwright/test';

async function publishedPhone(page, phone) {
  // Browser-only synthetic content. No CMS writes or real calls/messages.
  await page.route('**/api/content', async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.profile.phone = phone;
    await route.fulfill({ response, json: data });
  });
}

function observeCollection(page) {
  const requests = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/contact/')) requests.push(request.url());
  });
  return requests;
}

async function noIntake(page, requests) {
  await expect(page.locator('form, input[type="tel"], #callback')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Оставить номер|Перезвоните/ })).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => sessionStorage.getItem('anna-callback-retry-v1'))).toBeNull();
}

for (const [width, height] of [[320, 740], [390, 844], [1440, 960]]) {
  test(`direct phone/SMS actions are visible and do not collect numbers at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    const requests = observeCollection(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await publishedPhone(page, '+7 (900) 000-00-01');
    await page.goto('/contact');
    const section = page.locator('.contact-intro');
    await expect(section).toHaveAttribute('aria-labelledby', 'contact-title');
    const call = section.getByRole('link', { name: /Позвонить Анне/ });
    const sms = section.getByRole('link', { name: 'Написать SMS' });
    await expect(call).toHaveAttribute('href', 'tel:+79000000001');
    await expect(sms).toHaveAttribute('href', 'sms:+79000000001');
    await expect(sms).not.toHaveAttribute('target');
    await expect(section).toContainText('Сообщение отправляете вы.');
    await expect(page.locator('.site-header')).toHaveClass(/scrolled/);
    await page.evaluate(() => document.fonts.ready);
    const portrait = section.locator('img');
    if (await portrait.isVisible()) await expect.poll(() => portrait.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    expect((await call.boundingBox()).y + (await call.boundingBox()).height).toBeLessThanOrEqual(height);
    expect((await sms.boundingBox()).y + (await sms.boundingBox()).height).toBeLessThanOrEqual(height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await call.focus();
    await expect(call).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(sms).toBeFocused();
    // Never activate tel:/sms: handlers in automated tests.
    await noIntake(page, requests);
    await page.screenshot({ path: testInfo.outputPath(`direct-contact-${width}-top.png`) });
    await section.screenshot({ path: testInfo.outputPath(`direct-contact-${width}-section.png`) });
    await page.goto('/services');
    await page.goBack();
    await expect(call).toHaveAttribute('href', 'tel:+79000000001');
    await page.reload();
    await expect(sms).toHaveAttribute('href', 'sms:+79000000001');
    await page.goto('/contact/');
    await expect(call).toHaveAttribute('href', 'tel:+79000000001');
    await expect(page.locator('.site-header')).toHaveClass(/scrolled/);
    await noIntake(page, requests);
    expect(errors).toEqual([]);
  });
}

test('new contact actions do not invent a phone or SMS destination for unavailable or landline values', async ({ page }) => {
  const requests = observeCollection(page);
  for (const phone of ['', 'javascript:+79000000000', '+7 (495) 000-00-00']) {
    await page.unroute('**/api/content');
    await publishedPhone(page, phone);
    await page.goto('/contact');
    const section = page.locator('.contact-intro');
    await expect(section).toBeVisible();
    if (phone.startsWith('+7')) {
      await expect(section.getByRole('link', { name: /Позвонить Анне/ })).toHaveAttribute('href', 'tel:+74950000000');
    } else {
      await expect(section).toContainText('Телефон для связи пока не опубликован.');
      await expect(section.locator('a')).toHaveCount(0);
    }
    await expect(section.getByRole('link', { name: 'Написать SMS' })).toHaveCount(0);
    await noIntake(page, requests);
  }
});

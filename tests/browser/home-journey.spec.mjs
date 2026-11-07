import { test, expect } from '@playwright/test';
import { initialContent } from '../../shared/content.mjs';

// Public response fixtures only; never save content or activate phone/SMS handlers.
async function content(page, address, services = []) {
  const data = structuredClone(initialContent);
  data.services = services;
  data.profile.address = address;
  data.profile.phone = address ? '+7 (900) 000-00-01' : '';
  await page.route('**/api/content', route => route.fulfill({ json: data }));
}

for (const [width, height] of [[320, 740], [390, 844], [1440, 960]]) {
  test(`first screen and contact journey at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const address = 'Ростов-на-Дону. Выезд на дом по предварительной записи';
    await content(page, address, [{ id: 'synthetic-service', title: 'Тестовая услуга', body: 'Только браузерный пример', image: '', category: '', duration: '', price: '1000 ₽', published: true }]);
    await page.goto('/');
    await expect(page.locator('.hero-location')).toHaveText(address);
    await page.evaluate(() => document.fonts.ready);
    for (const selector of ['.hero-contact', '.hero-services', '.hero-document-link']) {
      const link = page.locator(selector);
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(page.locator('.motion-off')).toHaveCount(1);
    expect(await page.locator('.hero-portrait-video').evaluate(video => video.paused)).toBe(true);
    await page.locator('.hero-contact').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('.hero-services')).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`) });
    await expect(page.locator('.hero-services')).toHaveText('Услуги и стоимость');
    await page.locator('.hero-services').click();
    await expect(page).toHaveURL(/\/services$/);
    await expect(page.getByRole('heading', { name: 'Тестовая услуга' })).toBeVisible();
    await expect(page.locator('.service-meta')).toContainText('1000 ₽');
    await page.goBack();
    await expect(page.locator('.hero-contact')).toBeVisible();
    await page.locator('.hero-contact').click();
    await expect(page.locator('.contact-intro a[href="tel:+79000000001"]')).toBeVisible();
    await expect(page.locator('.contact-intro a[href="sms:+79000000001"]')).toBeVisible();
    await expect(page.locator('form, input[type="tel"]')).toHaveCount(0);
    await page.goBack();
    const menu = page.getByRole('button', { name: 'Меню', exact: true });
    await menu.click();
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
    await menu.click();
    await page.getByRole('dialog', { name: 'Главное меню' }).getByRole('link', { name: /Дипломы/ }).click();
    await expect(page).toHaveURL(/\/diplomas$/);
    await page.goBack();
    await expect(page.locator('.hero-document-link')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Главное меню' })).not.toBeVisible();
  });
}

test('empty CMS fields do not invent a location or a contact destination', async ({ page }) => {
  await content(page, '');
  await page.goto('/');
  await expect(page.locator('.hero-location')).toHaveCount(0);
  await expect(page.locator('.hero-services')).toHaveCount(0);
  await expect(page.locator('.hero-contact')).toHaveAttribute('href', '/contact');
  await page.locator('.hero-contact').click();
  await expect(page.locator('.contact-intro')).toContainText('Телефон для связи пока не опубликован.');
  await expect(page.locator('.contact-intro a, form, input[type="tel"]')).toHaveCount(0);
});


test('published location with no services keeps contact and ordinary navigation', async ({ page }) => {
  await content(page, 'Ростов-на-Дону. Выезд на дом по предварительной записи');
  await page.goto('/');
  await expect(page.locator('.hero-location')).toBeVisible();
  await expect(page.locator('.hero-services')).toHaveCount(0);
  await expect(page.locator('.hero-contact')).toBeVisible();
  await expect(page.locator('.hero-document-link')).toBeVisible();
  await page.locator('.hero-chapters a[href="/services"]').click();
  await expect(page.getByText('Перечень услуг и цены скоро появятся.')).toBeVisible();
});

test('service without price does not promise a price in the hero action', async ({ page }) => {
  await content(page, 'Тестовый адрес', [{ id: 'synthetic-service', title: 'Тестовая услуга', body: '', image: '', category: '', duration: '', price: '  ', published: true }]);
  await page.goto('/');
  await expect(page.locator('.hero-services')).toHaveText('Услуги');
});

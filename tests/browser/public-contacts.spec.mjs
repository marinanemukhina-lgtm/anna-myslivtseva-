import { test, expect } from '@playwright/test';
import { initialContent } from '../../shared/content.mjs';

// Public content fixtures only. No CMS writes or real contact data.
async function showContact(page, profile) {
  const content = structuredClone(initialContent);
  Object.assign(content.profile, profile);
  await page.route('**/api/content', route => route.fulfill({ json: content }));
  await page.goto('/contact');
  await expect(page.getByRole('heading', { name: /Связаться.*Анной/ })).toBeVisible();
  await expect(page.locator('.booking-unavailable')).toContainText(/Онлайн-(?:запись|календарь) пока не открыт/);
}

test('empty contact details and hours do not leave public columns', async ({ page }) => {
  await showContact(page, { address: ' ', mapUrl: '', phone: '\n', email: '\t', socialUrl: '', hours: ' \n ' });
  await expect(page.locator('.contact-section .contacts')).toHaveCount(0);
  await expect(page.locator('.footer .contacts, .footer .hours')).toHaveCount(0);
  await expect(page.locator('.footer-contact-note')).toBeVisible();
  await expect(page.locator('.footer-grid')).toHaveClass('footer-grid single-column');
  await expect(page.locator('form')).toHaveCount(0);
});

test('one contact stays actionable without blank fields in page, footer and menu', async ({ page }, testInfo) => {
  await showContact(page, { phone: ' +000 ', hours: '' });
  for (const selector of ['.contact-section .contacts', '.footer .contacts']) {
    const contacts = page.locator(selector);
    await expect(contacts.locator(':scope > div')).toHaveCount(1);
    await expect(contacts.getByRole('link', { name: '+000', exact: true })).toHaveAttribute('href', 'tel:+000');
    await expect(contacts).not.toContainText('—');
    await expect(contacts.locator('br')).toHaveCount(0);
  }
  const columns = await page.locator('.footer-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns);
  expect(columns.trim().split(/\s+/)).toHaveLength(1);
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Главное меню' });
  await expect(menu.locator('.contacts > div')).toHaveCount(1);
  await expect(menu.getByRole('link', { name: '+000', exact: true })).toHaveAttribute('href', 'tel:+000');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Меню', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('sparse-public-contacts.png'), fullPage: true });
});

test('standalone map and all supplied contact details remain visible', async ({ page }) => {
  await showContact(page, { mapUrl: 'https://example.invalid/map' });
  await expect(page.locator('.contact-section .contacts > div')).toHaveCount(1);
  await expect(page.locator('.contact-section').getByRole('link', { name: 'Как добраться' })).toHaveAttribute('href', 'https://example.invalid/map');
  await expect(page.locator('.footer-contact-note')).toHaveCount(0);
  await page.unroute('**/api/content');
  await showContact(page, {
    address: 'Synthetic address', mapUrl: 'https://example.invalid/map',
    phone: '+000', email: 'test@example.invalid', socialUrl: 'https://example.invalid/social',
    hours: 'Synthetic hours', bookingUrl: 'https://example.invalid/book',
  });
  const contacts = page.locator('.contact-section .contacts');
  await expect(contacts.locator(':scope > div')).toHaveCount(3);
  await expect(contacts).toContainText('Synthetic address');
  for (const href of ['tel:+000', 'mailto:test@example.invalid', 'https://example.invalid/map', 'https://example.invalid/social']) {
    await expect(contacts.locator(`a[href="${href}"]`)).toHaveCount(1);
  }
  await expect(page.locator('.footer .hours')).toContainText('Synthetic hours');
  await expect(page.locator('.contact-section a[href="https://example.invalid/book"]')).toBeVisible();
  await expect(page.locator('form')).toHaveCount(0);
});

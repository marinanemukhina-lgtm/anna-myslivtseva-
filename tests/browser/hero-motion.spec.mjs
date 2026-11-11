import { test, expect } from '@playwright/test';
import { initialContent } from '../../shared/content.mjs';

test.use({ reducedMotion: 'no-preference' });

test('motion preference never substitutes the old portrait for the approved petrol photograph', async ({ page }) => {
  const legacyRequests = [];
  page.on('request', request => {
    if (request.url().includes('anna-portrait-calm.mp4')) legacyRequests.push(request.url());
  });
  await page.route('**/api/content', route => route.fulfill({ json: initialContent }));
  await page.route('**/api/contact/config', route => route.fulfill({ json: { enabled: false } }));
  await page.goto('/');
  const stage = page.locator('.hero-portrait-stage');
  const image = stage.locator('img');
  await expect(image).toHaveAttribute('src', '/media/anna-hero-petrol-clean-v1.png');
  await expect(image).toHaveJSProperty('complete', true);
  await expect(stage.locator('video')).toHaveCount(0);
  await expect(stage.getByRole('button')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(image).toHaveAttribute('src', '/media/anna-hero-petrol-clean-v1.png');
  await expect(image).toBeVisible();
  expect(legacyRequests).toEqual([]);
});

test('published custom portrait remains authoritative without the default video', async ({ page }) => {
  const content = structuredClone(initialContent);
  content.profile.heroPortrait = '/media/anna-portrait-smile.png';
  await page.route('**/api/content', route => route.fulfill({ json: content }));
  await page.route('**/api/contact/config', route => route.fulfill({ json: { enabled: false } }));
  await page.goto('/');
  const stage = page.locator('.hero-portrait-stage');
  await expect(stage.locator('img')).toHaveAttribute('src', content.profile.heroPortrait);
  await expect(stage.locator('video')).toHaveCount(0);
  await expect(stage.getByRole('button')).toHaveCount(0);
});

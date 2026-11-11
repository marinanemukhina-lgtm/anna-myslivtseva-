import { test, expect } from '@playwright/test';
import { initialContent } from '../../shared/content.mjs';

test.use({ reducedMotion: 'no-preference' });

test('default hero keeps the live portrait, pause and a static fallback', async ({ page }) => {
  await page.route('**/api/content', route => route.fulfill({ json: initialContent }));
  await page.route('**/api/contact/config', route => route.fulfill({ json: { enabled: false } }));
  await page.goto('/');
  const stage = page.locator('.hero-portrait-stage');
  const image = stage.locator('img');
  const video = stage.locator('video');
  await expect(image).toHaveAttribute('src', '/media/anna-hero-petrol-clean-v1.png');
  await expect(video).toHaveAttribute('src', '/media/anna-portrait-calm.mp4');
  await expect(video).toHaveAttribute('poster', '/media/anna-portrait-smile.png');
  const pause = stage.getByRole('button', { name: 'Остановить анимацию портрета' });
  await expect(pause).toBeVisible();
  await pause.click();
  await expect(stage.getByRole('button', { name: 'Включить анимацию портрета' })).toBeVisible();
  await video.dispatchEvent('error');
  await expect(video).toHaveCount(0);
  await expect(stage.getByRole('button')).toHaveCount(0);
  await expect(image).toBeVisible();
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

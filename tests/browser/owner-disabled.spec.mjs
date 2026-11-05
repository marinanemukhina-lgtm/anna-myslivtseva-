import { test, expect } from '@playwright/test';
import { OWNER_HANDOFF_ACTIVE } from '../../shared/owner-handoff-mode.mjs';
test.skip(OWNER_HANDOFF_ACTIVE, 'Disabled UI behavior belongs to the disabled source release.');

test('disabled release never requests or displays the invitation flow', async ({ page }) => {
  const ownerRequests = [];
  page.on('request', request => {
    if (/owner-(handoff|invitation)/.test(request.url())) ownerRequests.push(request.url());
  });
  const response = await page.goto('/admin/claim');
  expect(response.status()).toBe(404);
  await expect(page.getByLabel('Код приглашения', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Доступ владельца', { exact: true })).toHaveCount(0);
  await page.goto('/admin/setup');
  await expect(page.getByRole('heading', { name: 'Подготовка пароля', exact: true })).toBeVisible();
  await expect(page.getByText(/Если сайт уже передан владельцу через одноразовое приглашение/)).toHaveCount(0);
  expect(ownerRequests).toEqual([]);
});

import { test, expect } from '@playwright/test';

test('published isolated demo completes booking and closes stale sources without sending patient data', async ({ page }) => {
  const writes = [], errors = [];
  page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/demo/booking');
  await expect(page.getByRole('heading', { name: 'Проверяем запись' })).toBeVisible();
  await page.getByRole('button', { name: 'Обновить свободное время' }).click();
  await page.getByRole('button', { name: '09:00', exact: true }).click();
  await page.getByRole('button', { name: 'Зарезервировать на 5 минут' }).click();
  await expect(page.getByRole('heading', { name: 'Время зарезервировано' })).toBeVisible();
  await page.getByRole('button', { name: 'Подтвердить демо-запись' }).click();
  await expect(page.getByRole('heading', { name: 'Демо-запись подтверждена' })).toBeVisible();
  await page.getByRole('button', { name: 'Отменить демо-запись' }).click();
  await expect(page.getByRole('heading', { name: 'Демо-запись отменена' })).toBeVisible();
  for (const mode of ['stale', 'incomplete']) {
    await page.getByLabel('Состояние источника').selectOption(mode);
    await page.getByRole('button', { name: 'Обновить свободное время' }).click();
    await expect(page.getByRole('status')).toContainText('Актуальность занятости не подтверждена');
    await expect(page.getByRole('button', { name: '09:00', exact: true })).toHaveCount(0);
  }
  expect(writes).toEqual([]); expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

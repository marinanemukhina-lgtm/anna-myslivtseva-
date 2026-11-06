import { test, expect } from '@playwright/test';

test('service, reserve, confirm, cancel; responsive page and stale/incomplete source', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/booking-demo.html');
  const refresh = page.getByRole('button', { name: 'Обновить свободное время' });
  await expect(refresh).toBeEnabled();
  await page.getByLabel('Услуга', { exact: true }).selectOption('demo-30');
  await refresh.click();
  const slot = page.getByRole('button', { name: '09:00', exact: true });
  await slot.click();
  await page.getByRole('button', { name: 'Зарезервировать на 5 минут' }).click();
  await expect(page.getByRole('heading', { name: 'Время зарезервировано' })).toBeVisible();
  await page.getByRole('button', { name: 'Подтвердить демо-запись' }).click();
  await expect(page.getByRole('heading', { name: 'Демо-запись подтверждена' })).toBeVisible();
  await page.screenshot({ path: `.qa/demo-browser/confirmed-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Отменить демо-запись' }).click();
  await expect(page.getByRole('heading', { name: 'Демо-запись отменена' })).toBeVisible();
  await refresh.click(); await expect(slot).toBeVisible();
  for (const mode of ['stale','incomplete']) {
    await page.getByLabel('Состояние источника').selectOption(mode);
    await expect(refresh).toBeEnabled(); await refresh.click();
    await expect(page.getByRole('status')).toContainText('Актуальность занятости не подтверждена');
    await expect(page.getByRole('group', { name: 'Свободное время' })).toHaveCount(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('lost reservation response retries the same operation key', async ({ page }) => {
  await page.goto('/booking-demo.html');
  await page.getByRole('button', { name: 'Обновить свободное время' }).click();
  await page.getByRole('button', { name: '10:30', exact: true }).click();
  const keys = []; let lose = true;
  await page.route('**/api/demo/booking/reserve', async route => {
    keys.push(route.request().postDataJSON().operationKey);
    const response = await route.fetch();
    if (lose) { lose = false; await route.abort(); } else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Зарезервировать на 5 минут' }).click();
  await expect(page.getByLabel('Услуга', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Повторить тот же запрос' }).click();
  await expect(page.getByRole('heading', { name: 'Время зарезервировано' })).toBeVisible();
  expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
  await page.getByRole('button', { name: 'Отменить демо-запись' }).click();
});

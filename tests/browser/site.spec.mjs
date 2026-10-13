import { test, expect } from '@playwright/test';

test('public routes, local media, menu and responsive layout', async ({ page }, testInfo) => {
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  for (const path of ['/', '/diplomas', '/services', '/about', '/news', '/offers', '/contact', '/privacy', '/terms']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${path.replaceAll('/', '') || 'home'}.png`), fullPage: true });
    if (path === '/') {
      await page.getByRole('button', { name: 'Меню', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Главное меню' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Меню', exact: true })).toBeFocused();
      await page.getByRole('button', { name: 'Меню', exact: true }).click();
      await page.getByRole('dialog', { name: 'Главное меню' }).getByRole('link', { name: /Дипломы/ }).click();
      await expect(page).toHaveURL(/\/diplomas$/);
      await page.goBack();
      await expect(page).toHaveURL(/\/$/);
      for (const image of await page.locator('img').all()) {
        // Responsive layouts intentionally hide the desktop-only media.
        if (!(await image.isVisible())) continue;
        await image.scrollIntoViewIfNeeded();
        await expect.poll(() => image.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
      }
    }
  }
  expect(failures).toEqual([]);
});

test('admin keeps newer edits during save and persists them after the next save', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'one isolated stateful CMS run');
  await page.goto('/admin');
  await page.getByLabel('Пароль', { exact: true }).fill('browser-fixture-only-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const field = page.getByLabel('Специализация', { exact: true });
  await expect(field).toBeVisible();
  const original = await field.inputValue();
  await field.fill('Первая тестовая правка');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let started;
  const requestStarted = new Promise(resolve => { started = resolve; });
  await page.route('**/api/admin/content', async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response });
  });
  await page.locator('.admin-topbar').getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await requestStarted;
  await field.fill('Новая правка во время сохранения');
  release();
  await expect(page.getByRole('status')).toContainText('Новые правки ещё не сохранены');
  await expect(field).toHaveValue('Новая правка во время сохранения');
  await page.unroute('**/api/admin/content');
  await page.locator('.admin-topbar').getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Сохранено.');
  await page.reload();
  await expect(field).toHaveValue('Новая правка во время сохранения');
  await field.fill(original);
  await page.locator('.admin-topbar').getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Сохранено.');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
});

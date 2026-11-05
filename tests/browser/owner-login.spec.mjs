import { test, expect } from '@playwright/test';

// Existing synthetic password from scripts/qa-server.mjs, never a real secret.
const password = 'browser-fixture-only-password';
const calendar = page => page.getByRole('button', { name: 'Календарь и запись', exact: true });
const ownerEntry = page => page.getByRole('button', { name: 'Вход владельца', exact: true });
const ownerForm = page => page.getByRole('form', { name: 'Вход владельца', exact: true });

async function temporaryEditor({ page, request, baseURL }, options = {}) {
  // Read the fixture using a separate authenticated API context. The browser
  // remains anonymous. Only temporary content access is simulated below;
  // password POSTs, session verification and protected booking APIs stay real.
  const headers = { origin: baseURL, "Content-Type": "application/json" };
  expect((await request.post('/api/session', { headers, data: { password } })).ok()).toBe(true);
  const response = await request.get('/api/admin/content');
  expect(response.ok()).toBe(true);
  const original = await response.json();
  expect((await request.delete('/api/session', { headers })).ok()).toBe(true);
  const { bookingSchedule, bookingOccupancy, ...content } = original.data;
  const state = { temporary: true, ...options };
  await page.route('**/api/session', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const session = await response.json();
    await route.fulfill({ response, json: {
      ...session,
      temporaryContentAccess: state.temporary,
      ...(state.configured === undefined ? {} : { configured: state.configured }),
    } });
  });
  await page.route('**/api/admin/content', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    if (response.status() !== 401 || !state.temporary) return route.fulfill({ response });
    await route.fulfill({ status: 200, json: { ...original, data: content } });
  });
  await page.goto('/admin');
  await expect(ownerEntry(page)).toBeVisible();
  await expect(page.getByLabel('Специализация', { exact: true })).toBeVisible();
  await expect(calendar(page)).toHaveCount(0);
  expect((await page.request.get('/api/admin/booking')).status()).toBe(401);
  return { state, original, headers };
}

async function login(page) {
  await ownerEntry(page).click();
  await ownerForm(page).getByLabel('Пароль', { exact: true }).fill(password);
  await ownerForm(page).getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(calendar(page)).toBeVisible();
  await expect(ownerForm(page)).toHaveCount(0);
}

test('owner password opens the protected calendar without losing the content draft', async ({ page, request, baseURL }, testInfo) => {
  const fixtures = { page, request, baseURL };
  await temporaryEditor(fixtures);
  const role = page.getByLabel('Специализация', { exact: true });
  await role.fill('Несохранённая правка владельца');
  await login(page);
  await expect(role).toHaveValue('Несохранённая правка владельца');
  await expect(page.locator('.admin-topbar')).toContainText('Есть несохранённые изменения');
  expect((await (await page.request.get('/api/session')).json()).authenticated).toBe(true);
  expect((await page.request.get('/api/admin/booking')).status()).toBe(200);
  await calendar(page).click();
  await expect(page.getByLabel('Часовой пояс', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'О себе и сайт', exact: true }).click();
  await expect(role).toHaveValue('Несохранённая правка владельца');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('owner-authenticated.png'), fullPage: true });
});

test('wrong password leaves calendar locked and cancellation clears only the login fields', async ({ page, request, baseURL }) => {
  const fixtures = { page, request, baseURL };
  await temporaryEditor(fixtures);
  await page.getByLabel('Специализация', { exact: true }).fill('Сохранить эту правку');
  await ownerEntry(page).click();
  await ownerForm(page).getByLabel('Пароль', { exact: true }).fill('incorrect-synthetic-password');
  await ownerForm(page).getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(ownerForm(page).getByRole('alert')).toHaveText('Неверный пароль.');
  await expect(calendar(page)).toHaveCount(0);
  expect((await (await page.request.get('/api/session')).json()).authenticated).toBe(false);
  expect((await page.request.get('/api/admin/booking')).status()).toBe(401);
  await ownerForm(page).getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(ownerForm(page)).toHaveCount(0);
  await expect(ownerEntry(page)).toBeFocused();
  await expect(page.getByLabel('Специализация', { exact: true })).toHaveValue('Сохранить эту правку');
  await ownerEntry(page).click();
  await expect(ownerForm(page).getByLabel('Пароль', { exact: true })).toHaveValue('');
  await expect(ownerForm(page).getByRole('alert')).toHaveCount(0);
});

test('open, Escape, Cancel and browser Back/Forward create no owner-login URL or session', async ({ page, request, baseURL }) => {
  const fixtures = { page, request, baseURL };
  await page.goto('/');
  await temporaryEditor(fixtures);
  const historyLength = await page.evaluate(() => history.length);
  await ownerEntry(page).dblclick();
  await expect(ownerForm(page)).toHaveCount(1);
  await ownerForm(page).getByLabel('Пароль', { exact: true }).fill(password);
  await page.keyboard.press('Escape');
  await expect(ownerForm(page)).toHaveCount(0);
  await expect(ownerEntry(page)).toBeFocused();
  await ownerEntry(page).click();
  await expect(ownerForm(page).getByLabel('Пароль', { exact: true })).toHaveValue('');
  await ownerForm(page).getByRole('button', { name: 'Отмена', exact: true }).click();
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await expect(page).toHaveURL(/\/admin$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(ownerEntry(page)).toBeVisible();
  await expect(ownerForm(page)).toHaveCount(0);
  await expect(calendar(page)).toHaveCount(0);
  expect((await (await page.request.get('/api/session')).json()).authenticated).toBe(false);
});

test('same-turn duplicate submits send one password request and keep calendar locked while pending', async ({ page, request, baseURL }) => {
  const fixtures = { page, request, baseURL };
  await temporaryEditor(fixtures);
  let submissions = 0;
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { started = resolve; });
  await page.route('**/api/session', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    submissions++;
    started();
    await gate;
    await route.continue();
  });
  await ownerEntry(page).click();
  await ownerForm(page).getByLabel('Пароль', { exact: true }).fill(password);
  await ownerForm(page).evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  await requested;
  await expect(ownerForm(page).getByRole('button', { name: 'Входим…', exact: true })).toBeDisabled();
  await expect(ownerForm(page).getByRole('button', { name: 'Отмена', exact: true })).toBeDisabled();
  await expect(calendar(page)).toHaveCount(0);
  await page.getByLabel('Специализация', { exact: true }).fill('Правка во время входа');
  expect(submissions).toBe(1);
  release();
  await expect(calendar(page)).toBeVisible();
  await expect(page.getByLabel('Специализация', { exact: true })).toHaveValue('Правка во время входа');
  expect(submissions).toBe(1);
});

test('unconfigured owner access is honest and never offers a working password or calendar', async ({ page, request, baseURL }) => {
  const fixtures = { page, request, baseURL };
  await temporaryEditor(fixtures, { configured: false });
  const posts = [];
  page.on('request', request => { if (request.url().endsWith('/api/session') && request.method() === 'POST') posts.push(request); });
  await ownerEntry(page).click();
  await expect(ownerForm(page)).toContainText('Защищённый вход ещё не настроен');
  await expect(ownerForm(page).getByLabel('Пароль', { exact: true })).toHaveCount(0);
  await expect(ownerForm(page).getByRole('button', { name: 'Войти', exact: true })).toHaveCount(0);
  await expect(calendar(page)).toHaveCount(0);
  await ownerForm(page).getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByLabel('Специализация', { exact: true })).toBeVisible();
  expect(posts).toEqual([]);
});

test('failed password request is retryable without discarding the draft', async ({ page, request, baseURL }) => {
  const fixtures = { page, request, baseURL };
  await temporaryEditor(fixtures);
  let fail = true;
  await page.route('**/api/session', route => {
    if (route.request().method() !== 'POST' || !fail) return route.fallback();
    fail = false;
    return route.fulfill({ status: 503, json: { error: 'Сервис временно недоступен.' } });
  });
  await page.getByLabel('Специализация', { exact: true }).fill('Правка до ошибки');
  await ownerEntry(page).click();
  await ownerForm(page).getByLabel('Пароль', { exact: true }).fill(password);
  await ownerForm(page).getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(ownerForm(page).getByRole('alert')).toHaveText('Сервис временно недоступен.');
  await expect(calendar(page)).toHaveCount(0);
  await expect(ownerForm(page).getByRole('button', { name: 'Отмена', exact: true })).toBeEnabled();
  await ownerForm(page).getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(calendar(page)).toBeVisible();
  await expect(page.getByLabel('Специализация', { exact: true })).toHaveValue('Правка до ошибки');
});

test('logout returns to the current temporary editor and respects cancelled draft loss', async ({ page, request, baseURL }) => {
  const fixtures = { page, request, baseURL };
  const { original } = await temporaryEditor(fixtures);
  await login(page);
  await page.getByLabel('Специализация', { exact: true }).fill('Не терять без согласия');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(calendar(page)).toBeVisible();
  await expect(page.getByLabel('Специализация', { exact: true })).toHaveValue('Не терять без согласия');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(ownerEntry(page)).toBeVisible();
  await expect(calendar(page)).toHaveCount(0);
  await expect(page.getByLabel('Специализация', { exact: true })).toHaveValue(original.data.profile.role);
  expect((await page.request.get('/api/admin/booking')).status()).toBe(401);
  expect((await (await page.request.get('/api/session')).json()).authenticated).toBe(false);
});

test('logout rechecks temporary access instead of assuming it is still open', async ({ page, request, baseURL }) => {
  const fixtures = { page, request, baseURL };
  const { state } = await temporaryEditor(fixtures);
  await login(page);
  await calendar(page).click();
  await expect(page.getByLabel('Часовой пояс', { exact: true })).toBeVisible();
  state.temporary = false;
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Вход.', exact: true })).toBeVisible();
  await expect(page.getByLabel('Пароль', { exact: true })).toHaveValue('');
  await expect(calendar(page)).toHaveCount(0);
  await expect(page.getByLabel('Часовой пояс', { exact: true })).toHaveCount(0);
  await expect(ownerEntry(page)).toHaveCount(0);
});

test('uncertain logout hides private data and does not falsely claim the session ended', async ({ page, request, baseURL }) => {
  const fixtures = { page, request, baseURL };
  await temporaryEditor(fixtures);
  await login(page);
  await calendar(page).click();
  await expect(page.getByLabel('Часовой пояс', { exact: true })).toBeVisible();
  await page.route('**/api/session', route => route.request().method() === 'DELETE' ? route.abort() : route.fallback());
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Не удалось подтвердить выход. Обновите страницу и проверьте сеанс.');
  await expect(calendar(page)).toHaveCount(0);
  await expect(page.getByLabel('Часовой пояс', { exact: true })).toHaveCount(0);
  expect((await (await page.request.get('/api/session')).json()).authenticated).toBe(true);
});

test('successful POST without a verified session still cannot reveal the calendar', async ({ page, request, baseURL }) => {
  const fixtures = { page, request, baseURL };
  await temporaryEditor(fixtures);
  await page.route('**/api/session', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    // Simulate a browser that did not retain the cookie. Verification must use
    // the real anonymous GET response, never configured:true or POST alone.
    const headers = response.headers();
    delete headers['set-cookie'];
    await page.context().clearCookies();
    await route.fulfill({ response, headers });
  });
  await ownerEntry(page).click();
  await ownerForm(page).getByLabel('Пароль', { exact: true }).fill(password);
  await ownerForm(page).getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(ownerForm(page).getByRole('alert')).toContainText('Не удалось подтвердить вход');
  await expect(calendar(page)).toHaveCount(0);
  expect((await page.request.get('/api/admin/booking')).status()).toBe(401);
  await expect(ownerForm(page).getByLabel('Пароль', { exact: true })).toHaveValue('');
});

test('owner login never rebases an old draft onto a newer server version', async ({ page, request, baseURL }) => {
  const fixtures = { page, request, baseURL };
  const { original, headers } = await temporaryEditor(fixtures);
  await page.getByLabel('Специализация', { exact: true }).fill('Мой старый черновик');
  expect((await request.post('/api/session', { headers, data: { password } })).ok()).toBe(true);
  try {
    const external = structuredClone(original);
    external.data.profile.role = 'Более свежая правка другого редактора';
    expect((await request.put('/api/admin/content', { headers, data: external })).ok()).toBe(true);
    await login(page);
    const submitted = page.waitForRequest(request => request.url().endsWith('/api/admin/content') && request.method() === 'PUT');
    const rejected = page.waitForResponse(response => response.url().endsWith('/api/admin/content') && response.request().method() === 'PUT');
    await page.locator('.admin-topbar').getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
    expect((await submitted).postDataJSON().version).toBe(original.version);
    expect((await rejected).status()).toBe(409);
    await expect(page.getByLabel('Специализация', { exact: true })).toHaveValue('Мой старый черновик');
    const saved = await (await request.get('/api/admin/content')).json();
    expect(saved.data.profile.role).toBe(external.data.profile.role);
  } finally {
    const current = await (await request.get('/api/admin/content')).json();
    expect((await request.put('/api/admin/content', { headers, data: { version: current.version, data: original.data } })).ok()).toBe(true);
    await request.delete('/api/session', { headers });
  }
});

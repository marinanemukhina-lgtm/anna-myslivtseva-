import { test as base, expect } from '@playwright/test';

const freshSettings = () => ({ timezone: '', services: [], weeklyHours: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }, overrides: [], slotStepMinutes: 15, minNoticeMinutes: 0, horizonDays: 60 });
const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const service = { id: 'browser-schedule-fixture', title: 'Синтетическая услуга QA', body: '', image: '', published: false, price: '', duration: '', category: '' };
const test = base.extend({
  prepared: async ({ page, baseURL }, use) => {
    await page.goto('/admin');
    await page.getByLabel('Пароль', { exact: true }).fill('browser-fixture-only-password');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByLabel('Специализация', { exact: true })).toBeVisible();
    const get = async url => { const response = await page.request.get(url); expect(response.ok()).toBe(true); return response.json(); };
    const put = async (url, data) => page.request.put(url, { headers: { origin: baseURL }, data });
    const original = await get('/api/admin/content');
    const oldSchedule = await get('/api/admin/booking');
    const next = structuredClone(original); next.data.services.push(service);
    expect((await put('/api/admin/content', next)).ok()).toBe(true);
    let current = await get('/api/admin/booking');
    expect((await put('/api/admin/booking', { version: current.version, settings: freshSettings() })).ok()).toBe(true);
    await page.reload();
    try { await use({ get, put }); }
    finally {
      current = await get('/api/admin/booking');
      await put('/api/admin/booking', { version: current.version, settings: oldSchedule.settings });
      current = await get('/api/admin/content');
      await put('/api/admin/content', { version: current.version, data: original.data });
    }
  },
});
async function openCalendar(page) {
  await page.getByRole('button', { name: 'Календарь и запись', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Календарь и запись', exact: true })).toBeVisible();
  await expect(page.getByLabel('Часовой пояс', { exact: true })).toBeVisible();
}

test('schedule saves chosen days, previews only allowed times and survives reload', async ({ page, prepared }, testInfo) => {
  await openCalendar(page);
  await expect(page.getByLabel('Часовой пояс', { exact: true })).toHaveValue('');
  await page.getByLabel('Часовой пояс', { exact: true }).fill('Europe/Moscow');
  await page.getByLabel(`Длительность: ${service.title}`, { exact: true }).fill('45');
  await page.getByLabel(`Перерыв после: ${service.title}`, { exact: true }).fill('15');
  await page.getByLabel('Включить в расписание', { exact: true }).check();
  await page.getByRole('button', { name: 'Добавить интервал: Понедельник', exact: true }).click();
  await page.getByLabel('Понедельник: начало 1', { exact: true }).fill('09:00');
  await page.getByLabel('Понедельник: конец 1', { exact: true }).fill('11:00');
  const date = tomorrow();
  await page.getByLabel('Выбранная дата', { exact: true }).fill(date);
  await page.getByLabel('Режим дня', { exact: true }).selectOption('custom');
  await page.getByRole('button', { name: `Добавить интервал: Приём ${date}`, exact: true }).click();
  await page.getByLabel(`Приём ${date}: начало 1`, { exact: true }).fill('10:00');
  await page.getByLabel(`Приём ${date}: конец 1`, { exact: true }).fill('12:00');
  let writes = 0;
  page.on('request', request => { if (request.method() === 'PUT' && request.url().endsWith('/api/admin/booking')) writes++; });
  await page.getByRole('button', { name: 'Сохранить расписание', exact: true }).evaluate(button => { button.click(); button.click(); });
  await expect(page.getByRole('status')).toContainText('Расписание сохранено');
  expect(writes).toBe(1);
  await page.getByLabel('Услуга для проверки', { exact: true }).selectOption(service.id);
  await expect(page.locator('.calendar-preview-slots li')).toHaveCount(5);
  await expect(page.locator('.calendar-preview')).toContainText('время не бронируется');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('calendar-preparation.png'), fullPage: true });
  await page.reload(); await openCalendar(page);
  await expect(page.getByLabel('Часовой пояс', { exact: true })).toHaveValue('Europe/Moscow');
  await expect(page.getByLabel('Понедельник: начало 1', { exact: true })).toHaveValue('09:00');
  await expect(page.getByLabel('Понедельник: конец 1', { exact: true })).toHaveValue('11:00');
  await page.getByLabel('Выбранная дата', { exact: true }).fill(date);
  await expect(page.getByLabel('Режим дня', { exact: true })).toHaveValue('custom');
  await page.getByLabel('Режим дня', { exact: true }).selectOption('closed');
  await page.getByRole('button', { name: 'Сохранить расписание', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Расписание сохранено');
  await page.getByLabel('Услуга для проверки', { exact: true }).selectOption(service.id);
  await expect(page.locator('.calendar-preview')).toContainText('нет доступных интервалов');
  const config = await prepared.get('/api/booking/config');
  expect(config.enabled).toBe(false); expect(config.ready).toBe(false);
});

test('unchecking an unconfigured service allows other schedule edits to save', async ({ page, prepared }) => {
  await openCalendar(page);
  await page.getByLabel('Включить в расписание', { exact: true }).check();
  await page.getByLabel('Включить в расписание', { exact: true }).uncheck();
  await page.getByLabel('Часовой пояс', { exact: true }).fill('Europe/Moscow');
  await page.getByRole('button', { name: 'Добавить интервал: Понедельник', exact: true }).click();
  await page.getByLabel('Понедельник: начало 1', { exact: true }).fill('23:00');
  await page.getByLabel('До конца дня (24:00): Понедельник, интервал 1', { exact: true }).check();
  await page.getByRole('button', { name: 'Сохранить расписание', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Расписание сохранено');
  const saved = await prepared.get('/api/admin/booking');
  expect(saved.settings.services).toEqual([]);
  expect(saved.settings.weeklyHours['1']).toEqual([{ start: '23:00', end: '24:00' }]);
});

test('own schedule save preserves unsaved profile edits and safe shared version', async ({ page, prepared }) => {
  const role = page.getByLabel('Специализация', { exact: true });
  await role.fill('Несохранённая синтетическая правка');
  await openCalendar(page);
  await page.getByLabel('Часовой пояс', { exact: true }).fill('Europe/Moscow');
  await page.getByRole('button', { name: 'Сохранить расписание', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Расписание сохранено');
  await page.getByRole('button', { name: 'О себе и сайт', exact: true }).click();
  await expect(role).toHaveValue('Несохранённая синтетическая правка');
  await page.locator('.admin-topbar').getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Сохранено.');
  expect((await prepared.get('/api/admin/booking')).settings.timezone).toBe('Europe/Moscow');
  expect((await prepared.get('/api/admin/content')).data.profile.role).toBe('Несохранённая синтетическая правка');
});

test('external CMS change does not silently rebase or discard unsaved profile', async ({ page, prepared }) => {
  const role = page.getByLabel('Специализация', { exact: true });
  await role.fill('Мой несохранённый текст');
  const external = await prepared.get('/api/admin/content'); external.data.profile.role = 'Внешняя сохранённая правка';
  expect((await prepared.put('/api/admin/content', external)).ok()).toBe(true);
  await openCalendar(page);
  await page.getByLabel('Часовой пояс', { exact: true }).fill('Europe/Moscow');
  await page.getByRole('button', { name: 'Сохранить расписание', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Расписание сохранено');
  await page.getByRole('button', { name: 'О себе и сайт', exact: true }).click();
  await expect(role).toHaveValue('Мой несохранённый текст');
  await page.locator('.admin-topbar').getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(role).toHaveValue('Мой несохранённый текст');
  expect((await prepared.get('/api/admin/content')).data.profile.role).toBe('Внешняя сохранённая правка');
});

test('schedule conflict and cancelled navigation keep the local calendar draft', async ({ page, prepared }) => {
  await openCalendar(page);
  await page.getByLabel('Часовой пояс', { exact: true }).fill('Europe/Moscow');
  const external = await prepared.get('/api/admin/content'); external.data.profile.role = 'Другой редактор';
  expect((await prepared.put('/api/admin/content', external)).ok()).toBe(true);
  await page.getByRole('button', { name: 'Сохранить расписание', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Часовой пояс', { exact: true })).toHaveValue('Europe/Moscow');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'О себе и сайт', exact: true }).click();
  await expect(page.getByLabel('Часовой пояс', { exact: true })).toHaveValue('Europe/Moscow');
  expect((await prepared.get('/api/admin/booking')).settings.timezone).toBe('');
});

test('delayed conflict reload locks fields instead of erasing new edits', async ({ page, prepared }) => {
  await openCalendar(page);
  await page.getByLabel('Часовой пояс', { exact: true }).fill('Europe/Moscow');
  const external = await prepared.get('/api/admin/content'); external.data.profile.role = 'External fixture';
  expect((await prepared.put('/api/admin/content', external)).ok()).toBe(true);
  await page.getByRole('button', { name: 'Сохранить расписание', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { started = resolve; });
  await page.route('**/api/admin/booking', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch(); started(); await gate; await route.fulfill({ response });
  });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Загрузить сохранённое расписание', exact: true }).click();
  await requested;
  await expect(page.getByLabel('Часовой пояс', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'О себе и сайт', exact: true })).toBeDisabled();
  release();
  await expect(page.getByLabel('Часовой пояс', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Часовой пояс', { exact: true })).toHaveValue('');
});

test('preview uses its returned timezone when saved settings changed elsewhere', async ({ page, prepared }) => {
  const date = tomorrow();
  let saved = await prepared.get('/api/admin/booking');
  saved.settings.timezone = 'Europe/Moscow';
  saved.settings.services = [{ serviceId: service.id, durationMinutes: 45, bufferMinutes: 15, enabled: true }];
  saved.settings.overrides = [{ date, closed: false, windows: [{ start: '10:00', end: '12:00' }] }];
  expect((await prepared.put('/api/admin/booking', { version: saved.version, settings: saved.settings })).ok()).toBe(true);
  await page.reload(); await openCalendar(page);
  saved = await prepared.get('/api/admin/booking'); saved.settings.timezone = 'Europe/London';
  expect((await prepared.put('/api/admin/booking', { version: saved.version, settings: saved.settings })).ok()).toBe(true);
  await page.getByLabel('Выбранная дата', { exact: true }).fill(date);
  await page.getByLabel('Услуга для проверки', { exact: true }).selectOption(service.id);
  await expect(page.locator('.calendar-preview [role="alert"]')).toContainText('Europe/London');
  await expect(page.locator('.calendar-preview-slots li').first()).toContainText('10:00');
  await expect(page.getByLabel('Часовой пояс', { exact: true })).toHaveValue('Europe/Moscow');
  saved = await prepared.get('/api/admin/booking'); saved.settings.overrides[0].windows = [{ start: '11:00', end: '12:00' }];
  expect((await prepared.put('/api/admin/booking', { version: saved.version, settings: saved.settings })).ok()).toBe(true);
  await page.getByRole('button', { name: 'Загрузить сохранённое расписание', exact: true }).click();
  await expect(page.getByLabel('Часовой пояс', { exact: true })).toHaveValue('Europe/London');
  await expect(page.locator('.calendar-preview-slots li')).toHaveCount(1);
  await expect(page.locator('.calendar-preview-slots li').first()).toContainText('11:00');
});

base('contact has an honest unavailable state and no personal-data form', async ({ page }) => {
  const writes = [];
  page.on('request', request => { if (request.url().includes('/api/booking/') && request.method() !== 'GET') writes.push(request.url()); });
  await page.goto('/contact');
  await expect(page.locator('.booking-unavailable')).toContainText('пока не открыт');
  await expect(page.locator('.booking-section input')).toHaveCount(0);
  expect(writes).toEqual([]);
});

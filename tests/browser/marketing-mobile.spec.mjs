import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Only the isolated qa-server's real API and synthetic owner password are used.
// No production storage, provider calls, credentials or publishing adapters.
const endpoint = '/api/admin/marketing';
const key = 'anna_warmup_channel_v4';
const password = 'browser-fixture-only-password';
const headers = baseURL => ({ origin: baseURL, 'Content-Type': 'application/json' });

async function loginAndReset(page, baseURL) {
  expect(baseURL).toBe('http://127.0.0.1:4176');
  await page.goto('/admin');
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const entry = page.getByRole('link', { name: 'Маркетинг и прогрев', exact: true });
  await expect(entry).toBeVisible();
  expect((await entry.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await noOverflow(page);
  const seed = await (await page.request.get(`${endpoint}/seed`)).json();
  const current = await (await page.request.get(endpoint)).json();
  expect((await page.request.put(endpoint, { headers: headers(baseURL), data: { data: seed, version: current.version } })).status()).toBe(200);
  await entry.click();
  await expect(page.locator('#serverLoad')).toBeEnabled();
  await loadServer(page);
  return seed;
}
async function loadServer(page) {
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#serverLoad').click();
  await expect(page.locator('#banner')).toHaveText('Загружена серверная копия.');
}
async function saveServer(page, status = 200) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === endpoint && r.request().method() === 'PUT');
  await page.locator('#serverSave').click();
  expect((await response).status()).toBe(status);
  await expect(page.locator('#serverSave')).toBeEnabled();
}
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}
async function noModal(page) {
  await expect(page.locator('.modal.on')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Boolean(history.state?.marketingModal))).toBe(false);
}

for (const width of [390, 320]) {
  test.describe(`phone ${width}px`, () => {
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(!testInfo.project.name.endsWith('-mobile'), 'Phone flows run in mobile Chromium and WebKit.');
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    });

    test('owner can add a topic, author, plan by tapping, export, import and restore', async ({ page, baseURL }, testInfo) => {
      test.setTimeout(90000);
      const errors = [], unexpected = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname.includes('/publish') || (url.origin !== baseURL && !['data:', 'blob:'].includes(url.protocol))) unexpected.push(request.url());
      });
      const seed = await loginAndReset(page, baseURL);
      expect(seed.chapters).toHaveLength(12);
      await noOverflow(page);
      await page.getByRole('button', { name: 'Добавить тему', exact: true }).click();
      const topic = page.getByRole('dialog', { name: 'Добавить тему', exact: true });
      await topic.getByLabel('Название', { exact: true }).fill('Синтетическая тема с телефона');
      await topic.getByLabel('Что тема даёт увидеть', { exact: true }).fill('Полезное объяснение, написанное автором.');
      await topic.getByRole('button', { name: 'Сохранить карточку', exact: true }).click();
      await noModal(page);
      await expect(page.locator('#chapters .chapter')).toHaveCount(13);
      await page.locator('#chapters .chapter').filter({ hasText: 'Синтетическая тема с телефона' }).click();
      await page.getByLabel('Адресат *', { exact: true }).fill('Синтетический читатель');
      await page.getByLabel('Текст', { exact: true }).fill('Авторский синтетический текст без персональных данных.');
      await page.getByLabel('Что читатель увидел *', { exact: true }).fill('Понятное объяснение темы');
      await page.getByLabel('Что намеренно осталось за пределами *', { exact: true }).fill('Индивидуальные назначения');
      await page.locator('#saveDraft').click();
      await expect(page.locator('#posts .postrow')).toHaveCount(1);
      await page.locator('#posts').getByRole('button', { name: 'Открыть', exact: true }).click();
      await expect(page.locator('#text')).toBeFocused();
      await page.locator('#text').fill('Авторский синтетический текст, отредактированный с телефона.');
      await page.locator('#factCleared').check();
      for (const review of await page.locator('[data-review]').all()) {
        expect((await review.boundingBox()).height).toBeGreaterThanOrEqual(44);
        await review.click();
      }
      await page.locator('#saveReady').click();
      await expect(page.locator('#posts .ready')).toHaveText('Готов');
      await page.locator('[data-status]').click();
      const status = page.getByRole('dialog');
      await status.getByLabel('Дата и время', { exact: true }).fill('');
      await status.getByRole('button', { name: 'Запланировать', exact: true }).click();
      await expect(status.locator('.modalMessage')).toContainText('нужна дата');
      const date = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15T10:30`; });
      await status.getByLabel('Дата и время', { exact: true }).fill(date);
      await status.getByRole('button', { name: 'Запланировать', exact: true }).click();
      await noModal(page);
      await page.getByRole('button', { name: 'Календарь', exact: true }).click();
      const calendarPost = page.locator('[data-calpost]');
      await expect(calendarPost).toHaveCount(1);
      expect((await calendarPost.boundingBox()).width).toBeGreaterThanOrEqual(44);
      expect((await calendarPost.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await noOverflow(page);
      await calendarPost.click();
      await page.getByLabel('Дата и время', { exact: true }).fill(date.replace('-15T', '-16T'));
      await page.getByRole('button', { name: 'Запланировать', exact: true }).click();
      await noModal(page);
      await expect(page.locator(`[data-day="${date.slice(0, 8)}16"] [data-calpost]`)).toHaveCount(1);
      await page.screenshot({ path: testInfo.outputPath(`calendar-${width}.png`), fullPage: true });

      await page.getByRole('button', { name: 'Мастерская', exact: true }).click();
      const unfinished = 'Синтетический рабочий текст для экспорта и восстановления.';
      await page.getByLabel('Текст', { exact: true }).fill(unfinished);
      const downloaded = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Экспорт базы', exact: true }).click();
      const download = await downloaded;
      expect(download.suggestedFilename()).toBe('kanal-progreva-baza.json');
      const buffer = await readFile(await download.path());
      const exported = JSON.parse(buffer.toString());
      expect(exported.workingDraft.post.text).toBe(unfinished);
      expect(exported.posts[0].status).toBe('scheduled');
      await page.getByLabel('Текст', { exact: true }).fill('Локальная проба перед импортом');
      const upload = { name: 'synthetic-mobile.json', mimeType: 'application/json', buffer };
      page.once('dialog', dialog => dialog.dismiss());
      await page.locator('#importFile').setInputFiles(upload);
      await expect(page.getByLabel('Текст', { exact: true })).toHaveValue('Локальная проба перед импортом');
      page.once('dialog', dialog => dialog.accept());
      await page.locator('#importFile').setInputFiles(upload);
      await expect(page.locator('#banner')).toHaveText('База проверена и импортирована.');
      await expect(page.getByLabel('Текст', { exact: true })).toHaveValue(unfinished);
      await saveServer(page);
      let saved = await (await page.request.get(endpoint)).json();
      expect(saved.publishingEnabled).toBe(false);
      expect(saved.data.chapters.slice(0, 12).map(c => c.id)).toEqual(seed.chapters.map(c => c.id));
      expect(saved.data.posts[0].scheduledAt).toBe(date.replace('-15T', '-16T'));
      expect(saved.data.workingDraft.post.text).toBe(unfinished);
      await page.reload();
      await expect(page.getByLabel('Текст', { exact: true })).toHaveValue(unfinished);
      await loadServer(page);
      await expect(page.getByLabel('Текст', { exact: true })).toHaveValue(unfinished);
      await noOverflow(page);
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
    });

    test('topic cancel, Back, Escape, view history and landscape remain usable', async ({ page, baseURL }, testInfo) => {
      await loginAndReset(page, baseURL);
      const text = 'Синтетический черновик, который нельзя потерять при закрытии.';
      await page.getByLabel('Текст', { exact: true }).fill(text);
      await page.getByRole('button', { name: 'Добавить тему', exact: true }).click();
      await page.getByRole('dialog').getByLabel('Название', { exact: true }).fill('Не сохранять при Back');
      await page.goBack();
      await noModal(page);
      await expect(page.locator('#addChapter')).toBeFocused();
      await expect(page.locator('#chapters .chapter')).toHaveCount(12);
      await expect(page.locator('#text')).toHaveValue(text);
      await page.goForward();
      await noModal(page);
      await page.getByRole('button', { name: 'Добавить тему', exact: true }).click();
      await page.keyboard.press('Escape');
      await noModal(page);
      await page.setViewportSize({ width: width === 320 ? 568 : 844, height: width });
      await page.getByRole('button', { name: 'Карточка темы', exact: true }).click();
      const dialog = page.getByRole('dialog');
      const original = await dialog.getByLabel('Название', { exact: true }).inputValue();
      await dialog.getByLabel('Название', { exact: true }).fill('');
      await dialog.getByRole('button', { name: 'Сохранить карточку', exact: true }).click();
      await expect(dialog.locator('.modalMessage')).toBeVisible();
      await expect(dialog.locator('.modalMessage')).toContainText('Введите название темы');
      const box = await dialog.locator('.dialog').boundingBox();
      expect(box.height).toBeLessThanOrEqual(width);
      await noOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`topic-landscape-${width}.png`), fullPage: true });
      await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
      await noModal(page);
      await expect(page.locator('#chapters')).toContainText(original);
      await expect(page.locator('#text')).toHaveValue(text);
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      await page.getByRole('button', { name: 'Приборная', exact: true }).click();
      await expect(page.locator('#dashboard')).toBeVisible();
      await noOverflow(page);
      await page.getByRole('button', { name: 'Календарь', exact: true }).click();
      await page.goBack();
      await expect(page.locator('#dashboard')).toBeVisible();
      await page.goForward();
      await expect(page.locator('#calendarView')).toBeVisible();
      await page.getByRole('link', { name: 'К тексту поста', exact: true }).click();
      await expect(page.locator('#text')).toBeFocused();
      await expect(page.locator('#text')).toHaveValue(text);
    });

    test('server conflict and expired session retain phone edits without publishing or anonymous access', async ({ page, baseURL }) => {
      await loginAndReset(page, baseURL);
      const initial = await (await page.request.get(endpoint)).json();
      const external = structuredClone(initial.data);
      external.chapters[0].title = 'Синтетическая серверная правка';
      expect((await page.request.put(endpoint, { headers: headers(baseURL), data: { data: external, version: initial.version } })).status()).toBe(200);
      const text = 'Несохранённая сервером синтетическая правка телефона';
      await page.getByLabel('Текст', { exact: true }).fill(text);
      await saveServer(page, 409);
      await expect(page.locator('#banner')).toContainText('Серверная копия изменена');
      await expect(page.locator('#text')).toHaveValue(text);
      expect((await (await page.request.get(endpoint)).json()).data.chapters[0].title).toBe(external.chapters[0].title);
      expect((await page.request.delete('/api/session', { headers: headers(baseURL) })).ok()).toBe(true);
      await saveServer(page, 401);
      await expect(page.locator('#banner')).toContainText('Войдите в панель управления');
      await expect(page.locator('#text')).toHaveValue(text);
      expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key + '_working_draft')).post.text, key)).toBe(text);
      expect((await page.request.get('/admin/marketing')).status()).toBe(401);
      await page.getByRole('link', { name: '← Панель управления', exact: true }).click();
      await page.getByLabel('Пароль', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
      await page.getByRole('link', { name: 'Маркетинг и прогрев', exact: true }).click();
      await expect(page.locator('#text')).toHaveValue(text);
      expect((await (await page.request.get(endpoint)).json()).publishingEnabled).toBe(false);
    });
  });
}

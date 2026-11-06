import { test, expect } from '@playwright/test';

// Real API and synthetic QA-server session only. No production data, mocks,
// provider credentials, external publication calls or account creation.
const password = 'browser-fixture-only-password';
const endpoint = '/api/admin/marketing';
const headers = baseURL => ({ origin: baseURL, 'Content-Type': 'application/json' });

async function loginAndReset(page, baseURL) {
  expect(baseURL).toBe('http://127.0.0.1:4176');
  await page.goto('/admin');
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Маркетинг и прогрев', exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/session')).json()).authenticated).toBe(true);
  const seed = await (await page.request.get(`${endpoint}/seed`)).json();
  const current = await (await page.request.get(endpoint)).json();
  expect((await page.request.put(endpoint, { headers: headers(baseURL), data: { data: seed, version: current.version } })).status()).toBe(200);
  await page.getByRole('link', { name: 'Маркетинг и прогрев', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Канал прогрева', exact: true })).toBeVisible();
  await loadServer(page);
  return seed;
}
async function loadServer(page) {
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#serverLoad').click();
  await expect(page.locator('#banner')).toHaveText('Загружена серверная копия.');
}
async function editTopic(page, title) {
  await page.locator('#editChapter').click();
  await expect(page.locator('#chapterModal')).toBeVisible();
  await page.locator('[data-cf="title"]').fill(title);
  await page.locator('[data-cf="reveals"]').fill('Полезное объяснение самой темы без обещаний результата.');
  await page.locator('[data-cf="factNote"]').fill('Синтетический источник для теста; это не настоящий диплом.');
  await page.locator('#saveChapter').click();
  await expect(page.locator('#chapterModal')).not.toBeVisible();
  await expect(page.locator('#chapters')).toContainText(title);
}
async function saveServer(page, status = 200) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === endpoint && r.request().method() === 'PUT');
  await page.locator('#serverSave').click();
  expect((await response).status()).toBe(status);
  await expect(page.locator('#serverSave')).toBeEnabled();
}

// Every configured desktop/mobile/tablet project runs these same real flows.
test('copied workshop starts without personal content, persists topics and drafts, and handles stale versions', async ({ page, baseURL }, testInfo) => {
  const errors = [], publicationRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.includes('/publish') || (url.origin !== baseURL && !['data:', 'blob:'].includes(url.protocol))) publicationRequests.push(request.url());
  });
  const seed = await loginAndReset(page, baseURL);
  expect(seed.posts).toEqual([]);
  expect(seed.measures).toEqual([]);
  expect(seed.concepts).toEqual([]);
  expect(seed.telegramIdentityAccountId).toBe('');
  expect(seed.chapters).toHaveLength(12); // Editable course topics, no fabricated post text or certificates.
  expect(seed.chapters[0].sourceText).toBe('');
  expect(seed.chapters[0].reveals).toBe('');
  await expect(page.locator('#posts .postrow')).toHaveCount(0);
  await expect(page.locator('#text')).toHaveValue('');
  await expect(page.locator('#telegramIdentity')).toBeHidden();
  await expect(page.locator('body')).toContainText('Автопостинг не подключён');

  await editTopic(page, 'Синтетическая тема');
  await page.locator('#addressee').fill('Синтетическая аудитория');
  await page.locator('#text').fill('Синтетический учебный текст о теме. Без реальных данных пациентов.');
  await page.locator('#seen').fill('Что читатель понял о теме');
  await page.locator('#withheld').fill('Индивидуальная диагностика и назначения');
  await page.locator('#saveDraft').click();
  await expect(page.locator('#posts .postrow')).toHaveCount(1);
  await saveServer(page);
  await expect(page.locator('#banner')).toContainText('Ничего не опубликовано');
  let saved = await (await page.request.get(endpoint)).json();
  expect(saved.publishingEnabled).toBe(false);
  expect(saved.data.chapters[0].title).toBe('Синтетическая тема');
  expect(saved.data.posts[0].status).toBe('draft');

  await page.reload();
  await expect(page.locator('#banner')).toContainText('Есть локальная база');
  await loadServer(page);
  await expect(page.locator('#posts .postrow')).toHaveCount(1);
  await expect(page.locator('#chapters')).toContainText('Синтетическая тема');

  // A real independent server update must not be overwritten by the old page.
  const external = structuredClone(saved.data);
  external.chapters[0].title = 'Тема из другой вкладки';
  expect((await page.request.put(endpoint, { headers: headers(baseURL), data: { data: external, version: saved.version } })).status()).toBe(200);
  await editTopic(page, 'Несохранённая локальная тема');
  await saveServer(page, 409);
  await expect(page.locator('#banner')).toContainText('Серверная копия изменена');
  await expect(page.locator('#chapters')).toContainText('Несохранённая локальная тема');
  saved = await (await page.request.get(endpoint)).json();
  expect(saved.data.chapters[0].title).toBe('Тема из другой вкладки');
  await loadServer(page);
  await expect(page.locator('#chapters')).toContainText('Тема из другой вкладки');

  for (const view of ['workshop', 'dashboard', 'calendarView']) {
    await page.locator(`[data-view="${view}"]`).click();
    await expect(page.locator(`#${view}`)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${view} must not overflow the viewport`).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('marketing-synthetic-calendar.png'), fullPage: true });
  expect(publicationRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('logout removes server access and never turns a local draft into publication', async ({ page, baseURL }) => {
  await loginAndReset(page, baseURL);
  await editTopic(page, 'Локальный черновик после выхода');
  const publishRequests = [];
  page.on('request', r => { if (new URL(r.url()).pathname.includes('/publish')) publishRequests.push(r.url()); });
  expect((await page.request.delete('/api/session', { headers: headers(baseURL) })).ok()).toBe(true);
  expect((await (await page.request.get('/api/session')).json()).authenticated).toBe(false);
  // Existing open HTML can retain local content; logout revokes server access,
  // not browser storage. This test deliberately does not claim local erasure.
  await saveServer(page, 401);
  await expect(page.locator('#banner')).toContainText('Войдите в панель управления');
  for (const path of ['/admin/marketing', endpoint, `${endpoint}/seed`, `${endpoint}/assets/safety`, `${endpoint}/assets/styles`]) {
    expect((await page.request.get(path)).status(), path).toBe(401);
  }
  expect((await page.request.put(endpoint, { headers: headers(baseURL), data: { data: {}, version: 1 } })).status()).toBe(401);
  const response = await page.goto('/admin/marketing');
  expect(response.status()).toBe(401);
  await expect(page.getByRole('heading', { name: 'Канал прогрева' })).toHaveCount(0);
  expect(publishRequests).toEqual([]);
});

test('an unfinished server working draft restores on a clean browser without manual import', async ({ page, browser, baseURL }) => {
  await loginAndReset(page, baseURL);
  const text = 'Синтетический незавершённый текст, ещё не добавленный в список постов.';
  await page.locator('#addressee').fill('Синтетический читатель');
  await page.locator('#text').fill(text);
  await page.locator('#seen').fill('Понимание темы');
  await page.locator('#withheld').fill('Индивидуальные рекомендации');
  // Save the workspace, deliberately without pressing Save draft.
  await saveServer(page);
  const saved = await (await page.request.get(endpoint)).json();
  expect(saved.data.posts).toEqual([]);
  expect(saved.data.workingDraft.post.text).toBe(text);

  const fresh = await browser.newContext({ baseURL });
  try {
    const other = await fresh.newPage();
    await other.goto('/admin');
    expect(await other.evaluate(() => localStorage.getItem('anna_warmup_channel_v4'))).toBeNull();
    expect(await other.evaluate(() => localStorage.getItem('anna_warmup_channel_v4_working_draft'))).toBeNull();
    await other.getByLabel('Пароль', { exact: true }).fill(password);
    await other.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(other.getByRole('link', { name: 'Маркетинг и прогрев', exact: true })).toBeVisible();
    await other.getByRole('link', { name: 'Маркетинг и прогрев', exact: true }).click();
    // No serverLoad click: first-load recovery is the behavior under test.
    await expect(other.locator('#text')).toHaveValue(text);
    await expect(other.locator('#addressee')).toHaveValue('Синтетический читатель');
    await expect(other.locator('#seen')).toHaveValue('Понимание темы');
    await expect(other.locator('#withheld')).toHaveValue('Индивидуальные рекомендации');
    await expect(other.locator('#posts .postrow')).toHaveCount(0);
    expect((await (await other.request.get(endpoint)).json()).data.posts).toEqual([]);
  } finally { await fresh.close(); }
});

test('a working-text change in another tab blocks local and server overwrite', async ({ page, context, baseURL }) => {
  await loginAndReset(page, baseURL);
  const second = await context.newPage();
  try {
    await second.goto('/admin/marketing');
    await expect(second.getByRole('heading', { name: 'Канал прогрева', exact: true })).toBeVisible();
    await loadServer(second);
    const before = await (await page.request.get(endpoint)).json();
    const winner = 'Синтетический текст первой вкладки';
    const retained = 'Синтетическая правка второй вкладки, которую нельзя потерять';
    const conflict = 'Рабочий текст изменён в другой вкладке. Сохранение приостановлено. Скопируйте свой текст перед обновлением.';
    await page.locator('#text').fill(winner);
    await expect(second.locator('#banner')).toHaveText(conflict);
    await second.locator('#text').fill(retained);
    await expect(second.locator('#text')).toHaveValue(retained);
    expect(await second.evaluate(() => JSON.parse(localStorage.getItem('anna_warmup_channel_v4_working_draft')).post.text)).toBe(winner);

    const writes = [];
    second.on('request', request => {
      if (new URL(request.url()).pathname === endpoint && request.method() === 'PUT') writes.push(request.url());
    });
    await second.locator('#serverSave').click();
    await expect(second.locator('#serverSave')).toBeEnabled();
    await expect(second.locator('#banner')).toContainText(/конфликт|другой вкладке/i);
    // A same-origin read lets pending request events run without arbitrary sleep.
    const after = await (await second.request.get(endpoint)).json();
    expect(writes).toEqual([]);
    expect(after.version).toBe(before.version);
    expect(after.data).toEqual(before.data);
    await expect(second.locator('#text')).toHaveValue(retained);
    await expect(page.locator('#text')).toHaveValue(winner);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('anna_warmup_channel_v4_working_draft')).post.text)).toBe(winner);
  } finally { await second.close(); }
});

test('manual topics support cancel, Escape, repeat save and safe switching without losing the current post', async ({ page, baseURL }) => {
  const seed = await loginAndReset(page, baseURL);
  const count = seed.chapters.length;
  const working = 'Синтетический текущий пост, который должен сохраниться.';
  await page.locator('#text').fill(working);
  await page.locator('#addChapter').click();
  await expect(page.locator('[data-cf="title"]')).toHaveValue('');
  await page.locator('[data-cf="title"]').fill('Отменённая тема');
  await page.locator('[data-close="chapterModal"]').click();
  await expect(page.locator('#chapters .chapter')).toHaveCount(count);
  await expect(page.locator('#text')).toHaveValue(working);
  await page.locator('#addChapter').click();
  await page.locator('[data-cf="title"]').fill('Тема, отменённая Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('#chapterModal')).not.toBeVisible();
  await expect(page.locator('#chapters .chapter')).toHaveCount(count);

  await page.locator('#addChapter').click();
  await page.locator('#saveChapter').click();
  await expect(page.locator('#banner')).toContainText('Введите название темы');
  await page.locator('[data-cf="title"]').fill('Моя произвольная тема');
  await page.locator('[data-cf="reveals"]').fill('Полезное содержание по выбору автора');
  // Repeat activation in the same turn must not create two identical records.
  await page.locator('#saveChapter').evaluate(button => { button.click(); button.click(); });
  await expect(page.locator('#chapters .chapter')).toHaveCount(count + 1);
  await expect(page.locator('#text')).toHaveValue(working);
  await page.locator('#addTopicSeeds').click();
  await expect(page.locator('#banner')).toContainText('Все темы уже добавлены');
  await expect(page.locator('#chapters .chapter')).toHaveCount(count + 1);
  await expect(page.locator('#text')).toHaveValue(working);

  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#chapters .chapter').filter({ hasText: 'Моя произвольная тема' }).click();
  await expect(page.locator('#text')).toHaveValue(working);
  await expect(page.locator('#posts .postrow')).toHaveCount(0);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#chapters .chapter').filter({ hasText: 'Моя произвольная тема' }).click();
  await expect(page.locator('#text')).toHaveValue('');
  await expect(page.locator('#posts .postrow')).toHaveCount(1);
  await expect(page.locator('#posts')).toContainText(working);
  await page.locator('#editChapter').click();
  await expect(page.locator('[data-cf="title"]')).toHaveValue('Моя произвольная тема');
  await page.locator('[data-cf="title"]').fill('Переименованная произвольная тема');
  await page.locator('#saveChapter').click();
  await expect(page.locator('#chapters .chapter')).toHaveCount(count + 1);
  await saveServer(page);
  const saved = await (await page.request.get(endpoint)).json();
  expect(saved.data.chapters).toHaveLength(count + 1);
  expect(saved.data.chapters.at(-1).title).toBe('Переименованная произвольная тема');
  expect(saved.data.posts[0].text).toBe(working);
  expect(saved.data.posts[0].sources.primaryChapter).toBe(seed.chapters[0].id);
  expect(saved.publishingEnabled).toBe(false);
});


test('materials show prepared copy, editorial plan and saved social links without publishing', async ({page,baseURL}) => {
  await loginAndReset(page,baseURL);
  await page.getByRole('button',{name:'Материалы и план',exact:true}).click();
  await expect(page.locator('#materialsStatus')).toContainText('Данные из админки загружены');
  await expect(page.locator('#annaPlan article')).toHaveCount(4);
  await expect(page.locator('#annaPrepared')).toContainText('Выездной приём');
  await expect(page.locator('#annaDiplomas')).toContainText('нет загруженных дипломов');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('link',{name:'Заполнить ссылки на соцсети'}).click();
  await expect(page.getByRole('heading',{name:'Соцсети Анны',exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:/^Telegram · ссылка/}).fill('https://t.me/synthetic_test_only');
  const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/content' && r.request().method()==='PUT');
  await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole('button',{name:'Сохранить изменения',exact:true})).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('textbox',{name:/^Telegram · ссылка/})).toHaveValue('https://t.me/synthetic_test_only');
  await page.getByRole('link',{name:'Маркетинг и прогрев',exact:true}).click();
  await page.getByRole('button',{name:'Материалы и план',exact:true}).click();
  await expect(page.locator('#annaSocials')).toContainText('https://t.me/synthetic_test_only');
  await expect(page.locator('#materialsView')).toContainText('отправка публикаций пока не настроены');
});

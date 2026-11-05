import { test, expect } from '@playwright/test';

// Synthetic fixture only; writes intercepted below never reach a real calendar.
const future = hours => new Date(Date.now() + hours * 3600000).toISOString();
async function setup(page, { busyFailure = false } = {}) {
  const snapshot = { version: 0, settings: null, serviceCatalog: [], occupancy: { schemaVersion: 1, coverage: null, records: [] } };
  const calls = [];
  let failBusy = busyFailure;
  await page.route('**/api/admin/booking/occupancy', route => route.fulfill({ json: snapshot }));
  await page.route('**/api/admin/booking/busy', async route => {
    const body = route.request().postDataJSON(); calls.push({ path: 'busy', body });
    if (failBusy) { failBusy = false; return route.abort('failed'); }
    snapshot.occupancy.records.push({ id: 'synthetic-busy', type: 'busy', status: 'active', ...body.intervals[0], operationKey: body.operationKey });
    const previousVersion = snapshot.version++;
    await route.fulfill({ json: { version: snapshot.version, rebasedFromVersion: previousVersion, settings: snapshot.settings } });
  });
  await page.route('**/api/admin/booking/coverage', async route => {
    const body = route.request().postDataJSON(); calls.push({ path: 'coverage', body });
    snapshot.occupancy.coverage = { start: body.start, end: body.end, verifiedUntil: body.verifiedUntil }; const previousVersion = snapshot.version++;
    await route.fulfill({ json: { version: snapshot.version, rebasedFromVersion: previousVersion, settings: snapshot.settings } });
  });
  await page.route('**/api/admin/booking/records/*/cancel', async route => {
    calls.push({ path: 'cancel', body: route.request().postDataJSON() });
    snapshot.occupancy.records[0].status = 'cancelled'; const previousVersion = snapshot.version++;
    await route.fulfill({ json: { version: snapshot.version, rebasedFromVersion: previousVersion, settings: snapshot.settings } });
  });
  await page.goto('/admin');
  await page.getByLabel('Пароль', { exact: true }).fill('browser-fixture-only-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByLabel('Специализация', { exact: true })).toBeVisible();
  const schedule = await page.request.get('/api/admin/booking');
  expect(schedule.ok()).toBe(true); Object.assign(snapshot, await schedule.json());
  // Keep the same realistic settings and version as the authenticated CMS.
  await page.route('**/api/admin/booking', route => route.fulfill({ json: { version: snapshot.version, settings: snapshot.settings, serviceCatalog: snapshot.serviceCatalog } }));
  await page.getByRole('button', { name: 'Календарь и запись', exact: true }).click();
  const manager = page.getByRole('region', { name: 'Закрытая подготовка занятости' });
  await expect(manager.getByText('Полнота занятости пока не подтверждена.', { exact: true })).toBeVisible();
  return { manager, calls, snapshot };
}
async function fillBusy(manager) {
  await manager.getByLabel('Занято с (ISO UTC)', { exact: true }).fill(future(30));
  await manager.getByLabel('Занято до (ISO UTC)', { exact: true }).fill(future(31));
}

test('private occupancy uses explicit UTC and guards duplicate writes and cancellation', async ({ page }) => {
  const { manager, calls } = await setup(page);
  await expect(manager).toContainText('Публичная онлайн-запись выключена');
  await expect(manager).toContainText('.Shifter пока не поддерживается');
  await fillBusy(manager);
  await manager.getByLabel('Занято с (ISO UTC)', { exact: true }).fill('2027-01-01T09:00:00');
  await manager.getByRole('button', { name: 'Добавить занятость', exact: true }).click();
  await expect(manager.getByRole('alert')).toContainText('ISO UTC'); expect(calls).toHaveLength(0);
  await fillBusy(manager);
  await manager.getByRole('button', { name: 'Добавить занятость', exact: true }).evaluate(button => { button.click(); button.click(); });
  await expect(manager.getByRole('button', { name: 'Отменить интервал synthetic-busy' })).toBeVisible();
  expect(calls.filter(call => call.path === 'busy')).toHaveLength(1);
  expect(calls[0].body.intervals[0].start).toMatch(/Z$/);
  page.once('dialog', dialog => dialog.accept());
  await manager.getByRole('button', { name: 'Отменить интервал synthetic-busy' }).click();
  await expect(manager).toContainText('Отменено');
  expect(calls.filter(call => call.path === 'cancel')).toHaveLength(1);
});

test('coverage requires attestation and expires within 24 hours', async ({ page }) => {
  const { manager, calls } = await setup(page);
  await manager.getByLabel('Проверено с (ISO UTC)', { exact: true }).fill(future(2));
  await manager.getByLabel('Проверено до (ISO UTC)', { exact: true }).fill(future(48));
  await manager.getByLabel('Актуально до (ISO UTC)', { exact: true }).fill(future(25));
  const submit = manager.getByRole('button', { name: 'Подтвердить сверку', exact: true });
  await expect(submit).toBeDisabled();
  await manager.getByRole('checkbox').check(); await submit.click();
  await expect(manager.getByRole('alert')).toContainText('не более 24 часов'); expect(calls).toHaveLength(0);
  await manager.getByLabel('Актуально до (ISO UTC)', { exact: true }).fill(future(12));
  await expect(submit).toBeDisabled();
  await manager.getByRole('checkbox').check(); await submit.click();
  await expect(manager).toContainText('Сверенный период:');
  expect(calls.filter(call => call.path === 'coverage')).toHaveLength(1);
});

test('uncertain write requires refresh and reuses the exact operation payload', async ({ page }) => {
  const { manager, calls } = await setup(page, { busyFailure: true });
  await fillBusy(manager);
  const submit = manager.getByRole('button', { name: 'Добавить занятость', exact: true });
  await submit.click();
  await expect(manager.getByRole('alert')).toContainText('Результат операции неизвестен');
  await expect(submit).toBeDisabled();
  await expect(manager.getByLabel('Занято с (ISO UTC)', { exact: true })).toBeDisabled();
  await manager.getByRole('button', { name: 'Обновить занятость', exact: true }).click();
  await expect(submit).toBeEnabled(); await submit.click();
  await expect(manager.getByRole('button', { name: 'Отменить интервал synthetic-busy' })).toBeVisible();
  expect(calls).toHaveLength(2); expect(calls[1].body).toEqual(calls[0].body);
});

test('conflicts require refresh and unsaved schedule blocks occupancy edits', async ({ page }) => {
  const { manager, calls } = await setup(page);
  await page.route('**/api/admin/booking/busy', route => route.fulfill({ status: 409, json: { error: 'Синтетический конфликт версии' } }));
  await fillBusy(manager); await manager.getByRole('button', { name: 'Добавить занятость', exact: true }).click();
  await expect(manager.getByRole('alert')).toContainText('Данные изменились');
  await expect(manager.getByRole('button', { name: 'Добавить занятость', exact: true })).toBeDisabled();
  await manager.getByRole('button', { name: 'Обновить занятость', exact: true }).click();
  await expect(manager.getByRole('button', { name: 'Добавить занятость', exact: true })).toBeEnabled();
  await page.getByLabel('Часовой пояс', { exact: true }).fill('Europe/Moscow');
  await expect(manager).toContainText('Сначала сохраните изменения расписания');
  await expect(manager.getByRole('button', { name: 'Добавить занятость', exact: true })).toBeDisabled();
  expect(calls).toHaveLength(0);
});

test('stale conflict refresh renews expectedVersion while preserving the operation', async ({ page }) => {
  const { manager, snapshot } = await setup(page);
  const attempts = [];
  await page.route('**/api/admin/booking/busy', async route => {
    const body = route.request().postDataJSON(); attempts.push(body);
    if (attempts.length === 1) {
      snapshot.version++;
      return route.fulfill({ status: 409, json: { error: 'Синтетический конфликт версии' } });
    }
    expect(body.expectedVersion).toBe(snapshot.version);
    snapshot.occupancy.records.push({ id: 'synthetic-busy', type: 'busy', status: 'active', ...body.intervals[0], operationKey: body.operationKey });
    const previousVersion = snapshot.version++;
    return route.fulfill({ json: { version: snapshot.version, rebasedFromVersion: previousVersion, settings: snapshot.settings } });
  });
  await fillBusy(manager);
  const submit = manager.getByRole('button', { name: 'Добавить занятость', exact: true });
  await submit.click(); await expect(manager.getByRole('alert')).toContainText('Данные изменились');
  await manager.getByRole('button', { name: 'Обновить занятость', exact: true }).click();
  await expect(submit).toBeEnabled(); await submit.click();
  await expect(manager.getByRole('button', { name: 'Отменить интервал synthetic-busy' })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1].expectedVersion).toBe(attempts[0].expectedVersion + 1);
  expect(attempts[1].operationKey).toBe(attempts[0].operationKey);
  expect(attempts[1].intervals).toEqual(attempts[0].intervals);
});

for (const receipt of ['atomic', 'replay', 'invalid-version']) {
  test(`CMS rebases only from an atomic write receipt, never a newer read (${receipt})`, async ({ page }) => {
    const { manager, snapshot } = await setup(page);
    const originalVersion = snapshot.version;
    await page.getByRole('button', { name: 'О себе и сайт', exact: true }).click();
    await page.getByLabel('Специализация', { exact: true }).fill('Несохранённая синтетическая правка');
    await page.getByRole('button', { name: 'Календарь и запись', exact: true }).click();
    await expect(manager.getByRole('button', { name: 'Добавить занятость', exact: true })).toBeEnabled();
    await page.route('**/api/admin/booking/busy', async route => {
      const body = route.request().postDataJSON();
      expect(body.expectedVersion).toBe(originalVersion);
      snapshot.occupancy.records.push({ id: 'synthetic-busy', type: 'busy', status: 'active', ...body.intervals[0], operationKey: body.operationKey });
      // The write succeeds at v2, but another editor produces v3 before GET.
      snapshot.version = originalVersion + 2;
      const result = { version: originalVersion + (receipt === 'invalid-version' ? 2 : 1), settings: snapshot.settings };
      if (receipt !== 'replay') result.rebasedFromVersion = originalVersion;
      await route.fulfill({ json: result });
    });
    const contentWrites = [];
    await page.route('**/api/admin/content', async route => {
      if (route.request().method() !== 'PUT') return route.fallback();
      contentWrites.push(route.request().postDataJSON());
      return route.fulfill({ status: 409, json: { error: 'Синтетическая защита от устаревшей версии' } });
    });
    await fillBusy(manager); await manager.getByRole('button', { name: 'Добавить занятость', exact: true }).click();
    await expect(manager.getByRole('button', { name: 'Отменить интервал synthetic-busy' })).toBeVisible();
    await expect(manager.getByRole('button', { name: 'Обновить занятость', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'О себе и сайт', exact: true }).click();
    await expect(page.getByLabel('Специализация', { exact: true })).toHaveValue('Несохранённая синтетическая правка');
    await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).first().click();
    await expect(page.getByRole('alert')).toContainText('Синтетическая защита');
    expect(contentWrites).toHaveLength(1);
    expect(contentWrites[0].version).toBe(originalVersion + (receipt === 'atomic' ? 1 : 0));
    expect(contentWrites[0].version).not.toBe(snapshot.version);
  });
}

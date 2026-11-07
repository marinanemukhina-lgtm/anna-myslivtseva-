import { test, expect } from '@playwright/test';

async function mockSpeech(page, prefixed = false) {
  await page.addInitScript(({ prefixed }) => {
    window.speechSessions = [];
    class MockRecognition {
      constructor() { window.speechSessions.push(this); }
      start() { this.onstart?.(); }
      stop() { this.stopped = true; }
      abort() { this.aborted = true; }
      result(parts) {
        this.onresult?.({ results: parts.map(([text, final]) => Object.assign([{ transcript: text }], { isFinal: final })) });
      }
    }
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: prefixed ? undefined : MockRecognition });
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: prefixed ? MockRecognition : undefined });
  }, { prefixed });
}

test('Russian dictation appends once, allows correction, saves locally and isolates card drafts', async ({ page }) => {
  const writes = [];
  page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  await mockSpeech(page);
  await page.goto('/admin/patients');
  const field = page.getByRole('textbox', { name: 'Заметка к посещению' });
  await field.fill('Тест:');
  await page.getByRole('button', { name: 'Надиктовать', exact: true }).click();
  expect(await page.evaluate(() => [speechSessions.length, speechSessions[0].lang, speechSessions[0].continuous])).toEqual([1, 'ru-RU', true]);
  await expect(field).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Демо-клиент 002', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Сохранить процедуру' })).toBeDisabled();
  await page.evaluate(() => speechSessions[0].result([['первое наблюдение.', true], ['продолжение', false]]));
  await expect(field).toHaveValue('Тест: первое наблюдение.');
  await expect(page.getByText('Распознаётся: продолжение')).toBeVisible();
  await page.evaluate(() => speechSessions[0].result([['первое наблюдение.', true], ['второе наблюдение.', true]]));
  await page.evaluate(() => speechSessions[0].result([['первое наблюдение.', true], ['второе наблюдение.', true]]));
  await expect(field).toHaveValue('Тест: первое наблюдение. второе наблюдение.');
  await page.getByRole('button', { name: 'Остановить диктовку' }).click();
  await page.evaluate(() => { speechSessions[0].onend?.(); });
  await expect(field).toBeEnabled();
  expect(await page.evaluate(() => speechSessions[0].stopped)).toBe(true);
  await page.getByRole('button', { name: 'Демо-клиент 002', exact: true }).click();
  await expect(field).toHaveValue('');
  await field.fill('Другая тестовая карта.');
  await page.getByRole('button', { name: 'Демо-клиент 001', exact: true }).click();
  await expect(field).toHaveValue('Тест: первое наблюдение. второе наблюдение.');
  await field.fill('Тест: проверенный текст <b>без HTML</b>.');
  await page.getByRole('button', { name: 'Сохранить процедуру' }).click();
  await expect(field).toHaveValue('');
  await page.reload();
  await expect(page.locator('.clinical-visit').first()).toContainText('Тест: проверенный текст <b>без HTML</b>.');
  await expect(page.locator('.clinical-visit b')).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('prefixed engine: permission failure retains text, retry works, stalled stop releases controls', async ({ page }) => {
  await mockSpeech(page, true);
  await page.goto('/admin/patients');
  const field = page.getByRole('textbox', { name: 'Заметка к посещению' });
  await field.fill('Тестовая запись.');
  await page.getByRole('button', { name: 'Надиктовать', exact: true }).click();
  await page.evaluate(() => { window.staleResult = speechSessions[0].onresult; speechSessions[0].onerror({ error: 'not-allowed' }); });
  await expect(page.getByText(/Доступ к микрофону не разрешён/)).toBeVisible();
  await expect(field).toHaveValue('Тестовая запись.');
  await expect(field).toBeEnabled();
  await page.getByRole('button', { name: 'Надиктовать', exact: true }).click();
  await page.evaluate(() => { staleResult({ results: [Object.assign([{ transcript: 'Устаревшее событие' }], { isFinal: true })] }); speechSessions[1].result([['Новая фраза.', true]]); });
  await expect(field).toHaveValue('Тестовая запись. Новая фраза.');
  await page.getByRole('button', { name: 'Остановить диктовку' }).click();
  await expect(field).toBeEnabled({ timeout: 5000 });
  expect(await page.evaluate(() => speechSessions.every(s => s.aborted))).toBe(true);
});

test('dictation stops at the note limit and cannot overwrite a later card', async ({ page }) => {
  await mockSpeech(page);
  await page.goto('/admin/patients');
  const field = page.getByRole('textbox', { name: 'Заметка к посещению' });
  await field.fill('x'.repeat(3995));
  await page.getByRole('button', { name: 'Надиктовать', exact: true }).click();
  await page.evaluate(() => { window.staleResult = speechSessions[0].onresult; speechSessions[0].result([['длинная тестовая фраза', true]]); });
  await expect(page.getByText(/Достигнут предел 4000/)).toBeVisible();
  expect((await field.inputValue()).length).toBe(4000);
  await expect(page.getByRole('button', { name: 'Надиктовать', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Демо-клиент 002', exact: true }).click();
  await page.evaluate(() => staleResult({ results: [Object.assign([{ transcript: 'Устаревшее событие' }], { isFinal: true })] }));
  await expect(field).toHaveValue('');
});

test('without recognition, keyboard notes remain editable and persist', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: undefined });
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: undefined });
  });
  await page.goto('/admin/patients');
  await expect(page.getByText(/используйте микрофон на клавиатуре телефона/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Надиктовать', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Заметка к посещению' }).fill('Тест с клавиатуры.');
  await page.getByRole('button', { name: 'Сохранить процедуру' }).click();
  await page.reload();
  await expect(page.locator('.clinical-visit').first()).toContainText('Тест с клавиатуры.');
});

test('interim-only speech remains editable after dictation ends and can be saved',async ({page})=>{
  await mockSpeech(page);
  await page.goto('/admin/patients');
  const field=page.getByRole('textbox',{name:'Заметка к посещению'});
  await page.getByRole('button',{name:'Надиктовать',exact:true}).click();
  await page.evaluate(()=>speechSessions[0].result([['Синтетический незавершённый текст',false]]));
  await expect(page.getByText(/Распознаётся: Синтетический незавершённый текст/)).toBeVisible();
  await page.getByRole('button',{name:'Остановить диктовку'}).click();
  await page.evaluate(()=>speechSessions[0].onend?.());
  await expect(field).toHaveValue('Синтетический незавершённый текст');
  await expect(page.getByText(/Неподтверждённые слова оставлены в поле/)).toBeVisible();
  await field.fill('Исправленный синтетический текст.');
  await page.getByRole('button',{name:'Сохранить процедуру'}).click();
  await page.reload();
  await expect(page.locator('.clinical-visit').first()).toContainText('Исправленный синтетический текст.');
});

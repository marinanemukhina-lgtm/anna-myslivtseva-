import { test, expect } from '@playwright/test';
test('open patient histories require no password, persist locally, and can start empty', async ({ page }) => {
  const writes = []; page.on('request', r => { if (r.method()==='POST') writes.push(r.url()); });
  await page.goto('/admin/patients');
  await expect(page.getByRole('heading',{name:'Пациенты и истории'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Демо-клиент 001',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'История процедур'})).toBeVisible();
  await expect(page.locator('.clinical-visit')).toHaveCount(3);
  await expect(page.getByRole('heading',{name:'Фото до и после',exact:true})).toBeVisible();
  await expect(page.getByText(/Боль|Подвижность/)).toHaveCount(0);
  await expect(page.getByLabel('Снять фото До',{exact:true})).toHaveAttribute('capture','environment');
  await expect(page.getByLabel('Снять фото После',{exact:true})).toHaveAttribute('capture','environment');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAALUlEQVR4nGPccuISAy0BE01NH7Vg1IJRC0YtGLVg1IJRC0YtGLVg1IJRC6gIAH7ZAo5zVBhDAAAAAElFTkSuQmCC','base64');
  await page.getByLabel('Снять фото До',{exact:true}).setInputFiles({name:'synthetic-before.png',mimeType:'image/png',buffer:png});
  await expect(page.getByRole('status')).toContainText('Тестовое фото добавлено');
  await page.getByLabel('Добавить фото После',{exact:true}).setInputFiles({name:'synthetic-after.png',mimeType:'image/png',buffer:png});
  await expect(page.locator('.clinical-photo-frame img')).toHaveCount(2);
  await page.reload();await expect(page.locator('.clinical-photo-frame img')).toHaveCount(2);
  await page.getByRole('combobox',{name:'Ракурс',exact:true}).selectOption('Сбоку');
  await expect(page.locator('.clinical-photo-frame img')).toHaveCount(0);
  await page.getByRole('combobox',{name:'Ракурс',exact:true}).selectOption('Спереди');
  await expect(page.locator('.clinical-photo-frame img')).toHaveCount(2);
  await page.getByRole('button',{name:'Сохранить процедуру'}).click();
  await expect(page.locator('.clinical-visit')).toHaveCount(4);
  await page.reload(); await expect(page.locator('.clinical-visit')).toHaveCount(4);
  await page.screenshot({path:`.qa/clinical-${test.info().project.name}.png`,fullPage:true});
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button',{name:'Начать с пустого кабинета'}).click();
  await expect(page.getByRole('heading',{name:'Начните с тестовой карты'})).toBeVisible();
  await page.getByRole('button',{name:'Создать Демо-клиент 001'}).click();
  await expect(page.getByText('Пока нет процедур.',{exact:true})).toBeVisible();
  expect(writes).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('six photos can be appended to one visit and one deleted without losing the rest',async ({page})=>{
 await page.goto('/admin/patients');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAALUlEQVR4nGPccuISAy0BE01NH7Vg1IJRC0YtGLVg1IJRC6gIAH7ZAo5zVBhDAAAAAElFTkSuQmCC','base64');
 const input=page.getByLabel('Добавить фото к посещению 2026-10-20');
 for(let i=0;i<6;i++){
  await input.setInputFiles({name:`synthetic-${i}.png`,mimeType:'image/png',buffer:png});
  await expect(page.locator('.clinical-gallery-visit').last().locator('.clinical-gallery-photo')).toHaveCount(i+1);
 }
 await page.reload();
 await expect(page.locator('.clinical-gallery-visit').last().locator('.clinical-gallery-photo')).toHaveCount(6);
 page.once('dialog',dialog=>dialog.accept());
 await page.locator('.clinical-gallery-visit').last().getByRole('button',{name:'Удалить фото'}).first().click();
 await expect(page.locator('.clinical-gallery-visit').last().locator('.clinical-gallery-photo')).toHaveCount(5);
});

import { test, expect } from '@playwright/test';
const projectNumber = info => ({'contact-chromium-desktop': 0, 'contact-chromium-small': 1, 'contact-webkit-mobile': 2}[info.project.name]);

test('call, explicit SMS and server-persisted callback reach protected owner inbox', async ({page}, testInfo) => {
  const failures=[]; page.on('pageerror',e=>failures.push(e.message));
  await page.goto('/contact');
  const call=page.getByRole('link',{name:/Позвонить Анне/}).first();
  await expect(call).toHaveAttribute('href','tel:+79000000000');
  await expect(page.locator('.contact-intro').getByRole('link',{name:'Написать SMS'})).toHaveAttribute('href','sms:+79000000000');
  expect(await call.evaluate(el=>el.getBoundingClientRect().bottom)).toBeLessThan(testInfo.project.use.viewport.height);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('contact-top.png')});
  await page.getByRole('button',{name:'Оставить номер для звонка'}).click();
  const input=page.getByLabel('Ваш телефон',{exact:true});
  await expect(input).toBeFocused();
  const phone='+1 202 555 01'+String(10+projectNumber(testInfo)).padStart(2,'0');
  await input.fill(phone);
  await expect(page.getByRole('button',{name:'Перезвоните мне',exact:true})).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.locator('.callback-form').screenshot({path:testInfo.outputPath('callback-form.png')});
  let submissions=0; page.on('request',r=>{if(r.url().endsWith('/api/contact/callback')&&r.method()==='POST')submissions++;});
  await page.getByRole('button',{name:'Перезвоните мне',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Заявка сохранена'})).toBeVisible();
  expect(submissions).toBe(1);
  await page.screenshot({path:testInfo.outputPath('contact-saved.png')});
  const anonymous = await page.request.get('/api/admin/callbacks');
  expect(anonymous.status()).toBe(401);
  await page.goto('/admin#callbacks');
  await page.getByLabel('Пароль',{exact:true}).fill('contact-fixture-only-password');
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  const row=page.locator('.callback-inbox-list li').filter({hasText:phone.replaceAll(' ','')});
  await expect(row).toBeVisible();
  await expect(page.locator('.admin-main')).toContainText('Обращения не публикуются на сайте.');
  await expect(page.locator('.admin-main')).not.toContainText('Изменения публикуются после сохранения.');
  await expect(row.getByRole('link')).toHaveAttribute('href','tel:'+phone.replaceAll(' ',''));
  await row.getByRole('button',{name:'Отметить обработанным'}).click();
  await expect(row).toContainText('Обработано');
  await page.reload();
  await expect(row).toContainText('Обработано');
  await page.screenshot({path:testInfo.outputPath('owner-inbox.png'),fullPage:true});
  expect(failures).toEqual([]);
});

test('lost response can retry without duplicating saved callback', async ({page},testInfo)=>{
  test.skip(testInfo.project.name !== 'contact-chromium-desktop', 'One stateful retry test; keep the shared synthetic fixture under the real rate limit.');
  await page.goto('/contact');
  await page.getByLabel('Ваш телефон',{exact:true}).fill('+1 202 555 01'+String(20+projectNumber(testInfo)).padStart(2,'0'));
  await page.getByRole('checkbox').check();
  let count=0;const keys=[];
  await page.route('**/api/contact/callback',async route=>{
    keys.push(route.request().postDataJSON().requestId);
    if(count++===0){await route.fetch();return route.abort('failed');}
    await route.continue();
  });
  await page.getByRole('button',{name:'Перезвоните мне',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось подтвердить');
  const handle=await page.evaluate(()=>sessionStorage.getItem('anna-callback-retry-v1'));
  expect(Object.keys(JSON.parse(handle)).sort()).toEqual(['consentVersion','requestId']);
  await page.reload();
  await page.getByLabel('Ваш телефон',{exact:true}).fill('+120255501'+String(20+projectNumber(testInfo)).padStart(2,'0'));
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'Перезвоните мне',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Заявка сохранена'})).toBeVisible();
  expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);
  expect(await page.evaluate(()=>sessionStorage.getItem('anna-callback-retry-v1'))).toBeNull();
});

test('disabled, consent changes and failures do not claim success or send without consent',async({page})=>{
  await page.route('**/api/contact/config',route=>route.fulfill({json:{enabled:false,reason:'Test disabled'}}));
  await page.goto('/contact');
  await expect(page.locator('.callback-unavailable')).toContainText('пока не подключён');
  await expect(page.getByLabel('Ваш телефон',{exact:true})).toHaveCount(0);
  await page.unroute('**/api/contact/config');
  await page.reload();
  await page.getByLabel('Ваш телефон',{exact:true}).fill('+12025550199');
  await page.getByRole('checkbox').check();
  await page.route('**/api/contact/callback',route=>route.fulfill({status:409,json:{code:'CONSENT_CHANGED',error:'Условия изменились. Подтвердите новые условия.'}}));
  await page.getByRole('button',{name:'Перезвоните мне',exact:true}).click();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByRole('heading',{name:'Заявка сохранена'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Перезвоните мне',exact:true})).toBeDisabled();
});

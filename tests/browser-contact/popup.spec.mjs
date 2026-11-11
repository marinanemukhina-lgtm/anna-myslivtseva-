import {test,expect} from '@playwright/test';
const enabled={enabled:true,consentVersion:'a'.repeat(64),consentText:'Synthetic operator consent only',consentUrl:'/callback-consent',privacyUrl:'/privacy'};
async function setup(page, native=true) {
 if(!native) await page.addInitScript(()=>{HTMLDialogElement.prototype.showModal=undefined;});
 await page.route('**/api/contact/config',r=>r.fulfill({json:enabled}));
 await page.goto('/contact');
 const trigger=page.getByRole('button',{name:'Оставить номер для звонка'});
 await trigger.click(); return trigger;
}
async function released(page) {
 await expect.poll(()=>page.evaluate(()=>[document.body.style.overflow,document.documentElement.style.overflow].includes('hidden'))).toBe(false);
}
test('single dialog preserves draft, resets consent, restores focus and supports fallback',async({page})=>{
 const trigger=await setup(page);
 const dialog=page.getByRole('dialog',{name:'Заказать обратный звонок'});
 await expect(dialog).toBeVisible(); await expect(page.locator('form.callback-form')).toHaveCount(1);
 const field=page.getByLabel('Ваш телефон',{exact:true}); await expect(field).toBeFocused();
 await field.fill('+12025550199'); await page.getByRole('checkbox').check();
 for(let i=0;i<12;i++) {await page.keyboard.press(i<6?'Tab':'Shift+Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);}
 await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();await released(page);
 await trigger.click();await expect(field).toHaveValue('+12025550199');await expect(page.getByRole('checkbox')).not.toBeChecked();
 await page.mouse.click(1,1);await expect(dialog).not.toBeVisible();await released(page);
 const ids=await page.locator('[id]').evaluateAll(nodes=>nodes.map(n=>n.id));expect(new Set(ids).size).toBe(ids.length);
});
test('unsupported dialog keeps one usable inline form',async({page})=>{
 await setup(page,false);await expect(page.locator('dialog.callback-dialog')).toHaveCount(0);
 await expect(page.getByLabel('Ваш телефон',{exact:true})).toBeVisible();await expect(page.locator('.callback-form')).toHaveCount(1);
});
test('pending close waits; uncertain result reopens with same idempotency key',async({page})=>{
 const trigger=await setup(page);let first,release;
 await page.route('**/api/contact/callback',async route=>{
  const request=route.request().postDataJSON();
  if(!first){first=request;await new Promise(resolve=>{release=resolve;});await route.abort('failed');}
  else {expect(request.requestId).toBe(first.requestId);await route.fulfill({json:{ok:true,requestId:request.requestId}});}
 });
 await page.getByLabel('Ваш телефон',{exact:true}).fill('+12025550199');await page.getByRole('checkbox').check();
 await page.getByRole('button',{name:'Перезвоните мне',exact:true}).click();await expect.poll(()=>Boolean(release)).toBe(true);
 await page.keyboard.press('Escape');await expect(page.locator('dialog.callback-dialog')).toBeVisible();
 await expect(page.getByText('Окно можно закрыть после ответа или сообщения о неопределённом результате.')).toBeVisible();
 release();await expect(page.getByRole('alert')).toContainText('Не удалось подтвердить');
 await page.keyboard.press('Escape');await released(page);await trigger.click();
 await expect(page.getByRole('checkbox')).not.toBeChecked();await expect(page.getByLabel('Ваш телефон',{exact:true})).toHaveValue('+12025550199');
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Перезвоните мне',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Заявка сохранена'})).toBeVisible();
 await page.getByRole('button',{name:'Закрыть форму обратного звонка'}).click();await released(page);
 await expect(page.getByRole('heading',{name:'Заявка сохранена'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Заявка сохранена'})).toBeFocused();
 await expect(page.getByRole('button',{name:'Оставить номер для звонка'})).toHaveCount(0);
});
for(const nextEnabled of [true,false]) test(`consent transition keeps safe modal and cleanup: enabled=${nextEnabled}`,async({page})=>{
 const trigger=await setup(page);
 await page.route('**/api/contact/config',r=>r.fulfill({json:{...enabled,enabled:nextEnabled,consentVersion:'b'.repeat(64)}}));
 await page.route('**/api/contact/callback',r=>r.fulfill({status:409,json:{code:'CONSENT_CHANGED',error:'Synthetic consent revision'}}));
 await page.getByLabel('Ваш телефон',{exact:true}).fill('+12025550199');await page.getByRole('checkbox').check();
 await page.getByRole('button',{name:'Перезвоните мне',exact:true}).click();
 if(nextEnabled){await expect(page.getByRole('checkbox')).not.toBeChecked();await expect(page.getByRole('button',{name:'Перезвоните мне',exact:true})).toBeDisabled();}
 else {await expect(page.locator('.callback-unavailable')).toBeVisible();await expect(page.locator('.callback-form')).toHaveCount(0);}
 await page.keyboard.press('Escape');await released(page);
 if(nextEnabled)await expect(trigger).toBeFocused();
});
test('timeout unlocks closing and route unmount releases locks while retaining only retry handle',async({page})=>{
 await page.clock.install();
 const trigger=await setup(page);
 await page.route('**/api/contact/callback',()=>{});
 await page.getByLabel('Ваш телефон',{exact:true}).fill('+12025550199');await page.getByRole('checkbox').check();
 await page.getByRole('button',{name:'Перезвоните мне',exact:true}).click();
 await expect(page.getByText('Сохраняем заявку. Дождитесь результата перед закрытием окна.')).toBeVisible();
 await page.clock.runFor(15100);
 await expect(page.getByRole('alert')).toContainText('Не удалось подтвердить');
 await page.keyboard.press('Escape');await released(page);await trigger.click();
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Перезвоните мне',exact:true}).click();
 await expect(page.getByText('Сохраняем заявку. Дождитесь результата перед закрытием окна.')).toBeVisible();
 await page.evaluate(()=>{history.pushState({},'', '/about');window.dispatchEvent(new PopStateEvent('popstate'));});
 await expect(page.locator('.callback-form')).toHaveCount(0);await released(page);
 const handle=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('anna-callback-retry-v1')));
 expect(Object.keys(handle).sort()).toEqual(['consentVersion','requestId']);
});

test('actual 503 disabled response closes intake but preserves an earlier opaque retry',async({page})=>{
 const key={requestId:'11111111-1111-4111-8111-111111111111',consentVersion:'a'.repeat(64)};
 await page.addInitScript(key=>sessionStorage.setItem('anna-callback-retry-v1',JSON.stringify({...key,unexpected:'must not transmit'})),key);
 await setup(page);
 await page.route('**/api/contact/callback',async r=>{
  expect(Object.keys(r.request().postDataJSON()).sort()).toEqual(['consent','consentVersion','phone','requestId','website']);
  await r.fulfill({status:503,json:{code:'CALLBACK_DISABLED',error:'Synthetic disabled'}});
 });
 await page.getByLabel('Ваш телефон',{exact:true}).fill('+12025550199');await page.getByRole('checkbox').check();
 await page.getByRole('button',{name:'Перезвоните мне',exact:true}).click();
 await expect(page.locator('.callback-unavailable')).toBeVisible();
 await expect(page.locator('.callback-form')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Оставить номер для звонка'})).toHaveCount(0);
 const cached=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('anna-callback-retry-v1')));
 expect(cached.requestId).toBe(key.requestId);expect(cached.consentVersion).toBe(key.consentVersion);
 await page.keyboard.press('Escape');await released(page);
});
test('reentrant open does not leak a second document lock',async({page})=>{
 const trigger=await setup(page);
 await trigger.evaluate(button=>{button.click();button.click();});
 await page.keyboard.press('Escape');await released(page);
 await expect(trigger).toBeFocused();
});

test('drag from dialog to backdrop preserves consent but an outside click closes',async({page})=>{
 await setup(page);
 const dialog=page.getByRole('dialog',{name:'Заказать обратный звонок'});
 await page.getByRole('checkbox').check();
 const box=await dialog.getByRole('heading').boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await page.mouse.down();await page.mouse.move(1,1,{steps:8});await page.mouse.up();
 await expect(dialog).toBeVisible();await expect(page.getByRole('checkbox')).toBeChecked();
 await page.mouse.click(1,1);await expect(dialog).not.toBeVisible();await released(page);
 await page.getByRole('button',{name:'Оставить номер для звонка'}).click();
 await expect(page.getByRole('checkbox')).not.toBeChecked();
});

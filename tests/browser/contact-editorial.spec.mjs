import { test, expect } from '@playwright/test';
import { initialContent } from '../../shared/content.mjs';

// Prepared only. Requires separately authorized browser/socket runtime.
// No test clicks tel/SMS/map links or submits callback intake.
async function fixture(page) {
 const data = structuredClone(initialContent);
 data.profile.phone = '+79000000000';
 data.profile.address = 'Тестовый город и выезд';
 data.profile.officeAddress = '';
 data.profile.directionsUrl = '';
 await page.route('**/api/content', route => route.fulfill({json:data}));
 await page.route('**/api/contact/config', route => route.fulfill({json:{enabled:false}}));
}
test('dialog locks focus and scroll, restores focus and offers only explicit device links', async ({page}) => {
 await fixture(page); await page.goto('/contact');
 const circle = page.locator('.phone-circle-link');
 await expect(circle).toHaveAttribute('href','tel:+79000000000');
 await expect(circle).toHaveAccessibleName('Позвонить Анне');
 expect(await circle.innerText()).toBe('');
 const trigger = page.locator('.contact-editorial').getByRole('button',{name:'Связаться',exact:true});
 await trigger.click();
 const dialog = page.getByRole('dialog',{name:'Связаться с Анной'});
 await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Закрыть выбор способа связи'})).toBeFocused();
 for(let i=0;i<6;i++) {
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
 }
 await expect(dialog.getByRole('link',{name:'Позвонить Анне'})).toHaveAttribute('href','tel:+79000000000');
 await expect(dialog.getByRole('link',{name:'Написать SMS Анне'})).toHaveAttribute('href','sms:+79000000000');
 const y = await page.evaluate(()=>scrollY);
 await page.mouse.wheel(0,400);
 await page.waitForTimeout(200);
 expect(await page.evaluate(()=>scrollY)).toBe(y);
 await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
 expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
 await expect(page.locator('.callback-section input')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:test.info().outputPath('contact-editorial.png'),fullPage:true});
});
test('home and services keep readable DOM, every route and safe unpublished office', async ({page}) => {
 await fixture(page);
 for(const route of ['/','/services','/contact','/about','/diplomas','/news','/offers','/privacy','/terms','/callback-consent','/not-found']) {
  await page.goto(route);
  await expect(page.locator('h1')).toBeVisible();
  const headerBottom = await page.locator('.site-header').evaluate(el=>el.getBoundingClientRect().bottom);
  const titleTop = await page.locator('h1').evaluate(el=>el.getBoundingClientRect().top);
  expect(titleTop).toBeGreaterThanOrEqual(headerBottom);
  await expect(page.getByRole('button',{name:'Меню',exact:true})).toBeVisible();
  await expect(page.locator('footer')).toBeVisible();
  await expect(page.locator('footer a[href="/diplomas"]')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.getByRole('link',{name:/Как добраться/})).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath((route.slice(1)||'home')+'.png'),fullPage:true});
 }
});
test('unsupported native dialog uses real contact route without fake modality', async ({page})=>{
 await page.addInitScript(()=>{HTMLDialogElement.prototype.showModal=undefined;});
 await fixture(page); await page.goto('/');
 await expect(page.locator('.hero-contact')).toHaveAttribute('href','/contact');
 await expect(page.locator('dialog')).toHaveCount(0);
});
test('capture known public identity with full role and no invented services or prices', async ({page},testInfo)=>{
 const data=structuredClone(initialContent);
 Object.assign(data.profile,{name:'Анна Мысливцева',role:'Остеопат специалист Мягких Мануальных Техник',phone:'+7 (908) 502-38-53',address:'Ростов-на-Дону. Выезд на дом по предварительной записи.'});
 await page.route('**/api/content',route=>route.fulfill({json:data}));
 await page.route('**/api/contact/config',route=>route.fulfill({json:{enabled:false}}));
 for(const route of ['/','/contact','/services']){
  await page.goto(route);
  await expect(page.locator('footer')).toContainText(data.profile.role);
  await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('input[type="tel"]')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('known-public-fixture-'+(route.slice(1)||'home')+'.png'),fullPage:true});
 }
});

for (const width of [701, 1023]) {
 test(`tablet boundary ${width} keeps direct contact above the fold on public routes`, async ({page}, testInfo) => {
  await page.setViewportSize({width, height:390});
  await fixture(page);
  for (const route of ['/','/services','/contact','/about','/diplomas','/news','/offers','/privacy','/terms','/callback-consent']) {
   await page.goto(route);
   const trigger=page.locator('.site-header .header-contact');
   await expect(trigger).toBeVisible();
   await expect(trigger).toHaveRole('button');
   await expect(page.locator('.header-navigation')).toBeHidden();
   const box=await trigger.boundingBox();
   expect(box.y).toBeGreaterThanOrEqual(0);
   expect(box.y+box.height).toBeLessThanOrEqual(390);
   expect(box.x).toBeGreaterThanOrEqual(0);
   expect(box.x+box.width).toBeLessThanOrEqual(width);
   await trigger.click();
   await expect(page.getByRole('dialog',{name:'Связаться с Анной'})).toBeVisible();
   await page.keyboard.press('Escape');
   await expect(trigger).toBeFocused();
   await page.screenshot({path:testInfo.outputPath(`header-${width}-${route.slice(1)||'home'}.png`)});
  }
 });
}

test.describe('smooth scrolling remains isolated from the native dialog', () => {
 test.use({reducedMotion:'no-preference',viewport:{width:844,height:390}});
 test('Lenis stops background scrolling but permits overflow inside the chooser', async ({page},testInfo) => {
  await fixture(page); await page.goto('/contact');
  await expect(page.locator('html')).toHaveClass(/lenis/);
  const trigger=page.locator('.site-header .header-contact');
  await expect(trigger).toBeVisible();
  await trigger.click();
  const dialog=page.getByRole('dialog',{name:'Связаться с Анной'});
  await expect(dialog).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/lenis-stopped/);
  // Ensure overflow independently of the platform's font metrics.
  await dialog.evaluate(el=>{el.style.maxHeight='220px';el.scrollTop=0;});
  const y=await page.evaluate(()=>scrollY);
  const box=await dialog.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.wheel(0,200);
  await expect.poll(()=>dialog.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>scrollY)).toBe(y);
  await page.screenshot({path:testInfo.outputPath('dialog-native-overflow-lenis.png')});
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.locator('html')).not.toHaveClass(/lenis-stopped/);
  expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
 });
});

import {test, expect} from '@playwright/test';
import {initialContent} from '../../shared/content.mjs';

const telegram = 'https://t.me/synthetic_anna_channel';
const vk = 'https://vk.com/synthetic_anna';
const hydrationLink = 'https://vk.com/synthetic_hydration_marker';
async function fixture(page, socialLinks = {telegram, vk}) {
  const data = structuredClone(initialContent);
  data.profile.phone = '+7 (900) 000-00-01';
  data.profile.socialUrl = '';
  data.profile.socialLinks = socialLinks;
  await page.route('**/api/content', route => route.fulfill({json:data}));
}
async function gotoContent(page, url) {
  const pathname = new URL(url, 'http://fixture.invalid').pathname;
  const pending = page.waitForResponse(response => {
    const request = response.request();
    const referer = request.headers().referer;
    return new URL(response.url()).pathname === '/api/content' && request.method() === 'GET'
      && Boolean(referer) && new URL(referer).pathname === pathname;
  });
  await page.goto(url);
  const response = await pending;
  expect(response.status()).toBe(200);
  expect(await response.finished()).toBeNull();
  return response.json();
}

for (const width of [320,390,1440]) {
  test(`CMS channel destinations remain reachable from home, services, menu and footer at ${width}px`, async ({page}, testInfo) => {
    await page.setViewportSize({width,height:900});
    await fixture(page);
    const writes = [], errors = [], intake = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/contact/')) intake.push(r.url()); if (r.method() !== 'GET' && r.method() !== 'HEAD') writes.push(r.url()); });
    await page.goto('/');
    const footerChannel = page.locator('footer').getByRole('link',{name:/Канал в Telegram/});
    await expect(footerChannel).toHaveAttribute('href',telegram);
    await page.getByRole('button',{name:'Меню',exact:true}).click();
    const menu = page.getByRole('dialog',{name:'Главное меню'});
    await expect(menu.getByRole('button',{name:'Закрыть',exact:true})).toBeFocused();
    const channel = menu.getByRole('link',{name:/Канал в Telegram/});
    await expect(channel).toHaveAttribute('href',telegram);
    await channel.focus();
    await expect(channel).toBeFocused();
    await expect(channel).toHaveAttribute('rel','noopener noreferrer');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button',{name:'Меню',exact:true})).toBeFocused();
    await page.locator('.site-header .book-link').click();
    await expect(page).toHaveURL(/\/contact$/);
    await expect(page.locator('.contact-intro').getByRole('link',{name:/Канал в Telegram/})).toHaveAttribute('href',telegram);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/services');
    await expect(footerChannel).toHaveAttribute('href',telegram);
    const footerPhone = page.locator('footer a[href="tel:+79000000001"]');
    await expect(footerPhone).toBeVisible();
    expect(await footerPhone.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.locator('.footer-contact-link').click();
    await expect(page).toHaveURL(/\/contact$/);
    await page.reload();
    const mainChannel = page.locator('.contact-intro').getByRole('link',{name:/Канал в Telegram/});
    await expect(mainChannel).toHaveAttribute('href',telegram);
    await mainChannel.focus();
    await expect(mainChannel).toBeFocused();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (width <= 390) {
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('footer .contacts, .contact-section')).toHaveCount(0);
      const phone = page.locator('.contact-primary span').last();
      const sms = page.locator('.contact-intro a[href="sms:+79000000001"]');
      for (const text of [phone, sms]) {
        await expect(text).toBeVisible();
        expect(await text.evaluate(element => {
          const range = document.createRange();
          range.selectNodeContents(element.firstChild);
          return [...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.y)).filter((y, index, values) => values.indexOf(y) === index).length;
        })).toBe(1);
      }
    }

    await expect(page.locator('input[type="tel"], #callback')).toHaveCount(0);
    expect(writes).toEqual([]);
    expect(intake).toEqual([]);
    expect(errors).toEqual([]);
    // Do not activate external apps or send actual messages.
    await page.screenshot({path:testInfo.outputPath(`channel-contact-${width}.png`),fullPage:true});
  });
}

test('empty, removed and invalid structured links are hidden everywhere', async ({page}) => {
  for (const socialLinks of [{}, {telegram:''}, {telegram:'javascript:alert(1)', vk:'https://t.me/wrong_service'}]) {
    await page.unroute('**/api/content');
    await fixture(page,socialLinks);
    const loaded = await gotoContent(page, '/contact');
    expect(loaded.profile.socialLinks).toEqual(socialLinks);
    await expect(page.locator('.contact-intro a[href="tel:+79000000001"]')).toBeVisible();
    await expect(page.locator('.social-links')).toHaveCount(0);
    await page.getByRole('button',{name:'Меню',exact:true}).click();
    await expect(page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true})).toBeFocused();
    await expect(page.getByRole('dialog').locator('.social-links')).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
});

test('admin can add, replace, reload and remove a future channel without losing profile fields', async ({page,baseURL}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'one isolated synthetic CMS persistence run');
  expect(baseURL).toBe('http://127.0.0.1:4176');
  await page.goto('/admin');
  await page.getByLabel('Пароль',{exact:true}).fill('browser-fixture-only-password');
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(page.getByRole('button',{name:'Сохранить изменения',exact:true}).first()).toBeVisible();
  const original = await (await page.request.get('/api/admin/content')).json();
  try {
    await page.getByRole('button',{name:'Соцсети',exact:true}).click();
    // Field's label also contains its changing help text; match the unique title prefix.
    const field = page.getByRole('textbox',{name:/^Telegram · канал · ссылка(?:\s|$)/});
    const legacy = page.getByRole('textbox',{name:/^Основная ссылка на соцсеть(?:\s|$)/});
    await expect(field).toBeVisible();
    // A non-Telegram marker proves public hydration even after removing Telegram.
    await legacy.fill(hydrationLink);
    for (const value of [telegram, 'https://t.me/synthetic_replacement', '']) {
      await field.fill(value);
      const response = page.waitForResponse(r=>new URL(r.url()).pathname === '/api/admin/content' && r.request().method()==='PUT');
      await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
      expect((await response).status()).toBe(200);
      await page.reload();
      await expect(field).toHaveValue(value);
      const saved = await (await page.request.get('/api/admin/content')).json();
      expect(saved.data.profile.phone).toBe(original.data.profile.phone);
      expect(saved.data.profile.about).toBe(original.data.profile.about);
      expect(saved.data.services).toEqual(original.data.services);
      const publicPage = await page.context().newPage();
      const publicData = await gotoContent(publicPage, '/contact');
      expect(publicData.profile.socialLinks.telegram).toBe(value);
      expect(publicData.profile.socialUrl).toBe(hydrationLink);
      await expect(publicPage.locator(`.contact-intro a[href="${hydrationLink}"]`)).toBeVisible();
      if (value) await expect(publicPage.locator('.contact-intro').getByRole('link',{name:/Канал в Telegram/})).toHaveAttribute('href',value);
      else await expect(publicPage.locator('.social-links a[href*="t.me/"]')).toHaveCount(0);
      await publicPage.close();
    }
  } finally {
    const current = await (await page.request.get('/api/admin/content')).json();
    expect((await page.request.put('/api/admin/content',{headers:{origin:baseURL},data:{data:original.data,version:current.version}})).status()).toBe(200);
  }
});

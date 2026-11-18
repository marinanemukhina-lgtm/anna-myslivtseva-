import {test, expect} from '@playwright/test';

test('published article retains server metadata when content refresh fails', async ({page, baseURL}) => {
 const login = await page.request.post('/api/session', {headers:{origin:baseURL},data:{password:'browser-fixture-only-password'}});
 expect(login.ok()).toBe(true);
 const original = await (await page.request.get('/api/admin/content')).json();
 const data = structuredClone(original.data);
 data.news.push({id:'seo-fixture',title:'Проверочная статья SEO',body:'Синтетический материал',image:'',published:true,date:''});
 const write = await page.request.put('/api/admin/content',{headers:{origin:baseURL},data:{version:original.version,data}});
 expect(write.ok()).toBe(true);
 try {
  await page.route('**/api/content', route => route.fulfill({status:503,contentType:'application/json',body:'{}'}));
  await page.goto('/news/seo-fixture');
  await expect(page.getByRole('status')).toContainText('Не удалось обновить');
  await expect(page).toHaveTitle('Проверочная статья SEO');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href','https://osteopatrostov.ru/news/seo-fixture');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content','index, follow');
  await page.unroute('**/api/content');
  await page.reload();
  await expect(page.getByRole('heading',{name:'Проверочная статья SEO',exact:true})).toBeVisible();
  await expect(page).toHaveTitle('Проверочная статья SEO');
  await page.goto('/news/missing-fixture');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content','noindex, nofollow');
 } finally {
  const current = await (await page.request.get('/api/admin/content')).json();
  await page.request.put('/api/admin/content',{headers:{origin:baseURL},data:{version:current.version,data:original.data}});
 }
});


test('public head is stable across loading and navigation; empty sections and private routes stay excluded', async ({page}) => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/content', async route => { await pending; await route.continue(); });
  await page.goto('/about', {waitUntil:'domcontentloaded'});
  await expect(page).toHaveTitle('Об Анне Мысливцевой — сведения о специалисте');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href','https://osteopatrostov.ru/about');
  release();
  await expect(page.getByRole('heading',{name:'Об Анне',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Услуги и цены',exact:true}).last().click();
  await expect(page).toHaveURL(/\/services$/);
  await expect(page).toHaveTitle('Услуги и стоимость — Анна Мысливцева');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href','https://osteopatrostov.ru/services');
  await expect(page.locator('meta[name="description"]')).toHaveCount(1);
  await page.unroute('**/api/content');
  for (const path of ['/news','/offers','/terms']) {
    const response = await page.goto(path);
    expect(response.status()).toBe(200);
    expect(response.headers()['x-robots-tag']).toBe('noindex, follow');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content','noindex, follow');
  }
  const sitemap = await page.request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()['content-type']).toContain('application/xml');
  expect(await sitemap.text()).toContain('https://osteopatrostov.ru/about');
  expect(await sitemap.text()).not.toMatch(/vercel|\/news|\/offers|\/terms|\/admin/);
  for (const path of ['/admin','/demo/booking','/missing-seo-fixture']) {
    await page.goto(path);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content','noindex, nofollow');
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  }
});


test('returning to the entry page restores its server metadata when the initial content request fails', async ({page}) => {
  await page.route('**/api/content', route => route.fulfill({status:503,contentType:'application/json',body:'{}'}));
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('Не удалось обновить');
  const title = await page.title();
  const description = await page.locator('meta[name="description"]').getAttribute('content');
  await page.getByRole('link',{name:'Новости',exact:true}).last().click();
  await expect(page).toHaveURL(/\/news$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content','noindex, follow');
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page).toHaveTitle(title);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content',description);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content','index, follow');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href','https://osteopatrostov.ru/');
});

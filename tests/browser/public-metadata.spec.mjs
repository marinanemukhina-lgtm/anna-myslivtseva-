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
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href','https://anna-myslivtseva.vercel.app/news/seo-fixture');
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
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

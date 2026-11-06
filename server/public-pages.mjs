import { readFile } from 'node:fs/promises';
import { readContent } from './db.mjs';
import { initialContent, publicContent } from '../shared/content.mjs';
const origin = 'https://anna-myslivtseva.vercel.app';
const titles = {'/':'Анна Мысливцева · Остеопат','/services':'Услуги и цены','/about':'Об Анне','/news':'Новости','/offers':'Акции','/diplomas':'Образование и дипломы','/contact':'Запись на приём','/privacy':'Конфиденциальность','/terms':'Условия'};
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderPublicPage(template, pathname, raw) {
  const data = publicContent(raw), p = data.profile;
  const parts = pathname.split('/').filter(Boolean);
  const collection = ['news','offers'].includes(parts[0]) ? data[parts[0]] : null;
  const article = collection && parts.length === 2 ? collection.find(x => x.id === parts[1]) : null;
  const demo = ['/demo/booking', '/admin/patients', '/demo/patients'].includes(pathname);
  const admin = ['/admin','/admin/setup'].includes(pathname);
  const known = Object.hasOwn(titles, pathname) || !!article || admin || demo;
  const status = known ? 200 : 404;
  const title = article?.title || titles[pathname] || (demo ? 'Демонстрация записи · Только вымышленные данные' : admin ? 'Вход' : 'Страница не найдена');
  let content = '';
  const paragraphs = values => values.filter(Boolean).map(x => `<p>${escapeHtml(x)}</p>`).join('');
  if (pathname === '/' || pathname === '/about') content = paragraphs([p.name,p.role,p.intro,p.about,p.philosophy,p.approach,p.qualification]);
  if (pathname === '/contact') content = paragraphs([p.phone,p.email,p.address,p.hours]);
  if (['/privacy','/terms'].includes(pathname)) content = paragraphs([p[parts[0]]]);
  const items = article ? [article] : data[parts[0]];
  if (Array.isArray(items)) content += items.map(x => `<section><h2>${escapeHtml(x.title)}</h2>${paragraphs([x.body,x.price,x.duration,x.issuer,x.year])}${['news','offers'].includes(parts[0]) ? `<a href="/${parts[0]}/${encodeURIComponent(x.id)}">Подробнее</a>` : ''}</section>`).join('');
  const nav = Object.entries(titles).map(([url,label])=>`<a href="${url}">${escapeHtml(label)}</a>`).join(' · ');
  const noindex = !known || admin || demo;
  const head = `<title>${escapeHtml(title)}</title>${noindex ? '<meta name="robots" content="noindex, nofollow">' : `<link rel="canonical" href="${origin}${escapeHtml(pathname)}">`}`;
  const html = template.replace(/<title>[\s\S]*?<\/title>/, head).replace('<div id="root"></div>', `<div id="root"><main><h1>${escapeHtml(title)}</h1>${content}<nav>${nav}</nav></main></div>`);
  return {html,status,noindex};
}
export function registerPublicPages(app) {
  app.get('/{*path}', async (req,res,next) => {
    if (/^\/(api|assets|media)(\/|$)/.test(req.path) || /\.[a-z0-9]+$/i.test(req.path)) return next();
    if (req.path !== '/' && req.path.endsWith('/')) return res.redirect(308, req.path.replace(/^\/+/, '/').replace(/\/+$/, '') + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''));
    try {
      const template = await readFile(new URL('../dist/client/index.html', import.meta.url),'utf8');
      const raw = process.env.VERCEL && !process.env.DATABASE_URL ? initialContent : (await readContent()).data;
      const result = renderPublicPage(template,req.path,raw);
      res.set('Cache-Control','no-store');
      if (result.noindex) res.set('X-Robots-Tag','noindex, nofollow');
      res.status(result.status).type('html').send(result.html);
    } catch (e) { next(e); }
  });
}

import { readFile } from 'node:fs/promises';
import { publicContent } from '../shared/content.mjs';
import { publicSocialLinks } from '../shared/contact-links.mjs';
import { contactMethods } from '../src/contact-methods.mjs';
import { metadataFor, publicPageTitles as titles } from '../shared/seo.mjs';
import { readPublicSource } from './seo.mjs';
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
  const patientDemo = ['/admin/patients', '/demo/patients'].includes(pathname);
  const title = (patientDemo ? 'Пациенты и истории · Фото до и после' : '') || article?.title || titles[pathname] || (demo ? 'Демонстрация записи · Только вымышленные данные' : admin ? 'Вход' : 'Страница не найдена');
  let content = '';
  const paragraphs = values => values.filter(Boolean).map(x => `<p>${escapeHtml(x)}</p>`).join('');
  if (pathname === '/' || pathname === '/about') content = paragraphs([p.name,p.role,p.intro,p.about,p.philosophy,p.approach,p.qualification]);
  if (pathname === '/') content += paragraphs([
    p.address,
    p.philosophy ? '' : 'Прежде чем записаться — познакомьтесь со специалистом и его образованием.',
    p.approach ? '' : 'Информация об услугах, стоимости и записи. В одном месте, в вашем ритме.',
    'За каждым приёмом — человек.',
    p.approach ? '' : 'Познакомьтесь с Анной: биография и сведения об образовании собраны на отдельной странице.',
  ]);
  if (pathname === '/about') content += data.diplomas.slice(0, 3).map(x => `<section><h2>${escapeHtml(x.title)}</h2>${paragraphs([x.body,x.issuer,x.year])}</section>`).join('');
  if (pathname === '/contact') {
    content = paragraphs([p.email,p.address,p.hours]);
    const {phone, displayPhone, smsHref} = contactMethods(p);
    if (phone) content += `<p><a href="tel:${escapeHtml(phone)}">Позвонить Анне: ${escapeHtml(displayPhone)}</a></p>`;
    if (smsHref) content += `<p><a href="${escapeHtml(smsHref)}">Написать SMS</a></p>`;
    content += publicSocialLinks(p).map(({label,href}) => `<p><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></p>`).join('');
  }
  if (['/privacy','/terms'].includes(pathname)) content = paragraphs([p[parts[0]]]);
  const items = article ? [article] : data[parts[0]];
  if (Array.isArray(items)) content += items.map(x => `<section><h2>${escapeHtml(x.title)}</h2>${paragraphs([x.body,x.price,x.duration,x.issuer,x.year])}${['news','offers'].includes(parts[0]) ? `<a href="/${parts[0]}/${encodeURIComponent(x.id)}">Подробнее</a>` : ''}</section>`).join('');
  const nav = Object.entries(titles).map(([url,label])=>`<a href="${url}">${escapeHtml(label)}</a>`).join(' · ');
  const meta = metadataFor(pathname, data);
  const noindex = meta.robots.startsWith('noindex');
  const head = `<title>${escapeHtml(meta.title)}</title><meta name="description" content="${escapeHtml(meta.description)}"><meta name="robots" content="${meta.robots}">${meta.canonical ? `<link rel="canonical" href="${escapeHtml(meta.canonical)}">` : ''}`;
  const html = template.replace(/<meta\b[^>]*name=["'](?:description|robots)["'][^>]*>/gi, '')
    .replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi, '')
    .replace(/<title>[\s\S]*?<\/title>/, head)
    .replace('<div id="root"></div>', `<div id="root"><main><h1>${escapeHtml(title)}</h1>${content}<nav>${nav}</nav></main></div>`);
  return {html,status,noindex,robots:meta.robots};
}
export function registerPublicPages(app) {
  app.get('/{*path}', async (req,res,next) => {
    if (/^\/(api|assets|media)(\/|$)/.test(req.path) || /\.[a-z0-9]+$/i.test(req.path)) return next();
    if (req.path !== '/' && req.path.endsWith('/')) return res.redirect(308, req.path.replace(/^\/+/, '/').replace(/\/+$/, '') + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''));
    try {
      const template = await readFile(new URL('../dist/client/index.html', import.meta.url),'utf8');
      const raw = await readPublicSource();
      const result = renderPublicPage(template,req.path,raw);
      res.set('Cache-Control','no-store');
      if (result.noindex) res.set('X-Robots-Tag',result.robots);
      res.status(result.status).type('html').send(result.html);
    } catch (e) { next(e); }
  });
}

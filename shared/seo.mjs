// Shared by initial HTML, React navigation and the sitemap. Never infer identity from Host.
// Yandex: https://yandex.ru/support/webmaster/robot-workings/canonical.html
export const SITE_ORIGIN = 'https://osteopatrostov.ru';
export const publicPageTitles = {
  '/': 'Анна Мысливцева · Остеопат', '/services': 'Услуги и цены', '/about': 'Об Анне',
  '/news': 'Новости', '/offers': 'Акции', '/diplomas': 'Образование и дипломы',
  '/contact': 'Запись на приём', '/privacy': 'Конфиденциальность', '/terms': 'Условия',
};
const clean = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const published = (data, kind) => (data?.[kind] || []).filter(item => item.published);
export function indexablePaths(data) {
  const paths = ['/', '/about'];
  for (const kind of ['services', 'diplomas']) if (published(data, kind).length) paths.push('/' + kind);
  const p = data?.profile || {};
  if ([p.phone, p.email, p.address, p.bookingUrl, p.socialUrl, ...Object.values(p.socialLinks || {})].some(clean)) paths.push('/contact');
  for (const kind of ['privacy', 'terms']) if (clean(p[kind])) paths.push('/' + kind);
  for (const kind of ['news', 'offers']) {
    const items = published(data, kind);
    if (items.length) paths.push('/' + kind);
    for (const item of items) paths.push('/' + kind + '/' + encodeURIComponent(item.id));
  }
  return paths;
}
export function metadataFor(pathname, data) {
  const p = data?.profile || {};
  const name = clean(p.name) || 'Анна Мысливцева';
  const match = pathname.match(/^\/(news|offers)\/([a-zA-Z0-9_-]{1,80})$/);
  const article = match && published(data, match[1]).find(item => item.id === match[2]);
  const publicPage = Object.hasOwn(publicPageTitles, pathname) || !!article;
  const indexable = indexablePaths(data).includes(pathname);
  const titles = {
    '/': name + ' · Остеопат' + (clean(p.address).includes('Ростов-на-Дону') ? ' — Ростов-на-Дону' : ''),
    '/about': 'Об Анне Мысливцевой — сведения о специалисте',
    '/services': 'Услуги и стоимость — ' + name,
    '/diplomas': 'Образование и дипломы — ' + name,
    '/contact': 'Контакты и запись — ' + name,
    '/news': 'Новости Анны Мысливцевой', '/offers': 'Акции и предложения — ' + name,
    '/privacy': 'Политика конфиденциальности — ' + name,
    '/terms': 'Условия использования сайта — ' + name,
  };
  const descriptions = {
    '/': name + '. Сведения о специалисте, образовании, услугах, стоимости и способах связи.' + (clean(p.address) ? ' ' + clean(p.address) : ''),
    '/about': clean(p.about) || 'Сведения об Анне Мысливцевой, её подходе и образовании.',
    '/services': indexable ? 'Опубликованные услуги Анны Мысливцевой: описания и стоимость. Контакты для уточнения деталей и записи.' : 'Раздел услуг Анны Мысливцевой. Публикации пока отсутствуют.',
    '/diplomas': indexable ? 'Сведения об образовании Анны Мысливцевой: опубликованные карточки обучения, дипломов и сертификатов.' : 'Раздел образования Анны Мысливцевой. Публикации пока отсутствуют.',
    '/contact': 'Способы связи с Анной Мысливцевой для уточнения деталей и записи.' + (clean(p.address) ? ' ' + clean(p.address) : ''),
    '/news': indexable ? 'Опубликованные новости Анны Мысливцевой.' : 'Раздел новостей Анны Мысливцевой. Новости пока не опубликованы.',
    '/offers': indexable ? 'Опубликованные акции и предложения Анны Мысливцевой, их стоимость и условия.' : 'Раздел акций Анны Мысливцевой. Предложения пока не опубликованы.',
    '/privacy': 'Политика конфиденциальности и обработки персональных данных на сайте Анны Мысливцевой.',
    '/terms': indexable ? 'Опубликованные условия использования сайта Анны Мысливцевой.' : 'Раздел условий использования сайта Анны Мысливцевой. Документ пока не опубликован.',
  };
  return {
    title: article?.title || titles[pathname] || (pathname.startsWith('/admin') ? 'Панель управления · ' + name : pathname.startsWith('/demo') ? 'Демонстрация · ' + name : 'Страница не найдена'),
    description: article ? clean(article.body).slice(0, 180) || article.title : (descriptions[pathname] || ''),
    canonical: publicPage ? SITE_ORIGIN + pathname : null,
    robots: indexable ? 'index, follow' : publicPage ? 'noindex, follow' : 'noindex, nofollow',
  };
}
const xmlEscape = value => value.replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));
export function sitemapXml(data) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    indexablePaths(data).map(path => '<url><loc>' + xmlEscape(SITE_ORIGIN + path) + '</loc></url>').join('\n') + '\n</urlset>\n';
}

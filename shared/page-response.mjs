import { canonicalMetadata } from './seo.mjs';
const staticPages = new Set(['/', '/about', '/services', '/diplomas', '/contact', '/news', '/offers', '/privacy', '/terms']);
export function resolvePage(rawPath, publicData) {
  const path = String(rawPath).split('?')[0];
  if (/%2f|%5c|\\|%00/i.test(path)) return { path, status: 404 };
  let decoded;
  try { decoded = decodeURIComponent(path); } catch { return { path, status: 404 }; }
  if (decoded.includes('\0') || decoded !== path) return { path, status: 404 };
  const normalized = path.length > 1 ? path.replace(/\/$/, '') : path;
  if (staticPages.has(normalized) || ['/admin','/admin/setup'].includes(normalized)) return { path: normalized, status: 200 };
  const match = normalized.match(/^\/(news|offers)\/([a-zA-Z0-9_-]{1,80})$/);
  const exists = match && publicData?.[match[1]]?.some(item => item.id === match[2] && item.published);
  return { path: normalized, status: exists ? 200 : 404 };
}
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export function pageHtml(template, path, data, primaryOrigin, currentOrigin, status) {
  const meta = canonicalMetadata(path, data, primaryOrigin, currentOrigin);
  if (status !== 200) { meta.robots = 'noindex, nofollow'; meta.title = status === 404 ? 'Страница не найдена' : 'Сайт временно недоступен'; meta.canonical = null; }
  const tags = [`<title>${escape(meta.title)}</title>`, `<meta name="description" content="${escape(meta.description)}">`, `<meta name="robots" content="${meta.robots}">`, `<meta property="og:title" content="${escape(meta.title)}">`, `<meta property="og:description" content="${escape(meta.description)}">`, '<meta property="og:type" content="website">', '<meta property="og:locale" content="ru_RU">'];
  if (meta.canonical) tags.push(`<link rel="canonical" href="${escape(meta.canonical)}">`, `<meta property="og:url" content="${escape(meta.canonical)}">`);
  // Reuse the existing public portrait, never generate a new visual identity.
  const portrait = data.profile?.portrait;
  if (meta.origin && typeof portrait === 'string' && /^\/(?:media|api\/media)\//.test(portrait)) {
    const image = new URL(portrait, meta.origin);
    if (image.origin === meta.origin && /^\/(?:media|api\/media)\//.test(image.pathname))
      tags.push(`<meta property="og:image" content="${escape(image.href)}">`, `<meta property="og:image:alt" content="${escape(data.profile?.name || 'Анна Мысливцева')}">`);
  }
  if (meta.robots === 'index, follow') {
    const person = {'@context':'https://schema.org','@type':'Person',name:data.profile?.name || 'Анна Мысливцева',jobTitle:data.profile?.role || 'специалист',url:meta.origin+'/'};
    tags.push('<script id="site-person-structured-data" type="application/ld+json">'+JSON.stringify(person).replaceAll('<','\\u003c')+'</script>');
  }
  const marker = /<!-- SEO:START -->[\s\S]*?<!-- SEO:END -->/;
  if (!marker.test(template)) throw new Error('Missing SEO template marker');
  return { html:template.replace(marker, ()=>'<!-- SEO:START -->\n'+tags.join('\n')+'\n<!-- SEO:END -->'), robots:meta.robots };
}
export function isDocumentPath(path) {
  return !/^\/(?:api|assets|media)(?:\/|$)/.test(path) && !/\.[a-z0-9]+$/i.test(path);
}

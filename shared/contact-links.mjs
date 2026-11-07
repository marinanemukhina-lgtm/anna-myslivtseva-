// Public destinations are owner-maintained CMS values, never inferred from a phone.
export function safePublicUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000 || /[\s\\\u0000-\u001f\u007f]/.test(value.trim())) return '';
  try {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password || url.port) return '';
    return url.href;
  } catch { return ''; }
}
export const socialDestinations = [
  ['telegram', 'Канал в Telegram', ['t.me', 'telegram.me']],
  ['max', 'Страница в MAX', ['max.ru']],
  ['vk', 'Страница ВКонтакте', ['vk.com', 'vk.ru']],
  ['instagram', 'Страница в Instagram', ['instagram.com']],
  ['whatsapp', 'Открыть WhatsApp', ['wa.me', 'whatsapp.com', 'api.whatsapp.com', 'chat.whatsapp.com'] ],
];
export function socialLink(key, value) {
  const href = safePublicUrl(value);
  const item = socialDestinations.find(([id]) => id === key);
  if (!href || !item) return '';
  const url = new URL(href);
  const host = url.hostname.replace(/^www\./, '');
  if (url.protocol !== 'https:' || !item[2].includes(host) || url.hash) return '';
  const path = url.pathname.replace(/\/$/, '');
  if (key === 'telegram') {
    const reserved = /^(?:share|proxy|socks|login|joinchat|addstickers|addemoji|addlist|setlanguage|iv|confirmphone|contact|invoice|giftcode|boost|s|c)$/i;
    return !url.search && /^\/[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(path) && !reserved.test(path.slice(1)) ? href : '';
  }
  if (key === 'instagram' || key === 'vk' || key === 'max') {
    const reserved = /^(?:accounts|login|logout|share|settings|search|feed|explore|reels|direct|oauth|authorize|join|help|privacy|terms|api)$/i;
    return !url.search && /^\/[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(path) && !reserved.test(path.slice(1)) ? href : '';
  }
  if (key === 'whatsapp') {
    if (host === 'wa.me') return !url.search && /^\/[1-9]\d{7,14}$/.test(path) ? href : '';
    if (host === 'chat.whatsapp.com') return !url.search && /^\/[a-zA-Z0-9]{16,}$/.test(path) ? href : '';
    if (host === 'whatsapp.com') return !url.search && /^\/channel\/[a-zA-Z0-9]+$/.test(path) ? href : '';
    if (host === 'api.whatsapp.com') return path === '/send' && url.searchParams.size === 1 && url.searchParams.has('phone') && /^[1-9]\d{7,14}$/.test(url.searchParams.get('phone') || '') ? href : '';
  }
  return '';
}
export function socialIdentity(value) {
  const href = safePublicUrl(value);
  if (!href) return '';
  const url = new URL(href);
  let host = url.hostname.replace(/^www\./, '');
  if (host === 'telegram.me') host = 't.me';
  const pathname = url.pathname.replace(/\/$/, '');
  return host + (host === 't.me' ? pathname.toLowerCase() : pathname) + url.search;
}
export function publicSocialLinks(profile = {}) {
  const links = socialDestinations.flatMap(([key, label]) => {
    const href = socialLink(key, profile.socialLinks?.[key]);
    return href ? [{ key, label, href }] : [];
  });
  const legacy = safePublicUrl(profile.socialUrl);
  const legacyHost = legacy ? new URL(legacy).hostname.replace(/^www\./, '') : '';
  const knownHost = socialDestinations.find(([, , hosts]) => hosts.includes(legacyHost));
  const allowedLegacy = legacy && (!knownHost || socialLink(knownHost[0], legacy));
  if (allowedLegacy && !links.some(link => socialIdentity(link.href) === socialIdentity(legacy))) {
    const known = socialDestinations.find(([key]) => socialLink(key, legacy));
    links.push({ key: 'primary', label: known?.[1] || 'Социальная сеть Анны', href: legacy });
  }
  return links;
}

export function updateSocialProfile(profile, key, value) {
  const next = { ...profile, socialLinks: { ...profile.socialLinks, [key]: value.trim() } };
  // Editing/removing a structured destination must not resurrect its duplicate legacy URL.
  const previous = socialLink(key, profile.socialLinks?.[key]);
  if (previous && socialIdentity(profile.socialUrl) === socialIdentity(previous)) next.socialUrl = '';
  return next;
}

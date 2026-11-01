// Technical search metadata. Never invent location, credentials, reviews or clinical outcomes.
const clean = value => typeof value === "string" ? value.trim() : "";
const safePath = path => String(path || "/").split("?")[0].split("#")[0] || "/";

export function indexablePaths(data) {
  const pages = ["/", "/about"];
  if (data?.diplomas?.some(x => x.published)) pages.push("/diplomas");
  if (data?.services?.some(x => x.published)) pages.push("/services");
  const profile = data?.profile || {};
  if ([profile.phone,profile.email,profile.socialUrl,profile.address,profile.bookingUrl].some(v => clean(v)))
    pages.push("/contact");
  for (const kind of ["news","offers"]) {
    const items = (data?.[kind] || []).filter(x => x.published && clean(x.title));
    if (items.length) pages.push("/" + kind);
    for(const item of items) pages.push("/" + kind + "/" + encodeURIComponent(item.id));
  }
  return pages;
}

export function metadataFor(path, data) {
  const pathname = safePath(path);
  const profile = data?.profile || {};
  const name = clean(profile.name) || "Анна Мысливцева";
  const role = clean(profile.role) || "специалист";
  let title = name + " — " + role;
  let description = name + ". Информация о специалисте, образовании, опубликованных услугах и способах связи.";
  const sections = {
    "/about": ["О специалисте", "Информация о " + name + " и её профессиональном подходе."],
    "/services": ["Услуги и стоимость", "Опубликованные услуги и цены " + name + "."],
    "/diplomas": ["Образование и дипломы", "Опубликованные документы об образовании " + name + "."],
    "/contact": ["Контакты и запись", "Контакты для связи с " + name + " и актуальная информация о записи."],
    "/news": ["Новости", "Опубликованные новости " + name + "."],
    "/offers": ["Актуальные предложения", "Опубликованные предложения " + name + "."],
  };
  const info = sections[pathname];
  if (info) {title=info[0]+" | "+name;description=info[1];}
  const match=pathname.match(/^\/(news|offers)\/([a-zA-Z0-9_-]{1,80})$/);
  if (match) {
    const item=(data?.[match[1]]||[]).find(x=>x.id===match[2]&&x.published);
    if(item){title=clean(item.title)+" | "+name;description=clean(item.body).slice(0,155)||description;}
  }
  const indexable = indexablePaths(data);
  const allowed=indexable.includes(pathname);
  // Private and synthetic paths are excluded from indexing regardless of content.
  const noindex = !allowed || pathname.startsWith("/admin") || pathname.startsWith("/demo");
  return { title, description, canonicalPath: pathname, robots: noindex ? "noindex, nofollow" : "index, follow" };
}


export function sitemapXml(siteUrl, data) {
  const origin = new URL(siteUrl);
  if (origin.protocol !== "https:" || origin.username || origin.password ||
    origin.search || origin.hash || origin.pathname !== "/")
    throw new Error("PUBLIC_SITE_URL must be an https origin, for example https://example.ru/");
  const xmlEscape = x => x.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&apos;");
  const locs = indexablePaths(data).map(path => "<url><loc>" +
    xmlEscape(origin.origin + path) + "</loc></url>");
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    locs.join("\n") + '\n</urlset>\n';
}

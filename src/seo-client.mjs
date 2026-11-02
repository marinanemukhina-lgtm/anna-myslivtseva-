import { canonicalMetadata } from "../shared/seo.mjs";

// Visible SPA navigation gets truthful route-specific titles and meta tags.
// Yandex renders JavaScript but server-rendering remains a separate future gate.
export function applySeo(path, data) {
  const info = canonicalMetadata(path, data, import.meta.env.VITE_PUBLIC_SITE_URL, window.location.origin);
  document.title = info.title;
  const meta = (attribute, name, content) => {
    let tag = document.head.querySelector('meta[' + attribute + '="' + name + '"]');
    if (!tag) {
      tag = document.createElement("meta");
      tag.setAttribute(attribute, name);
      document.head.appendChild(tag);
    }
    tag.setAttribute("content", content);
  };
  meta("name", "description", info.description);
  meta("name", "robots", info.robots);
  meta("property", "og:title", info.title);
  meta("property", "og:description", info.description);
  meta("property", "og:type", "website");
  const { origin, canonical } = info;
  let link = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) {
    link?.remove();
    document.head.querySelector('meta[property="og:url"]')?.remove();
  } else {
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = canonical;
    meta("property", "og:url", canonical);
  }
  const id = "site-person-structured-data";
  let jsonLd = document.getElementById(id);
  if (info.robots.startsWith("noindex")) {
    jsonLd?.remove();
    return info;
  }
  if (!jsonLd) {
    jsonLd = document.createElement("script");
    jsonLd.id = id;
    jsonLd.type = "application/ld+json";
    document.head.appendChild(jsonLd);
  }
  jsonLd.textContent = JSON.stringify({
    "@context": "https://schema.org", "@type": "Person",
    name: data.profile.name || "Анна Мысливцева",
    jobTitle: data.profile.role || "специалист",
    url: origin + "/",
  }).replace(/</g, "\\u003c");
  return info;
}

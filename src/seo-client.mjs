import { metadataFor } from "../shared/seo.mjs";

// Visible SPA navigation gets truthful route-specific titles and meta tags.
// Yandex renders JavaScript but server-rendering remains a separate future gate.
export function applySeo(path, data) {
  const info = metadataFor(path, data);
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
  const origin = window.location.origin;
  const canonical = origin + info.canonicalPath;
  let link = document.head.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.appendChild(link);
  }
  link.href = canonical;
  meta("property", "og:url", canonical);
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

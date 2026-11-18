import { metadataFor } from '../shared/seo.mjs';
// React effects run only on the client; initial HTML uses the same metadataFor policy.
// https://react.dev/reference/react/useEffect
export function applySeo(pathname, data, document) {
  const meta = metadataFor(pathname, data);
  applyMetadata(meta, document);
}
export function readMetadata(document) {
  return { title: document.title, description: document.querySelector('meta[name="description"]')?.content,
    robots: document.querySelector('meta[name="robots"]')?.content,
    canonical: document.querySelector('link[rel="canonical"]')?.href };
}
export function applyMetadata(meta, document) {
  document.title = meta.title;
  for (const selector of ['meta[name="description"]', 'meta[name="robots"]', 'link[rel="canonical"]']) {
    document.querySelectorAll(selector).forEach(node => node.remove());
  }
  for (const [name, content] of [['description', meta.description], ['robots', meta.robots]]) {
    if (!content) continue;
    const node = document.createElement('meta'); node.name = name; node.content = content;
    document.head.appendChild(node);
  }
  if (meta.canonical) {
    const node = document.createElement('link'); node.rel = 'canonical'; node.href = meta.canonical;
    document.head.appendChild(node);
  }
}

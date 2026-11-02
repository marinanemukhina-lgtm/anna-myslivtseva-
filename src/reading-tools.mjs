/** Dependency-free enhancement for published articles. No patient data or analytics. */
const SCALES = [1, 1.15, 1.3];
const STORAGE_KEY = 'anna-reading-scale-v1';
export function normalizeReadingScale(value) {
  const number = Number(value);
  return SCALES.includes(number) ? number : 1;
}
export function readingProgress(top, height, viewport) {
  if (![top, height, viewport].every(Number.isFinite) || height <= 0 || viewport <= 0) return 0;
  if (height <= viewport) return top <= 0 ? 100 : 0;
  return Math.round(Math.max(0, Math.min(100, -top / (height - viewport) * 100)));
}
export function publicArticleUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !/^\/news\/[A-Za-z0-9_-]{1,80}\/?$/.test(url.pathname)) return null;
    url.search = ''; url.hash = '';
    return url.href;
  } catch { return null; }
}
export function sourceUrls(values, ownOrigin) {
  return [...new Set(values.filter(value => {
    if (typeof value !== 'string' || value.length > 2048) return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && url.origin !== ownOrigin;
    } catch { return false; }
  }))];
}
export function installReadingTools({ root, getLocation = () => window.location } = {}) {
  if (typeof document === 'undefined') return null;
  root ||= document.getElementById('root');
  if (!root || document.querySelector('anna-reading-tools')) return null;
  const host = document.createElement('anna-reading-tools');
  host.hidden = true;
  host.setAttribute('role', 'region');
  host.setAttribute('aria-label', '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u0447\u0442\u0435\u043d\u0438\u044f \u0441\u0442\u0430\u0442\u044c\u0438');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { position:fixed;z-index:40;inset:auto 16px max(16px,env(safe-area-inset-bottom)) auto;
        display:block;box-sizing:border-box;width:min(420px,calc(100% - 32px));
        color:var(--ink);background:var(--paper);border:1px solid currentColor;font:14px/1.45 var(--sans); }
      :host([hidden]) { display:none; }
      * { box-sizing:border-box; }
      .heading { display:flex;justify-content:space-between;gap:10px;padding:9px 12px 0;font-size:12px; }
      .controls { display:grid;grid-template-columns:44px 44px minmax(0,1fr) 76px;gap:4px;padding:8px; }
      button { color:inherit;background:transparent;border:1px solid transparent;font:inherit;padding:7px 5px;min-height:44px;cursor:pointer; }
      button:hover { text-decoration:underline;text-underline-offset:4px; }
      button:focus-visible,input:focus-visible { outline:3px solid var(--ink);outline-offset:-3px; }
      button:disabled { opacity:.5;cursor:not-allowed; }
      .size { font-size:20px;border-color:currentColor; }
      progress { display:block;width:100%;height:3px;accent-color:var(--ink);border:0; }
      .status { padding:0 12px;font-size:12px;margin:0; }
      .status:not(:empty) { padding-bottom:10px; }
      input { width:calc(100% - 24px);margin:0 12px 10px;padding:9px;font:inherit;min-height:44px; }
      [hidden] { display:none; }
      @media(max-width:480px) { :host { inset-inline:8px;width:calc(100% - 16px);bottom:max(8px,env(safe-area-inset-bottom)); }
        .controls { grid-template-columns:44px 44px minmax(0,1fr) 68px;font-size:13px; } }
      @media(forced-colors:active) { button:focus-visible,input:focus-visible { outline-color:Highlight; } }
      @media print { :host { display:none; } }
    </style>
    <div class="heading"><span>\u0423\u0434\u043e\u0431\u043d\u043e\u0435 \u0447\u0442\u0435\u043d\u0438\u0435</span><span class="size-label">100%</span></div>
    <div class="controls">
      <button type="button" class="size smaller" aria-label="\u0423\u043c\u0435\u043d\u044c\u0448\u0438\u0442\u044c \u0442\u0435\u043a\u0441\u0442">A\u2212</button>
      <button type="button" class="size larger" aria-label="\u0423\u0432\u0435\u043b\u0438\u0447\u0438\u0442\u044c \u0442\u0435\u043a\u0441\u0442">A+</button>
      <button type="button" class="sources">\u0418\u0441\u0442\u043e\u0447\u043d\u0438\u043a\u0438</button>
      <button type="button" class="share">\u0421\u0441\u044b\u043b\u043a\u0430</button>
    </div>
    <p class="status" role="status" aria-live="polite"></p>
    <input hidden readonly aria-label="\u0421\u0441\u044b\u043b\u043a\u0430 \u043d\u0430 \u0441\u0442\u0430\u0442\u044c\u044e \u0434\u043b\u044f \u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u044f">
    <progress max="100" value="0" aria-label="\u041f\u043e\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u0432 \u0441\u0442\u0430\u0442\u044c\u0435"></progress>`;
  document.body.append(host);
  const small = shadow.querySelector('.smaller'), large = shadow.querySelector('.larger');
  const sourcesButton = shadow.querySelector('.sources'), shareButton = shadow.querySelector('.share');
  const status = shadow.querySelector('.status'), input = shadow.querySelector('input');
  let scale = 1, article = null, currentPath = '', frame = 0, scheduled = false, destroyed = false, sharing = false;
  try { scale = normalizeReadingScale(sessionStorage.getItem(STORAGE_KEY)); } catch { /* Privacy mode: use default. */ }
  function applyScale() {
    document.documentElement.style.setProperty('--quality-reading-scale', String(scale));
    small.disabled = scale === SCALES[0]; large.disabled = scale === SCALES.at(-1);
    shadow.querySelector('.size-label').textContent = `${Math.round(scale * 100)}%`;
    requestProgress();
  }
  function changeSize(delta) {
    scale = SCALES[Math.max(0, Math.min(SCALES.length - 1, SCALES.indexOf(scale) + delta))];
    applyScale();
    try { sessionStorage.setItem(STORAGE_KEY, String(scale)); } catch { /* Preference only. */ }
  }
  small.addEventListener('click', () => changeSize(-1));
  large.addEventListener('click', () => changeSize(1));
  function links() {
    if (!article) return [];
    const all = [...article.querySelectorAll('a[href]')];
    const allowed = new Set(sourceUrls(all.map(a => a.href), getLocation().origin));
    return all.filter(a => allowed.has(a.href));
  }
  function requestProgress() {
    if (frame || destroyed || host.hidden) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!article?.isConnected) return;
      const box = article.getBoundingClientRect();
      shadow.querySelector('progress').value = readingProgress(box.top, box.height, window.innerHeight);
    });
  }
  sourcesButton.addEventListener('click', () => {
    const link = links()[0];
    if (!link) return;
    link.scrollIntoView({ block: 'center', behavior: 'auto' });
    link.focus({ preventScroll: true });
  });
  shareButton.addEventListener('click', async () => {
    if (sharing) return;
    const location = getLocation(), href = publicArticleUrl(location.href), sharedPath = location.pathname;
    status.textContent = ''; input.hidden = true;
    if (!href) { status.textContent = '\u0421\u0441\u044b\u043b\u043a\u0430 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430 \u043f\u043e\u0441\u043b\u0435 \u0440\u0430\u0437\u043c\u0435\u0449\u0435\u043d\u0438\u044f \u0441\u0442\u0430\u0442\u044c\u0438 \u043d\u0430 HTTPS-\u0441\u0430\u0439\u0442\u0435.'; return; }
    sharing = true; shareButton.disabled = true;
    const stillHere = () => !destroyed && !host.hidden && getLocation().pathname === sharedPath;
    try {
      if (navigator.share) {
        await navigator.share({ title: root.querySelector('.article-heading h1')?.textContent || '\u0421\u0442\u0430\u0442\u044c\u044f', url: href }); return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(href);
        if (stillHere()) status.textContent = '\u0421\u0441\u044b\u043b\u043a\u0430 \u0441\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u043d\u0430.';
        return;
      }
    } catch (error) { if (error?.name === 'AbortError') return; }
    finally { sharing = false; shareButton.disabled = false; }
    if (!stillHere()) return;
    input.value = href; input.hidden = false; input.focus(); input.select();
    status.textContent = '\u0412\u044b\u0434\u0435\u043b\u0435\u043d\u043d\u0443\u044e \u0441\u0441\u044b\u043b\u043a\u0443 \u043c\u043e\u0436\u043d\u043e \u0441\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0432\u0440\u0443\u0447\u043d\u0443\u044e.';
  });
  function refresh() {
    scheduled = false;
    if (destroyed) return;
    const location = getLocation();
    const eligible = /^\/news\/[A-Za-z0-9_-]{1,80}\/?$/.test(location.pathname);
    article = eligible ? root.querySelector('main .article-page .article-body') : null;
    if (!article) {
      host.hidden = true; document.documentElement.removeAttribute('data-anna-reader'); currentPath = ''; return;
    }
    if (currentPath !== location.pathname) { status.textContent = ''; input.hidden = true; }
    currentPath = location.pathname;
    host.hidden = false; document.documentElement.setAttribute('data-anna-reader', 'active');
    const count = new Set(links().map(a => a.href)).size;
    sourcesButton.disabled = count === 0;
    sourcesButton.textContent = count ? `\u0418\u0441\u0442\u043e\u0447\u043d\u0438\u043a\u0438 (${count})` : '\u0418\u0441\u0442\u043e\u0447\u043d\u0438\u043a\u0438';
    applyScale();
  }
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (!host.hidden) document.documentElement.style.setProperty('--quality-reader-space', `${Math.ceil(host.getBoundingClientRect().height + 32)}px`);
  }) : null;
  resizeObserver?.observe(host);
  const observer = new MutationObserver(() => { if (!scheduled) { scheduled = true; queueMicrotask(refresh); } });
  observer.observe(root, { childList: true, subtree: true });
  window.addEventListener('scroll', requestProgress, { passive: true });
  window.addEventListener('resize', requestProgress, { passive: true });
  window.addEventListener('popstate', refresh);
  refresh();
  return { refresh, destroy() {
    destroyed = true; observer.disconnect(); resizeObserver?.disconnect(); cancelAnimationFrame(frame);
    window.removeEventListener('scroll', requestProgress); window.removeEventListener('resize', requestProgress); window.removeEventListener('popstate', refresh);
    host.remove(); document.documentElement.removeAttribute('data-anna-reader');
    document.documentElement.style.removeProperty('--quality-reading-scale'); document.documentElement.style.removeProperty('--quality-reader-space');
  }};
}
if (typeof document !== 'undefined') installReadingTools();

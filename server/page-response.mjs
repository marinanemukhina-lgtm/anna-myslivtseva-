import { readFile } from 'node:fs/promises';
import { readContent } from './db.mjs';
import { publicContent } from '../shared/content.mjs';
import { canonicalOrigin } from '../shared/seo.mjs';
import { resolvePage, pageHtml, isDocumentPath } from '../shared/page-response.mjs';
const defaultTemplate = new URL('../dist/client/index.html', import.meta.url);
export function createPageHandler({ loadData = async () => publicContent((await readContent()).data), loadTemplate = () => readFile(defaultTemplate,'utf8'), siteUrl = () => process.env.PUBLIC_SITE_URL || '' } = {}) {
  return async (req,res) => {
    const path = req.originalUrl.split('?')[0];
    if (!['GET','HEAD'].includes(req.method) || !isDocumentPath(path)) return res.status(404).type('text/plain').send('Not found');
    res.set('Cache-Control','no-store');
    try {
      const origin = canonicalOrigin(siteUrl());
      const current = origin && req.get('host') === new URL(origin).host ? origin : '';
      const template = await loadTemplate();
      let data, status, route;
      try {
        // Defense in depth: injected adapters also cannot pass draft/private content onward.
        data = publicContent(await loadData());
        route = resolvePage(path,data); status = route.status;
      } catch { data = {profile:{},news:[],offers:[]}; route = {path}; status = 503; }
      const result = pageHtml(template,route.path,data,origin,current,status);
      res.set('X-Robots-Tag',result.robots);
      res.status(status).type('html');
      if (req.method === 'HEAD') return res.end();
      return res.send(result.html);
    } catch {
      res.set('X-Robots-Tag','noindex, nofollow');
      res.status(503).type('text/plain').send('Сайт временно недоступен');
    }
  };
}

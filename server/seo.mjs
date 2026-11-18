import { readContent } from './db.mjs';
import { initialContent } from '../shared/content.mjs';
import { sitemapXml } from '../shared/seo.mjs';
export async function readPublicSource() {
  return process.env.VERCEL && !process.env.DATABASE_URL ? initialContent : (await readContent()).data;
}
export function registerSeo(app) {
  app.get('/sitemap.xml', async (_req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store').type('application/xml').send(sitemapXml(await readPublicSource()));
    } catch (error) { next(error); }
  });
}

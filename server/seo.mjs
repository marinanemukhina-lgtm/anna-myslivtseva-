import { readContent } from "./db.mjs";
import { publicContent } from "../shared/content.mjs";
import { sitemapXml } from "../shared/seo.mjs";

export function registerSeo(app) {
  app.get("/api/seo/sitemap.xml", async (_req, res, next) => {
    // Never guess a canonical hostname from an untrusted Host header.
    const canonical = String(process.env.PUBLIC_SITE_URL || "").trim();
    if (!canonical) return res.status(404).type("text/plain").send("Canonical site URL not configured.");
    try {
      const data = publicContent((await readContent()).data);
      res.set("Cache-Control","public, max-age=300");
      res.status(200).type("application/xml").send(sitemapXml(canonical,data));
    } catch (error) { next(error); }
  });
}

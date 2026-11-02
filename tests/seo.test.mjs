import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initialContent, publicContent } from "../shared/content.mjs";
import { indexablePaths, metadataFor, sitemapXml, canonicalOrigin, canonicalMetadata, robotsText } from "../shared/seo.mjs";

const fixture = () => structuredClone(initialContent);
test("index is based on published content, no artificial medical claims", () => {
  const raw = fixture();
  raw.news = [
    { id: "draft", title: "Не опубликовано", body: "Не читать", image: "", published: false, date: "" },
    { id: "real", title: "Опубликованная новость", body: "Опубликованный материал", image: "", published: true, date: "" },
  ];
  raw.services = [{ id: "sample", title: "Тестовая услуга", body: "",image:"", published:false,price:"",duration:"",category:"" }];
  const data = publicContent(raw);
  assert.deepEqual(indexablePaths(data), ["/","/about","/news","/news/real"]);
  assert.equal(metadataFor("/services",data).robots, "noindex, nofollow");
  assert.equal(metadataFor("/news/real",data).robots, "index, follow");
  assert.equal(metadataFor("/news/draft",data).robots, "noindex, nofollow");
  assert.equal(metadataFor("/admin",data).robots, "noindex, nofollow");
  assert.equal(metadataFor("/admin/setup",data).robots, "noindex, nofollow");
  assert.equal(metadataFor("/demo/booking",data).robots, "noindex, nofollow");
  assert.equal(metadataFor("/anything-made-up",data).robots, "noindex, nofollow");
  assert.ok(!metadataFor("/",data).description.includes("успешн"));
  const xml=sitemapXml("https://example.test/",data);
  assert.ok(xml.includes("<loc>https://example.test/news/real</loc>"));
  assert.ok(!xml.includes("draft"));
  assert.ok(!xml.includes("/admin"));
  assert.ok(!xml.includes("/demo"));
  assert.throws(()=>sitemapXml("http://example.test/",data));
  assert.throws(()=>sitemapXml("https://example.test/other",data));
});
test("robots policy shields admin and demo and includes sitemap allowance", async () => {
  const robots=await readFile("public/robots.txt","utf8");
  assert.match(robots,/Disallow: \/admin/);
  assert.match(robots,/Disallow: \/demo/);
  assert.match(robots,/Allow: \/api\/seo\/sitemap\.xml/);
});
test("runtime sitemap serves only published routes and is disabled without canonical site URL", async t => {
  const dir=await mkdtemp(path.join(os.tmpdir(),"anna-seo-"));
  process.env.DATA_DIR=dir;
  process.env.PUBLIC_SITE_URL="https://example.test/";
  const { createApp }=await import("../server/app.mjs");
  const server=createApp().listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  const base="http://127.0.0.1:"+server.address().port;
  t.after(async()=>{
    await new Promise(resolve=>server.close(resolve));
    await rm(dir,{recursive:true,force:true});
    delete process.env.PUBLIC_SITE_URL;
  });
  const result=await fetch(base+"/api/seo/sitemap.xml");
  assert.equal(result.status,200);
  assert.match(result.headers.get("content-type"),/xml/);
  const xml=await result.text();
  assert.match(xml,/<loc>https:\/\/example\.test\/<\/loc>/);
  assert.match(xml,/<loc>https:\/\/example\.test\/about<\/loc>/);
  assert.doesNotMatch(xml,/\/admin|\/demo|\/services|\/diplomas|\/contact|\/privacy|\/terms/);
  delete process.env.PUBLIC_SITE_URL;
  const no=await fetch(base+"/api/seo/sitemap.xml");
  assert.equal(no.status,404);
});

test("canonical identity uses only explicit origin and previews remain noindex", () => {
  const data = publicContent(fixture());
  const primary = canonicalMetadata("/about?tracking=1", data, "https://example.test/", "https://example.test");
  assert.equal(primary.canonical, "https://example.test/about");
  assert.equal(primary.robots, "index, follow");
  const preview = canonicalMetadata("/about", data, "https://example.test/", "https://preview.test");
  assert.equal(preview.canonical, primary.canonical);
  assert.equal(preview.robots, "noindex, nofollow");
  assert.equal(canonicalMetadata("/", data, "", "https://untrusted.test").canonical, null);
  assert.equal(canonicalMetadata("/", data, "", "https://untrusted.test").robots, "noindex, nofollow");
  assert.equal(canonicalOrigin(""), null);
  for (const invalid of ["http://example.test", "https://u:p@example.test", "https://example.test/sub", "https://example.test/?x=1"])
    assert.throws(() => canonicalOrigin(invalid));
});
test("robots publication declares configured sitemap and permits rendering resources", () => {
  const text = robotsText("https://example.test/");
  const directives = text.trim().split("\n");
  assert.ok(directives.includes("Sitemap: https://example.test/api/seo/sitemap.xml"));
  assert.ok(directives.includes("Allow: /api/content$"));
  assert.ok(directives.includes("Allow: /api/media/"));
  assert.ok(directives.includes("Disallow: /admin"));
  assert.ok(!robotsText("").includes("Sitemap:"));
});

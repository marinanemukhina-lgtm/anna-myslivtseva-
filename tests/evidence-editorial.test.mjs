import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { scryptSync } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { evidenceDrafts } from "../editorial/evidence-drafts.mjs";

test("research drafts are source-backed and import only through authenticated CMS", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "anna-evidence-"));
  process.env.DATA_DIR = dir;
  process.env.ADMIN_PASSWORD_HASH =
    "review-test:" + scryptSync("review-test-long-password", "review-test", 64).toString("hex");
  const { createApp } = await import("../server/app.mjs");
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  let cookie = "";
  const req = (endpoint, method = "GET", body, extra = {}) =>
    fetch(base + endpoint, {
      method,
      headers: { origin: base, cookie, "content-type": "application/json", ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  assert.equal(evidenceDrafts.length, 3);
  for (const article of evidenceDrafts) {
    assert.ok(article.sources.length > 0);
    assert.ok(article.body.includes(article.sourceUrl));
    assert.ok(article.body.includes("провер"));
    assert.ok(article.body.length > 1200);
  }

  assert.equal((await req("/api/admin/evidence/catalog")).status, 401);
  assert.equal((await req("/api/admin/evidence/import", "POST", { ids:[evidenceDrafts[0].id] })).status, 401);
  const initialPublic = JSON.stringify(await (await req("/api/content")).json());
  assert.ok(!initialPublic.includes(evidenceDrafts[0].title));

  const login = await req("/api/session","POST",{ password:"review-test-long-password" });
  assert.equal(login.status,200);
  cookie = login.headers.get("set-cookie").split(";")[0];
  const list = await (await req("/api/admin/evidence/catalog")).json();
  assert.equal(list.items.length,3);
  assert.ok(list.items.every(item => item.imported === false));

  assert.equal((await req("/api/admin/evidence/import","POST",{ ids:["made-up-article"] })).status,400);
  assert.equal((await req("/api/admin/evidence/import","POST",{ ids:[evidenceDrafts[0].id] },
    { origin:"https://attacker.invalid" })).status,403);
  const ids = evidenceDrafts.map(article => article.id);
  const importedResponse = await req("/api/admin/evidence/import","POST",{ ids });
  assert.equal(importedResponse.status,200);
  const imported = await importedResponse.json();
  assert.equal(imported.imported.length,3);
  assert.equal(imported.data.news.length,3);
  assert.ok(imported.data.news.every(item => item.published === false && !item.date && !item.image));
  assert.equal((await req("/api/admin/evidence/import","POST",{ ids })).status,200);
  const again = await (await req("/api/admin/evidence/import","POST",{ ids })).json();
  assert.equal(again.imported.length,0);
  assert.equal(again.skipped.length,3);
  assert.equal(again.version,imported.version);
  const after = await (await req("/api/admin/content")).json();
  assert.equal(after.data.news.length,3);
  assert.deepEqual(after.data.news.map(x=>x.title).sort(),evidenceDrafts.map(x=>x.title).sort());

  // Generic "show on site" editor cannot accidentally publish a research draft.
  after.data.news[0].published = true;
  const unsafe = await req("/api/admin/content","PUT",after);
  assert.equal(unsafe.status,422);
  assert.equal((await unsafe.json()).code,"MEDICAL_REVIEW_REQUIRED");
  after.data.news[0].published = false;
  const safe = await req("/api/admin/content","PUT",after);
  assert.equal(safe.status,200);
  const publicAfter = JSON.stringify(await (await req("/api/content")).json());
  assert.ok(!publicAfter.includes(evidenceDrafts[0].title));
  assert.ok(!publicAfter.includes(evidenceDrafts[1].title));
  const sitemap = await req("/api/seo/sitemap.xml");
  assert.ok([200,404].includes(sitemap.status));
  if (sitemap.status === 200) {
    const xml = await sitemap.text();
    assert.ok(!xml.includes("/news/" + evidenceDrafts[0].id));
  }
});

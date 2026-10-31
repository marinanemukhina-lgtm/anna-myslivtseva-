import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scryptSync } from "node:crypto";
// Real HTTP requests + a temporary database: catches missing authorization,
// draft leaks, stale overwrites, lost persistence, unsafe files and CSRF.
test("authenticated CMS persists edits without exposing drafts", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "anna-test-"));
  process.env.DATA_DIR = dir;
  process.env.ADMIN_PASSWORD_HASH =
    "test-salt:" +
    scryptSync("test-password-long", "test-salt", 64).toString("hex");
  let mod;
  try {
    mod = await import("../server/app.mjs");
  } catch {}
  assert.ok(mod?.createApp, "CMS server must exist");
  const server = mod.createApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  let cookie = "";
  const req = (route, method = "GET", body, extra = {}) =>
    fetch(base + route, {
      method,
      headers: {
        "content-type": "application/json",
        origin: base,
        cookie,
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });
  assert.equal((await req("/api/admin/content")).status, 401);
  assert.equal(
    (await req("/api/session", "POST", { password: "wrong" })).status,
    401,
  );
  const login = await req("/api/session", "POST", {
    password: "test-password-long",
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  let content = await (await req("/api/admin/content")).json();
  content.data.news = [
    {
      id: "draft",
      title: "Секретный черновик",
      body: "Не опубликован",
      date: "",
      image: "",
      published: false,
    },
    {
      id: "public",
      title: "Открытая новость",
      body: "Опубликована",
      date: "",
      image: "",
      published: true,
    },
  ];
  assert.equal(
    (
      await req("/api/admin/content", "PUT", content, {
        origin: "https://unrelated.example",
      })
    ).status,
    403,
  );
  const save = await req("/api/admin/content", "PUT", content);
  assert.equal(save.status, 200);
  assert.equal((await req("/api/admin/content", "PUT", content)).status, 409);
  const visible = await (await req("/api/content")).json();
  assert.deepEqual(
    visible.news.map((x) => x.title),
    ["Открытая новость"],
  );
  const saved = await (await req("/api/admin/content")).json();
  assert.equal(saved.data.news.length, 2);
  assert.equal(saved.version, content.version + 1);
  const untitled = structuredClone(saved);
  untitled.data.news[1].title = " ";
  assert.equal((await req("/api/admin/content", "PUT", untitled)).status, 400);
  const bad = structuredClone(saved);
  bad.data.profile.bookingUrl = "javascript:alert(1)";
  assert.equal((await req("/api/admin/content", "PUT", bad)).status, 400);
  assert.equal(
    (
      await req("/api/media", "POST", {
        name: "x.svg",
        type: "image/svg+xml",
        base64: Buffer.from("<svg/>").toString("base64"),
      })
    ).status,
    400,
  );
  const media = await req("/api/media", "POST", {
    name: "proof.png",
    type: "image/png",
    base64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO/a2nQAAAAASUVORK5CYII=",
  });
  assert.equal(media.status, 201);
  const { url } = await media.json();
  assert.equal((await req(url)).status, 200);
  const boundaryFile = Buffer.alloc(3 * 1024 * 1024);
  boundaryFile.write("%PDF-1.7");
  assert.equal((await req("/api/media", "POST", {
    name: "maximum-diploma.pdf",
    type: "application/pdf",
    base64: boundaryFile.toString("base64"),
  })).status, 201, "a file at the advertised 3 MiB limit must upload");
  assert.equal((await req("/api/media", "POST", {
    name: "too-large.pdf",
    type: "application/pdf",
    base64: Buffer.concat([boundaryFile, Buffer.from([0])]).toString("base64"),
  })).status, 400, "files over 3 MiB must still be rejected");
  assert.equal((await req("/api/session", "DELETE")).status, 200);
  assert.equal((await req("/api/admin/content")).status, 401);
  cookie = "";
  assert.equal((await req(url)).status, 404);
  assert.equal((await req("/api/admin/content")).status, 401);
  // Persisted content must survive a fresh app instance.
  const again = mod.createApp().listen(0, "127.0.0.1");
  await new Promise((r) => again.once("listening", r));
  const restored = await (
    await fetch("http://127.0.0.1:" + again.address().port + "/api/content")
  ).json();
  assert.equal(restored.news[0].title, "Открытая новость");
  await new Promise((r) => again.close(r));
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scryptSync, createHash } from "node:crypto";
import { verifyClinicalBackup } from "../server/clinical-demo.mjs";

test("synthetic clinical prototype: booking, privacy, media, history and integrity", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "anna-clinical-demo-"));
  process.env.DATA_DIR = dir;
  process.env.CLINICAL_DEMO_MODE = "synthetic-only";
  process.env.ADMIN_PASSWORD_HASH = "demo-test:" + scryptSync("demo-password-long", "demo-test", 64).toString("hex");
  const { createApp } = await import("../server/app.mjs");
  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  let cookie = "";
  const req = (route, method = "GET", body, headers = {}) => fetch(base + route, {
    method,
    headers: { "Content-Type": "application/json", origin: base, cookie, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { force: true, recursive: true });
    delete process.env.CLINICAL_DEMO_MODE;
  });
  assert.equal((await req("/api/demo/clinical/config")).status, 200);
  assert.equal((await req("/api/admin/clinical/clients")).status, 401);
  assert.equal((await req("/api/admin/clinical/export")).status, 401);
  assert.equal((await req("/api/admin/clinical/requests")).status, 401);
  assert.equal((await req("/api/admin/clinical/photos/11111111-1111-4111-8111-111111111111")).status, 401);
  let booking = await (await req("/api/demo/booking/config")).json();
  assert.equal(booking.enabled, true);
  assert.deepEqual(booking.personas, ["Демо-клиент 001","Демо-клиент 002","Демо-клиент 003"]);
  assert.equal((await req("/api/demo/booking/requests", "POST", { persona: "Настоящий пациент", serviceId: "demo-session", start: "2026-12-02T06:00:00.000Z" })).status, 400);
  const login = await req("/api/session", "POST", { password: "demo-password-long" });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];
  const create = await req("/api/admin/clinical/clients", "POST", { label: "Демо-клиент 001" });
  assert.equal(create.status, 201);
  const client = await create.json();
  assert.equal((await req("/api/admin/clinical/clients", "POST", { label: "Реальный клиент" })).status, 400);
  assert.equal((await req("/api/admin/clinical/clients", "POST", { label: "Демо-клиент 001" })).status, 409);
  const fakeDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const visit = await req("/api/admin/clinical/visits", "POST", {
    clientId: client.id, date: fakeDate, procedure: "Демонстрационная процедура",
    note: "Тест: первичное наблюдение", pain: 4, mobility: 65,
  });
  assert.equal(visit.status, 201);
  const visitId = (await visit.json()).id;
  assert.equal((await req("/api/admin/clinical/visits", "POST", {
    clientId: client.id, date: fakeDate, procedure: "Демонстрационная процедура",
    note: "Введены настоящие медицинские данные", pain: 4, mobility: 65,
  })).status, 400);
  // Completely synthetic 1x1 PNG (not a patient's photograph).
  const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yXc8AAAAASUVORK5CYII=";
  const uploaded = await req("/api/admin/clinical/photos", "POST", {
    clientId: client.id, visitId, mime: "image/png", base64: tinyPng,
  });
  assert.equal(uploaded.status, 201);
  const photo = await uploaded.json();
  const bytes = await req(photo.url);
  assert.equal(bytes.status, 200);
  assert.equal(bytes.headers.get("content-type"), "image/png");
  const unauthorizedPhoto = await fetch(base + photo.url);
  assert.equal(unauthorizedPhoto.status, 401);
  const card = await (await req("/api/admin/clinical/clients/" + client.id)).json();
  assert.equal(card.visits.length, 1);
  assert.equal(card.photos.length, 1);
  assert.equal(card.visits[0].pain, 4);
  assert.equal(card.visits[0].mobility, 65);
  // The public CMS must never expose demo clinical information.
  const publicResponse = await (await req("/api/content")).text();
  assert.equal(publicResponse.includes("Демо-клиент 001"), false);
  const exportResponse = await req("/api/admin/clinical/export");
  assert.equal(exportResponse.status, 200);
  const backup = await exportResponse.json();
  assert.equal(verifyClinicalBackup(backup), true);
  assert.equal(backup.payload.clients.length, 1);
  assert.equal(backup.payload.visits.length, 1);
  assert.equal(backup.payload.photos.length, 1);
  assert.equal(backup.payload.photos[0].body, tinyPng);
  const modified = structuredClone(backup);
  modified.payload.visits[0].pain = 10;
  assert.equal(verifyClinicalBackup(modified), false);
  assert.equal(backup.sha256, createHash("sha256").update(JSON.stringify(backup.payload)).digest("hex"));
  // Booking with two simultaneous requests for one slot: exactly one should win.
  let date = "";
  let slots = [];
  for(let offset = 2; offset < 13 && slots.length === 0; offset++) {
    date = new Date(Date.now() + offset * 86400000).toISOString().slice(0,10);
    const response = await req("/api/demo/booking/availability?" + new URLSearchParams({ serviceId: "demo-session", date }));
    assert.equal(response.status, 200);
    slots = (await response.json()).slots;
  }
  assert.ok(slots.length > 0, "The synthetic calendar should provide a weekday");
  const ask = { serviceId: "demo-session", persona: "Демо-клиент 001", start: slots[0].start };
  const concurrent = await Promise.all([req("/api/demo/booking/requests", "POST", ask), req("/api/demo/booking/requests", "POST", ask)]);
  assert.deepEqual(concurrent.map(x=>x.status).sort(), [201,409]);
  const requests = await (await req("/api/admin/clinical/requests")).json();
  assert.equal(requests.requests.length, 1);
  assert.equal(requests.requests[0].status, "pending");
  const reschedule = await req("/api/admin/clinical/requests/" + requests.requests[0].id, "PATCH", { status: "confirmed" });
  assert.equal(reschedule.status, 200);
  assert.equal((await req("/api/booking/config")).status, 200);
  assert.equal((await req("/api/booking/appointments", "POST", ask)).status, 503);
  assert.equal((await req("/api/demo/booking/requests", "POST", ask, { origin: "https://evil.example" })).status, 403);
});

test("clinical demo routes fail closed without explicit synthetic-only flag", async t => {
  delete process.env.CLINICAL_DEMO_MODE;
  const { createApp } = await import("../server/app.mjs");
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = "http://127.0.0.1:" + server.address().port;
  const state = await (await fetch(base + "/api/demo/clinical/config")).json();
  assert.equal(state.enabled, false);
  assert.equal((await fetch(base + "/api/demo/booking/config")).status, 404);
  assert.equal((await fetch(base + "/api/admin/clinical/clients")).status, 404);
});

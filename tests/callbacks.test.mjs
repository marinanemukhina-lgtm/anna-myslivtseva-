import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID, scryptSync } from "node:crypto";
import { spawn } from "node:child_process";
import { normalizeCallbackPhone, callbackConsentText } from "../shared/callbacks.mjs";

// All persisted numbers below are fictional UK numbers reserved for drama.
// No dotenv import, external connection, real contact, mail or SMS is used.
const phone = "+44 7700 900001";
const otherPhone = "+44 7700 900002";
const normalizedPhone = "+447700900001";
const password = "synthetic-callback-test-only";
const passwordHash = `synthetic-only:${scryptSync(password, "synthetic-only", 64).toString("hex")}`;

test("callback phone normalization accepts common RU and international input without free text", () => {
  for (const input of ["8 (999) 000-00-00", "+7 (999) 000-00-00", "79990000000", "9990000000"])
    assert.equal(normalizeCallbackPhone(input), "+79990000000");
  assert.equal(normalizeCallbackPhone(phone), normalizedPhone);
  for (const input of ["", "hello", "call +447700900001", "+447700900001 ext 2", "447700900001", "+01234567890", "+7000", "8", "+7 000 000 00 00", "+111111111", "+447700\n900001", "1".repeat(41), null, {}, "+1234567890123456"])
    assert.equal(normalizeCallbackPhone(input), null);
});

test("isolated real HTTP callback flow: durability, consent, abuse prevention and owner-only access", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "anna-callback-synthetic-"));
  // Explicitly discard any inherited remote/storage/owner configuration.
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.CONTACT_CALLBACK_ENABLED;
  delete process.env.CONTACT_CALLBACK_DATA_APPROVED;
  process.env.DATA_DIR = dir;
  process.env.ADMIN_PASSWORD_HASH = passwordHash;
  const { createApp } = await import("../server/app.mjs");
  const { database, readContent } = await import("../server/db.mjs");
  const db = await database();
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = (route, method = "GET", body, headers = {}) => fetch(base + route, {
    method,
    headers: { origin: base, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setPrivacy = async (privacy) => {
    const current = await readContent();
    current.data.profile.privacy = privacy;
    await db.query("UPDATE content SET body=$1,version=version+1 WHERE id=$2", [JSON.stringify(current.data), "main"]);
  };
  const config = async () => (await req("/api/contact/config")).json();
  let active;
  const payload = (overrides = {}) => ({ phone, consent: true, consentVersion: active.consentVersion, requestId: randomUUID(), website: "", ...overrides });
  const clearLimits = () => db.query("DELETE FROM callback_limits");
  let ownerCookie;
  let firstBody;
  let firstReceipt;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { force: true, recursive: true });
  });

  await t.test("disabled unless flags, real owner authentication, storage and published privacy are ready", async () => {
    assert.equal((await config()).enabled, false);
    assert.equal((await req("/api/contact/callback", "POST", {})).status, 503);
    process.env.CONTACT_CALLBACK_ENABLED = "true";
    assert.equal((await config()).enabled, false);
    process.env.CONTACT_CALLBACK_DATA_APPROVED = "true";
    assert.equal((await config()).enabled, false);
    await setPrivacy("Синтетическая политика для локальной проверки. Не для публикации.");
    process.env.ADMIN_PASSWORD_HASH = "invalid-test-value";
    assert.equal((await config()).enabled, false);
    process.env.ADMIN_PASSWORD_HASH = passwordHash;
    process.env.VERCEL = "1";
    assert.equal((await config()).enabled, false);
    delete process.env.VERCEL;
    const { callbackConfiguredReason } = await import("../server/callbacks.mjs");
    assert.match(callbackConfiguredReason({ CONTACT_CALLBACK_ENABLED: "true", CONTACT_CALLBACK_DATA_APPROVED: "true", ADMIN_PASSWORD_HASH: passwordHash }, true), /редактор/);
    active = await config();
    assert.equal(active.enabled, true);
    assert.equal(active.privacyUrl, "/privacy");
    assert.equal(active.consentText, callbackConsentText);
    assert.match(active.consentVersion, /^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(active).sort(), ["consentText", "consentVersion", "enabled", "privacyUrl"]);
  });

  await t.test("only real owner session can read or change callbacks, never temporary content access", async () => {
    assert.equal((await req("/api/admin/callbacks")).status, 401);
    assert.equal((await req(`/api/admin/callbacks/${randomUUID()}`, "PATCH", { status: "done", version: 1 })).status, 401);
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    assert.equal((await req("/api/admin/callbacks", "GET", undefined, { host: "anna-myslivtseva.vercel.app" })).status, 401);
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    const login = await req("/api/session", "POST", { password });
    assert.equal(login.status, 200);
    ownerCookie = login.headers.get("set-cookie").split(";")[0];
    assert.equal((await req("/api/admin/callbacks", "GET", undefined, { cookie: ownerCookie })).status, 200);
    const source = await readFile(new URL("../server/callbacks.mjs", import.meta.url), "utf8");
    assert.match(source, /app\.get\("\/api\/admin\/callbacks", requireAdmin,/);
    assert.match(source, /app\.patch\("\/api\/admin\/callbacks\/:id", requireAdmin,/);
  });

  await t.test("success is an actual stored phone-only request; identical retries have the same receipt", async () => {
    firstBody = payload();
    const submitted = await req("/api/contact/callback", "POST", firstBody);
    assert.equal(submitted.status, 201);
    firstReceipt = await submitted.json();
    assert.deepEqual(Object.keys(firstReceipt).sort(), ["createdAt", "ok", "requestId"]);
    assert.equal(firstReceipt.ok, true);
    assert.equal(firstReceipt.requestId, firstBody.requestId);
    assert.ok(Number.isFinite(Date.parse(firstReceipt.createdAt)));
    const [row] = await db.query("SELECT * FROM callback_requests WHERE id=$1", [firstBody.requestId]);
    assert.equal(row.phone, normalizedPhone);
    assert.equal(row.consent_version, active.consentVersion);
    const [policy] = await db.query("SELECT privacy_text,consent_text FROM callback_consents WHERE version=$1", [active.consentVersion]);
    assert.match(policy.privacy_text, /Синтетическая политика/);
    assert.equal(policy.consent_text, callbackConsentText);
    assert.equal(row.status, "new");
    assert.equal(row.version, 1);
    assert.deepEqual(Object.keys(row).sort(), ["consent_version", "created_at", "fingerprint", "id", "phone", "status", "version"]);
    const retry = await req("/api/contact/callback", "POST", firstBody);
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), firstReceipt);
    const changed = await req("/api/contact/callback", "POST", { ...firstBody, phone: otherPhone });
    assert.equal(changed.status, 409);
    assert.equal((await changed.json()).code, "IDEMPOTENCY_CONFLICT");
    const publicData = await (await req("/api/content")).text();
    assert.ok(!publicData.includes(normalizedPhone));
    assert.ok(!publicData.includes(firstBody.requestId));
    const [limits] = await db.query("SELECT id FROM callback_limits WHERE id LIKE $1", ["address:%"]);
    assert.ok(!limits.id.includes("127.0.0.1"));
    assert.match(limits.id, /^address:\d+:[a-f0-9]{64}$/);
  });

  await t.test("concurrent same-key attempts create exactly one row, including when response delivery is uncertain", async () => {
    await clearLimits();
    const body = payload();
    const replies = await Promise.all(Array.from({ length: 4 }, () => req("/api/contact/callback", "POST", body)));
    assert.equal(replies.filter((reply) => reply.status === 201).length, 1);
    assert.ok(replies.every((reply) => [200, 201].includes(reply.status)));
    const results = await Promise.all(replies.map((reply) => reply.json()));
    assert.ok(results.every((result) => JSON.stringify(result) === JSON.stringify(results[0])));
    const [{ total }] = await db.query("SELECT COUNT(*) AS total FROM callback_requests WHERE id=$1", [body.requestId]);
    assert.equal(Number(total), 1);
    const lostReceiptBody = payload();
    await clearLimits();
    const ignored = await req("/api/contact/callback", "POST", lostReceiptBody);
    await ignored.body.cancel();
    const retried = await req("/api/contact/callback", "POST", lostReceiptBody);
    assert.equal(retried.status, 200);
    assert.equal((await retried.json()).requestId, lostReceiptBody.requestId);
  });

  await t.test("strict schema refuses free text, honeypot, invalid phone, missing consent and stale revision", async () => {
    for (const change of [
      { consent: false }, { consent: undefined }, { consentVersion: "" },
      { phone: "bad number" }, { phone: "1".repeat(100) },
      { requestId: "not-a-uuid" }, { website: "spam" }, { website: undefined },
      { name: "SYNTHETIC" }, { message: "must not be stored" }, { extra: true },
    ]) assert.equal((await req("/api/contact/callback", "POST", payload(change))).status, 400);
    const stale = await req("/api/contact/callback", "POST", payload({ consentVersion: "0".repeat(64) }));
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, "CONSENT_CHANGED");
    await setPrivacy("Обновлённая синтетическая политика. Не для публикации.");
    assert.equal((await req("/api/contact/callback", "POST", payload())).status, 409);
    assert.deepEqual(await (await req("/api/contact/callback", "POST", firstBody)).json(), firstReceipt);
    const changed = await config();
    assert.notEqual(changed.consentVersion, active.consentVersion);
    const [preserved] = await db.query("SELECT privacy_text FROM callback_consents WHERE version=$1", [firstBody.consentVersion]);
    assert.match(preserved.privacy_text, /^Синтетическая политика для локальной проверки/);
    active = changed;
  });

  await t.test("origin/content type checks and small parser bound apply to public and private writes", async () => {
    assert.equal((await req("/api/contact/callback", "POST", payload(), { origin: "https://foreign.invalid" })).status, 403);
    assert.equal((await req("/api/contact/callback", "POST", payload(), { origin: "" })).status, 403);
    assert.equal((await req("/api/contact/callback", "POST", payload(), { "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await req("/api/contact/callback", "POST", payload(), { "content-type": "text/plain" })).status, 415);
    assert.equal((await req("/api/contact/callback", "POST", payload({ extra: "x".repeat(2500) }))).status, 413);
    assert.equal((await req(`/api/admin/callbacks/${firstBody.requestId}`, "PATCH", { status: "done", version: 1 }, { cookie: ownerCookie, origin: "https://foreign.invalid" })).status, 403);
  });

  await t.test("snapshot changes during commit reject new requests rather than silently accepting stale consent", async () => {
    await clearLimits();
    const originalTransaction = db.transaction;
    db.transaction = async (statements) => {
      await setPrivacy("Синтетическая политика изменена во время отправки.");
      return originalTransaction(statements);
    };
    const body = payload();
    try {
      assert.equal((await req("/api/contact/callback", "POST", body)).status, 409);
      const [{ total }] = await db.query("SELECT COUNT(*) AS total FROM callback_requests WHERE id=$1", [body.requestId]);
      assert.equal(Number(total), 0);
    } finally { db.transaction = originalTransaction; }
    active = await config();
  });

  await t.test("database failures never report false success, and ambiguous commits are safely retried without logging phone data", async () => {
    await clearLimits();
    const originalTransaction = db.transaction;
    const originalLog = console.error;
    const logs = [];
    console.error = (...args) => logs.push(args.join(" "));
    try {
      for (const commitBeforeError of [false, true]) {
        const body = payload();
        db.transaction = async (statements) => {
          if (commitBeforeError) await originalTransaction(statements);
          throw new Error(`Synthetic adapter error: ${phone}`);
        };
        const uncertain = await req("/api/contact/callback", "POST", body);
        assert.equal(uncertain.status, 503);
        assert.ok(!(await uncertain.text()).includes(phone));
        db.transaction = originalTransaction;
        const [count] = await db.query("SELECT COUNT(*) AS total FROM callback_requests WHERE id=$1", [body.requestId]);
        assert.equal(Number(count.total), commitBeforeError ? 1 : 0);
        const retry = await req("/api/contact/callback", "POST", body);
        assert.equal(retry.status, commitBeforeError ? 200 : 201);
        assert.equal((await retry.json()).requestId, body.requestId);
        const [after] = await db.query("SELECT COUNT(*) AS total FROM callback_requests WHERE id=$1", [body.requestId]);
        assert.equal(Number(after.total), 1);
      }
      assert.ok(logs.length >= 2);
      assert.ok(logs.every((line) => !line.includes(phone) && !line.includes(normalizedPhone)));
    } finally { db.transaction = originalTransaction; console.error = originalLog; }
  });

  await t.test("durable rate limits reject excess submissions without raw address storage or duplicate charging", async () => {
    await clearLimits();
    for (let i = 0; i < 5; i++) assert.equal((await req("/api/contact/callback", "POST", payload())).status, 201);
    const excess = await req("/api/contact/callback", "POST", payload());
    assert.equal(excess.status, 429);
    assert.ok(Number(excess.headers.get("retry-after")) > 0);
    assert.equal((await excess.json()).code, "RATE_LIMITED");
    assert.equal((await req("/api/contact/callback", "POST", firstBody)).status, 200);
    await clearLimits();
    const window = Math.floor(Date.now() / (15 * 60 * 1000));
    await db.query("INSERT INTO callback_limits (id,count,expires) VALUES ($1,100,$2)", [`site:${window}`, (window + 1) * 15 * 60 * 1000]);
    assert.equal((await req("/api/contact/callback", "POST", payload())).status, 429);
    await clearLimits();
  });

  await t.test("private status changes use compare-and-swap, with concurrent and stale updates rejected", async () => {
    const list = await (await req("/api/admin/callbacks", "GET", undefined, { cookie: ownerCookie })).json();
    assert.ok(list.requests.some((row) => row.id === firstBody.requestId));
    assert.equal(list.enabled, true);
    const target = `/api/admin/callbacks/${firstBody.requestId}`;
    const updates = await Promise.all(["done", "new"].map((status) => req(target, "PATCH", { status, version: 1 }, { cookie: ownerCookie })));
    assert.equal(updates.filter((reply) => reply.status === 200).length, 1);
    assert.equal(updates.filter((reply) => reply.status === 409).length, 1);
    const saved = await updates.find((reply) => reply.status === 200).json();
    assert.equal(saved.request.version, 2);
    assert.equal((await req(target, "PATCH", { status: "done", version: 1 }, { cookie: ownerCookie })).status, 409);
    assert.equal((await req(target, "PATCH", { status: "unknown", version: 2 }, { cookie: ownerCookie })).status, 400);
    assert.equal((await req(target, "PATCH", { status: "done", version: 2, phone: otherPhone }, { cookie: ownerCookie })).status, 400);
    assert.equal((await req(`/api/admin/callbacks/${randomUUID()}`, "PATCH", { status: "done", version: 1 }, { cookie: ownerCookie })).status, 404);
  });

  await t.test("fresh server process sees the saved requests, receipts, sessions and durable rate limits", async () => {
    await clearLimits();
    for (let i = 0; i < 5; i++) assert.equal((await req("/api/contact/callback", "POST", payload())).status, 201);
    const child = spawn(process.execPath, ["--input-type=module", "-e", `import { createApp } from './server/app.mjs'; const server=createApp().listen(0,'127.0.0.1',()=>console.log(server.address().port));`], {
      cwd: path.resolve(new URL("..", import.meta.url).pathname),
      env: { PATH: process.env.PATH, DATA_DIR: dir, ADMIN_PASSWORD_HASH: passwordHash, CONTACT_CALLBACK_ENABLED: "true", CONTACT_CALLBACK_DATA_APPROVED: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const port = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Synthetic process startup timeout")), 10000);
        child.once("error", (error) => { clearTimeout(timeout); reject(error); });
        child.once("exit", () => { clearTimeout(timeout); reject(new Error("Synthetic process exited before readiness")); });
        child.stdout.once("data", (chunk) => { clearTimeout(timeout); resolve(Number(chunk.toString().trim())); });
      });
      assert.ok(Number.isInteger(port));
      const otherBase = `http://127.0.0.1:${port}`;
      const list = await fetch(`${otherBase}/api/admin/callbacks`, { headers: { cookie: ownerCookie } });
      assert.equal(list.status, 200);
      assert.ok((await list.json()).requests.some((row) => row.id === firstBody.requestId));
      const send = (body) => fetch(`${otherBase}/api/contact/callback`, { method: "POST", headers: { origin: otherBase, "content-type": "application/json" }, body: JSON.stringify(body) });
      assert.deepEqual(await (await send(firstBody)).json(), firstReceipt);
      assert.equal((await send(payload())).status, 429);
    } finally {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.exitCode !== null || child.signalCode !== null ? resolve() : child.once("exit", resolve));
    }
  });

  await t.test("retention pruning and cursor pagination are bounded, private and usable while intake is off", async () => {
    await clearLimits();
    const now = Date.now();
    const expiredId = randomUUID();
    const insert = (id, createdAt) => db.query("INSERT INTO callback_requests (id,phone,consent_version,fingerprint,created_at,status,version) VALUES ($1,$2,$3,$4,$5,'new',1)", [id, "+447700900099", active.consentVersion, "synthetic", createdAt]);
    await insert(expiredId, now - 31 * 24 * 60 * 60 * 1000);
    for (let i = 0; i < 60; i++) await insert(randomUUID(), now - i);
    process.env.CONTACT_CALLBACK_ENABLED = "false";
    assert.equal((await config()).enabled, false);
    assert.equal((await req("/api/contact/callback", "POST", payload())).status, 503);
    const list = await (await req("/api/admin/callbacks", "GET", undefined, { cookie: ownerCookie })).json();
    assert.equal(list.enabled, false);
    assert.equal(list.requests.length, 50);
    assert.ok(list.nextCursor);
    assert.ok(!list.nextCursor.includes("447700"));
    assert.ok(!list.requests.some((row) => row.id === expiredId));
    const next = await (await req(`/api/admin/callbacks?cursor=${list.nextCursor}`, "GET", undefined, { cookie: ownerCookie })).json();
    assert.ok(next.requests.length > 0);
    assert.equal(next.nextCursor, null);
    const ids = [...list.requests, ...next.requests].map((row) => row.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal((await req("/api/admin/callbacks?cursor=bad", "GET", undefined, { cookie: ownerCookie })).status, 400);
    assert.equal((await req("/api/admin/callbacks?phone=not-allowed", "GET", undefined, { cookie: ownerCookie })).status, 400);
    const [{ total }] = await db.query("SELECT COUNT(*) AS total FROM callback_requests WHERE id=$1", [expiredId]);
    assert.equal(Number(total), 0);
  });

  await t.test("booking remains closed and new callback storage does not leak in any public payload", async () => {
    assert.equal((await req("/api/booking/appointments", "POST", {})).status, 503);
    assert.equal((await req("/api/booking/appointments/anything", "POST", {})).status, 503);
    const booking = await (await req("/api/booking/config")).json();
    assert.equal(booking.enabled, false);
    const publicText = await (await req("/api/content")).text();
    for (const secret of [normalizedPhone, firstBody.requestId, "callback_requests", "consent_version"]) assert.ok(!publicText.includes(secret));
  });
});

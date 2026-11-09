import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash, scryptSync } from "node:crypto";
import { syntheticCallbackConsent } from "./helpers/callback-policy.mjs";
import { createPostgresAdapter } from "../server/postgres.mjs";

const urlKey = "POSTGRES_NATIVE_TEST_URL";
const optInKey = "POSTGRES_NATIVE_TEST_ALLOW_WRITE";
const caKey = "POSTGRES_NATIVE_TEST_CA_PEM";
const fixtureUrl = "postgresql://adapter_synthetic:adapter-synthetic-only@127.0.0.1:55434/adapter_synthetic";
export function fixtureConfiguration(env) {
  assert.ok(!env.DATABASE_URL, "No application DATABASE_URL may be inherited");
  assert.ok(env[optInKey] === "synthetic-only", "Explicit synthetic-only opt-in required");
  let url;
  try { url = new URL(env[urlKey]); } catch { throw new Error("Dedicated fixture URL required"); }
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "[::1]"].includes(url.hostname), "Literal loopback endpoint required");
  assert.ok(url.port && Number(url.port) >= 1024);
  assert.ok(url.username === "adapter_synthetic" && url.password === "adapter-synthetic-only", "Only dedicated public synthetic credentials allowed");
  assert.ok(url.pathname === "/adapter_synthetic" && !url.search && !url.hash);
  assert.ok(typeof env[caKey] === "string" && env[caKey].includes("-----BEGIN CERTIFICATE-----"), "Fixture public TLS certificate required");
  return { DATABASE_DRIVER: "postgres", DATABASE_URL: env[urlKey], DATABASE_TLS_CA_PEM: env[caKey] };
}

test("native PostgreSQL fixture rejects ambient, remote and non-synthetic configuration", () => {
  const valid = { [urlKey]: fixtureUrl, [optInKey]: "synthetic-only", [caKey]: "-----BEGIN CERTIFICATE-----\nsynthetic configuration test only" };
  assert.equal(fixtureConfiguration(valid).DATABASE_DRIVER, "postgres");
  for (const invalid of [
    {}, { ...valid, DATABASE_URL: "configured" }, { ...valid, [optInKey]: "" }, { ...valid, [caKey]: "" },
    ...[fixtureUrl.replace("127.0.0.1", "localhost"), fixtureUrl.replace("127.0.0.1", "production.invalid"), fixtureUrl.replace("adapter_synthetic:", "owner:"), `${fixtureUrl}?sslmode=disable`, `${fixtureUrl}#x`].map((url) => ({ ...valid, [urlKey]: url })),
  ]) assert.throws(() => fixtureConfiguration(invalid));
});

const enabled = [urlKey, optInKey, caKey].some((key) => Object.hasOwn(process.env, key));
test("real PostgreSQL 18 over verified TLS: native adapter durability, CAS, callback locking and rollback", {
  skip: enabled ? false : "Not run: requires an explicitly configured disposable PostgreSQL 18 TLS fixture",
  timeout: 90000,
}, async (t) => {
  const configuration = fixtureConfiguration(process.env);
  const db = await createPostgresAdapter(configuration);
  const [{ database, role, version, tls, foreign_tables }] = await db.query(`SELECT current_database() AS database,current_user AS role,current_setting('server_version_num')::integer AS version,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls,(SELECT count(*)::integer FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_schema !~ '^adapter_test_[a-f0-9]{24}$') AS foreign_tables`);
  assert.equal(database, "adapter_synthetic"); assert.equal(role, "adapter_synthetic");
  assert.ok(version >= 180000 && version < 190000, "Actual PostgreSQL 18 is required");
  assert.equal(tls, true); assert.equal(foreign_tables, 0, "Refusing a fixture containing application tables");
  const schema = `adapter_test_${randomBytes(12).toString("hex")}`;
  const prefix = `"${schema}".`;
  await db.query(`CREATE SCHEMA "${schema}"`);
  t.after(async () => { try { await db.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await db.close(); } });
  await db.transaction([
    { sql: `CREATE TABLE ${prefix}content (id TEXT PRIMARY KEY,body TEXT NOT NULL,version INTEGER NOT NULL)` },
    { sql: `CREATE TABLE ${prefix}media (id TEXT PRIMARY KEY,mime TEXT NOT NULL,body TEXT NOT NULL,name TEXT NOT NULL)` },
    { sql: `CREATE TABLE ${prefix}callback_consents (version TEXT PRIMARY KEY,privacy_text TEXT NOT NULL,consent_text TEXT NOT NULL,created_at BIGINT NOT NULL)` },
    { sql: `CREATE TABLE ${prefix}callback_requests (id TEXT PRIMARY KEY,phone TEXT NOT NULL,consent_version TEXT NOT NULL,fingerprint TEXT NOT NULL,created_at BIGINT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL)` },
  ]);
  const text = JSON.stringify({ profile: { privacy: "Синтетическая политика", callbackConsent: syntheticCallbackConsent(), name: "Синтетический владелец" }, bookingSchedule: { timezone: "Europe/Moscow" }, bookingOccupancy: {}, services: [], diplomas: [] });
  await db.query(`INSERT INTO ${prefix}content VALUES ($1,$2,$3)`, ["main", text, 1]);
  await db.query(`INSERT INTO ${prefix}content VALUES ($1,$2,$3)`, ["marketing", '{"draft":"синтетический материал"}', 7]);
  await db.query(`INSERT INTO ${prefix}media VALUES ($1,$2,$3,$4)`, ["synthetic-media", "image/png", Buffer.from("synthetic image bytes").toString("base64"), "синтетика.png"]);

  await t.test("query row arrays, Unicode and exact media bytes survive new adapter connections", async () => {
    const independent = await createPostgresAdapter(configuration);
    try {
      const [row] = await independent.query(`SELECT body,version FROM ${prefix}content WHERE id=$1`, ["main"]);
      assert.equal(row.body, text); assert.equal(row.version, 1);
      const [media] = await independent.query(`SELECT body FROM ${prefix}media WHERE id=$1`, ["synthetic-media"]);
      assert.equal(Buffer.from(media.body, "base64").toString(), "synthetic image bytes");
    } finally { await independent.close(); }
  });

  await t.test("CAS preserves one writer and a failed batch rolls back all preceding writes", async () => {
    const sql = `UPDATE ${prefix}content SET version=version+1 WHERE id=$1 AND version=$2 RETURNING version`;
    const results = await Promise.all([db.query(sql, ["marketing", 7]), db.query(sql, ["marketing", 7])]);
    assert.deepEqual(results.map((r) => r.length).sort(), [0, 1]);
    await assert.rejects(db.transaction([{ sql: `UPDATE ${prefix}content SET version=100 WHERE id='marketing'` }, { sql: "SELECT 1/0" }]), /STORAGE_UNAVAILABLE/);
    assert.equal((await db.query(`SELECT version FROM ${prefix}content WHERE id='marketing'`))[0].version, 8);
  });

  await t.test("actual callback statements wait for in-flight privacy update and reject stale consent", async () => {
    const { Pool } = await import("pg");
    const { postgresOptions } = await import("../server/storage-config.mjs");
    const { callbackInsertStatements, callbackReleaseRevision } = await import("../server/callbacks.mjs");
    const editorPool = new Pool(postgresOptions(configuration));
    const editor = await editorPool.connect();
    const privacy = "Синтетическая политика";
    const revision = callbackReleaseRevision({ privacy, callbackConsent: syntheticCallbackConsent() });
    const consentVersion = revision.version;
    const body = { phone: "+447700900001", consent: true, consentVersion, requestId: randomUUID(), website: "" };
    const statements = callbackInsertStatements(body, "synthetic-fingerprint", Date.now(), 1, privacy, revision.snapshot);
    try {
      await editor.query("BEGIN");
      const revisedPrivacy = "Синтетическая политика после правки";
      const revisedContent = JSON.parse(text);
      revisedContent.profile.privacy = revisedPrivacy;
      await editor.query(`UPDATE ${prefix}content SET body=$1,version=2 WHERE id='main'`, [JSON.stringify(revisedContent)]);
      const pending = db.transaction([{ sql: `SET LOCAL search_path TO "${schema}"` }, ...statements]);
      pending.catch(() => {});
      let lockObserved = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const [{ count }] = await db.query("SELECT count(*)::integer AS count FROM pg_stat_activity WHERE application_name='anna-site' AND wait_event_type='Lock'");
        if (count > 0) { lockObserved = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(lockObserved, true, "Observe a real PostgreSQL lock wait, not a timer assumption");
      await editor.query("COMMIT");
      const result = await pending;
      assert.equal(result.at(-1).length, 0);
      assert.equal((await db.query(`SELECT count(*)::integer AS count FROM ${prefix}callback_requests`))[0].count, 0);
      const freshRevision = callbackReleaseRevision({ privacy: revisedPrivacy, callbackConsent: syntheticCallbackConsent() });
      const freshBody = { ...body, consentVersion: freshRevision.version };
      const fresh = callbackInsertStatements(freshBody, "synthetic-fingerprint", Date.now(), 2, revisedPrivacy, freshRevision.snapshot);
      const concurrent = await Promise.all([1, 2].map(() => db.transaction([{ sql: `SET LOCAL search_path TO "${schema}"` }, ...fresh])));
      assert.deepEqual(concurrent.map((r) => r.at(-1).length).sort(), [0, 1]);
      assert.equal((await db.query(`SELECT phone FROM ${prefix}callback_requests`))[0].phone, "+447700900001");
      assert.equal((await db.query(`SELECT privacy_text FROM ${prefix}callback_consents WHERE version=$1`, [freshBody.consentVersion]))[0].privacy_text, revisedPrivacy);
    } finally {
      await editor.query("ROLLBACK").catch(() => {}); editor.release(); await editorPool.end();
    }
  });

  await t.test("lost acknowledgement AFTER actual COMMIT is recoverable with the same operation key", async () => {
    const { Pool } = await import("pg");
    let simulateLostAck = true;
    class LostAckPool extends Pool {
      connect(callback) {
        if (callback) return super.connect(callback);
        return super.connect().then((client) => {
          const query = client.query.bind(client);
          client.query = async (...args) => {
            const result = await query(...args);
            if (args[0] === "COMMIT" && simulateLostAck) {
              simulateLostAck = false;
              throw new Error("Synthetic transport lost the committed acknowledgement");
            }
            return result;
          };
          return client;
        });
      }
    }
    const ambiguous = await createPostgresAdapter(configuration, { PoolClass: LostAckPool });
    const id = `synthetic-retry-${randomUUID()}`;
    const statements = [{ sql: `INSERT INTO ${prefix}content (id,body,version) VALUES ($1,$2,1) ON CONFLICT (id) DO NOTHING RETURNING id`, args: [id, "synthetic committed data"] }];
    try {
      await assert.rejects(ambiguous.transaction(statements), /STORAGE_COMMIT_UNCONFIRMED/);
      assert.equal((await db.query(`SELECT count(*)::integer AS count FROM ${prefix}content WHERE id=$1`, [id]))[0].count, 1);
      assert.equal((await ambiguous.transaction(statements))[0].length, 0);
      assert.equal((await db.query(`SELECT count(*)::integer AS count FROM ${prefix}content WHERE id=$1`, [id]))[0].count, 1);
    } finally { await ambiguous.close(); }
  });

  await t.test("database dispatch and real application routes use the TLS adapter end to end", async () => {
    // The top-level guard verified this dedicated fixture before any configuration
    // is assigned. These are synthetic-only values, never inherited app secrets.
    Object.assign(process.env, configuration);
    delete process.env.VERCEL;
    process.env.ADMIN_PASSWORD_HASH = `fixture-salt:${scryptSync("synthetic-owner-only", "fixture-salt", 64).toString("hex")}`;
    process.env.CONTACT_CALLBACK_ENABLED = "true";
    process.env.CONTACT_CALLBACK_DATA_APPROVED = "true";
    const { createApp } = await import("../server/app.mjs");
    const server = createApp().listen(0, "127.0.0.1");
    try {
      await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
      const base = `http://127.0.0.1:${server.address().port}`;
      const request = (route, method = "GET", body, cookie = "") => fetch(base + route, {
        method, headers: { origin: base, "content-type": "application/json", cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      assert.equal((await request("/api/content")).status, 200);
      const [row] = await db.query("SELECT body FROM public.content WHERE id=$1", ["main"]);
      const content = JSON.parse(row.body);
      content.profile.privacy = "Synthetic app-level fixture policy only.";
      content.profile.callbackConsent = syntheticCallbackConsent();
      const { callbackReleaseRevision } = await import("../server/callbacks.mjs");
      process.env.CONTACT_CALLBACK_RELEASE_VERSION = callbackReleaseRevision(content.profile).version;
      await db.query("UPDATE public.content SET body=$1,version=version+1 WHERE id=$2", [JSON.stringify(content), "main"]);
      const config = await (await request("/api/contact/config")).json();
      assert.equal(config.enabled, true);
      const body = { phone: "+447700900002", consent: true, consentVersion: config.consentVersion, requestId: randomUUID(), website: "" };
      assert.equal((await request("/api/contact/callback", "POST", body)).status, 201);
      assert.equal((await request("/api/contact/callback", "POST", body)).status, 200);
      assert.equal((await request("/api/admin/callbacks")).status, 401);
      const login = await request("/api/session", "POST", { password: "synthetic-owner-only" });
      assert.equal(login.status, 200);
      const cookie = login.headers.get("set-cookie").split(";")[0];
      const list = await (await request("/api/admin/callbacks", "GET", undefined, cookie)).json();
      assert.equal(list.requests[0].phone, "+447700900002");
      assert.equal((await request(`/api/admin/callbacks/${body.requestId}`, "PATCH", { status: "done", version: 1 }, cookie)).status, 200);
      assert.equal((await request("/api/booking/config")).status, 200);
      assert.equal((await (await request("/api/booking/config")).json()).enabled, false);
    } finally {
      if (server.listening) await new Promise((resolve) => server.close(resolve));
      // Only the explicitly empty disposable fixture's newly created app tables.
      await db.query("DROP TABLE IF EXISTS public.callback_requests,public.callback_consents,public.callback_limits,public.attempts,public.sessions,public.media,public.content");
      delete process.env.DATABASE_URL;
      delete process.env.DATABASE_DRIVER;
      delete process.env.DATABASE_TLS_CA_PEM;
      delete process.env.CONTACT_CALLBACK_RELEASE_VERSION;
    }
  });

  await t.test("untrusted self-signed TLS fixture is rejected rather than downgraded", async () => {
    const { DATABASE_TLS_CA_PEM: ignored, ...withoutTrust } = configuration;
    const untrusted = await createPostgresAdapter(withoutTrust);
    try { await assert.rejects(untrusted.query("SELECT 1"), /STORAGE_UNAVAILABLE/); }
    finally { await untrusted.close(); }
  });
});

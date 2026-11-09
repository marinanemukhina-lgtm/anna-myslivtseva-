import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { postgresOptions, storageDriver, allowsInitialContentFallback, storageConfigurationReady } from "../server/storage-config.mjs";
import { createPostgresAdapter } from "../server/postgres.mjs";

const url = "postgresql://synthetic_user:synthetic-only@db.example.invalid:5432/synthetic_db";
const env = () => ({ DATABASE_DRIVER: "postgres", DATABASE_URL: url });

test("storage selection preserves Neon/local defaults and fails closed for explicit misconfiguration", () => {
  assert.equal(storageDriver({}), "sqlite");
  assert.equal(storageDriver({ DATABASE_URL: url }), "neon");
  assert.equal(storageDriver(env()), "postgres");
  assert.equal(storageDriver({ DATABASE_DRIVER: "sqlite" }), "sqlite");
  for (const invalid of [
    { DATABASE_DRIVER: "" }, { DATABASE_DRIVER: "", DATABASE_URL: url }, { DATABASE_DRIVER: "native" }, { DATABASE_DRIVER: "postgres" }, { DATABASE_DRIVER: "neon" },
    { DATABASE_DRIVER: "sqlite", DATABASE_URL: url }, { VERCEL: "1" }, { DATABASE_DRIVER: "sqlite", VERCEL: "1" },
  ]) assert.throws(() => storageDriver(invalid), /STORAGE_/);
  assert.equal(allowsInitialContentFallback({ VERCEL: "1" }), true);
  for (const DATABASE_DRIVER of ["", "postgres", "neon", "sqlite", "typo"]) {
    assert.equal(allowsInitialContentFallback({ VERCEL: "1", DATABASE_DRIVER }), false);
    assert.equal(storageConfigurationReady({ VERCEL: "1", DATABASE_DRIVER }), false);
  }
});

test("PostgreSQL requires certificate AND hostname verification and rejects URL/env TLS downgrades", () => {
  const options = postgresOptions(env());
  assert.equal(options.host, "db.example.invalid");
  assert.equal(options.user, "synthetic_user");
  assert.equal(options.database, "synthetic_db");
  assert.equal(options.port, 5432);
  assert.equal(options.options, "-c search_path=public");
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.minVersion, "TLSv1.2");
  assert.ok(!Object.hasOwn(options, "connectionString"));
  assert.equal(options.ssl.checkServerIdentity("irrelevant", { subjectaltname: "DNS:db.example.invalid" }), undefined);
  assert.ok(options.ssl.checkServerIdentity("db.example.invalid", { subjectaltname: "DNS:wrong.example.invalid" }));
  const ip = postgresOptions({ ...env(), DATABASE_URL: url.replace("db.example.invalid", "127.0.0.1") });
  assert.equal(ip.ssl.checkServerIdentity("ignored", { subjectaltname: "IP Address:127.0.0.1" }), undefined);
  for (const value of [
    `${url}?sslmode=disable`, `${url}?sslmode=require`, `${url}?sslmode=verify-full`, `${url}?sslrootcert=x`, `${url}?host=other.invalid`, `${url}?options=-c%20search_path=public`, `${url}#fragment`,
    "http://db.example.invalid/db", "postgresql:///db", "postgresql://user@db.example.invalid/db", "postgresql://user:password@db.example.invalid/", `${url}/extra`, url.replace("synthetic_user", "%00user"),
  ]) assert.throws(() => postgresOptions({ ...env(), DATABASE_URL: value }), /STORAGE_CONFIGURATION_INVALID/);
  assert.throws(() => postgresOptions({ ...env(), NODE_TLS_REJECT_UNAUTHORIZED: "0" }), /STORAGE_CONFIGURATION_INVALID/);
  for (const ca of ["", "not-a-certificate", "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----"])
    assert.throws(() => postgresOptions({ ...env(), DATABASE_TLS_CA_PEM: ca }), /STORAGE_CONFIGURATION_INVALID/);
});

function fixture({ failAt, rollbackFails = false, gateCommit } = {}) {
  const calls = [], clients = [];
  class Pool extends EventEmitter {
    constructor(options) { super(); this.options = options; }
    async query(sql, args) { calls.push(["pool", sql, args]); if (failAt === "pool") throw new Error(`Secret ${url}`); return { rows: [{ value: args?.[0] ?? 1 }] }; }
    async connect() {
      if (failAt === "connect") throw new Error(`Secret ${url}`);
      const id = clients.length;
      const client = {
        async query(sql, args) {
          calls.push([id, sql, args]);
          if (sql === failAt || (sql === "ROLLBACK" && rollbackFails)) throw new Error(`Secret ${url}`);
          if (sql === "COMMIT" && gateCommit) await gateCommit;
          return { rows: [{ value: args?.[0] ?? 1 }] };
        },
        release(destroy) { calls.push([id, "release", destroy]); },
      };
      clients.push(client); return client;
    }
    async end() { calls.push(["pool", "end"]); }
  }
  return { Pool, calls, clients };
}

test("native pg adapter preserves query row arrays, parameterization and same-client ordered atomic batches", async () => {
  const f = fixture();
  const adapter = await createPostgresAdapter(env(), { PoolClass: f.Pool });
  assert.deepEqual(await adapter.query("SELECT $1", ["synthetic"]), [{ value: "synthetic" }]);
  assert.deepEqual(await adapter.transaction([{ sql: "SELECT $1", args: [11] }, { sql: "SELECT $1", args: [12] }]), [[{ value: 11 }], [{ value: 12 }]]);
  assert.deepEqual(f.calls.slice(1).map(([id, sql]) => [id, sql]), [[0, "BEGIN ISOLATION LEVEL READ COMMITTED"], [0, "SELECT $1"], [0, "SELECT $1"], [0, "COMMIT"], [0, "release"]]);
  await adapter.close();
});

test("atomic success waits for COMMIT acknowledgement and does not use pool.query", async () => {
  let releaseCommit;
  const gateCommit = new Promise((resolve) => { releaseCommit = resolve; });
  const f = fixture({ gateCommit });
  const adapter = await createPostgresAdapter(env(), { PoolClass: f.Pool });
  let returned = false;
  const pending = adapter.transaction([{ sql: "INSERT fixture", args: [] }]).then(() => { returned = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(returned, false);
  releaseCommit(); await pending;
  assert.equal(returned, true);
  assert.ok(f.calls.every(([client]) => client === 0));
});

test("statement errors roll back, never retry, and release or discard the checked-out connection", async () => {
  for (const rollbackFails of [false, true]) {
    const f = fixture({ failAt: "FAIL", rollbackFails });
    const adapter = await createPostgresAdapter(env(), { PoolClass: f.Pool });
    await assert.rejects(adapter.transaction([{ sql: "FAIL" }, { sql: "NEVER" }]), { message: "STORAGE_UNAVAILABLE" });
    assert.deepEqual(f.calls.map(([,sql]) => sql), ["BEGIN ISOLATION LEVEL READ COMMITTED", "FAIL", "ROLLBACK", "release"]);
    assert.equal(f.calls.at(-1)[2], rollbackFails);
  }
});

test("ambiguous COMMIT is never retried or represented as rolled back; errors cannot leak credentials", async () => {
  const f = fixture({ failAt: "COMMIT" });
  const adapter = await createPostgresAdapter(env(), { PoolClass: f.Pool });
  await assert.rejects(adapter.transaction([{ sql: "INSERT fixture" }]), { message: "STORAGE_COMMIT_UNCONFIRMED" });
  assert.deepEqual(f.calls.map(([,sql]) => sql), ["BEGIN ISOLATION LEVEL READ COMMITTED", "INSERT fixture", "COMMIT", "release"]);
  assert.equal(f.calls.at(-1)[2], true);
  for (const failAt of ["connect", "pool"]) {
    const failed = fixture({ failAt });
    const a = await createPostgresAdapter(env(), { PoolClass: failed.Pool });
    await assert.rejects(failAt === "connect" ? a.transaction([]) : a.query("SELECT 1"), { message: "STORAGE_UNAVAILABLE" });
  }
});

test("public API does not disguise an explicitly broken driver as initial content or configured storage", async (t) => {
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_TLS_CA_PEM;
  process.env.VERCEL = "1";
  process.env.ADMIN_PASSWORD_HASH = "synthetic-present-only";
  process.env.DATABASE_DRIVER = "postgres";
  const { createApp } = await import("../server/app.mjs");
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const driver of ["", "postgres", "neon", "sqlite", "typo"]) {
    process.env.DATABASE_DRIVER = driver;
    assert.equal((await fetch(`${base}/api/content`)).status, 503);
    assert.equal((await (await fetch(`${base}/api/session`)).json()).configured, false);
  }
  delete process.env.DATABASE_DRIVER;
  assert.equal((await fetch(`${base}/api/content`)).status, 200);
});

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";

// Opt-in, disposable PostgreSQL 16 only. Never imports dotenv, starts the app,
// uses DATABASE_URL, contacts Neon, or loads production account information.
const urlName = "CALLBACK_POSTGRES_TEST_URL";
const allowName = "CALLBACK_POSTGRES_TEST_ALLOW_WRITE";
const testUrl = "postgresql://callback_synthetic:callback-synthetic-only@127.0.0.1:55433/callback_synthetic";

function configuration(env) {
  assert.ok(!env.DATABASE_URL, "Refusing inherited application database configuration");
  assert.ok(env[allowName] === "synthetic-only", "Explicit synthetic write opt-in required");
  let url;
  try { url = new URL(env[urlName]); } catch { throw new Error("Dedicated synthetic PostgreSQL URL required"); }
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "[::1]"].includes(url.hostname), "Literal loopback endpoint required");
  assert.ok(url.port && Number(url.port) >= 1024, "Explicit unprivileged port required");
  assert.ok(url.username === "callback_synthetic", "Dedicated synthetic role required");
  assert.ok(url.password === "callback-synthetic-only", "Only public synthetic credentials permitted");
  assert.ok(url.pathname === "/callback_synthetic", "Dedicated synthetic database required");
  assert.ok(!url.search && !url.hash, "Endpoint overrides forbidden");
  return { host: url.hostname === "[::1]" ? "::1" : url.hostname, port: url.port };
}

function sqlValue(value) {
  if (typeof value === "number") { assert.ok(Number.isSafeInteger(value)); return String(value); }
  assert.equal(typeof value, "string");
  assert.ok(!value.includes("\0"));
  return `convert_from(decode('${Buffer.from(value).toString("hex")}','hex'),'UTF8')`;
}
const statementSql = ({ sql, args }) => sql.replace(/\$(\d+)/g, (_, n) => sqlValue(args[Number(n) - 1]));

function postgres(config) {
  function open(applicationName = "callback-synthetic-test") {
    const child = spawn("psql", ["--no-psqlrc", "--no-password", "--quiet", "--no-align", "--tuples-only", "--set", "ON_ERROR_STOP=1", "--file", "-"], {
      env: {
        PATH: process.env.PATH, LC_ALL: "C", PGHOST: config.host, PGPORT: config.port,
        PGDATABASE: "callback_synthetic", PGUSER: "callback_synthetic", PGPASSWORD: "callback-synthetic-only",
        PGPASSFILE: "/dev/null", PGSERVICEFILE: "/dev/null", PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable", PGAPPNAME: applicationName,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "", stderr = "", pending = "", settled = false;
    const lines = [], watchers = [];
    let resolveDone, rejectDone;
    const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
    // Interactive sessions can fail while the caller is waiting for a marker.
    done.catch(() => {});
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(new Error("Synthetic PostgreSQL test timed out")); }, 15000);
    function finish(error) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      for (const watcher of watchers.splice(0)) watcher.reject(error || new Error("PostgreSQL exited before marker"));
      if (error) rejectDone(error); else resolveDone(output.trim());
    }
    child.on("error", () => finish(new Error("Cannot start PostgreSQL client")));
    child.stdin.on("error", () => finish(new Error("Cannot write synthetic PostgreSQL input")));
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    child.stdout.on("data", (chunk) => {
      output += chunk; pending += chunk;
      if (output.length > 2 * 1024 * 1024) { child.kill("SIGKILL"); finish(new Error("Synthetic SQL output exceeded its bound")); return; }
      while (pending.includes("\n")) {
        const i = pending.indexOf("\n"); const line = pending.slice(0, i).trim(); pending = pending.slice(i + 1); lines.push(line);
        for (const watcher of [...watchers]) if (watcher.marker === line) { watchers.splice(watchers.indexOf(watcher), 1); watcher.resolve(); }
      }
    });
    child.on("close", (code) => finish(code === 0 ? undefined : new Error(`Synthetic PostgreSQL failed (${code}): ${stderr.trim()}`)));
    child.stdin.write("SET statement_timeout='10s'; SET lock_timeout='8s';\n");
    return {
      write(sql) { child.stdin.write(sql + "\n"); },
      end(sql = "") { child.stdin.end(sql + "\n"); return done; },
      marker(marker) { return lines.includes(marker) ? Promise.resolve() : new Promise((resolve, reject) => watchers.push({ marker, resolve, reject })); },
      kill() { child.kill("SIGKILL"); },
      done,
    };
  }
  async function run(sql, app) { return open(app).end(sql); }
  async function json(sql, app) { return JSON.parse((await run(sql, app)).split("\n").at(-1)); }
  async function blocked(app) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const { count } = await json(`SELECT json_build_object('count',count(*)) FROM pg_stat_activity WHERE application_name=${sqlValue(app)} AND wait_event_type='Lock';`);
      if (count > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail("Expected actual PostgreSQL row-lock overlap was not observed");
  }
  return { open, run, json, blocked };
}

test("callback PostgreSQL test refuses production/default connections and endpoint overrides", () => {
  const valid = { [urlName]: testUrl, [allowName]: "synthetic-only" };
  assert.deepEqual(configuration(valid), { host: "127.0.0.1", port: "55433" });
  for (const invalid of [
    {}, { ...valid, DATABASE_URL: "configured" }, { ...valid, [allowName]: "" },
    ...[testUrl.replace("127.0.0.1", "localhost"), testUrl.replace("127.0.0.1", "production.invalid"), testUrl.replace(":55433", ""), testUrl.replace("callback_synthetic:", "owner:"), `${testUrl}?host=remote.invalid`, `${testUrl}#fragment`].map((url) => ({ ...valid, [urlName]: url })),
  ]) assert.throws(() => configuration(invalid));
});

const optedIn = Object.hasOwn(process.env, urlName) || Object.hasOwn(process.env, allowName);
test("actual PostgreSQL 16: callback commits serialize with in-flight privacy edits", {
  skip: optedIn ? false : `Not run: set ${urlName} and ${allowName} for a disposable loopback PostgreSQL 16 database`,
  timeout: 120000,
}, async (t) => {
  const pg = postgres(configuration(process.env));
  const identity = await pg.json(`SELECT json_build_object('database',current_database(),'role',current_user,'version',current_setting('server_version_num')::integer,'foreignTables',(SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_schema !~ '^callback_test_[a-f0-9]{24}$'));`);
  assert.equal(identity.database, "callback_synthetic");
  assert.equal(identity.role, "callback_synthetic");
  assert.ok(identity.version >= 160000 && identity.version < 170000);
  assert.equal(identity.foreignTables, 0, "Refusing a database containing application tables");
  const { callbackInsertStatements } = await import("../server/callbacks.mjs");
  const { callbackConsentText } = await import("../shared/callbacks.mjs");
  const schema = `callback_test_${randomBytes(12).toString("hex")}`;
  const searchPath = `SET search_path TO "${schema}";`;
  await pg.run(`CREATE SCHEMA "${schema}"; ${searchPath}
    CREATE TABLE content (id TEXT PRIMARY KEY,body TEXT NOT NULL,version INTEGER NOT NULL);
    CREATE TABLE callback_consents (version TEXT PRIMARY KEY,privacy_text TEXT NOT NULL,consent_text TEXT NOT NULL,created_at BIGINT NOT NULL);
    CREATE TABLE callback_requests (id TEXT PRIMARY KEY,phone TEXT NOT NULL,consent_version TEXT NOT NULL,fingerprint TEXT NOT NULL,created_at BIGINT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL);
    INSERT INTO content VALUES ('main','synthetic policy one',1);`);
  t.after(() => pg.run(`DROP SCHEMA "${schema}" CASCADE;`));
  const privacy = "Synthetic policy one, fixture only.";
  const consentVersion = createHash("sha256").update(JSON.stringify([callbackConsentText, privacy])).digest("hex");
  const body = () => ({ phone: "+44 7700 900001", consent: true, consentVersion, requestId: randomUUID(), website: "" });
  const batch = (request, version) => callbackInsertStatements(request, "synthetic-fingerprint", Date.now(), version, privacy).map(statementSql);
  const count = () => pg.json(`${searchPath} SELECT json_build_object('count',count(*)) FROM callback_requests;`);

  await t.test("editor holds the row first: waiting callback observes committed new policy and writes nothing", async () => {
    const editor = pg.open("callback-synthetic-editor-first");
    editor.write(`${searchPath} BEGIN; UPDATE content SET body='synthetic policy two',version=2 WHERE id='main'; SELECT 'EDITOR_LOCKED';`);
    try {
      await editor.marker("EDITOR_LOCKED");
      const request = body();
      const app = "callback-synthetic-waiting-request";
      const pending = pg.run(`${searchPath} BEGIN ISOLATION LEVEL READ COMMITTED; ${batch(request, 1).join(";\n")}; COMMIT;`, app);
      await pg.blocked(app); // Observed pg_stat_activity lock wait, not a timing assumption.
      await editor.end("COMMIT;");
      await pending;
      assert.equal((await count()).count, 0);
      assert.equal((await pg.json(`${searchPath} SELECT json_build_object('count',count(*)) FROM callback_consents;`)).count, 0);
    } finally { editor.kill(); }
  });

  await t.test("callback holds the row first: acceptance commits before policy edit, with immutable accepted text", async () => {
    const request = body();
    const statements = batch(request, 2);
    const callback = pg.open("callback-synthetic-request-first");
    callback.write(`${searchPath} BEGIN ISOLATION LEVEL READ COMMITTED; ${statements[0]}; SELECT 'CALLBACK_LOCKED';`);
    try {
      await callback.marker("CALLBACK_LOCKED");
      const app = "callback-synthetic-waiting-editor";
      const pendingEdit = pg.run(`${searchPath} UPDATE content SET body='synthetic policy three',version=3 WHERE id='main';`, app);
      await pg.blocked(app);
      await callback.end(`${statements.slice(1).join(";\n")}; COMMIT;`);
      await pendingEdit;
      assert.equal((await count()).count, 1);
      const stored = await pg.json(`${searchPath} SELECT json_build_object('phone',r.phone,'status',r.status,'privacy',c.privacy_text,'consent',c.consent_text) FROM callback_requests r JOIN callback_consents c ON c.version=r.consent_version WHERE r.id=${sqlValue(request.requestId)};`);
      assert.equal(stored.phone, "+447700900001");
      assert.equal(stored.status, "new");
      assert.equal(stored.privacy, privacy);
      assert.equal(stored.consent, callbackConsentText);
    } finally { callback.kill(); }
  });

  await t.test("concurrent same-key commits persist once and compare-and-swap prevents lost status updates", async () => {
    const request = body();
    const sql = `${searchPath} BEGIN ISOLATION LEVEL READ COMMITTED; ${batch(request, 3).join(";\n")}; COMMIT;`;
    await Promise.all([pg.run(sql, "callback-synthetic-duplicate-a"), pg.run(sql, "callback-synthetic-duplicate-b")]);
    const found = await pg.json(`${searchPath} SELECT json_build_object('count',count(*)) FROM callback_requests WHERE id=${sqlValue(request.requestId)};`);
    assert.equal(found.count, 1);
    const cas = (status) => `${searchPath} WITH changed AS (UPDATE callback_requests SET status=${sqlValue(status)},version=version+1 WHERE id=${sqlValue(request.requestId)} AND version=1 RETURNING id) SELECT json_build_object('count',count(*)) FROM changed;`;
    const updates = await Promise.all([pg.json(cas("done")), pg.json(cas("new"))]);
    assert.deepEqual(updates.map((result) => result.count).sort(), [0, 1]);
  });

  await t.test("failed atomic batch rolls back both immutable consent snapshot and request", async () => {
    const request = { ...body(), consentVersion: "e".repeat(64) };
    const statements = batch(request, 3);
    await assert.rejects(pg.run(`${searchPath} BEGIN ISOLATION LEVEL READ COMMITTED; ${statements[0]}; ${statements[1]}; SELECT 1/0; ${statements[2]}; COMMIT;`));
    const stored = await pg.json(`${searchPath} SELECT json_build_object('requests',(SELECT count(*) FROM callback_requests WHERE id=${sqlValue(request.requestId)}),'policies',(SELECT count(*) FROM callback_consents WHERE version=${sqlValue(request.consentVersion)}));`);
    assert.deepEqual(stored, { requests: 0, policies: 0 });
  });
});

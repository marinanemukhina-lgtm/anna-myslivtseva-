import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

// Opt-in integration checks against a disposable PostgreSQL 16 database only.
// Never imports server/db.mjs, reads .env, or falls back to DATABASE_URL.
// Run with psql on PATH and these two dedicated variables:
// BOOKING_POSTGRES_TEST_ALLOW_WRITE=synthetic-only
// BOOKING_POSTGRES_TEST_URL=postgresql://booking_synthetic:booking-synthetic-only@127.0.0.1:55432/booking_synthetic
// Without them the database suite explicitly skips, not a PostgreSQL pass.
const urlVariable = 'BOOKING_POSTGRES_TEST_URL';
const optInVariable = 'BOOKING_POSTGRES_TEST_ALLOW_WRITE';
const testUrl = 'postgresql://booking_synthetic:booking-synthetic-only@127.0.0.1:55432/booking_synthetic';
const casSql = 'UPDATE content SET body=$1,version=version+1 WHERE id=$2 AND version=$3 RETURNING version';

function configuration(env) {
  assert.equal(env[optInVariable], 'synthetic-only', `${optInVariable}=synthetic-only is required`);
  assert.ok(!env.DATABASE_URL, 'Refusing a process with DATABASE_URL set; use a clean synthetic-only environment');
  assert.ok(env[urlVariable], `${urlVariable} must explicitly name the disposable database`);
  let url;
  try { url = new URL(env[urlVariable]); } catch { throw new Error('Invalid dedicated synthetic PostgreSQL URL'); }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'Only PostgreSQL URLs are allowed');
  assert.ok(['127.0.0.1', '[::1]'].includes(url.hostname), 'Only literal loopback endpoints are allowed');
  assert.ok(url.port && Number(url.port) >= 1024, 'An explicit unprivileged test port is required');
  // Boolean assertions deliberately avoid echoing an accidentally supplied URL
  // component (especially a real password) in a failing test's diagnostic.
  assert.ok(url.username === 'booking_synthetic', 'Only the dedicated synthetic role is allowed');
  assert.ok(url.password === 'booking-synthetic-only', 'Only the fixed non-secret synthetic password is allowed');
  assert.ok(url.pathname === '/booking_synthetic', 'Only the dedicated synthetic database is allowed');
  assert.ok(url.search === '', 'Connection options and endpoint overrides are forbidden');
  assert.ok(url.hash === '', 'URL fragments are forbidden');
  return {
    host: url.hostname === '[::1]' ? '::1' : url.hostname,
    port: url.port,
  };
}

// Byte encoding avoids shell interpolation, psql substitution, quote escaping,
// backslash handling and standard_conforming_strings dependencies for data.
const sqlText = value => {
  assert.equal(typeof value, 'string');
  assert.ok(!value.includes('\0'), 'PostgreSQL text cannot contain NUL');
  return `convert_from(decode('${Buffer.from(value, 'utf8').toString('hex')}','hex'),'UTF8')`;
};
const envelope = relation => `SELECT json_build_object('backendPid',pg_backend_pid(),'rows',COALESCE(json_agg(result),'[]'::json)) FROM (${relation}) AS result;`;

function runner(config) {
  return async sql => {
    // Do not inherit PG*, service files, credentials, dotenv or app configuration.
    // psql -X also disables user/system psqlrc. Every command is a new real
    // PostgreSQL connection; concurrent CAS calls use independent backends.
    const env = {
      PATH: process.env.PATH,
      LC_ALL: 'C',
      PGHOST: config.host,
      PGPORT: config.port,
      PGDATABASE: 'booking_synthetic',
      PGUSER: 'booking_synthetic',
      PGPASSWORD: 'booking-synthetic-only',
      PGPASSFILE: '/dev/null',
      PGSERVICEFILE: '/dev/null',
      PGCONNECT_TIMEOUT: '5',
      PGSSLMODE: 'disable',
      PGAPPNAME: 'booking-synthetic-integration-test',
      PGCLIENTENCODING: 'UTF8',
    };
    return new Promise((resolve, reject) => {
      const child = spawn('psql', ['--no-psqlrc', '--no-password', '--quiet', '--no-align', '--tuples-only', '--set', 'ON_ERROR_STOP=1', '--file', '-'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', settled = false;
      const timeout = setTimeout(() => finish(new Error('Synthetic psql command timed out')), 12_000);
      function finish(error, result) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) { child.kill('SIGKILL'); reject(error); } else resolve(result);
      }
      child.on('error', () => finish(new Error('Cannot start psql: configured PostgreSQL checks require the PostgreSQL client')));
      child.stdin.on('error', () => finish(new Error('Cannot send synthetic SQL to psql')));
      child.stdout.on('data', chunk => {
        stdout += chunk;
        if (stdout.length > 4 * 1024 * 1024) finish(new Error('Synthetic psql output exceeded its limit'));
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
      child.on('close', code => {
        if (code !== 0) return finish(new Error(`Synthetic PostgreSQL command failed (exit ${code}): ${stderr.trim()}`));
        // Resolve only after psql exits successfully, not when RETURNING arrives:
        // the manager's adapter contract requires commit acknowledgement.
        try {
          const result = JSON.parse(stdout.trim());
          assert.ok(Number.isInteger(result.backendPid));
          assert.ok(Array.isArray(result.rows));
          finish(null, result);
        } catch { finish(new Error('Synthetic psql did not return one valid JSON result')); }
      });
      child.stdin.end(`SET statement_timeout='5s'; SET lock_timeout='3s';\n${sql}\n`);
    });
  };
}

test('PostgreSQL test configuration refuses production/default connections and endpoint overrides', () => {
  const valid = { [urlVariable]: testUrl, [optInVariable]: 'synthetic-only' };
  assert.deepEqual(configuration(valid), { host: '127.0.0.1', port: '55432' });
  assert.throws(() => configuration({ DATABASE_URL: testUrl }));
  assert.throws(() => configuration({ ...valid, DATABASE_URL: 'postgresql://production.invalid/live' }));
  assert.throws(() => configuration({ ...valid, [optInVariable]: '' }));
  assert.throws(() => configuration({ ...valid, [urlVariable]: '' }));
  for (const unsafe of [
    testUrl.replace('127.0.0.1', 'production.invalid'),
    testUrl.replace('127.0.0.1', 'localhost'),
    testUrl.replace('postgresql:', 'https:'),
    testUrl.replace(':55432', ''),
    testUrl.replace(':55432', ':443'),
    testUrl.replace('/booking_synthetic', '/postgres'),
    testUrl.replace('booking_synthetic:', 'postgres:'),
    testUrl.replace('booking-synthetic-only', 'real-password'),
    `${testUrl}?host=production.invalid`,
    `${testUrl}#ignored`,
  ]) assert.throws(() => configuration({ ...valid, [urlVariable]: unsafe }));
});

const configured = Object.hasOwn(process.env, urlVariable) || Object.hasOwn(process.env, optInVariable);
test('real PostgreSQL 16: isolated synthetic private-booking checks', {
  skip: configured ? false : `Not run: set ${urlVariable} and ${optInVariable} for a disposable loopback PostgreSQL 16 database`,
  timeout: 180_000,
}, async t => {
  const run = runner(configuration(process.env));
  // Validate the endpoint before any writes. A database containing application
  // tables is not a disposable fixture, even if someone reused the test name.
  const { rows: [identity] } = await run(envelope(`SELECT current_database() AS database, current_user AS role,
    current_setting('server_version_num')::integer AS version,
    (SELECT count(*)::integer FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog','information_schema')
      AND table_schema !~ '^booking_test_[a-f0-9]{24}$') AS foreign_tables`));
  assert.equal(identity.database, 'booking_synthetic');
  assert.equal(identity.role, 'booking_synthetic');
  assert.ok(identity.version >= 160000 && identity.version < 170000, 'This suite requires actual PostgreSQL 16');
  assert.equal(identity.foreign_tables, 0, 'Refusing a database containing non-test application tables');

  // Deferred imports let a clean checkout explicitly skip without installing app
  // dependencies. These checks never start the application or its database layer.
  const { defaults } = await import('../shared/booking.mjs');
  const { createPrivateBookingManager, emptyBookingOccupancy } = await import('../server/private-booking-state.mjs');
  const clock = Date.parse('2026-11-05T00:00:00.000Z');
  const instant = time => `2026-11-05T${time}:00.000Z`;
  const key = n => n.toString(16).padStart(32, '0');
  const coverage = { start: instant('08:00'), end: instant('18:00'), verifiedUntil: instant('23:00') };
  const request = (n, start = '09:00', expectedVersion = 1) => ({ expectedVersion, operationKey: key(n), serviceId: 'synthetic', date: '2026-11-05', start: instant(start) });
  const settings = () => ({ ...defaults(), timezone: 'UTC', services: [{ serviceId: 'synthetic', durationMinutes: 60, bufferMinutes: 15, enabled: true }], overrides: [{ date: '2026-11-05', closed: false, windows: [{ start: '08:00', end: '18:00' }] }] });
  const receiptOnly = ({ rebasedFromVersion, settings: ignored, ...receipt }) => receipt;
  const rejects = (promise, code) => assert.rejects(promise, { code });

  async function fixture(context) {
    const schema = `booking_test_${randomBytes(12).toString('hex')}`;
    assert.match(schema, /^booking_test_[a-f0-9]{24}$/);
    const prefix = `SET search_path TO "${schema}",pg_catalog;\n`;
    const seed = {
      bookingSchedule: settings(), bookingOccupancy: { ...emptyBookingOccupancy(), coverage },
      services: [{ id: 'synthetic', title: 'Synthetic fixture', published: true }],
      other: "Synthetic quote ' and slash \\ and newline\nРусский текст must survive",
    };
    await run(`CREATE SCHEMA "${schema}"; ${envelope('SELECT 1 AS created')}`);
    context.after(async () => {
      await run(`DROP SCHEMA "${schema}" CASCADE; ${envelope('SELECT 1 AS cleaned')}`);
    });
    await run(`${prefix}
      CREATE TABLE content(id TEXT PRIMARY KEY,body TEXT NOT NULL,version INTEGER NOT NULL);
      INSERT INTO content VALUES('main',${sqlText(JSON.stringify(seed))},1);
      ${envelope('SELECT 1 AS seeded')}`);
    const writePids = [], readPids = [];
    const raw = sql => run(prefix + sql);
    function mutation(sql, args) {
      assert.equal(sql, casSql, 'The test adapter only accepts the manager\'s known CAS statement');
      assert.equal(args.length, 3);
      assert.equal(args[1], 'main');
      assert.ok(Number.isSafeInteger(args[2]) && args[2] > 0);
      return `WITH changed AS (UPDATE content SET body=${sqlText(args[0])},version=version+1 WHERE id='main' AND version=${args[2]} RETURNING version) ${envelope('SELECT version FROM changed')}`;
    }
    async function query(sql, args) {
      const result = await raw(mutation(sql, args));
      writePids.push(result.backendPid);
      return result.rows;
    }
    let gate;
    async function readContent() {
      const result = await raw(envelope("SELECT body,version FROM content WHERE id='main'"));
      readPids.push(result.backendPid);
      const [row] = result.rows;
      assert.ok(row);
      const snapshot = { data: JSON.parse(row.body), version: Number(row.version) };
      if (gate) {
        const current = gate;
        current.versions.push(snapshot.version);
        if (current.versions.length === 2) { gate = undefined; clearTimeout(current.timer); current.release(); }
        await current.promise;
      }
      return snapshot;
    }
    const manager = overrides => createPrivateBookingManager({ readContent, query, now: () => clock, ...overrides });
    return {
      managers: [manager(), manager()], manager, readContent, query, raw, mutation, writePids, readPids, seed,
      raceReads() {
        assert.equal(gate, undefined);
        let release, reject;
        const promise = new Promise((yes, no) => { release = yes; reject = no; });
        const current = { promise, release, versions: [], timer: setTimeout(() => reject(new Error('Both independent readers did not reach the race barrier')), 10_000) };
        gate = current;
        context.after(() => clearTimeout(current.timer));
        return current.versions;
      },
    };
  }

  function assertOneWinner(results) {
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'STALE_VERSION');
  }

  await t.test('overlapping different-start reservations race on independent PostgreSQL backends', async context => {
    const f = await fixture(context), versions = f.raceReads();
    const attempts = [request(1), request(2, '09:30')];
    const results = await Promise.allSettled(f.managers.map((manager, i) => manager.reserve(attempts[i])));
    assert.deepEqual(versions, [1, 1]);
    assertOneWinner(results);
    assert.equal(new Set(f.readPids.slice(0, 2)).size, 2);
    assert.equal(new Set(f.writePids).size, 2, 'Both independent PostgreSQL backends attempted the CAS');
    const snap = await f.managers[0].snapshot();
    assert.equal(snap.version, 2);
    assert.equal(snap.occupancy.records.length, 1);
    const loser = attempts[results.findIndex(result => result.status === 'rejected')];
    await rejects(f.managers[1].reserve({ ...loser, expectedVersion: snap.version }), 'WINDOW_BUSY');
    assert.equal((await f.readContent()).data.other, f.seed.other);
  });

  await t.test('nonoverlapping concurrent reservations require a fresh version before retry', async context => {
    const f = await fixture(context);
    f.raceReads();
    const attempts = [request(1), request(2, '12:00')];
    const results = await Promise.allSettled(f.managers.map((manager, i) => manager.reserve(attempts[i])));
    assertOneWinner(results);
    const loser = attempts[results.findIndex(result => result.status === 'rejected')];
    await rejects(f.managers[1].reserve(loser), 'STALE_VERSION');
    const snapshot = await f.managers[1].snapshot();
    const retried = await f.managers[1].reserve({ ...loser, expectedVersion: snapshot.version });
    assert.equal(retried.version, 3);
    assert.equal(retried.rebasedFromVersion, 2);
    assert.equal((await f.managers[0].snapshot()).occupancy.records.length, 2);
  });

  await t.test('same-key concurrent requests commit once and changed payloads conflict', async context => {
    const f = await fixture(context);
    f.raceReads();
    const [a, b] = await Promise.all(f.managers.map(manager => manager.reserve(request(1))));
    assert.deepEqual(receiptOnly(a), receiptOnly(b));
    assert.equal(a.version, 2);
    assert.equal([a, b].filter(result => Object.hasOwn(result, 'rebasedFromVersion')).length, 1);
    assert.deepEqual(await f.manager().reserve(request(1)), receiptOnly(a));
    await rejects(f.manager().reserve(request(1, '12:00', 2)), 'IDEMPOTENCY_CONFLICT');
    const snapshot = await f.manager().snapshot();
    assert.equal(snapshot.version, 2);
    assert.equal(snapshot.occupancy.records.length, 1);
  });

  await t.test('settings and reservations share the content CAS without losing either writer', async context => {
    const f = await fixture(context);
    f.raceReads();
    const closeDay = async () => {
      const s = await f.readContent();
      s.data.bookingSchedule.overrides = [{ date: '2026-11-05', closed: true, windows: [] }];
      const rows = await f.query(casSql, [JSON.stringify(s.data), 'main', s.version]);
      if (!rows.length) throw Object.assign(new Error('STALE_VERSION'), { code: 'STALE_VERSION' });
      return rows;
    };
    const results = await Promise.allSettled([f.managers[0].reserve(request(1)), closeDay()]);
    assertOneWinner(results);
    const s = await f.readContent();
    assert.equal(s.version, 2);
    assert.equal(s.data.other, f.seed.other);
    assert.equal(s.data.bookingOccupancy.records.length + Number(s.data.bookingSchedule.overrides[0].closed), 1);
    if (results[0].status === 'fulfilled') {
      assert.deepEqual(results[0].value.settings, settings());
      await closeDay();
      const latest = await f.readContent();
      assert.equal(latest.version, 3);
      assert.equal(latest.data.bookingSchedule.overrides[0].closed, true);
      assert.equal(latest.data.bookingOccupancy.records.length, 1);
      const replay = await f.manager().reserve(request(1));
      assert.equal(replay.version, 3);
      assert.equal(Object.hasOwn(replay, 'rebasedFromVersion'), false);
    } else {
      await rejects(f.manager().reserve(request(1, '09:00', s.version)), 'WINDOW_UNAVAILABLE');
      assert.equal((await f.readContent()).version, 2);
    }
  });

  await t.test('cancellation releases buffered occupancy without reviving cancelled idempotent requests', async context => {
    const f = await fixture(context), m = f.managers[0];
    const booked = await m.reserve(request(1));
    await rejects(m.cancel({ expectedVersion: 1, id: booked.records[0].id }), 'STALE_VERSION');
    await rejects(m.reserve(request(2, '10:00', 2)), 'WINDOW_BUSY');
    const available = await f.managers[1].available({ serviceId: 'synthetic', date: '2026-11-05' });
    assert.equal(available.ready, true);
    assert.ok(!available.slots.some(slot => slot.start === instant('10:00')));
    assert.ok(available.slots.some(slot => slot.start === instant('10:15')));
    const cancelled = await f.managers[1].cancel({ expectedVersion: 2, id: booked.records[0].id });
    assert.equal(cancelled.version, 3);
    assert.equal(cancelled.records[0].status, 'cancelled');
    assert.deepEqual(await m.cancel({ expectedVersion: 3, id: booked.records[0].id }), receiptOnly(cancelled));
    assert.equal((await m.reserve(request(1))).records[0].status, 'cancelled');
    assert.equal((await f.readContent()).version, 3);
    assert.equal((await m.reserve(request(2, '10:00', 3))).version, 4);
    assert.equal((await m.snapshot()).occupancy.records.filter(record => record.status === 'active').length, 1);
  });

  await t.test('a real PostgreSQL statement failure returns storage unavailable without a write', async context => {
    const f = await fixture(context);
    const failing = f.manager({ query: () => f.raw(envelope('SELECT 1/0 AS failure')) });
    await rejects(failing.reserve(request(1)), 'STORAGE_UNAVAILABLE');
    assert.equal((await f.readContent()).version, 1);
    assert.equal((await f.manager().snapshot()).occupancy.records.length, 0);
  });

  await t.test('lost acknowledgement after real PostgreSQL commit is recovered read-only by the same key', async context => {
    const f = await fixture(context);
    const uncertain = f.manager({ query: async (sql, args) => {
      await f.query(sql, args);
      throw new Error('Simulated lost response after acknowledged database commit');
    } });
    await rejects(uncertain.reserve(request(1)), 'STORAGE_UNAVAILABLE');
    assert.equal((await f.readContent()).version, 2);
    const restarted = f.manager({ query: async () => assert.fail('Idempotent recovery must not write') });
    const recovered = await restarted.reserve(request(1));
    assert.equal(recovered.version, 2);
    assert.equal(recovered.records.length, 1);
    assert.equal(Object.hasOwn(recovered, 'rebasedFromVersion'), false);
    assert.equal((await restarted.snapshot()).occupancy.records.length, 1);
  });

  await t.test('an uncommitted PostgreSQL attempt can retry the same operation after refresh', async context => {
    const f = await fixture(context);
    const rolledBack = f.manager({ query: async (sql, args) => {
      await f.raw(`BEGIN; ${f.mutation(sql, args)} ROLLBACK;`);
      throw new Error('Simulated lost response from an aborted transaction');
    } });
    await rejects(rolledBack.reserve(request(1)), 'STORAGE_UNAVAILABLE');
    const fresh = await f.manager().snapshot();
    assert.equal(fresh.version, 1);
    assert.equal(fresh.occupancy.records.length, 0);
    const retried = await f.manager().reserve(request(1, '09:00', fresh.version));
    assert.equal(retried.version, 2);
    assert.equal((await f.manager().snapshot()).occupancy.records.length, 1);
  });
});

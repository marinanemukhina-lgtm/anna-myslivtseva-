import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAnonymousBookingStore } from '../server/anonymous-booking-store.mjs';

const hex = n => n.toString(16).padStart(32, '0');
const win = (n, start, end, beforeMs = 0, afterMs = 0) => ({ windowId: hex(n), start, end, beforeMs, afterMs });
const request = (n, key, expectedRevision = 1) => ({ windowId: hex(n), idempotencyKey: hex(key), expectedRevision });
const rejectsCode = (promise, code) => assert.rejects(promise, { code });
async function fixture(t, ws = [win(1, 1000, 2000), win(2, 1500, 2500), win(3, 2000, 3000)]) {
  const dir = await mkdtemp(path.join(tmpdir(), 'anonymous-booking-test-'));
  const file = path.join(dir, 'synthetic.sqlite');
  const connections = [new DatabaseSync(file), new DatabaseSync(file)];
  for (const db of connections) db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  t.after(async () => { connections.forEach(db => db.close()); await rm(dir, { recursive: true, force: true }); });
  let barrier;
  const queries = connections.map(db => async (sql, params = []) => {
    const stmt = db.prepare(sql.replace(/\$\d+/g, '?'));
    const result = stmt.columns().length ? stmt.all(...params) : stmt.run(...params);
    if (barrier && sql.startsWith('SELECT')) {
      const b = barrier;
      b.arrivals++;
      if (b.arrivals === 2) { barrier = undefined; b.release(); }
      await b.promise;
    }
    return result;
  });
  const stores = queries.map(query => createAnonymousBookingStore({ query, now: () => 100 }));
  await stores[0].initialize({ windows: ws });
  return { stores, queries, connections, race() {
    let release; const promise = new Promise(r => { release = r; });
    barrier = { promise, release, arrivals: 0 };
  } };
}

test('two independent SQLite connections: equal starts and partial overlap allow exactly one winner', async t => {
  for (const second of [win(2, 1000, 2000), win(2, 1500, 2500)]) {
    const f = await fixture(t, [win(1, 1000, 2000), second]);
    f.race();
    const results = await Promise.allSettled([f.stores[0].reserve(request(1, 10)), f.stores[1].reserve(request(2, 20))]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'STALE_REVISION');
    const snap = await f.stores[0].snapshot();
    assert.equal(snap.revision, 2); assert.equal(snap.data.reservations.length, 1);
    const loserWindow = snap.data.reservations[0].windowId === hex(1) ? 2 : 1;
    await rejectsCode(f.stores[0].reserve(request(loserWindow, 30, 2)), 'WINDOW_BUSY');
  }
});

test('buffers conflict even when appointment times do not; half-open touching boundaries fit', async t => {
  const f = await fixture(t, [win(1, 1000, 2000, 0, 100), win(2, 2100, 2500, 1), win(3, 2100, 2500)]);
  await f.stores[0].reserve(request(1, 10));
  await rejectsCode(f.stores[1].reserve(request(2, 20, 2)), 'WINDOW_BUSY');
  await f.stores[1].reserve(request(3, 30, 2));
  assert.equal((await f.stores[0].snapshot()).data.reservations.length, 2);
});

test('simultaneous identical idempotency keys and later retries return one persisted reservation', async t => {
  const f = await fixture(t); f.race();
  const [a,b] = await Promise.all(f.stores.map(s => s.reserve(request(1, 10))));
  assert.deepEqual(a, b);
  assert.deepEqual(await f.stores[0].reserve(request(1, 10)), a);
  await rejectsCode(f.stores[0].reserve(request(2, 10, 2)), 'IDEMPOTENCY_CONFLICT');
  assert.equal((await f.stores[0].snapshot()).data.reservations.length, 1);
});

test('settings and bookings share one CAS guard; loser must refresh and never overwrites winner', async t => {
  const f = await fixture(t); f.race();
  const results = await Promise.allSettled([
    f.stores[0].reserve(request(1, 10)),
    f.stores[1].replaceWindows({ expectedRevision: 1, windows: [] }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'STALE_REVISION');
  const snap = await f.stores[0].snapshot();
  assert.equal(snap.revision, 2);
  assert.equal(snap.data.reservations.length + Number(snap.data.windows.length === 0), 1);
  await rejectsCode(f.stores[0].reserve(request(3, 30)), 'STALE_REVISION');
  await rejectsCode(f.stores[0].replaceWindows({ expectedRevision: 1, windows: [] }), 'STALE_REVISION');
});

test('settings replacement preserves busy reservations and reopen survives durable reads', async t => {
  const f = await fixture(t);
  const booked = await f.stores[0].reserve(request(1, 10));
  await f.stores[1].replaceWindows({ expectedRevision: 2, windows: [win(2, 1100, 1200)] });
  const reopened = createAnonymousBookingStore({ query: f.queries[1], now: () => 100 });
  assert.equal((await reopened.snapshot()).data.reservations[0].reservationId, booked.reservationId);
  await rejectsCode(reopened.reserve(request(2, 20, 3)), 'WINDOW_BUSY');
  await rejectsCode(reopened.initialize({ windows: [] }), 'ALREADY_INITIALIZED');
});

test('strict schema, invalid times, expired windows and unavailable window all fail closed', async t => {
  const f = await fixture(t, [win(1, 50, 90)]);
  await rejectsCode(f.stores[0].reserve({ ...request(1, 10), name: 'not accepted' }), 'INVALID_INPUT');
  await rejectsCode(f.stores[0].reserve({ ...request(1, 10), idempotencyKey: 'arbitrary user text' }), 'INVALID_INPUT');
  await rejectsCode(f.stores[0].reserve(request(1, 10)), 'WINDOW_EXPIRED');
  await rejectsCode(f.stores[0].reserve(request(2, 20)), 'WINDOW_UNAVAILABLE');
  for (const w of [win(2, 100, 100), win(2, 100, 200, -1), { ...win(2, 100, 200), metadata: {} }, win(2, NaN, 200)]) {
    await rejectsCode(f.stores[0].replaceWindows({ expectedRevision: 1, windows: [w] }), 'INVALID_INPUT');
  }
  assert.equal((await f.stores[0].snapshot()).revision, 1);
});

test('storage errors and ambiguous committed writes never report success; identical retry recovers', async t => {
  const f = await fixture(t);
  const offline = createAnonymousBookingStore({ query: async () => { throw Error('offline'); } });
  await rejectsCode(offline.reserve(request(1, 10)), 'STORAGE_UNAVAILABLE');
  const noWrite = createAnonymousBookingStore({ query: async (sql,args) => {
    if (sql.startsWith('UPDATE')) throw Error('failed write');
    return f.queries[0](sql,args);
  }, now: () => 100 });
  await rejectsCode(noWrite.reserve(request(1, 10)), 'STORAGE_UNAVAILABLE');
  assert.equal((await f.stores[0].snapshot()).revision, 1);
  const ambiguous = createAnonymousBookingStore({ query: async (sql,args) => {
    const result = await f.queries[0](sql,args);
    if (sql.startsWith('UPDATE')) throw Error('connection lost after commit');
    return result;
  }, now: () => 100 });
  await rejectsCode(ambiguous.reserve(request(1, 10)), 'STORAGE_UNAVAILABLE');
  const recovered = await f.stores[0].reserve(request(1, 10));
  assert.equal(recovered.revision, 2);
  assert.equal((await f.stores[0].snapshot()).data.reservations.length, 1);
});

test('corrupt stored state is rejected without writes', async t => {
  const f = await fixture(t);
  f.connections[0].prepare('UPDATE anonymous_booking_state SET body=?').run('{"windows":[],"reservations":[],"phone":"forbidden"}');
  await rejectsCode(f.stores[0].reserve(request(1, 10)), 'STORAGE_INVALID');
});

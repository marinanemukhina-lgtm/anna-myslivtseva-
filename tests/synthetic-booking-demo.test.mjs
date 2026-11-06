import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createSyntheticBookingDemo, createSyntheticMemoryStore, syntheticFixture, DEMO_NOW, DEMO_DATE, HOLD_MS } from '../server/synthetic-booking-demo.mjs';
import { createSyntheticBookingApp } from '../server/synthetic-booking-http.mjs';
import { createPrivateBookingManager } from '../server/private-booking-state.mjs';

const key = () => randomBytes(24).toString('hex');
const start = '2026-11-07T06:00:00.000Z';
const request = (overrides = {}) => ({ expectedVersion: 1, operationKey: key(), persona: 'Демо-клиент 001', serviceId: 'demo-60', date: DEMO_DATE, start, ...overrides });
const error = (promise, code) => assert.rejects(promise, { code });
function fixture(mode = 'fresh') {
  let clock = DEMO_NOW;
  const store = createSyntheticMemoryStore(syntheticFixture(mode));
  const demo = createSyntheticBookingDemo({ store, now: () => clock });
  const session = demo.session();
  return { store, demo, session, advance: n => { clock += n; }, async edit(fn) {
    const state = await store.read(); fn(state.data); return store.compareAndSwap(state.version, state.data);
  } };
}
const availability = f => f.demo.available(f.session, { serviceId: 'demo-60', date: DEMO_DATE });
const statusInput = r => ({ id: r.id, expectedVersion: r.version });

test('P5-01 PR5 exact unique-index rule permits different-start overlapping inserts', () => {
  // Isolated in-memory reproduction of PR5 schema at 0b0a904, not the PR5 HTTP app.
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE clinical_demo_requests (id TEXT PRIMARY KEY, persona TEXT NOT NULL, service_id TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, status TEXT NOT NULL, created_at BIGINT NOT NULL)");
    db.exec("CREATE UNIQUE INDEX clinical_demo_request_start ON clinical_demo_requests(starts_at) WHERE status <> 'cancelled'");
    const insert = db.prepare('INSERT INTO clinical_demo_requests VALUES (?,?,?,?,?,?,?)');
    insert.run('synthetic-1', 'Демо-клиент 001', 'demo', start, '2026-11-07T07:00:00.000Z', 'pending', DEMO_NOW);
    insert.run('synthetic-2', 'Демо-клиент 002', 'demo', '2026-11-07T06:30:00.000Z', '2026-11-07T07:30:00.000Z', 'pending', DEMO_NOW);
    assert.equal(db.prepare('SELECT count(*) AS n FROM clinical_demo_requests').get().n, 2);
  } finally { db.close(); }
});

test('P5-02 PR5 unrestricted status UPDATE can reconfirm a cancelled request', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE clinical_demo_requests (id TEXT PRIMARY KEY, status TEXT NOT NULL)');
    db.prepare('INSERT INTO clinical_demo_requests VALUES (?,?)').run('synthetic-1', 'cancelled');
    const row = db.prepare('UPDATE clinical_demo_requests SET status=? WHERE id=? RETURNING id,status').get('confirmed', 'synthetic-1');
    assert.equal(row.status, 'confirmed');
  } finally { db.close(); }
});

test('B01 service → fresh availability → reserve → confirm → cancel → free again', async () => {
  const f = fixture();
  assert.equal((await f.demo.config(f.session)).services.length, 2);
  const a = await availability(f); assert.equal(a.ready, true); assert.ok(a.slots.some(s => s.start === start));
  const r = await f.demo.reserve(f.session, request({ expectedVersion: a.version })); assert.equal(r.status, 'pending');
  assert.ok(!(await availability(f)).slots.some(s => s.start === start));
  const c = await f.demo.confirm(f.session, statusInput(r)); assert.equal(c.status, 'confirmed');
  const cancelled = await f.demo.cancel(f.session, statusInput(c)); assert.equal(cancelled.status, 'cancelled');
  assert.ok((await availability(f)).slots.some(s => s.start === start));
  assert.equal((await f.store.read()).data.demoRequests.length, 1);
});

test('B02 parallel different-start overlapping reservations have exactly one winner', async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.demo.reserve(f.session, request()), f.demo.reserve(f.demo.session(), request({ start: '2026-11-07T06:30:00.000Z' }))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'STALE_VERSION');
  assert.equal((await f.store.read()).data.bookingOccupancy.records.length, 1);
  await error(f.demo.reserve(f.session, request({ expectedVersion: 2, start: '2026-11-07T06:30:00.000Z' })), 'WINDOW_BUSY');
});

test('B03 parallel identical retries share receipt and produce one reservation', async () => {
  const f = fixture(), p = request();
  const rs = await Promise.all(Array.from({ length: 12 }, () => f.demo.reserve(f.session, p)));
  assert.equal(new Set(rs.map(r => r.id)).size, 1);
  assert.equal((await f.store.read()).data.demoRequests.length, 1);
  await error(f.demo.reserve(f.session, { ...p, persona: 'Демо-клиент 002' }), 'IDEMPOTENCY_CONFLICT');
  await error(f.demo.reserve(f.session, { ...p, date: '2026-11-08' }), 'IDEMPOTENCY_CONFLICT');
});

test('B04 confirm/cancel repeats are idempotent; cancellation cannot be resurrected', async () => {
  const f = fixture(), p = request(), r = await f.demo.reserve(f.session, p);
  const c = await f.demo.confirm(f.session, statusInput(r));
  assert.equal((await f.demo.confirm(f.session, statusInput(r))).version, c.version);
  const x = await f.demo.cancel(f.session, statusInput(c));
  assert.equal((await f.demo.cancel(f.session, statusInput(c))).version, x.version);
  assert.equal((await f.demo.reserve(f.session, p)).status, 'cancelled');
  await error(f.demo.confirm(f.session, statusInput(x)), 'TERMINAL_REQUEST');
});

for (const mode of ['stale', 'incomplete']) test(`B05 ${mode} source suppresses slots and rejects reservation`, async () => {
  const f = fixture(mode), a = await availability(f);
  assert.equal(a.ready, false); assert.deepEqual(a.slots, []);
  await error(f.demo.reserve(f.session, request()), 'SOURCE_NOT_VERIFIED');
  assert.equal((await f.store.read()).data.demoRequests.length, 0);
});

test('B06 confirmation revalidates freshness; cancellation remains possible with stale source', async () => {
  const f = fixture();
  await f.edit(d => { d.bookingOccupancy.coverage.verifiedUntil = new Date(DEMO_NOW + 1000).toISOString(); });
  const r = await f.demo.reserve(f.session, request({ expectedVersion: 2 }));
  f.advance(1000);
  await error(f.demo.confirm(f.session, statusInput(r)), 'SOURCE_NOT_VERIFIED');
  assert.equal((await f.demo.cancel(f.session, statusInput(r))).status, 'cancelled');
});

test('B07 hold expiry boundary releases time, rejects late confirmation and old-key resurrection', async () => {
  const f = fixture(), p = request(), r = await f.demo.reserve(f.session, p);
  f.advance(HOLD_MS - 1); assert.equal((await f.demo.requests(f.session)).requests[0].status, 'pending');
  f.advance(1); await error(f.demo.confirm(f.session, statusInput(r)), 'TERMINAL_REQUEST');
  assert.equal((await f.demo.reserve(f.session, p)).status, 'expired');
  assert.ok((await availability(f)).slots.some(s => s.start === start));
});

test('B08 confirmed appointment outlives temporary hold', async () => {
  const f = fixture(), r = await f.demo.reserve(f.session, request());
  await f.demo.confirm(f.session, statusInput(r)); f.advance(HOLD_MS);
  assert.equal((await f.demo.requests(f.session)).requests[0].status, 'confirmed');
  assert.ok(!(await availability(f)).slots.some(s => s.start === start));
});

test('B09 session cannot list, confirm, cancel or replay another session reservation', async () => {
  const f = fixture(), p = request(), r = await f.demo.reserve(f.session, p), stranger = f.demo.session();
  assert.deepEqual((await f.demo.requests(stranger)).requests, []);
  await error(f.demo.confirm(stranger, statusInput(r)), 'RECORD_NOT_FOUND');
  await error(f.demo.cancel(stranger, statusInput(r)), 'RECORD_NOT_FOUND');
  await error(f.demo.reserve(stranger, p), 'IDEMPOTENCY_CONFLICT');
  await error(f.demo.config('forged'), 'UNAUTHORIZED');
});

test('B10 buffers and verified coverage boundaries include entire occupied interval', async () => {
  const f = fixture(); await f.demo.reserve(f.session, request());
  await error(f.demo.reserve(f.session, request({ expectedVersion: 2, start: '2026-11-07T07:00:00.000Z' })), 'WINDOW_BUSY');
  assert.equal((await f.demo.reserve(f.session, request({ expectedVersion: 2, start: '2026-11-07T07:15:00.000Z' }))).status, 'pending');
  const g = fixture(); await g.edit(d => { d.bookingOccupancy.coverage.end = '2026-11-07T07:00:00.000Z'; });
  assert.deepEqual((await availability(g)).slots, []);
  await error(g.demo.reserve(g.session, request({ expectedVersion: 2 })), 'OUTSIDE_VERIFIED_COVERAGE');
});

test('B11 schedule change after listing rejects old version and disabled service', async () => {
  const f = fixture(); await availability(f);
  await f.edit(d => { d.bookingSchedule.services[0].enabled = false; });
  await error(f.demo.reserve(f.session, request()), 'STALE_VERSION');
  await error(f.demo.reserve(f.session, request({ expectedVersion: 2 })), 'SERVICE_UNAVAILABLE');
});

test('B12 changed duration/buffer before confirmation is rejected after refresh too', async () => {
  for (const field of ['durationMinutes', 'bufferMinutes']) {
    const f = fixture(), r = await f.demo.reserve(f.session, request());
    const v = await f.edit(d => { d.bookingSchedule.services[0][field] += 15; });
    await error(f.demo.confirm(f.session, statusInput(r)), 'STALE_VERSION');
    await error(f.demo.confirm(f.session, { id: r.id, expectedVersion: v }), 'SCHEDULE_CHANGED');
    assert.equal((await f.demo.requests(f.session)).requests[0].status, 'pending');
  }
});

test('B13 lost committed response recovers with identical operation without duplication', async () => {
  const base = createSyntheticMemoryStore(); let lose = true;
  const store = { read: base.read, async compareAndSwap(v, data) {
    const result = await base.compareAndSwap(v, data);
    if (lose && result) { lose = false; throw Object.assign(Error('uncertain'), { code: 'STORAGE_UNAVAILABLE' }); }
    return result;
  } };
  const demo = createSyntheticBookingDemo({ store, now: () => DEMO_NOW }), session = demo.session(), p = request();
  await error(demo.reserve(session, p), 'STORAGE_UNAVAILABLE');
  assert.equal((await demo.reserve(session, p)).status, 'pending');
  assert.equal((await base.read()).data.demoRequests.length, 1);
});

test('B14 simultaneous confirmation and cancellation cannot lose the terminal state', async () => {
  const f = fixture(), r = await f.demo.reserve(f.session, request());
  const results = await Promise.allSettled([f.demo.confirm(f.session, statusInput(r)), f.demo.cancel(f.session, statusInput(r))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const current = (await f.demo.requests(f.session)).requests[0];
  if (current.status === 'confirmed') await f.demo.cancel(f.session, statusInput(current));
  assert.equal((await f.demo.requests(f.session)).requests[0].status, 'cancelled');
});

test('B15 unknown fields and non-synthetic identity are rejected before any write', async () => {
  const f = fixture();
  for (const p of [request({ persona: 'Произвольное имя' }), request({ phone: 'synthetic-forbidden-field' }), request({ note: 'synthetic note' }), request({ serviceId: 'unknown' })]) await error(f.demo.reserve(f.session, p), 'INVALID_INPUT');
  assert.equal((await f.store.read()).version, 1);
});

test('B16 external busy update racing with reservation uses the same PR10 CAS boundary', async () => {
  const f = fixture();
  const manager = createPrivateBookingManager({ now: () => DEMO_NOW, readContent: f.store.read,
    query: async (_sql, [body, _id, v]) => { const next = await f.store.compareAndSwap(v, JSON.parse(body)); return next ? [{ version: next }] : []; } });
  const results = await Promise.allSettled([f.demo.reserve(f.session, request()), manager.addBusy({ expectedVersion: 1, operationKey: key(), intervals: [{ start, end: '2026-11-07T07:00:00.000Z' }] })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await f.store.read()).data.bookingOccupancy.records.length, 1);
});

test('B17 source validity expires exactly at 24h; extending verification beyond 24h fails', async () => {
  const f = fixture(); f.advance(86400000 - 1);
  assert.equal((await availability(f)).ready, true);
  f.advance(1); assert.equal((await availability(f)).ready, false);
  const g = fixture();
  const manager = createPrivateBookingManager({ now: () => DEMO_NOW, readContent: g.store.read, query: async () => { throw Error('must not write'); } });
  await error(manager.setCoverage({ expectedVersion: 1, start, end: '2026-11-07T14:00:00.000Z', verifiedUntil: new Date(DEMO_NOW + 86400001).toISOString() }), 'INVALID_VERIFICATION_EXPIRY');
});

test('B18 two services share one capacity; non-overlapping stale request requires refresh', async () => {
  const f = fixture(); await f.demo.reserve(f.session, request());
  await error(f.demo.reserve(f.session, request({ expectedVersion: 2, serviceId: 'demo-30', start: '2026-11-07T06:30:00.000Z' })), 'WINDOW_BUSY');
  const p = request({ start: '2026-11-07T09:00:00.000Z' });
  await error(f.demo.reserve(f.session, p), 'STALE_VERSION');
  const v = (await availability(f)).version;
  assert.equal((await f.demo.reserve(f.session, { ...p, expectedVersion: v })).status, 'pending');
});

test('B19 storage failure cannot become successful reservation or empty free schedule', async () => {
  const demo = createSyntheticBookingDemo({ store: { read: async () => { throw Object.assign(Error('synthetic outage'), { code: 'STORAGE_UNAVAILABLE' }); } }, now: () => DEMO_NOW });
  const session = demo.session();
  await error(demo.reserve(session, request()), 'STORAGE_UNAVAILABLE');
  await error(demo.available(session, { serviceId: 'demo-60', date: DEMO_DATE }), 'STORAGE_UNAVAILABLE');
});

test('B20 hold expiring during confirmation is not confirmed', async () => {
  const store = createSyntheticMemoryStore(); let reads = 0;
  const demo = createSyntheticBookingDemo({ store, now: () => ++reads >= 4 ? DEMO_NOW + HOLD_MS : DEMO_NOW });
  const session = demo.session(), r = await demo.reserve(session, request());
  await error(demo.confirm(session, statusInput(r)), 'HOLD_EXPIRED');
  assert.equal((await store.read()).data.demoRequests[0].status, 'pending');
  assert.equal((await demo.requests(session)).requests[0].status, 'expired');
});

async function httpFixture(t, enabled = true) {
  const server = createServer(createSyntheticBookingApp({ enabled, now: () => DEMO_NOW }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (path, body, session, headers = {}) => {
    const res = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { 'X-Demo-Session': session } : {}), ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}

test('H01 real public intake stays 503 even malformed JSON, config false and no clinical endpoints', async t => {
  const call = await httpFixture(t);
  assert.equal((await call('/api/booking/appointments', '{')).status, 503);
  const config = (await call('/api/booking/config')).data; assert.equal(config.ready, false); assert.equal(config.enabled, false);
  assert.deepEqual((await call('/api/booking/availability')).data.slots, []);
  assert.equal((await call('/api/admin/clinical/clients')).status, 404);
  assert.equal((await call('/api/demo/clinical/config')).status, 401);
});

test('H02 HTTP journey, repeated submission, authorization, origin and strict inputs', async t => {
  const call = await httpFixture(t), root = '/api/demo/booking';
  assert.equal((await call(root + '/config')).status, 401);
  const s = (await call(root + '/session', { mode: 'fresh' })).data.session;
  const p = request();
  const r = await call(root + '/reserve', p, s); assert.equal(r.status, 200);
  assert.equal((await call(root + '/reserve', p, s)).data.id, r.data.id);
  assert.equal((await call(root + '/confirm', statusInput(r.data), s, { Origin: 'https://example.invalid' })).status, 403);
  const c = await call(root + '/confirm', statusInput(r.data), s); assert.equal(c.data.status, 'confirmed');
  assert.equal((await call(root + '/cancel', statusInput(c.data), s)).data.status, 'cancelled');
  assert.equal((await call(root + '/reserve', request({ email: 'fiction@example.invalid' }), s)).status, 400);
});

test('H03 demo routes absent without explicit flag', async t => {
  const call = await httpFixture(t, false);
  assert.equal((await call('/api/demo/booking/session', { mode: 'fresh' })).status, 404);
  assert.equal((await call('/api/booking/appointments', {})).status, 503);
});

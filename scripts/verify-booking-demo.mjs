import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { createSyntheticBookingApp } from '../server/synthetic-booking-http.mjs';
import { DEMO_NOW } from '../server/synthetic-booking-demo.mjs';

// Reproducible real HTTP demonstration; stdout has no session capabilities.
const server = createServer(createSyntheticBookingApp({ enabled: true, now: () => DEMO_NOW }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let session;
async function call(path, body) {
  const res = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(session ? { 'X-Demo-Session': session } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { http: res.status, body: await res.json() };
}
const evidence = { schema: 'anna-booking-demo-evidence-v1', executedAt: new Date().toISOString(),
  transport: 'real HTTP, loopback', storage: 'synthetic in-memory CAS only', steps: [] };
try {
  session = (await call('/api/demo/booking/session', { mode: 'fresh' })).body.session;
  const config = await call('/api/demo/booking/config');
  evidence.steps.push({ action: 'Выбор услуги', http: config.http, service: config.body.services[0].title });
  const a = await call(`/api/demo/booking/availability?serviceId=demo-60&date=${config.body.date}`);
  assert.equal(a.body.ready, true); assert.ok(a.body.slots.length);
  evidence.steps.push({ action: 'Актуальные интервалы', http: a.http, ready: a.body.ready, slots: a.body.slots.length, observedAt: a.body.observedAt, validUntil: a.body.validUntil });
  const p = { expectedVersion: a.body.version, operationKey: randomBytes(24).toString('hex'), persona: config.body.personas[0], serviceId: 'demo-60', date: config.body.date, start: a.body.slots[0].start };
  const r = await call('/api/demo/booking/reserve', p); assert.equal(r.body.status, 'pending');
  evidence.steps.push({ action: 'Резерв', http: r.http, status: r.body.status, start: r.body.start });
  const repeat = await call('/api/demo/booking/reserve', p); assert.equal(repeat.body.id, r.body.id);
  evidence.steps.push({ action: 'Повтор того же запроса', http: repeat.http, sameReservation: true });
  const c = await call('/api/demo/booking/confirm', { id: r.body.id, expectedVersion: r.body.version }); assert.equal(c.body.status, 'confirmed');
  evidence.steps.push({ action: 'Подтверждение', http: c.http, status: c.body.status });
  const x = await call('/api/demo/booking/cancel', { id: c.body.id, expectedVersion: c.body.version }); assert.equal(x.body.status, 'cancelled');
  evidence.steps.push({ action: 'Отмена', http: x.http, status: x.body.status });
  const reopened = await call(`/api/demo/booking/availability?serviceId=demo-60&date=${config.body.date}`);
  assert.ok(reopened.body.slots.some(s => s.start === r.body.start));
  evidence.steps.push({ action: 'Освобождение интервала', http: reopened.http, slotRestored: true });
  for (const mode of ['stale', 'incomplete']) {
    session = (await call('/api/demo/booking/session', { mode })).body.session;
    const result = await call(`/api/demo/booking/availability?serviceId=demo-60&date=${config.body.date}`);
    assert.equal(result.body.ready, false); assert.deepEqual(result.body.slots, []);
    evidence.steps.push({ action: mode === 'stale' ? 'Устаревший источник' : 'Неполный источник', http: result.http, ready: result.body.ready, slots: result.body.slots.length, reason: result.body.reason });
  }
  const closed = await call('/api/booking/appointments', {}); assert.equal(closed.http, 503);
  const publicConfig = await call('/api/booking/config'); assert.equal(publicConfig.body.enabled, false); assert.equal(publicConfig.body.ready, false);
  evidence.steps.push({ action: 'Публичная запись', http: closed.http, enabled: publicConfig.body.enabled, ready: publicConfig.body.ready });
  console.log(JSON.stringify(evidence, null, 2));
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

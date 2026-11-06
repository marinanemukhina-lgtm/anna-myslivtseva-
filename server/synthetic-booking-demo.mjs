import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { defaults, dateSchema } from '../shared/booking.mjs';
import { createPrivateBookingManager, emptyBookingOccupancy } from './private-booking-state.mjs';

// Standalone synthetic experiment. Never imports db.mjs or registers production
// routes. The in-memory CAS models the PR10 aggregate, NOT durable SQL storage.
export const personas = ['Демо-клиент 001', 'Демо-клиент 002', 'Демо-клиент 003'];
export const DEMO_NOW = Date.parse('2026-11-06T06:00:00.000Z');
export const DEMO_DATE = '2026-11-07';
export const HOLD_MS = 5 * 60000; // Demonstration policy, not an owner-approved rule.
const token = z.string().regex(/^[a-f0-9]{48}$/);
const version = z.number().int().positive();
const reserveSchema = z.object({
  expectedVersion: version, operationKey: token, persona: z.enum(personas),
  serviceId: z.enum(['demo-60', 'demo-30']), date: dateSchema,
  start: z.string().datetime(),
}).strict();
const changeSchema = z.object({ id: token, expectedVersion: version }).strict();
const fail = code => { throw Object.assign(Error(code), { code }); };
const parse = (schema, input) => {
  const result = schema.safeParse(input);
  if (!result.success) fail('INVALID_INPUT');
  return result.data;
};
const iso = value => new Date(value).toISOString();

export function syntheticFixture(mode = 'fresh') {
  const services = [60, 30].map(n => ({ serviceId: `demo-${n}`, durationMinutes: n, bufferMinutes: 15, enabled: true }));
  return {
    version: 1,
    data: {
      services: services.map(s => ({ id: s.serviceId, title: `Тестовая услуга · ${s.durationMinutes} минут`, published: true })),
      bookingSchedule: { ...defaults(), timezone: 'Europe/Moscow', services,
        overrides: [{ date: DEMO_DATE, closed: false, windows: [{ start: '09:00', end: '17:00' }] }] },
      bookingOccupancy: { ...emptyBookingOccupancy(), coverage: mode === 'incomplete' ? null : {
        start: '2026-11-07T06:00:00.000Z', end: '2026-11-07T14:00:00.000Z',
        verifiedUntil: iso(mode === 'stale' ? DEMO_NOW : DEMO_NOW + 86400000),
      } },
      demoRequests: [],
    },
  };
}

// Exposed only for isolated test fixtures. There is no SQL, network, file, or
// existing database adapter. All writers share the same revision in this process.
export function createSyntheticMemoryStore(initial = syntheticFixture()) {
  let state = structuredClone(initial);
  return {
    async read() { return structuredClone(state); },
    async compareAndSwap(expected, data) {
      if (state.version !== expected) return null;
      state = { version: expected + 1, data: structuredClone(data) };
      return state.version;
    },
  };
}

export function createSyntheticBookingDemo({ store = createSyntheticMemoryStore(), now = Date.now } = {}) {
  const sessions = new Set();
  function authorize(session) { if (!sessions.has(session)) fail('UNAUTHORIZED'); }
  const receipt = (r, v) => ({ id: r.id, status: r.status, persona: r.persona, serviceId: r.serviceId,
    start: r.start, end: r.end, holdUntil: r.holdUntil, version: v, syntheticOnly: true });
  async function transaction(action) {
    const original = await store.read(), draft = structuredClone(original);
    const manager = createPrivateBookingManager({ now, readContent: async () => structuredClone(draft),
      query: async (_sql, [body, id, expected]) => {
        if (id !== 'main' || expected !== draft.version) return [];
        draft.data = JSON.parse(body);
        return [{ version: ++draft.version }];
      },
    });
    const result = await action(draft, manager);
    if (JSON.stringify(draft.data) !== JSON.stringify(original.data)) {
      const committed = await store.compareAndSwap(original.version, draft.data);
      if (committed === null) fail('STALE_VERSION');
      result.version = committed;
    } else result.version = original.version;
    return result;
  }
  async function expire() {
    // Retry bounded housekeeping only; user mutations never silently rebase.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await transaction(async draft => {
          for (const r of draft.data.demoRequests) if (r.status === 'pending' && now() >= Date.parse(r.holdUntil)) {
            r.status = 'expired';
            draft.data.bookingOccupancy.records.find(x => x.id === r.id).status = 'cancelled';
          }
          return {};
        });
        return;
      } catch (error) { if (error.code !== 'STALE_VERSION' || attempt === 3) throw error; }
    }
  }
  function owned(draft, session, id) {
    const r = draft.data.demoRequests.find(x => x.id === id && x.session === session);
    if (!r) fail('RECORD_NOT_FOUND');
    return r;
  }
  return {
    session() { const session = randomBytes(24).toString('hex'); sessions.add(session); return session; },
    async config(session) {
      authorize(session);
      const s = await store.read();
      return { syntheticOnly: true, publicBookingEnabled: false, date: DEMO_DATE, personas,
        timezone: s.data.bookingSchedule.timezone, services: s.data.services, holdMinutes: HOLD_MS / 60000 };
    },
    async available(session, input) {
      authorize(session); await expire();
      return transaction(async (_s, manager) => manager.available(input));
    },
    async reserve(session, input) {
      authorize(session); const p = parse(reserveSchema, input); await expire();
      const perform = () => transaction(async (draft, manager) => {
        const previous = draft.data.demoRequests.find(r => r.operationKey === p.operationKey);
        if (previous) {
          if (previous.session !== session || ['persona', 'serviceId', 'date', 'start'].some(k => previous[k] !== p[k])) fail('IDEMPOTENCY_CONFLICT');
          return receipt(previous, draft.version);
        }
        const { persona, ...request } = p;
        const result = await manager.reserve(request), record = result.records[0];
        const r = { ...record, session, persona, date: p.date, status: 'pending', holdUntil: iso(now() + HOLD_MS) };
        draft.data.demoRequests.push(r);
        return receipt(r, draft.version);
      });
      try { return await perform(); }
      catch (error) {
        if (error.code !== 'STALE_VERSION') throw error;
        // Only an identical committed operation may be replayed after a race.
        const s = await store.read();
        if (!s.data.demoRequests.some(r => r.operationKey === p.operationKey)) throw error;
        return perform();
      }
    },
    async confirm(session, input) {
      authorize(session); const p = parse(changeSchema, input); await expire();
      return transaction(async (draft, manager) => {
        const r = owned(draft, session, p.id);
        if (r.status === 'confirmed') return receipt(r, draft.version);
        if (r.status !== 'pending') fail('TERMINAL_REQUEST');
        if (draft.version !== p.expectedVersion) fail('STALE_VERSION');
        // Recheck source freshness and current schedule with only our own hold
        // removed from this private copy. No actual slot is released.
        const own = draft.data.bookingOccupancy.records.find(x => x.id === r.id);
        own.status = 'cancelled';
        const available = await manager.available({ serviceId: r.serviceId, date: r.date });
        own.status = 'active';
        if (!available.ready) fail(available.reason);
        if (now() >= Date.parse(r.holdUntil)) fail('HOLD_EXPIRED');
        if (now() >= Date.parse(draft.data.bookingOccupancy.coverage.verifiedUntil)) fail('SOURCE_NOT_VERIFIED');
        const slot = available.slots.find(x => x.start === r.start && x.end === r.end);
        const service = draft.data.bookingSchedule.services.find(x => x.serviceId === r.serviceId);
        if (!slot || iso(Date.parse(r.end) + service.bufferMinutes * 60000) !== own.occupiedEnd) fail('SCHEDULE_CHANGED');
        r.status = 'confirmed';
        return receipt(r, draft.version);
      });
    },
    async cancel(session, input) {
      authorize(session); const p = parse(changeSchema, input); await expire();
      return transaction(async (draft, manager) => {
        const r = owned(draft, session, p.id);
        if (['cancelled', 'expired'].includes(r.status)) return receipt(r, draft.version);
        await manager.cancel(p);
        // manager replaces the draft aggregate; resolve the request again.
        const current = owned(draft, session, p.id); current.status = 'cancelled';
        return receipt(current, draft.version);
      });
    },
    async requests(session) {
      authorize(session); await expire(); const s = await store.read();
      return { version: s.version, requests: s.data.demoRequests.filter(r => r.session === session).map(r => receipt(r, s.version)) };
    },
  };
}

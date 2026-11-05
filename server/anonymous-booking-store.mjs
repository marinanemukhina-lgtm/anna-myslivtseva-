import { randomBytes } from 'node:crypto';

/** LOCAL PREPARATION ONLY: never imported by a route or existing schedule writer.
 * Capacity one across this entire singleton. Windows are precomputed appointment
 * candidates, not recurring availability. The caller must validate owner-approved
 * duration, timezone/DST, lead time, horizon and service policy before initializing
 * or replacing them. No personal fields or arbitrary metadata are accepted.
 *
 * Every change uses one atomic SQL compare-and-swap of the same revision and JSON
 * state. Adapter contract: query(sql, parameters) returns row arrays; UPDATE ...
 * RETURNING must be atomic and resolve only after durable commit (as db.query
 * does). No process-local lock or multi-statement transaction is relied upon.
 * Dedicated table: existing content/settings writes do NOT participate. Production
 * integration must migrate all relevant settings into this guarded state first.
 * No cancellation, expiration, contacts, service mapping, auth, public endpoint,
 * rate limiting or production wiring. Reservations are permanent here. A storage
 * timeout may have committed: retry the identical key, never claim success early.
 */
const TABLE = 'anonymous_booking_state';
const ID = 'capacity-one';
const TOKEN = /^[a-f0-9]{32,64}$/;
const MAX_TIME = 8640000000000000;
const MAX_BUFFER = 86400000;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const exact = (x, keys) => {
  if (!x || typeof x !== 'object' || Array.isArray(x) ||
      Object.keys(x).sort().join(',') !== [...keys].sort().join(',')) fail('INVALID_INPUT');
};
const integer = (x, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(x) || x < min || x > max) fail('INVALID_INPUT');
};
const token = (x) => { if (typeof x !== 'string' || !TOKEN.test(x)) fail('INVALID_INPUT'); };
const intervalKeys = ['windowId', 'start', 'end', 'beforeMs', 'afterMs'];
function interval(x, keys = intervalKeys) {
  exact(x, keys); token(x.windowId);
  integer(x.start, 0, MAX_TIME); integer(x.end, 0, MAX_TIME);
  integer(x.beforeMs, 0, MAX_BUFFER); integer(x.afterMs, 0, MAX_BUFFER);
  if (x.end <= x.start || x.start - x.beforeMs < 0 || x.end + x.afterMs > MAX_TIME) fail('INVALID_INPUT');
}
const overlaps = (a, b) => a.start - a.beforeMs < b.end + b.afterMs && b.start - b.beforeMs < a.end + a.afterMs;
function windows(value) {
  if (!Array.isArray(value) || value.length > 2048) fail('INVALID_INPUT');
  const ids = new Set();
  for (const x of value) {
    interval(x); if (ids.has(x.windowId)) fail('INVALID_INPUT'); ids.add(x.windowId);
  }
  return structuredClone(value);
}
function state(value) {
  exact(value, ['windows', 'reservations']); windows(value.windows);
  if (!Array.isArray(value.reservations) || value.reservations.length > 10000) fail('INVALID_INPUT');
  const keys = new Set(), ids = new Set();
  for (const x of value.reservations) {
    interval(x, [...intervalKeys, 'idempotencyKey', 'reservationId']);
    token(x.idempotencyKey); token(x.reservationId);
    if (keys.has(x.idempotencyKey) || ids.has(x.reservationId)) fail('INVALID_INPUT');
    keys.add(x.idempotencyKey); ids.add(x.reservationId);
  }
  const ordered = [...value.reservations].sort((a,b) => (a.start-a.beforeMs)-(b.start-b.beforeMs));
  for (let i = 1; i < ordered.length; i++) if (overlaps(ordered[i-1], ordered[i])) fail('INVALID_INPUT');
  return value;
}
const receipt = (r, revision) => ({ reservationId: r.reservationId, windowId: r.windowId, start: r.start, end: r.end, revision });

export function createAnonymousBookingStore({ query, now = Date.now }) {
  if (typeof query !== 'function' || typeof now !== 'function') fail('INVALID_ADAPTER');
  async function sql(statement, args = []) {
    try { return await query(statement, args); }
    catch { fail('STORAGE_UNAVAILABLE'); }
  }
  async function read() {
    const rows = await sql(`SELECT revision, body FROM ${TABLE} WHERE id=$1`, [ID]);
    if (!Array.isArray(rows) || rows.length !== 1) fail('STORAGE_UNAVAILABLE');
    try {
      const revision = Number(rows[0].revision); integer(revision, 1);
      return { revision, data: state(JSON.parse(rows[0].body)) };
    } catch { fail('STORAGE_INVALID'); }
  }
  async function write(snapshot, data) {
    integer(snapshot.revision, 1, Number.MAX_SAFE_INTEGER - 1);
    const next = snapshot.revision + 1;
    const rows = await sql(`UPDATE ${TABLE} SET body=$1, revision=$2 WHERE id=$3 AND revision=$4 RETURNING revision`,
      [JSON.stringify(data), next, ID, snapshot.revision]);
    if (!Array.isArray(rows) || rows.length > 1) fail('STORAGE_UNAVAILABLE');
    if (!rows.length) return false;
    if (Number(rows[0].revision) !== next) fail('STORAGE_UNAVAILABLE');
    return next;
  }
  return {
    async initialize(input) {
      exact(input, ['windows']);
      const data = { windows: windows(input.windows), reservations: [] };
      await sql(`CREATE TABLE IF NOT EXISTS ${TABLE} (id TEXT PRIMARY KEY, revision BIGINT NOT NULL, body TEXT NOT NULL)`);
      const rows = await sql(`INSERT INTO ${TABLE} (id, revision, body) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING RETURNING revision`, [ID, 1, JSON.stringify(data)]);
      if (!Array.isArray(rows)) fail('STORAGE_UNAVAILABLE');
      if (!rows.length) fail('ALREADY_INITIALIZED');
      if (rows.length !== 1 || Number(rows[0].revision) !== 1) fail('STORAGE_UNAVAILABLE');
      return { revision: 1 };
    },
    async snapshot() {
      const s = await read();
      // Internal-only snapshot; do not expose idempotency keys or busy details publicly.
      return structuredClone(s);
    },
    async replaceWindows(input) {
      exact(input, ['expectedRevision', 'windows']); integer(input.expectedRevision, 1);
      const nextWindows = windows(input.windows), s = await read();
      if (s.revision !== input.expectedRevision) fail('STALE_REVISION');
      const revision = await write(s, { windows: nextWindows, reservations: s.data.reservations });
      if (!revision) fail('STALE_REVISION');
      return { revision };
    },
    async reserve(input) {
      exact(input, ['expectedRevision', 'windowId', 'idempotencyKey']);
      integer(input.expectedRevision, 1); token(input.windowId); token(input.idempotencyKey);
      const s = await read();
      const existing = s.data.reservations.find(r => r.idempotencyKey === input.idempotencyKey);
      if (existing) {
        if (existing.windowId !== input.windowId) fail('IDEMPOTENCY_CONFLICT');
        return receipt(existing, s.revision);
      }
      if (s.revision !== input.expectedRevision) fail('STALE_REVISION');
      const candidate = s.data.windows.find(w => w.windowId === input.windowId);
      if (!candidate) fail('WINDOW_UNAVAILABLE');
      const timestamp = now(); integer(timestamp, 0, MAX_TIME);
      if (candidate.start <= timestamp) fail('WINDOW_EXPIRED');
      if (s.data.reservations.some(r => overlaps(candidate, r))) fail('WINDOW_BUSY');
      if (s.data.reservations.length >= 10000) fail('CAPACITY_LIMIT');
      const reservation = { ...candidate, idempotencyKey: input.idempotencyKey, reservationId: randomBytes(24).toString('hex') };
      const revision = await write(s, { ...s.data, reservations: [...s.data.reservations, reservation] });
      if (revision) return receipt(reservation, revision);
      // Only identical retry may succeed after a losing CAS. Never blindly retry
      // stale settings, or convert a failed/uncertain write into apparent success.
      const latest = await read();
      const duplicate = latest.data.reservations.find(r => r.idempotencyKey === input.idempotencyKey);
      if (duplicate) {
        if (duplicate.windowId !== input.windowId) fail('IDEMPOTENCY_CONFLICT');
        return receipt(duplicate, latest.revision);
      }
      fail('STALE_REVISION');
    },
  };
}

import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { settingsSchema, dateSchema, generateSlots, defaults } from '../shared/booking.mjs';

// LOCAL, AUTHENTICATED-CALLER PREPARATION ONLY. No public intake or auth here.
// Coverage is an explicit owner-maintained assertion, NOT an imported-calendar
// completeness claim. It expires within 24 hours. Settings and occupancy MUST
// remain in the same content row/version; all other writers must preserve records.
// This stores anonymous operational intervals, never names, contact data or notes.
// query must acknowledge atomic UPDATE ... RETURNING only after commit. An error
// can have an uncertain write outcome: refresh/retry the same operation key.
const fail = code => { throw Object.assign(new Error(code), { code }); };
const opaque = z.string().regex(/^[a-f0-9]{32,64}$/);
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine(s => Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s);
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1);
const serviceId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const coverageSchema = z.object({ start: iso, end: iso, verifiedUntil: iso }).strict().refine(c => c.start < c.end);
const recordSchema = z.object({
  id: opaque, start: iso, end: iso, occupiedStart: iso, occupiedEnd: iso,
  type: z.enum(['busy', 'reservation']), status: z.enum(['active', 'cancelled']),
  operationKey: opaque, serviceId: serviceId.nullable(),
}).strict().refine(r => r.start < r.end && r.occupiedStart <= r.start && r.occupiedEnd >= r.end &&
  (r.type === 'reservation' ? r.serviceId !== null : r.serviceId === null));
const overlaps = (a,b) => Date.parse(a.occupiedStart) < Date.parse(b.occupiedEnd) && Date.parse(b.occupiedStart) < Date.parse(a.occupiedEnd);
export const bookingOccupancySchema = z.object({
  schemaVersion: z.literal(1), coverage: coverageSchema.nullable(), records: z.array(recordSchema).max(5000),
}).strict().superRefine((o, ctx) => {
  const ids = new Set(), operations = new Map();
  for (const r of o.records) {
    if (ids.has(r.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate record ID' });
    ids.add(r.id);
    const previous = operations.get(r.operationKey);
    if (previous && (previous !== 'busy' || r.type !== 'busy')) ctx.addIssue({ code: 'custom', message: 'Duplicate operation' });
    operations.set(r.operationKey, r.type);
  }
  const active = o.records.filter(r => r.status === 'active').sort((a,b) => Date.parse(a.occupiedStart)-Date.parse(b.occupiedStart));
  for (let i=0;i<active.length;i++) for(let j=i+1;j<active.length && Date.parse(active[j].occupiedStart)<Date.parse(active[i].occupiedEnd);j++) {
    if ((active[i].type === 'reservation' || active[j].type === 'reservation') && overlaps(active[i], active[j]))
      ctx.addIssue({ code: 'custom', message: 'Conflicting reservation' });
  }
});
export const emptyBookingOccupancy = () => ({ schemaVersion: 1, coverage: null, records: [] });
function parse(schema, input) { const p = schema.safeParse(input); if (!p.success) fail('INVALID_INPUT'); return p.data; }
const intervalSchema = z.object({ start: iso, end: iso }).strict().refine(x => x.start < x.end);
const addSchema = z.object({ expectedVersion: version, operationKey: opaque, intervals: z.array(intervalSchema).min(1).max(100) }).strict();
const reserveSchema = z.object({ expectedVersion: version, operationKey: opaque, serviceId, date: dateSchema, start: iso }).strict();
const availableSchema = z.object({ serviceId, date: dateSchema }).strict();
const cancelSchema = z.object({ expectedVersion: version, id: opaque }).strict();
const setCoverageSchema = z.object({ expectedVersion: version, start: iso, end: iso, verifiedUntil: iso }).strict();
const fingerprint = intervals => JSON.stringify(intervals.map(({start,end})=>({start,end})).sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end)));
// Only a newly acknowledged CAS proves which exact settings/version were rebased.
// Read-only idempotency responses deliberately never carry these markers.
const mutationMarker = s => ({ rebasedFromVersion: s.version, settings: structuredClone(s.data.bookingSchedule ?? defaults()) });
const response = (s, records) => ({ version: s.version, records: structuredClone(records) });

export function createPrivateBookingManager({ readContent, query, now = Date.now }) {
  if (typeof readContent !== 'function' || typeof query !== 'function' || typeof now !== 'function') fail('INVALID_ADAPTER');
  function time() { const n = now(); if (!Number.isSafeInteger(n) || n < 0) fail('INVALID_CLOCK'); return n; }
  async function read() {
    let raw; try { raw = await readContent(); } catch { fail('STORAGE_UNAVAILABLE'); }
    if (!raw || !version.safeParse(raw.version).success || !raw.data || typeof raw.data !== 'object' || Array.isArray(raw.data)) fail('STORAGE_INVALID');
    const s = structuredClone(raw);
    const parsed = bookingOccupancySchema.safeParse(s.data.bookingOccupancy === undefined ? emptyBookingOccupancy() : s.data.bookingOccupancy);
    if (!parsed.success) fail('STORAGE_INVALID');
    s.occupancy = parsed.data;
    return s;
  }
  function fresh(s, expected) { if (s.version !== expected) fail('STALE_VERSION'); }
  async function save(s, occupancy) {
    if (!bookingOccupancySchema.safeParse(occupancy).success) fail('INVALID_INPUT');
    let rows;
    try {
      rows = await query('UPDATE content SET body=$1,version=version+1 WHERE id=$2 AND version=$3 RETURNING version',
        [JSON.stringify({ ...s.data, bookingOccupancy: occupancy }), 'main', s.version]);
    } catch { fail('STORAGE_UNAVAILABLE'); }
    if (!Array.isArray(rows) || rows.length > 1) fail('STORAGE_UNAVAILABLE');
    if (!rows.length) fail('STALE_VERSION');
    if (Number(rows[0].version) !== s.version + 1) fail('STORAGE_UNAVAILABLE');
    return s.version + 1;
  }
  async function withIdempotency(s, input, matches, create) {
    const records = s.occupancy.records.filter(r => r.operationKey === input.operationKey);
    if (records.length) { if (!matches(records)) fail('IDEMPOTENCY_CONFLICT'); return response(s, records); }
    fresh(s, input.expectedVersion);
    try { return await create(); }
    catch (error) {
      if (error.code !== 'STALE_VERSION') throw error;
      const latest = await read(), existing = latest.occupancy.records.filter(r => r.operationKey === input.operationKey);
      if (!existing.length) throw error;
      if (!matches(existing)) fail('IDEMPOTENCY_CONFLICT');
      return response(latest, existing);
    }
  }
  return {
    async snapshot() { const s = await read(); return { version: s.version, settings: s.data.bookingSchedule ?? null, occupancy: structuredClone(s.occupancy), serviceCatalog: Array.isArray(s.data.services) ? s.data.services.map(({id,title,published})=>({id,title,published})) : [] }; },
    async available(input) {
      const p = parse(availableSchema, input), s = await read(), clock = time();
      const settings = settingsSchema.safeParse(s.data.bookingSchedule);
      const timezone = settings.success ? settings.data.timezone : '';
      const unavailable = reason => ({ version: s.version, timezone, ready: false, reason, slots: [] });
      const coverage = s.occupancy.coverage;
      if (!coverage || clock >= Date.parse(coverage.verifiedUntil)) return unavailable('SOURCE_NOT_VERIFIED');
      if (!settings.success || !timezone || !Array.isArray(s.data.services)) return unavailable('SCHEDULE_UNAVAILABLE');
      const service = settings.data.services.find(x => x.serviceId === p.serviceId && x.enabled);
      if (!service || !s.data.services.some(x => x.id === p.serviceId && x.published === true)) return unavailable('SERVICE_UNAVAILABLE');
      const candidates = generateSlots(settings.data, service, p.date, clock).filter(x => Date.parse(x.start) > clock);
      const bounded = candidates.map(candidate => ({
        ...candidate, occupiedStart: candidate.start,
        occupiedEnd: new Date(Date.parse(candidate.end) + service.bufferMinutes * 60000).toISOString(),
      })).filter(candidate => Date.parse(candidate.occupiedStart) >= Date.parse(coverage.start) && Date.parse(candidate.occupiedEnd) <= Date.parse(coverage.end));
      if (candidates.length && !bounded.length) return unavailable('OUTSIDE_VERIFIED_COVERAGE');
      const slots = bounded.filter(candidate => !s.occupancy.records.some(r => r.status === 'active' && overlaps(r, candidate)))
        .map(({start, end}) => ({start, end}));
      // A read snapshot is advisory; reserve recomputes eligibility and CASes the
      // returned version. Empty valid schedule/full occupancy is ready with [].
      const expires = Math.min(Date.parse(coverage.verifiedUntil), clock + 60000,
        ...(slots.length ? [Date.parse(slots[0].start)] : []));
      return { version: s.version, timezone, ready: true, reason: null, slots,
        observedAt: new Date(clock).toISOString(), validUntil: new Date(expires).toISOString() };
    },
    async setCoverage(input) {
      const p = parse(setCoverageSchema, input), s = await read(); fresh(s,p.expectedVersion);
      const coverage = parse(coverageSchema, { start:p.start,end:p.end,verifiedUntil:p.verifiedUntil });
      const clock = time(), expiry = Date.parse(coverage.verifiedUntil);
      if (expiry <= clock || expiry > clock+86400000) fail('INVALID_VERIFICATION_EXPIRY');
      const next = { ...s.occupancy, coverage };
      return { version: await save(s,next), coverage, ...mutationMarker(s) };
    },
    async addBusy(input) {
      const p = parse(addSchema,input), s = await read();
      return withIdempotency(s,p, rs => rs.every(r=>r.type==='busy') && fingerprint(rs)===fingerprint(p.intervals), async()=>{
        const records = p.intervals.map(({start,end})=>({id:randomBytes(24).toString('hex'),start,end,occupiedStart:start,occupiedEnd:end,type:'busy',status:'active',operationKey:p.operationKey,serviceId:null}));
        if (s.occupancy.records.some(r=>r.status==='active' && r.type==='reservation' && records.some(x=>overlaps(x,r)))) fail('WINDOW_BUSY');
        const next = {...s.occupancy,records:[...s.occupancy.records,...records]};
        return { ...response({version:await save(s,next)},records), ...mutationMarker(s) };
      });
    },
    async reserve(input) {
      const p=parse(reserveSchema,input),s=await read();
      return withIdempotency(s,p,rs=>rs.length===1 && rs[0].type==='reservation' && rs[0].serviceId===p.serviceId && rs[0].start===p.start,async()=>{
        const clock=time(),coverage=s.occupancy.coverage;
        if (!coverage || clock>=Date.parse(coverage.verifiedUntil)) fail('SOURCE_NOT_VERIFIED');
        const settings=settingsSchema.safeParse(s.data.bookingSchedule);
        if (!settings.success || !Array.isArray(s.data.services)) fail('SCHEDULE_UNAVAILABLE');
        const service=settings.data.services.find(x=>x.serviceId===p.serviceId && x.enabled);
        if (!service || !s.data.services.some(x=>x.id===p.serviceId && x.published===true)) fail('SERVICE_UNAVAILABLE');
        const candidate=generateSlots(settings.data,service,p.date,clock).find(x=>x.start===p.start);
        if (!candidate || Date.parse(candidate.start)<=clock) fail('WINDOW_UNAVAILABLE');
        const record={id:randomBytes(24).toString('hex'),...candidate,occupiedStart:candidate.start,
          occupiedEnd:new Date(Date.parse(candidate.end)+service.bufferMinutes*60000).toISOString(),type:'reservation',status:'active',operationKey:p.operationKey,serviceId:p.serviceId};
        if (Date.parse(record.occupiedStart)<Date.parse(coverage.start) || Date.parse(record.occupiedEnd)>Date.parse(coverage.end)) fail('OUTSIDE_VERIFIED_COVERAGE');
        if (s.occupancy.records.some(r=>r.status==='active' && overlaps(r,record))) fail('WINDOW_BUSY');
        return { ...response({version:await save(s,{...s.occupancy,records:[...s.occupancy.records,record]})},[record]), ...mutationMarker(s) };
      });
    },
    async cancel(input) {
      const p=parse(cancelSchema,input),s=await read(); fresh(s,p.expectedVersion);
      const record=s.occupancy.records.find(r=>r.id===p.id);
      if (!record) fail('RECORD_NOT_FOUND');
      if (record.status==='cancelled') return response(s,[record]);
      const cancelled={...record,status:'cancelled'};
      return { ...response({version:await save(s,{...s.occupancy,records:s.occupancy.records.map(r=>r.id===p.id?cancelled:r)})},[cancelled]), ...mutationMarker(s) };
    },
  };
}

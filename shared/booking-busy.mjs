// Preparation only: no routes, persistence, patient data or Shifter parser.
// An imported file is a snapshot, not a live calendar connection.
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function instant(value) {
  if (typeof value !== 'string') return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return NaN;
  const [, year, month, day, hour, minute, second, zone] = match;
  if (+year < 1970 || +month < 1 || +month > 12 || +day < 1 || +day > new Date(Date.UTC(+year, +month, 0)).getUTCDate()
    || +hour > 23 || +minute > 59 || +second > 59) return NaN;
  if (zone !== 'Z' && (+zone.slice(1, 3) > 14 || +zone.slice(4) > 59 || (+zone.slice(1, 3) === 14 && +zone.slice(4) !== 0))) return NaN;
  return Date.parse(value);
}
export const intervalsOverlap = (start, end, busyStart, busyEnd) => start < busyEnd && busyStart < end;
function interval(value) {
  if (!exactKeys(value, ['start', 'end'])) return null;
  const start = instant(value.start), end = instant(value.end);
  return Number.isFinite(start) && Number.isFinite(end) && start < end ? {start, end} : null;
}
const unavailable = reason => ({ready:false, slots:[], reason});

// The caller must explicitly decide the source coverage and maximum age.
// Only start/end instants are allowed; names, titles and notes are rejected.
export function filterAvailableSlots(candidates, snapshot, options) {
  if (!exactKeys(options, ['now', 'maxAgeMilliseconds', 'bufferBeforeMinutes', 'bufferAfterMinutes'])
    || !Number.isFinite(options.now) || !Number.isSafeInteger(options.maxAgeMilliseconds) || options.maxAgeMilliseconds < 0
    || ![options.bufferBeforeMinutes, options.bufferAfterMinutes].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 1440))
    return unavailable('INVALID_POLICY');
  if (!snapshot) return unavailable('BUSY_SNAPSHOT_MISSING');
  if (!exactKeys(snapshot, ['from', 'to', 'observedAt', 'complete', 'intervals'])) return unavailable('INVALID_BUSY_SNAPSHOT');
  if (snapshot.complete !== true) return unavailable('BUSY_SNAPSHOT_INCOMPLETE');
  const from = instant(snapshot.from), to = instant(snapshot.to), observedAt = instant(snapshot.observedAt);
  if (![from, to, observedAt].every(Number.isFinite) || from >= to || !Array.isArray(snapshot.intervals) || snapshot.intervals.length > 10000)
    return unavailable('INVALID_BUSY_SNAPSHOT');
  if (observedAt > options.now || options.now - observedAt > options.maxAgeMilliseconds) return unavailable('BUSY_SNAPSHOT_STALE');
  const busy = snapshot.intervals.map(interval);
  if (busy.some(value => !value)) return unavailable('INVALID_BUSY_SNAPSHOT');
  if (!Array.isArray(candidates) || candidates.length > 10000) return unavailable('INVALID_CANDIDATES');
  const parsed = candidates.map(interval);
  if (parsed.some(value => !value)) return unavailable('INVALID_CANDIDATES');
  const before = options.bufferBeforeMinutes * 60000, after = options.bufferAfterMinutes * 60000;
  const selected = new Map();
  for (const candidate of parsed) {
    const start = candidate.start - before, end = candidate.end + after;
    if (candidate.start < options.now || start < from || end > to) continue;
    if (busy.some(block => intervalsOverlap(start, end, block.start, block.end))) continue;
    selected.set(`${candidate.start}:${candidate.end}`, {start:new Date(candidate.start).toISOString(), end:new Date(candidate.end).toISOString()});
  }
  return {ready:true, slots:[...selected.values()].sort((a, b) => a.start.localeCompare(b.start)), reason:null};
}

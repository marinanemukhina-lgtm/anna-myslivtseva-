import { createHash } from 'node:crypto';

// LOCAL PREVIEW ONLY. This is a strict ICS subset, not a Shifter-backup parser.
// A successful preview proves neither calendar completeness nor availability.
// No apply path exists: application needs separate owner confirmation tied to
// the exact sourceSha256 and version, plus an explicit coverage/freshness policy.
export const MAX_ICS_BYTES = 1024 * 1024;
export const MAX_ICS_EVENTS = 5000;
export const ICS_PREVIEW_VERSION = 'ics-preview-v1';
const warnings = Object.freeze([
  'PREVIEW_ONLY_NOT_APPLIED',
  'OWNER_CONFIRMATION_WITH_SOURCE_HASH_AND_VERSION_REQUIRED',
  'SOURCE_COVERAGE_AND_FRESHNESS_NOT_VERIFIED',
  'ALL_EVENTS_TREATED_AS_BUSY',
  'IDENTIFYING_FIELDS_OMITTED',
  'ONLY_UTC_FIXED_ETC_GMT_AND_MODERN_MOSCOW_SUPPORTED',
  'MOSCOW_LIMITED_TO_2015_THROUGH_2030',
]);
const stripped = new Set([
  'UID', 'DTSTAMP', 'CREATED', 'LAST-MODIFIED', 'SEQUENCE', 'SUMMARY',
  'DESCRIPTION', 'LOCATION', 'ATTENDEE', 'ORGANIZER', 'CONTACT', 'COMMENT',
  'URL', 'CLASS', 'CATEGORIES', 'RESOURCES', 'ATTACH', 'GEO', 'PRIORITY',
  'COLOR', 'IMAGE', 'STATUS', 'TRANSP',
]);
const recurrence = new Set(['RRULE', 'RDATE', 'EXRULE', 'EXDATE', 'RECURRENCE-ID']);
const fail = code => { throw new Error(code); };
const knownErrors = new Set([
  'INVALID_BYTES', 'FILE_TOO_LARGE', 'INVALID_OPTIONS', 'INVALID_UTF8',
  'MALFORMED_ICS', 'UNSUPPORTED_COMPONENT', 'UNSUPPORTED_PROPERTY',
  'UNSUPPORTED_RECURRENCE', 'UNSUPPORTED_METHOD', 'EVENT_LIMIT_EXCEEDED',
  'INVALID_TIME', 'MISSING_TIMEZONE', 'UNSUPPORTED_TIMEZONE',
  'INVALID_TIME_PARAMETERS', 'MISSING_EVENT_BOUNDARIES',
  'MISMATCHED_EVENT_BOUNDARIES', 'END_NOT_AFTER_START',
]);

// Fixed-offset zones and the explicitly bounded modern Moscow subset only.
// Reject DST-capable zones rather than guess at local time or custom VTIMEZONE.
function offsetMinutes(zone, local) {
  if (zone === 'Europe/Moscow') {
    // Moscow has been UTC+03 without clock changes since October 2014.
    // Limit this convenience to 2015–2030 and verify the installed tzdb still
    // agrees; do not generalize this assumption to historical or other zones.
    if (local === undefined) return 180;
    const year = new Date(local).getUTCFullYear();
    if (year < 2015 || year > 2030) fail('UNSUPPORTED_TIMEZONE');
    const format = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    for (const delta of [-36, 0, 36]) {
      const expected = local + delta * 3600000;
      const parts = Object.fromEntries(format.formatToParts(expected - 180 * 60000).map(part => [part.type, part.value]));
      if (Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) !== expected) fail('UNSUPPORTED_TIMEZONE');
    }
    return 180;
  }
  if (!zone) fail('MISSING_TIMEZONE');
  if (['UTC', 'Etc/UTC', 'Etc/GMT', 'GMT'].includes(zone)) return 0;
  const match = /^Etc\/GMT([+-])(\d|1[0-4])$/.exec(zone);
  if (!match) fail('UNSUPPORTED_TIMEZONE');
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); }
  catch { fail('UNSUPPORTED_TIMEZONE'); }
  return (match[1] === '+' ? -1 : 1) * Number(match[2]) * 60;
}
function property(line) {
  let quoted = false, colon = -1;
  for (let index = 0; index < line.length; index++) {
    if (line[index] === '"') quoted = !quoted;
    if (line[index] === ':' && !quoted) { colon = index; break; }
  }
  if (colon < 1) fail('MALFORMED_ICS');
  const head = line.slice(0, colon);
  const name = head.split(';', 1)[0].toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(name)) fail('MALFORMED_ICS');
  return { name, head, value: line.slice(colon + 1) };
}
function boundary(prop, timezone) {
  const parameters = new Map();
  for (const parameter of prop.head.split(';').slice(1)) {
    const match = /^(VALUE|TZID)=(?:"([^";]+)"|([^";]+))$/i.exec(parameter);
    if (!match || parameters.has(match[1].toUpperCase())) fail('INVALID_TIME_PARAMETERS');
    parameters.set(match[1].toUpperCase(), match[2] ?? match[3]);
  }
  const type = (parameters.get('VALUE') ?? 'DATE-TIME').toUpperCase();
  if (!['DATE', 'DATE-TIME'].includes(type)) fail('INVALID_TIME_PARAMETERS');
  const allDay = type === 'DATE';
  const match = (allDay ? /^(\d{4})(\d{2})(\d{2})$/ : /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/).exec(prop.value);
  if (!match) fail('INVALID_TIME');
  const [, year, month, day, hour = '0', minute = '0', second = '0', utc = ''] = match;
  const local = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  const date = new Date(local);
  if (+year < 1970 || +year > 9998 || date.getUTCFullYear() !== +year || date.getUTCMonth() + 1 !== +month
    || date.getUTCDate() !== +day || date.getUTCHours() !== +hour || date.getUTCMinutes() !== +minute
    || date.getUTCSeconds() !== +second) fail('INVALID_TIME');
  if ((allDay || utc) && parameters.has('TZID')) fail('INVALID_TIME_PARAMETERS');
  const zone = utc ? 'UTC' : (parameters.get('TZID') ?? timezone);
  const offset = offsetMinutes(zone, local);
  return { instant: local - offset * 60000, allDay, offset };
}

export function previewBookingIcs(bytes, options = {}) {
  const result = {
    version: ICS_PREVIEW_VERSION, applied: false, sourceSha256: null, valid: false,
    counts: { events: 0, intervals: 0 }, intervals: [], warnings: [...warnings], errors: [],
  };
  try {
    if (!(bytes instanceof Uint8Array)) fail('INVALID_BYTES');
    if (bytes.byteLength > MAX_ICS_BYTES) fail('FILE_TOO_LARGE');
    result.sourceSha256 = createHash('sha256').update(bytes).digest('hex');
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some(key => key !== 'timezone')
      || (options.timezone !== undefined && typeof options.timezone !== 'string')) fail('INVALID_OPTIONS');
    if (options.timezone !== undefined) offsetMinutes(options.timezone);
    let input;
    try { input = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { fail('INVALID_UTF8'); }
    // No opaque binaries, control characters, bare CRs or BOM. Newlines may be LF/CRLF.
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufeff]/.test(input) || /\r(?!\n)/.test(input)) fail('MALFORMED_ICS');
    const lines = [];
    const physical = input.replace(/\r\n/g, '\n').split('\n');
    if (physical.at(-1) === '') physical.pop();
    for (const line of physical) {
      if (/^[ \t]/.test(line)) {
        if (!lines.length) fail('MALFORMED_ICS');
        lines[lines.length - 1] += line.slice(1);
      } else lines.push(line);
      if (!line || lines.at(-1).length > 65536) fail('MALFORMED_ICS');
    }
    let state = 'before', event = null, version = false, method = false;
    const intervals = [];
    for (const line of lines) {
      const prop = property(line);
      const value = prop.value.toUpperCase();
      if (prop.name === 'BEGIN' || prop.name === 'END') {
        if (prop.head.toUpperCase() !== prop.name) fail('MALFORMED_ICS');
        if (prop.name === 'BEGIN' && value === 'VCALENDAR' && state === 'before') state = 'calendar';
        else if (prop.name === 'BEGIN' && value === 'VEVENT' && state === 'calendar') {
          if (++result.counts.events > MAX_ICS_EVENTS) fail('EVENT_LIMIT_EXCEEDED');
          event = {}; state = 'event';
        } else if (prop.name === 'END' && value === 'VEVENT' && state === 'event') {
          if (!event.DTSTART || !event.DTEND) fail('MISSING_EVENT_BOUNDARIES');
          const start = boundary(event.DTSTART, options.timezone), end = boundary(event.DTEND, options.timezone);
          if (start.allDay !== end.allDay || start.offset !== end.offset) fail('MISMATCHED_EVENT_BOUNDARIES');
          if (end.instant <= start.instant) fail('END_NOT_AFTER_START');
          intervals.push({ start: new Date(start.instant).toISOString(), end: new Date(end.instant).toISOString() });
          event = null; state = 'calendar';
        } else if (prop.name === 'END' && value === 'VCALENDAR' && state === 'calendar') state = 'after';
        else fail('UNSUPPORTED_COMPONENT');
        continue;
      }
      if (recurrence.has(prop.name)) fail('UNSUPPORTED_RECURRENCE');
      if (state === 'calendar') {
        if (prop.name === 'VERSION') {
          if (version || prop.head.toUpperCase() !== 'VERSION' || prop.value !== '2.0') fail('MALFORMED_ICS');
          version = true;
        } else if (prop.name === 'METHOD') {
          if (method || prop.head.toUpperCase() !== 'METHOD' || value !== 'PUBLISH') fail('UNSUPPORTED_METHOD');
          method = true;
        } else if (!['PRODID', 'CALSCALE', 'NAME', 'DESCRIPTION'].includes(prop.name)) fail('UNSUPPORTED_PROPERTY');
        else if (prop.name === 'CALSCALE' && value !== 'GREGORIAN') fail('UNSUPPORTED_PROPERTY');
      } else if (state === 'event') {
        if (['DTSTART', 'DTEND'].includes(prop.name)) {
          if (event[prop.name]) fail('MALFORMED_ICS');
          event[prop.name] = prop;
        } else if (!stripped.has(prop.name)) fail('UNSUPPORTED_PROPERTY');
      } else fail('MALFORMED_ICS');
    }
    if (state !== 'after' || !version) fail('MALFORMED_ICS');
    result.intervals = intervals.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    result.counts.intervals = intervals.length;
    result.valid = true;
  } catch (error) {
    // Never echo input, timezone values, filenames or native exception text.
    result.errors = [knownErrors.has(error?.message) ? error.message : 'MALFORMED_ICS'];
    result.intervals = []; result.counts.intervals = 0;
  }
  return result;
}

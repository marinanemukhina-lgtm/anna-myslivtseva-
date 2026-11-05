import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { previewBookingIcs, MAX_ICS_BYTES, MAX_ICS_EVENTS } from '../shared/booking-ics.mjs';
const event = (extra = '', start = '20261105T100000Z', end = '20261105T110000Z') => `BEGIN:VEVENT\nDTSTART:${start}\nDTEND:${end}\n${extra ? extra + '\n' : ''}END:VEVENT`;
const calendar = body => `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Synthetic only//EN\n${body}\nEND:VCALENDAR\n`;
const parse = (body, options) => previewBookingIcs(Buffer.from(calendar(body)), options);
const invalid = (result, code) => {
  assert.equal(result.valid, false); assert.deepEqual(result.intervals, []);
  assert.equal(result.counts.intervals, 0); assert.ok(result.errors.includes(code), JSON.stringify(result));
};

test('UTC blocks, exact-byte SHA256, sorted start/end only, never applied', () => {
  const bytes = Buffer.from(calendar(event('', '20261106T230000Z', '20261107T010000Z') + '\n' + event()));
  const copy = Buffer.from(bytes), result = previewBookingIcs(bytes);
  assert.equal(result.valid, true); assert.equal(result.applied, false);
  assert.deepEqual(result.counts, { events: 2, intervals: 2 });
  assert.equal(result.sourceSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(result.intervals, [
    { start: '2026-11-05T10:00:00.000Z', end: '2026-11-05T11:00:00.000Z' },
    { start: '2026-11-06T23:00:00.000Z', end: '2026-11-07T01:00:00.000Z' },
  ]);
  assert.deepEqual(bytes, copy);
});
test('CRLF folding, private and malicious text omitted without execution', () => {
  const text = calendar(event('SUMMARY:PRIVATE_TITLE\nDESCRIPTION:PRIVATE_NAME $(touch /tmp/do-not-run)\n more private text\n\tcontinued\nLOCATION:PRIVATE_ROOM\nATTENDEE;CN="Private: Person":mailto:private@example.test\nORGANIZER:mailto:private@example.test\nCONTACT:PRIVATE_PHONE\nATTACH:https://example.test/private')).replaceAll('\n', '\r\n');
  const result = previewBookingIcs(Buffer.from(text));
  assert.equal(result.valid, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|private|example|touch|continued/);
});
test('folded DTSTART is unfolded before validation', () => {
  assert.equal(parse(event().replace('20261105T100000Z', '20261105T\n 100000Z')).valid, true);
});
test('exclusive all-day DTEND and explicit timezone required', () => {
  const body = 'BEGIN:VEVENT\nDTSTART;VALUE=DATE:20261105\nDTEND;VALUE=DATE:20261107\nEND:VEVENT';
  invalid(parse(body), 'MISSING_TIMEZONE');
  const result = parse(body, { timezone: 'Etc/GMT-3' });
  assert.equal(result.valid, true);
  assert.deepEqual(result.intervals, [{ start: '2026-11-04T21:00:00.000Z', end: '2026-11-06T21:00:00.000Z' }]);
});
test('floating times require explicit zone and TZID supports quoted fixed zones', () => {
  const floating = event('', '20261105T230000', '20261106T010000');
  invalid(parse(floating), 'MISSING_TIMEZONE');
  assert.equal(parse(floating, { timezone: 'Etc/GMT+5' }).intervals[0].start, '2026-11-06T04:00:00.000Z');
  const explicit = floating.replace('DTSTART:', 'DTSTART;TZID="Etc/GMT-3":').replace('DTEND:', 'DTEND;TZID=Etc/GMT-3:');
  assert.equal(parse(explicit).intervals[0].start, '2026-11-05T20:00:00.000Z');
});
test('explicit modern Moscow supports 2015–2030, rejects historical dates', () => {
  const body = event('', '20261105T230000', '20261106T010000');
  assert.equal(parse(body, { timezone: 'Europe/Moscow' }).intervals[0].start, '2026-11-05T20:00:00.000Z');
  const explicit = body.replace('DTSTART:', 'DTSTART;TZID=Europe/Moscow:').replace('DTEND:', 'DTEND;TZID=Europe/Moscow:');
  assert.equal(parse(explicit).valid, true);
  invalid(parse(body.replaceAll('2026', '2014'), { timezone: 'Europe/Moscow' }), 'UNSUPPORTED_TIMEZONE');
});
test('ambiguous and nonexistent DST times fail closed; no inferred timezone', () => {
  for (const start of ['20261101T013000', '20260308T023000']) {
    invalid(parse(event('', start, '20261102T120000'), { timezone: 'America/New_York' }), 'UNSUPPORTED_TIMEZONE');
  }
  invalid(parse(event(), { timezone: 'INJECT_PRIVATE_ZONE' }), 'UNSUPPORTED_TIMEZONE');
});
test('recurrence fields and overrides invalidate all intervals', () => {
  for (const name of ['RRULE', 'RDATE', 'EXRULE', 'EXDATE', 'RECURRENCE-ID']) invalid(parse(event() + '\n' + event(`${name}:PRIVATE`)), 'UNSUPPORTED_RECURRENCE');
});
test('malformed boundaries, impossible dates, mixed types, unsupported parameters', () => {
  invalid(parse(event('', '20260230T100000Z')), 'INVALID_TIME');
  invalid(parse(event('', '20261105T240000Z')), 'INVALID_TIME');
  invalid(parse(event('', '20261105T100060Z')), 'INVALID_TIME');
  invalid(parse(event('', '20261105T110000Z')), 'END_NOT_AFTER_START');
  invalid(parse(event('', '20261105T120000Z')), 'END_NOT_AFTER_START');
  invalid(parse(event().replace('DTEND:20261105T110000Z\n', '')), 'MISSING_EVENT_BOUNDARIES');
  invalid(parse(event().replace('DTSTART:', 'DTSTART;BOGUS=1:')), 'INVALID_TIME_PARAMETERS');
  invalid(parse(event().replace('DTSTART:', 'DTSTART;TZID=UTC:')), 'INVALID_TIME_PARAMETERS');
  invalid(parse(event().replace('DTSTART:20261105T100000Z', 'DTSTART;VALUE=DATE:20261105'), { timezone: 'UTC' }), 'MISMATCHED_EVENT_BOUNDARIES');
  invalid(parse(event('DTSTART:20261105T090000Z')), 'MALFORMED_ICS');
});
test('content validation, calendar structure and unsupported semantics', () => {
  for (const source of ['not an ICS file', 'PK\u0000binary', '', calendar(event()) + calendar(event()), calendar(event()).replace('VERSION:2.0\n', '')]) {
    assert.equal(previewBookingIcs(Buffer.from(source)).valid, false);
  }
  invalid(parse(event() + '\nBEGIN:VTIMEZONE\nEND:VTIMEZONE'), 'UNSUPPORTED_COMPONENT');
  invalid(parse(event('BEGIN:VALARM\nEND:VALARM')), 'UNSUPPORTED_COMPONENT');
  invalid(parse('METHOD:CANCEL\n' + event()), 'UNSUPPORTED_METHOD');
  invalid(parse(event('DURATION:PT1H')), 'UNSUPPORTED_PROPERTY');
  invalid(previewBookingIcs(Uint8Array.of(0xff)), 'INVALID_UTF8');
  invalid(previewBookingIcs('not bytes'), 'INVALID_BYTES');
  invalid(parse(event(), { arbitrary: true }), 'INVALID_OPTIONS');
});
test('byte and event bounds, no partial success', () => {
  invalid(previewBookingIcs(Buffer.alloc(MAX_ICS_BYTES + 1)), 'FILE_TOO_LARGE');
  const result = parse(Array(MAX_ICS_EVENTS + 1).fill(event()).join('\n'));
  invalid(result, 'EVENT_LIMIT_EXCEEDED');
  assert.equal(parse(Array(MAX_ICS_EVENTS).fill(event()).join('\n')).valid, true);
});
test('empty calendars do not imply verified availability', () => {
  const result = previewBookingIcs(Buffer.from('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR\n'));
  assert.equal(result.valid, true); assert.deepEqual(result.intervals, []);
  assert.ok(result.warnings.includes('SOURCE_COVERAGE_AND_FRESHNESS_NOT_VERIFIED'));
});
test('CLI read-only source preserved, private data never echoed; errors bounded', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ics-synthetic-'));
  const cli = new URL('../scripts/preview-booking-ics.mjs', import.meta.url);
  const run = args => spawnSync(process.execPath, [cli.pathname, ...args], { encoding: 'utf8' });
  try {
    const file = join(dir, 'synthetic.ics');
    const original = Buffer.from(calendar(event('SUMMARY:PRIVATE_USER')).replaceAll('\n', '\r\n'));
    await writeFile(file, original);
    const output = run([file]);
    assert.equal(output.status, 0); assert.equal(output.stderr, '');
    assert.equal(JSON.parse(output.stdout).applied, false);
    assert.doesNotMatch(output.stdout, /PRIVATE_USER|synthetic/);
    assert.deepEqual(await readFile(file), original);
    await writeFile(file, 'not ICS PRIVATE_USER');
    assert.equal(JSON.parse(run([file]).stdout).valid, false);
    assert.equal(JSON.parse(run([join(dir, 'PRIVATE_MISSING.ics')]).stdout).errors[0], 'FILE_READ_FAILED');
    assert.equal(JSON.parse(run([join(dir, 'backup.Shifter')]).stdout).errors[0], 'UNSUPPORTED_FILE_TYPE');
    assert.equal(JSON.parse(run([]).stdout).errors[0], 'USAGE_FILE_OPTIONAL_TIMEZONE');
    await writeFile(file, Buffer.alloc(MAX_ICS_BYTES + 1));
    assert.equal(JSON.parse(run([file]).stdout).errors[0], 'FILE_TOO_LARGE');
    await symlink(file, join(dir, 'link.ics'));
    assert.equal(JSON.parse(run([join(dir, 'link.ics')]).stdout).errors[0], 'FILE_READ_FAILED');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { dateInZone, formatAppointment, normalizeWindows } from '../src/booking-client.mjs';

test('dates use practice timezone rather than device timezone', () => {
  assert.equal(dateInZone('Pacific/Kiritimati', new Date('2026-10-13T15:00:00Z')), '2026-10-14');
  assert.match(formatAppointment('2026-10-13T15:00:00Z', 'Europe/Moscow'), /18:00/);
});
test('windows reject missing or reversed intervals without inventing hours', () => {
  assert.deepEqual(normalizeWindows([]), []);
  assert.throws(() => normalizeWindows([{ start: '', end: '' }]));
  assert.throws(() => normalizeWindows([{ start: '12:00', end: '09:00' }]));
  assert.throws(() => normalizeWindows([{ start: '09:00', end: '12:00' }, { start: '11:00', end: '13:00' }]));
  assert.deepEqual(normalizeWindows([{ start: '09:00', end: '12:00' }]), [{ start: '09:00', end: '12:00' }]);
});

test('own successful schedule save advances only a matching CMS baseline and preserves profile drafts', async () => {
  const { mergeScheduleSave } = await import('../src/booking-client.mjs');
  const draft = { version: 3, data: { profile: { role: 'Unsaved local draft' }, bookingSchedule: { timezone: '' } } };
  const saved = { version: 4, settings: { timezone: 'Europe/Moscow' } };
  const next = mergeScheduleSave(draft, 3, saved);
  assert.equal(next.version, 4);
  assert.equal(next.data.profile.role, 'Unsaved local draft');
  assert.deepEqual(next.data.bookingSchedule, saved.settings);
  assert.equal(draft.version, 3);
});
test('external writer baseline never silently rebases an older CMS draft', async () => {
  const { mergeScheduleSave } = await import('../src/booking-client.mjs');
  const draft = { version: 3, data: { profile: { role: 'Unsaved local draft' } } };
  assert.equal(mergeScheduleSave(draft, 4, { version: 5, settings: {} }), draft);
});

test('an unchecked service without timing cannot poison an unrelated schedule save', async () => {
  const { prepareScheduleDraft } = await import('../src/booking-client.mjs');
  const draft = { weeklyHours: { 0: [] }, overrides: [], services: [
    { serviceId: 'untouched', durationMinutes: '', bufferMinutes: 0, enabled: false },
    { serviceId: 'configured', durationMinutes: 45, bufferMinutes: 10, enabled: false },
  ] };
  assert.deepEqual(prepareScheduleDraft(draft).services.map(service => service.serviceId), ['configured']);
  assert.equal(draft.services.length, 2);
});
test('end-of-day windows preserve 24:00 while starts remain ordinary clock times', () => {
  assert.deepEqual(normalizeWindows([{ start: '23:00', end: '24:00' }]), [{ start: '23:00', end: '24:00' }]);
  assert.throws(() => normalizeWindows([{ start: '24:00', end: '24:00' }]));
});

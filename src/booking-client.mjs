export function dateInZone(timezone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}
export function formatAppointment(start, timezone) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: timezone || 'UTC', dateStyle: 'long', timeStyle: 'short' }).format(new Date(start));
}
export function normalizeWindows(windows) {
  const sorted = windows.map(window => ({ ...window })).sort((a, b) => a.start.localeCompare(b.start));
  sorted.forEach((window, index) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(window.start) || (window.end !== '24:00' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.end)) || window.start >= window.end)
      throw new Error('Укажите начало и конец каждого интервала. Конец должен быть позже начала.');
    if (index && sorted[index - 1].end > window.start) throw new Error('Интервалы приёма не должны пересекаться.');
  });
  return sorted;
}
export async function bookingApi(url, { method = 'GET', body, signal } = {}) {
  const response = await fetch(url, { method, credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data;
  try { data = await response.json(); } catch { throw new Error('Сервер не ответил. Попробуйте ещё раз позже.'); }
  if (!response.ok) { const error = new Error(data.error || 'Не удалось выполнить действие.'); error.status = response.status; error.code = data.code; throw error; }
  return data;
}
// A newer schedule snapshot can include another editor's changes. Never make an
// older unsaved CMS draft look current merely because this schedule save passed.
export function mergeScheduleSave(current, previousVersion, saved) {
  if (!current || current.version !== previousVersion) return current;
  return { ...current, version: saved.version, data: { ...current.data, bookingSchedule: saved.settings } };
}
export function prepareScheduleDraft(settings) {
  const result = structuredClone(settings);
  // An unchecked, never-configured service is not a schedule entry. Never
  // invent a duration just to make an untouched checkbox serializable.
  result.services = result.services.filter(service => service.enabled || service.durationMinutes !== '');
  Object.keys(result.weeklyHours).forEach(key => { result.weeklyHours[key] = normalizeWindows(result.weeklyHours[key]); });
  result.overrides = result.overrides.map(override => ({ ...override, windows: override.closed ? [] : normalizeWindows(override.windows) }));
  return result;
}

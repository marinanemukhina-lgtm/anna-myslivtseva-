import { z } from "zod";

export const defaults = () => ({
  timezone: "",
  services: [],
  weeklyHours: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [String(day), []])),
  overrides: [],
  slotStepMinutes: 15,
  minNoticeMinutes: 0,
  horizonDays: 60,
});

export const validDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
export const dateSchema = z.string().refine(validDate, "Укажите существующую дату.");
export function validZone(value) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return !!value;
  } catch {
    return false;
  }
}
export const minutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const windows = z.array(z.object({
  start: time,
  end: z.union([time, z.literal("24:00")]),
}).strict()).max(12).superRefine((items, context) => {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
  if (sorted.some((item, index) =>
    minutes(item.start) >= minutes(item.end) ||
    (index > 0 && minutes(sorted[index - 1].end) > minutes(item.start)),
  )) context.addIssue({
    code: "custom",
    message: "Интервалы не должны пересекаться; начало должно быть раньше конца.",
  });
});
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const settingsSchema = z.object({
  timezone: z.string().max(100).refine((value) => value === "" || validZone(value), "Неизвестный часовой пояс."),
  services: z.array(z.object({
    serviceId: id,
    durationMinutes: z.number().int().min(5).max(720),
    bufferMinutes: z.number().int().min(0).max(240),
    enabled: z.boolean(),
  }).strict()).max(100),
  weeklyHours: z.object(Object.fromEntries(
    Array.from({ length: 7 }, (_, day) => [String(day), windows]),
  )).strict(),
  overrides: z.array(z.object({
    date: dateSchema,
    closed: z.boolean(),
    windows,
  }).strict()).max(730),
  slotStepMinutes: z.number().int().min(5).max(120),
  minNoticeMinutes: z.number().int().min(0).max(43200),
  horizonDays: z.number().int().min(1).max(365),
}).strict().superRefine((settings, context) => {
  if (
    new Set(settings.services.map((item) => item.serviceId)).size !== settings.services.length ||
    new Set(settings.overrides.map((item) => item.date)).size !== settings.overrides.length
  ) context.addIssue({ code: "custom", message: "Повторяющиеся услуги или даты." });
  if (settings.overrides.some((item) => item.closed && item.windows.length))
    context.addIssue({ code: "custom", message: "Для закрытого дня уберите интервалы." });
});

function formatter(zone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}
function parts(format, milliseconds) {
  const value = Object.fromEntries(format.formatToParts(milliseconds).map((part) => [part.type, part.value]));
  return {
    date: `${value.year}-${value.month}-${value.day}`,
    minute: Number(value.hour) * 60 + Number(value.minute),
  };
}
export function localParts(milliseconds, zone) {
  return parts(formatter(zone), milliseconds);
}
export function dayWindows(settings, date) {
  const override = settings.overrides.find((item) => item.date === date);
  if (override) return override.closed ? [] : override.windows;
  return settings.weeklyHours[String(new Date(date + "T12:00:00Z").getUTCDay())];
}
export function fitsSchedule(settings, start, end) {
  if (!validZone(settings.timezone)) return false;
  const format = formatter(settings.timezone);
  const first = parts(format, start), last = parts(format, end - 1);
  if (first.date !== last.date) return false;
  return dayWindows(settings, first.date).some((window) => {
    const low = minutes(window.start), high = minutes(window.end);
    if (first.minute < low || first.minute >= high || last.minute < low || last.minute >= high)
      return false;
    // Ordinary days are monotonic. Across a DST transition, endpoints alone
    // could hide an excursion through the closed part of a repeated hour.
    if (last.minute - first.minute + 1 !== Math.ceil((end - start) / 60000)) {
      for (let point = start; point < end; point += 60000) {
        const local = parts(format, point);
        if (local.date !== first.date || local.minute < low || local.minute >= high)
          return false;
      }
    }
    return true;
  });
}

// Pure administrator preview. No patient records or occupied slots are read.
// Enumerating actual UTC minutes also preserves both instants of a repeated
// local DST minute instead of silently mapping two times to one reservation.
export function generateSlots(settings, service, date, now = Date.now()) {
  if (!validZone(settings.timezone)) return [];
  const format = formatter(settings.timezone);
  const today = parts(format, now).date;
  const maxDate = new Date(Date.parse(today) + settings.horizonDays * 86400000).toISOString().slice(0, 10);
  if (date < today || date > maxDate) return [];
  const available = dayWindows(settings, date);
  if (!available.length) return [];
  const duration = service.durationMinutes * 60000;
  const occupiedDuration = duration + service.bufferMinutes * 60000;
  const from = Date.parse(date) - 14 * 3600000;
  const to = Date.parse(date) + 38 * 3600000;
  const slots = [];
  for (let start = from; start < to; start += 60000) {
    if (start < now + settings.minNoticeMinutes * 60000) continue;
    const local = parts(format, start);
    if (local.date !== date) continue;
    if (!available.some((window) =>
      local.minute >= minutes(window.start) &&
      local.minute < minutes(window.end) &&
      (local.minute - minutes(window.start)) % settings.slotStepMinutes === 0,
    )) continue;
    if (!fitsSchedule(settings, start, start + occupiedDuration)) continue;
    slots.push({
      start: new Date(start).toISOString(),
      end: new Date(start + duration).toISOString(),
    });
  }
  return slots;
}

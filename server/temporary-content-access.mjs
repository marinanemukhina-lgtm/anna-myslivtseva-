// Temporary access explicitly approved by the site owner on 2026-11-05.
// Restore protection by setting both access flags to false and deploying again.
export const TEMPORARY_CONTENT_ACCESS_ENABLED = true;

export const TEMPORARY_CALENDAR_ACCESS_ENABLED = true;

function exactProductionHost(req, env) {
  return env.VERCEL === "1" &&
    env.VERCEL_ENV === "production" &&
    String(req.headers.host || "").toLowerCase() === "anna-myslivtseva.vercel.app";
}

export function temporaryContentAccess(req, env = process.env) {
  return TEMPORARY_CONTENT_ACCESS_ENABLED && exactProductionHost(req, env);
}

export function temporaryCalendarAccess(req, env = process.env) {
  return TEMPORARY_CONTENT_ACCESS_ENABLED && TEMPORARY_CALENDAR_ACCESS_ENABLED && exactProductionHost(req, env);
}

export function contentPayload(req, payload) {
  if (!req.contentOnlyAccess) return payload;
  const { bookingSchedule, bookingOccupancy, ...data } = payload.data;
  return { ...payload, data };
}

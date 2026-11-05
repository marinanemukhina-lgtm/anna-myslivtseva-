// Temporary access explicitly approved by the site owner on 2026-11-05.
// Roll back by setting this constant to false and deploying again.
export const TEMPORARY_CONTENT_ACCESS_ENABLED = true;

export function temporaryContentAccess(req, env = process.env) {
  return TEMPORARY_CONTENT_ACCESS_ENABLED &&
    env.VERCEL === "1" &&
    env.VERCEL_ENV === "production" &&
    String(req.headers.host || "").toLowerCase() === "anna-myslivtseva.vercel.app";
}

export function contentPayload(req, payload) {
  if (!req.contentOnlyAccess) return payload;
  const { bookingSchedule, ...data } = payload.data;
  return { ...payload, data };
}

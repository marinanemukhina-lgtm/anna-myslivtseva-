# Temporary open content and working-hours editors — 2026-11-05

The owner explicitly approved anonymous editing of the current empty content CMS after being told that visitors could change, publish, or delete content and that restoring password protection requires another deployment.

This mode applies only to `anna-myslivtseva.vercel.app`, with `VERCEL=1` and `VERCEL_ENV=production`. It does not apply to previews, other domains, or local servers. It creates no sessions or credentials, changes no existing password, and retains Origin checks, content validation, optimistic concurrency and file restrictions.

Anonymous access includes the content editor and media uploads/previews. Drafts in the editor are visible to all visitors while this mode is on. Do not enter confidential information or upload private documents. The UI displays this warning. A separately enabled calendar opt-in, which also requires the content opt-in, allows only GET/PUT /api/admin/booking: working hours, service durations, weekly rules and date overrides are publicly editable. Its snapshots explicitly set temporaryCalendarAccess. Schedule data remains redacted from content responses and preserved on content saves; services used in the schedule cannot be removed anonymously. Schedule saves preserve private occupancy and use the exact client version with an atomic compare-and-swap. Occupancy, import, reservations, cancellation, availability and true free-availability endpoints still require the original owner session. The temporary calendar never requests or renders private occupancy or free-time previews. Public appointment intake remains disabled.

## Restore protection

Set both `TEMPORARY_CONTENT_ACCESS_ENABLED` and `TEMPORARY_CALENDAR_ACCESS_ENABLED` to `false` in `server/temporary-content-access.mjs`, commit, and deploy the production branch again. Alternatively revert the temporary-access commit and deploy. Do not reset the database: content edits remain intact.

After deployment, a fresh browser must show the password form at `/admin`, `/api/session` must report `authenticated: false` and `temporaryContentAccess: false` and `temporaryCalendarAccess: false`, anonymous GET/PUT `/api/admin/booking`, `/api/admin/content` and `POST /api/media` must reject with 401, and unreferenced draft media must reject with 404.

The existing password configuration is preserved. A new password, if wanted, must be prepared via `/admin/setup`, configured as `ADMIN_PASSWORD_HASH` in the project's Vercel environment, and deployed. The setup page does not install a password by itself. Merely installing a password does not turn off the temporary-access flag.

The existing “Вход владельца” control verifies the password and server session before mounting a fresh owner calendar. Content drafts retain their exact version. Unsaved schedule changes require confirmation before replacement on login; logout reloads the current limited scope. Changing a password alone disables neither opt-in. No real calendar imports or client booking intake are enabled by this change.

Update 2026-11-06: the explicitly open content mode now also covers the marketing workspace, its non-secret materials summary and versioned content saves. It still creates no owner session and does not enable publication or access to private booking endpoints. Marketing GET is read-only; initial persistence requires an explicit PUT.

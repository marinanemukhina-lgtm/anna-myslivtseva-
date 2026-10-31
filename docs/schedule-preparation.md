# Schedule preparation

This feature prepares Anna's schedule. It does not accept appointments or patient information.

## Administrator workflow

1. Add genuine services in the existing content editor.
2. In the calendar editor, set the practice timezone and numeric service durations/buffers.
3. Set weekly hours, or leave weekly hours empty and open only selected dates.
4. Date overrides either close the full day or replace its weekly hours with explicit windows.
5. Save and preview the available times. Preview is private to the administrator and does not reserve a time.

The initial configuration has no services, timezone or working hours. The owner must enter them. Display-only service duration text is not parsed into booking rules.

## Storage and concurrency

The private `bookingSchedule` field lives in existing `content.body`. No additional tables, patient database, migrations or new credentials are introduced. It shares `content.version` optimistic concurrency with the content editor.

- `GET /api/admin/booking` returns settings, content version and genuine service catalog.
- `PUT /api/admin/booking` accepts `{settings,version}` and changes only the schedule.
- Ordinary CMS saves preserve the stored schedule, ignoring submitted schedule values. Deleting a CMS service removes only that service’s duration settings in the same atomic write; hours and other service settings remain.
- A stale save returns HTTP409. Clients preserve unsaved edits and require explicit reconciliation; they must not silently adopt the newer server version.
- After its own successful schedule save, the UI can advance a general editor's version only if that editor's baseline equals the submitted schedule version.

`GET /api/admin/booking/availability?serviceId=...&date=YYYY-MM-DD` returns a protected preview with `preview:true`. It does not query occupied slots. Dates must be real calendar dates, and results respect a maximum 365-day configured horizon, notice period, durations and buffers. UTC output distinguishes repeated local DST times.

## Public intake remains closed

`GET /api/booking/config` always says `ready:false` and `enabled:false`. Public availability is empty. All requests to the appointment endpoint and its descendants return HTTP503 with `BOOKING_NOT_CONNECTED`, before JSON parsing. Neither an administrator field nor an environment flag enables intake.

The public interface must not present a personal-data entry form or send booking payloads. Endpoint rejection alone does not prevent an unsolicited request from reaching the hosting provider and is not a patient-hosting compliance measure.

Actual booking needs a separately approved provider/intake hosting and data flow. This preparation release contains no Telegram, Google Calendar, patient contacts, booking records, notifications, management tokens, cancellations or rescheduling. There is no implied synchronization with an external provider.

## Verification

`npm test` covers schedule persistence, shared CMS version conflicts, concurrent schedule saves, preserved general edits, private projections, genuine service validation, disabled intake before parsing, timezone/window validation, buffers, day closures and preview calculations. The tests use synthetic local data only.

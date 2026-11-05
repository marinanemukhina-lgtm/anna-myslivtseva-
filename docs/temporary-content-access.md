# Temporary open content editor — 2026-11-05

The owner explicitly approved anonymous editing of the current empty content CMS after being told that visitors could change, publish, or delete content and that restoring password protection requires another deployment.

This mode applies only to `anna-myslivtseva.vercel.app`, with `VERCEL=1` and `VERCEL_ENV=production`. It does not apply to previews, other domains, or local servers. It creates no sessions or credentials, changes no existing password, and retains Origin checks, content validation, optimistic concurrency and file restrictions.

Anonymous access includes the content editor and media uploads/previews. Drafts in the editor are visible to all visitors while this mode is on. Do not enter confidential information or upload private documents. The UI displays this warning. Calendar APIs still require the original admin session; schedule data is redacted from anonymous content responses, preserved on saves, and services used in the protected schedule cannot be removed anonymously. Public appointment intake remains disabled.

## Restore protection

Set `TEMPORARY_CONTENT_ACCESS_ENABLED` to `false` in `server/temporary-content-access.mjs`, commit, and deploy the production branch again. Alternatively revert the temporary-access commit and deploy. Do not reset the database: content edits remain intact.

After deployment, a fresh browser must show the password form at `/admin`, `/api/session` must report `authenticated: false` and `temporaryContentAccess: false`, anonymous `/api/admin/content` and `POST /api/media` must reject with 401, and unreferenced draft media must reject with 404.

The existing password configuration is preserved. A new password, if wanted, must be prepared via `/admin/setup`, configured as `ADMIN_PASSWORD_HASH` in the project's Vercel environment, and deployed. The setup page does not install a password by itself. Merely installing a password does not turn off the temporary-access flag.

# Owner invitation handoff: local preparation, not activated

This is code preparation, not authorization to initialize a real database, issue a real invitation, change a real password, or activate the feature in production. CI and local tests use synthetic credentials and disposable storage. The browser claim page is `/admin/claim`; no invitation belongs in its URL.

## Security model

The opt-in `OWNER_HANDOFF_REQUIRED=1` requires a valid durable `owner_security` singleton. Missing, malformed or unavailable state does not fall back to the environment password or temporary editors. Startup creates only empty tables, never an owner record or first-visitor setup.

When a durable singleton exists it remains authoritative even if the opt-in environment flag is removed. The legacy environment password and legacy `sessions` table are no longer used. Missing state with the flag absent retains legacy behavior for the currently released app. Consequently the flag must remain explicitly enabled after activation; deleting the state and removing the flag is NOT recovery.

A deliberate, separately authorized operator invocation of `node scripts/init-owner-handoff.mjs --initialize-existing-owner`, with `OWNER_HANDOFF_REQUIRED=1` and the explicitly selected deployment environment, copies the existing environment password hash into a new singleton. The script does not load `.env`, does not overwrite an existing row, and does not create or print an invitation. No such real invocation has been performed. Existing legacy sessions stop working immediately; the current owner must log in again. Initialization retains the specifically approved temporary CMS/calendar access until handoff completes.

The existing owner session and a fresh verification of the current owner password are both required to issue or revoke an invitation. Issue replaces any outstanding invitation. Only a SHA-256 digest of a random 256-bit invitation is persisted; the plaintext is returned once. Validity is fixed at 15 minutes. Tokens are never added to URLs, cookies or storage. Delivering the invitation to Anna requires separately authorized private communication; do not put it in chat logs, shell history, screenshots or analytics. Do not install body logging or response tracing on these endpoints.

Redeeming an invitation changes the scrypt password hash, consumes the invitation, increments the session epoch and sets the single temporary-access flag to closed in ONE atomic compare-and-swap update. Both CMS and calendar use that flag. No auto-login occurs. The new password must be 12–256 characters and differ from the existing password. All previous owner sessions are immediately invalid by epoch; environment-password fallback remains disabled. Unreferenced media also requires current owner access after handoff; intentionally published media remains public.

## API contract

All responses are no-store. Mutation endpoints use the existing same-origin JSON CSRF policy. Unknown request fields are rejected.

- `GET /api/owner-handoff`: `{enabled, configured, complete, mayIssue}`. Configured means valid durable state. No secret/hash parameters are exposed.
- `POST /api/admin/owner-invitation` with `{password}`: `{invitation, expiresAt}`. Existing owner session plus fresh password required; fixed 15-minute expiry.
- `DELETE /api/admin/owner-invitation` with `{password}`: `{revoked:true}` under the same authentication requirements.
- `POST /api/owner-handoff/redeem` with `{invitation,password}`: `{complete:true,loginRequired:true}`. Lowercase hexadecimal invitation; the UI normalizes pasted case.

Expected error bodies contain readable `error` plus stable `code`: `INVALID_INPUT` (400), `UNAUTHORIZED` (401), `INVALID_INVITATION` (409, including expired/unknown/replayed tokens), `HANDOFF_COMPLETE` (409), `RATE_LIMITED` (429), `HANDOFF_UNAVAILABLE` (503). Disabled mutation routes are 404. Database/network/parser failures use the shared error handler; a 5xx or lost response may have an uncertain outcome. Do not automatically replay redemption after an uncertain result: check login/status instead.

Issuance/revocation share an eight-attempt/15-minute IP bucket. Redemption has a separate bucket. The counter is updated before scrypt work. Invalid token digest/expiry is checked before hashing. Existing login throttling remains in place. Reverse-proxy trust must continue matching the deployed platform; these limits are not a distributed abuse-prevention service.

## In-flight mutation protection

Authenticated and temporary middleware establishes a request-local access context. The database wrapper accepts only explicitly whitelisted mutations: version-CAS content updates (CMS, calendar, private occupancy and marketing), marketing seed insertion, and media insertion. Unknown mutations in this context fail closed. A stale owner context must match a current unexpired session and security epoch; a temporary context must match its epoch and the still-open flag. Legacy contexts require absence of durable state.

SQLite executes each guarded statement in synchronous `BEGIN IMMEDIATE` / commit without yielding. PostgreSQL executes `SELECT ... FOR UPDATE` on the security singleton then the guarded mutation as two statements in a `ReadCommitted` transaction. Transfer updates that same security row. Thus a writer ordered before transfer commits before transfer, and a writer ordered after it sees the closed flag/new epoch and changes no rows. A stale statement snapshot alone would NOT provide this guarantee, hence the explicit transaction and shared lock. Epoch-bound login insertion uses the same lock and matches the verified password hash.

Every authorized password rotation, recovery, or other access-changing security update MUST increment the epoch atomically. Direct manual partial edits, deleting the singleton, or changing credentials/access while retaining the epoch are prohibited operational procedures. Fresh requests reject malformed state; a request already authorized before an out-of-band same-epoch corruption is not protected against arbitrary database-administrator intervention.

Read requests authorized before transfer may finish delivering their already-read data; revocation does not retract bytes already delivered. The fence prevents late commits, not cancellation of every in-flight read. Initial activation is an operator migration and must occur with traffic drained: a not-yet-created singleton cannot supply a PostgreSQL row lock against legacy requests during first initialization.

## Release blockers and recovery

1. Obtain explicit authorization for deployment, production schema changes/initialization, invitation issuance and its recipient/delivery channel. None is authorized or executed by this local preparation.
2. Establish a handoff-compatible rollback baseline FIRST. An older application release does not know about the singleton, epoch or closed flag and can reopen the static temporary access or accept the old environment password. A durable row alone cannot secure an old binary. Disable incompatible automatic rollbacks and prove every permitted rollback honors durable owner state. If this is not established, do not activate or issue an invitation.
3. Run the complete synthetic test suite and actual PostgreSQL integration suite against a disposable explicitly supplied test database. Verify the deployed adapter supports `ReadCommitted` transaction locking as used here. A skipped PostgreSQL suite is not a production pass.
4. Arrange a maintenance/drain window for initial durable-state creation, confirm the existing owner password hash and exact target out of band, and maintain `OWNER_HANDOFF_REQUIRED=1`. Do not initialize from an unauthenticated web route.
5. Confirm the owner can log in and use content/media/calendar with the current password before privately issuing an invitation. After redemption confirm old sessions/password fail, new owner login succeeds, and unauthenticated editors/unreferenced media are closed.
6. Keep database backups access-controlled. Do not roll back durable authentication state to an older credential/epoch. Recovery is a separately approved operation that must rotate credentials and epoch, revoke invitations, and preserve closed temporary access. No recovery bypass is provided. `scripts/setup.mjs` refuses legacy-only password changes whenever this mode is required or durable state exists.

The temporary access source flags remain unchanged for the legacy unactivated release. The handoff-compatible server additionally gates every applicable path with durable state.

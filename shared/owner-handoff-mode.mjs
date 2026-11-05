// Release selection is reviewed source code, never a request, environment flag,
// database row, or test override. Activation requires a separate reviewed build.
// A disabled artifact remains legacy-capable and MUST be excluded from routing
// and rollback targets before real activation. See docs/owner-handoff-backend.md.
export const OWNER_HANDOFF_MODE = 'disabled';
if (!['disabled', 'active'].includes(OWNER_HANDOFF_MODE)) {
  throw new Error('INVALID_OWNER_HANDOFF_RELEASE_MODE');
}
export const OWNER_HANDOFF_ACTIVE = OWNER_HANDOFF_MODE === 'active';

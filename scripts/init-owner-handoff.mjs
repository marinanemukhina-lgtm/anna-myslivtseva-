// Deliberate operator-only initialization. Never called by the app/start/build.
// No dotenv loading: operator must explicitly select the target environment.
import { database } from '../server/db.mjs';
import { validHash } from '../server/owner-handoff.mjs';
if (process.argv[2] !== '--initialize-existing-owner' || process.env.OWNER_HANDOFF_REQUIRED !== '1') {
  console.error('Explicit --initialize-existing-owner and OWNER_HANDOFF_REQUIRED=1 required.');
  process.exitCode=1;
} else if (!validHash(process.env.ADMIN_PASSWORD_HASH)) {
  console.error('Existing owner password hash is missing or invalid.');
  process.exitCode=1;
} else {
  const {query}=await database();
  const rows=await query("INSERT INTO owner_security (id,password_hash,epoch,complete,temporary_open) VALUES ('owner',$1,1,0,1) ON CONFLICT (id) DO NOTHING RETURNING id",[process.env.ADMIN_PASSWORD_HASH]);
  if (rows.length) console.log('Owner state initialized. Existing legacy sessions are invalid. No invitation issued.');
  else { console.error('Owner state already exists; unchanged.'); process.exitCode=1; }
}

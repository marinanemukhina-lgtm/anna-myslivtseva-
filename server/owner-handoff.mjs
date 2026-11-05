import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { database } from './db.mjs';
import { OWNER_HANDOFF_ACTIVE } from '../shared/owner-handoff-mode.mjs';
export async function enabled() { return OWNER_HANDOFF_ACTIVE; }
export const digest = value => createHash('sha256').update(value).digest('hex');
export const validHash = value => typeof value === 'string' && /^[a-f0-9]{32,128}:[a-f0-9]{128}$/i.test(value);
export function matches(password, encoded) {
  if (!validHash(encoded) || typeof password !== 'string' || password.length > 256) return false;
  const [salt, expected] = encoded.split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(expected, 'hex'));
}
export function encodePassword(password) {
  const salt = randomBytes(32).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export async function securityState() {
  if (!OWNER_HANDOFF_ACTIVE) return null;
  const { query } = await database();
  const [row] = await query("SELECT * FROM owner_security WHERE id='owner'");
  if (!row || !validHash(row.password_hash) || !Number.isSafeInteger(Number(row.epoch)) || Number(row.epoch) < 1 ||
      ![0,1].includes(row.complete) || ![0,1].includes(row.temporary_open) ||
      (Number(row.complete) === 1 && Number(row.temporary_open) !== 0) ||
      (row.invitation_hash === null && row.invitation_expires !== null) ||
      (row.invitation_hash !== null && !/^[a-f0-9]{64}$/.test(row.invitation_hash)) ||
      (row.invitation_hash !== null && (!Number.isSafeInteger(Number(row.invitation_expires)) || Number(row.invitation_expires) < 1)) ||
      (Number(row.complete) === 1 && row.invitation_hash !== null)) return null;
  return { ...row, epoch:Number(row.epoch), complete:Number(row.complete), temporary_open:Number(row.temporary_open) };
}
export async function temporaryAllowed() {
  if (!(await enabled())) return true;
  try { const state = await securityState(); return !!state && state.temporary_open === 1 && state.complete === 0; }
  catch { return false; }
}
const errors = {
  INVALID_INPUT: [400, 'Проверьте приглашение. Новый пароль должен отличаться от текущего и содержать от 12 до 256 символов.'],
  INVALID_INVITATION: [409, 'Приглашение недействительно или срок его действия истёк.'],
  UNAUTHORIZED: [401, 'Войдите снова и подтвердите текущий пароль.'],
  HANDOFF_UNAVAILABLE: [503, 'Передача доступа пока не настроена.'],
  HANDOFF_COMPLETE: [409, 'Передача доступа уже завершена.'],
  RATE_LIMITED: [429, 'Слишком много попыток. Повторите через 15 минут.'],
};
function reply(res, code) { const [status,error] = errors[code]; return res.status(status).json({error,code}); }
function exact(body, keys) { return body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === keys.length && keys.every(k => Object.hasOwn(body,k)); }
async function limited(req, scope) {
  const { query } = await database(), now=Date.now();
  const [row] = await query('INSERT INTO attempts (id,count,expires) VALUES ($1,1,$2) ON CONFLICT (id) DO UPDATE SET count=CASE WHEN attempts.expires<$3 THEN 1 ELSE attempts.count+1 END, expires=CASE WHEN attempts.expires<$4 THEN $5 ELSE attempts.expires END RETURNING count',
    [digest(`handoff:${scope}:${req.ip || 'unknown'}`),now+900000,now,now,now+900000]);
  return Number(row.count)>8;
}
export function registerOwnerHandoff(app, isAdmin) {
  if (!OWNER_HANDOFF_ACTIVE) return;
  app.get('/api/owner-handoff', async(req,res,next)=>{
    try {
      if (!(await enabled())) return res.json({enabled:false,configured:false,complete:false,mayIssue:false});
      const state=await securityState();
      res.json({enabled:true,configured:!!state,complete:!!state?.complete,mayIssue:!!state && !state.complete && await isAdmin(req)});
    } catch(e) { next(e); }
  });
  for (const method of ['post','delete']) app[method]('/api/admin/owner-invitation',async(req,res,next)=>{
    try {
      if (!(await enabled())) return res.sendStatus(404);
      if (!exact(req.body,['password']) || typeof req.body.password !== 'string' || req.body.password.length>256) return reply(res,'INVALID_INPUT');
      if (await limited(req,'issue')) return reply(res,'RATE_LIMITED');
      if (!(await isAdmin(req))) return reply(res,'UNAUTHORIZED');
      const state=await securityState();
      if (!state) return reply(res,'HANDOFF_UNAVAILABLE');
      if (state.complete) return reply(res,'HANDOFF_COMPLETE');
      if (state.epoch!==req.ownerEpoch || !matches(req.body.password,state.password_hash)) return reply(res,'UNAUTHORIZED');
      const invitation=method==='post'?randomBytes(32).toString('hex'):null;
      const expiresAt=Date.now()+900000;
      const {query}=await database();
      const rows=await query("UPDATE owner_security SET invitation_hash=$1,invitation_expires=$2 WHERE id='owner' AND epoch=$3 AND password_hash=$4 AND complete=0 AND EXISTS (SELECT 1 FROM owner_sessions WHERE id=$5 AND epoch=$6 AND expires>$7) RETURNING epoch",
        [invitation?digest(invitation):null,invitation?expiresAt:null,state.epoch,state.password_hash,req.ownerSessionId,state.epoch,Date.now()]);
      if (!rows.length) return reply(res,'UNAUTHORIZED');
      return res.json(invitation?{invitation,expiresAt:new Date(expiresAt).toISOString()}:{revoked:true});
    } catch(e) { next(e); }
  });
  app.post('/api/owner-handoff/redeem',async(req,res,next)=>{
    try {
      if (!(await enabled())) return res.sendStatus(404);
      if (!exact(req.body,['invitation','password']) || typeof req.body.invitation!=='string' || !/^[a-f0-9]{64}$/.test(req.body.invitation) || typeof req.body.password!=='string' || req.body.password.length<12 || req.body.password.length>256) return reply(res,'INVALID_INPUT');
      if (await limited(req,'redeem')) return reply(res,'RATE_LIMITED');
      const state=await securityState();
      if (!state) return reply(res,'HANDOFF_UNAVAILABLE');
      const tokenHash=digest(req.body.invitation);
      if (state.complete || state.invitation_hash!==tokenHash || Number(state.invitation_expires)<=Date.now()) return reply(res,'INVALID_INVITATION');
      // One atomic update consumes the invitation, rotates credentials and epoch,
      // and closes BOTH temporary editors. No auto-login and no env fallback.
      if (matches(req.body.password,state.password_hash)) return reply(res,'INVALID_INPUT');
      const encoded=encodePassword(req.body.password), {query}=await database();
      const rows=await query(OWNER_REDEEM_SQL,
        [encoded,state.epoch,tokenHash,Date.now(),state.password_hash,state.temporary_open]);
      if (!rows.length) return reply(res,'INVALID_INVITATION');
      res.json({complete:true,loginRequired:true});
    } catch(e) { next(e); }
  });
}

export const OWNER_REDEEM_SQL = "UPDATE owner_security SET password_hash=$1,epoch=epoch+1,complete=1,temporary_open=0,invitation_hash=NULL,invitation_expires=NULL WHERE id='owner' AND epoch=$2 AND complete=0 AND invitation_hash=$3 AND invitation_expires>$4 AND password_hash=$5 AND temporary_open=$6 RETURNING epoch";

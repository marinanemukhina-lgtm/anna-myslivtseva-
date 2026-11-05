import { mkdir } from "node:fs/promises";
import path from "node:path";
import { OWNER_HANDOFF_ACTIVE } from '../shared/owner-handoff-mode.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
export const accessContext = new AsyncLocalStorage();

import { initialContent } from "../shared/content.mjs";
let ready;
export function database() {
  if (!ready)
    ready = init().catch((e) => {
      ready = undefined;
      throw e;
    });
  return ready;
}
async function init() {
  let query, guarded;
  if (process.env.DATABASE_URL) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(process.env.DATABASE_URL);
    query = (s, args = []) => sql.query(s, args);
    guarded = async (statement, args) => {
      // Transaction-wide row lock orders legacy/public writes with transfer.
      // READ COMMITTED gives the second statement the newly committed state.
      const rows = await sql.transaction([
        sql.query("SELECT id FROM owner_security WHERE id='owner' FOR UPDATE"),
        sql.query(statement, args),
      ], { isolationLevel: 'ReadCommitted' });
      if (!Array.isArray(rows) || rows.length !== 2 || !rows.every(Array.isArray))
        throw new Error('INVALID_TRANSACTION_ACKNOWLEDGEMENT');
      return rows[1];
    };
  } else {
    if (process.env.VERCEL) throw new Error("STORAGE_NOT_CONFIGURED");
    const { DatabaseSync } = await import("node:sqlite");
    const dir = process.env.DATA_DIR || path.resolve(".data");
    await mkdir(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, "content.sqlite"));
    db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    query = async (s, args = []) => {
      const statement = db.prepare(s.replace(/\$\d+/g, "?"));
      return statement.columns().length
        ? statement.all(...args)
        : statement.run(...args);
    };
    guarded = async (statement,args) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const stmt=db.prepare(statement.replace(/\$\d+/g,'?'));
        const rows=stmt.all(...args);
        db.exec('COMMIT');
        return rows;
      } catch(e) { db.exec('ROLLBACK'); throw e; }
    };
  }
  if (OWNER_HANDOFF_ACTIVE) {
    await query(OWNER_SECURITY_DDL);
    await query(OWNER_SESSIONS_DDL);
  }
  await query(
    "CREATE TABLE IF NOT EXISTS content (id TEXT PRIMARY KEY, body TEXT NOT NULL, version INTEGER NOT NULL)",
  );
  await query(
    "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires BIGINT NOT NULL)",
  );
  await query(
    "CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, mime TEXT NOT NULL, body TEXT NOT NULL, name TEXT NOT NULL)",
  );
  await query(
    "CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires BIGINT NOT NULL)",
  );
  await query(
    "INSERT INTO content (id,body,version) VALUES ($1,$2,1) ON CONFLICT (id) DO NOTHING",
    ["main", JSON.stringify(initialContent)],
  );
  // Disabled releases use the exact legacy query adapter, without any guards.
  if (!OWNER_HANDOFF_ACTIVE) return { query };
  return { query: async (statement,args=[]) => {
    const context=accessContext.getStore();
    // Login is fenced even before a request has an authenticated context.
    if (statement === OWNER_SESSION_INSERT) return guarded(statement,args);
    if (!context || !/^(UPDATE|INSERT|DELETE|REPLACE)\b/i.test(statement)) return query(statement,args);
    const {statement:guardedStatement,args:values}=guardMutation(statement,args,context);
    return guarded(guardedStatement,values);
  } };
}
export async function readContent() {
  const { query } = await database();
  const [row] = await query("SELECT body,version FROM content WHERE id=$1", [
    "main",
  ]);
  return { data: JSON.parse(row.body), version: Number(row.version) };
}

export const OWNER_SESSION_INSERT = "INSERT INTO owner_sessions (id,expires,epoch) SELECT $1,$2,epoch FROM owner_security WHERE id='owner' AND epoch=$3 AND password_hash=$4 RETURNING id";
// Explicit whitelist: never try to infer arbitrary SQL structure. New request
// mutation forms must add a reviewed branch and regression test here.
export function guardMutation(statement,args,context) {
  if (!OWNER_HANDOFF_ACTIVE) return { statement, args };
  const values=[...args];
  const bind=value=>{ values.push(value); return '$'+values.length; };
  const predicate=context.legacy
    ? '1=0'
    : context.temporary
    ? "EXISTS (SELECT 1 FROM owner_security WHERE id='owner' AND complete=0 AND temporary_open=1 AND epoch="+bind(context.epoch)+")"
    : "EXISTS (SELECT 1 FROM owner_security JOIN owner_sessions ON owner_sessions.epoch=owner_security.epoch WHERE owner_security.id='owner' AND owner_security.epoch="+bind(context.epoch)+" AND owner_sessions.id="+bind(context.sessionId)+" AND owner_sessions.expires>"+bind(Date.now())+")";
  let output;
  if (statement === 'UPDATE content SET body=$1,version=version+1 WHERE id=$2 AND version=$3 RETURNING version')
    output='UPDATE content SET body=$1,version=version+1 WHERE id=$2 AND version=$3 AND '+predicate+' RETURNING version';
  else if (statement === 'INSERT INTO media (id,mime,body,name) VALUES ($1,$2,$3,$4)')
    output='INSERT INTO media (id,mime,body,name) SELECT $1,$2,$3,$4 WHERE '+predicate+' RETURNING id';
  else if (statement === 'INSERT INTO content (id,body,version) VALUES ($1,$2,1) ON CONFLICT (id) DO NOTHING')
    output='INSERT INTO content (id,body,version) SELECT $1,$2,1 WHERE '+predicate+' ON CONFLICT (id) DO NOTHING RETURNING id';
  else throw new Error('UNGUARDED_WRITE');
  return {statement:output,args:values};
}

export const OWNER_SECURITY_DDL = 'CREATE TABLE IF NOT EXISTS owner_security (id TEXT PRIMARY KEY, password_hash TEXT NOT NULL, epoch BIGINT NOT NULL, complete INTEGER NOT NULL, temporary_open INTEGER NOT NULL, invitation_hash TEXT, invitation_expires BIGINT)';
export const OWNER_SESSIONS_DDL = 'CREATE TABLE IF NOT EXISTS owner_sessions (id TEXT PRIMARY KEY, expires BIGINT NOT NULL, epoch BIGINT NOT NULL)';

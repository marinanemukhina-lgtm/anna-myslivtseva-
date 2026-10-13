import { mkdir } from "node:fs/promises";
import path from "node:path";
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
  let query;
  if (process.env.DATABASE_URL) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(process.env.DATABASE_URL);
    query = (s, args = []) => sql.query(s, args);
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
  return { query };
}
export async function readContent() {
  const { query } = await database();
  const [row] = await query("SELECT body,version FROM content WHERE id=$1", [
    "main",
  ]);
  return { data: JSON.parse(row.body), version: Number(row.version) };
}

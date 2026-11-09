import { postgresOptions } from "./storage-config.mjs";

// Official pg (PostgreSQL's native wire protocol over verified TLS), not pg-native
// or a Neon HTTP endpoint. The injection seam is for synthetic unit tests only.
export async function createPostgresAdapter(env, { PoolClass } = {}) {
  const options = postgresOptions(env);
  const Pool = PoolClass || (await import("pg")).Pool;
  const pool = new Pool(options);
  // pg emits idle-client errors. Consume them without logging URLs, SQL, values
  // or server detail; a subsequent requested operation will fail explicitly.
  pool.on("error", () => {});
  return {
    async query(sql, args = []) {
      try { return (await pool.query(sql, args)).rows; }
      catch { throw new Error("STORAGE_UNAVAILABLE"); }
    },
    async transaction(statements) {
      let client, commitStarted = false, destroy = false;
      try {
        client = await pool.connect();
        await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        const results = [];
        for (const { sql, args = [] } of statements) results.push((await client.query(sql, args)).rows);
        commitStarted = true;
        await client.query("COMMIT");
        return results;
      } catch {
        // Never retry a transaction. COMMIT may have reached the server even if
        // its acknowledgement was lost; caller retries must use idempotency keys.
        destroy = commitStarted;
        if (client && !commitStarted) {
          try { await client.query("ROLLBACK"); } catch { destroy = true; }
        }
        throw new Error(commitStarted ? "STORAGE_COMMIT_UNCONFIRMED" : "STORAGE_UNAVAILABLE");
      } finally { if (client) client.release(destroy); }
    },
    // Used by isolated tests and controlled process shutdown, never an endpoint.
    close: () => pool.end(),
  };
}

import { createHash } from "node:crypto";

// Pure data comparison only: no database clients, network, files, env, export or
// import side effects. Real-data use requires a separately approved migration.
const inventory = {
  content: { key: "id", columns: ["id", "body", "version"], integers: ["version"] },
  media: { key: "id", columns: ["id", "mime", "body", "name"], integers: [] },
  sessions: { key: "id", columns: ["id", "expires"], integers: ["expires"] },
  attempts: { key: "id", columns: ["id", "count", "expires"], integers: ["count", "expires"] },
  callback_consents: { key: "version", columns: ["version", "privacy_text", "consent_text", "created_at"], integers: ["created_at"] },
  callback_requests: { key: "id", columns: ["id", "phone", "consent_version", "fingerprint", "created_at", "status", "version"], integers: ["created_at", "version"] },
  callback_limits: { key: "id", columns: ["id", "count", "expires"], integers: ["count", "expires"] },
  anonymous_booking_state: { key: "id", columns: ["id", "revision", "body"], integers: ["revision"] },
};
function integer(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("MIGRATION_UNSAFE_INTEGER");
  if (!/^-?\d+$/.test(String(value))) throw new Error("MIGRATION_INVALID_INTEGER");
  return BigInt(value).toString();
}

export function migrationManifest(tables) {
  const manifest = {};
  for (const name of Object.keys(tables).sort()) {
    const schema = inventory[name];
    if (!schema || !Array.isArray(tables[name])) throw new Error("MIGRATION_UNEXPECTED_TABLE");
    const keys = new Set();
    const rows = tables[name].map((row) => {
      if (!row || Object.keys(row).sort().join("|") !== [...schema.columns].sort().join("|")) throw new Error("MIGRATION_SCHEMA_MISMATCH");
      if (typeof row[schema.key] !== "string" || keys.has(row[schema.key])) throw new Error("MIGRATION_INVALID_KEY");
      keys.add(row[schema.key]);
      const values = schema.columns.map((column) => {
        if (schema.integers.includes(column)) return integer(row[column]);
        if (typeof row[column] !== "string") throw new Error("MIGRATION_INVALID_TEXT");
        return row[column]; // Includes byte-exact JSON/base64 text; never publicContent().
      });
      return { key: row[schema.key], values };
    }).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    const hash = createHash("sha256").update(JSON.stringify(schema.columns));
    for (const { values } of rows) hash.update("\n").update(JSON.stringify(values));
    manifest[name] = { rows: rows.length, sha256: hash.digest("hex") };
  }
  return manifest;
}

export function compareMigrationManifests(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .filter((table) => !before[table] || !after[table] || before[table].rows !== after[table].rows || before[table].sha256 !== after[table].sha256);
}

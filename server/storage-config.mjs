import { X509Certificate } from "node:crypto";
import { checkServerIdentity } from "node:tls";

const fail = () => { throw new Error("STORAGE_CONFIGURATION_INVALID"); };

// Preserve the original default. Explicit selections never fall back when
// misspelled, incomplete, unavailable, or incompatible with this runtime.
export function storageDriver(env) {
  const driver = env.DATABASE_DRIVER === undefined ? (env.DATABASE_URL ? "neon" : "sqlite") : env.DATABASE_DRIVER;
  if (!["neon", "postgres", "sqlite"].includes(driver)) fail();
  if (driver === "sqlite") {
    if (env.VERCEL) throw new Error("STORAGE_NOT_CONFIGURED");
    if (env.DATABASE_URL) fail();
  } else if (!env.DATABASE_URL) fail();
  return driver;
}

export function postgresOptions(env) {
  if (storageDriver(env) !== "postgres" || env.NODE_TLS_REJECT_UNAUTHORIZED === "0") fail();
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { fail(); }
  // Deliberately no connectionString passed to pg: URL sslmode/sslcert/etc can
  // replace its ssl options. Reject ALL query options, socket paths and fragments.
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.password || url.search || url.hash || !/^\/[^/]+$/.test(url.pathname)) fail();
  let host, user, password, database;
  try {
    host = url.hostname.replace(/^\[|\]$/g, "");
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch { fail(); }
  if (![host, user, password, database].every((part) => part && !/[\u0000-\u001f\u007f]/.test(part)) || host.includes("/") || database.includes("/")) fail();
  const port = url.port ? Number(url.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail();
  const ca = env.DATABASE_TLS_CA_PEM;
  if (ca !== undefined) {
    if (typeof ca !== "string" || !ca.trim() || ca.length > 128 * 1024) fail();
    const certificates = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    if (!certificates?.length || ca.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g, "").trim()) fail();
    try { for (const certificate of certificates) new X509Certificate(certificate); } catch { fail(); }
  }
  return {
    host, port, user, password, database,
    ssl: {
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      ...(ca ? { ca } : {}),
      // Pin hostname checking to the explicit destination, including IP SANs.
      checkServerIdentity: (_serverName, certificate) => checkServerIdentity(host, certificate),
    },
    // Do not inherit PGOPTIONS, including a different or attacker-writable schema.
    options: "-c search_path=public",
    application_name: "anna-site",
    max: 4,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
    query_timeout: 20000,
    allowExitOnIdle: true,
  };
}

// Preserve the original empty Vercel demo only when no driver was selected.
export function allowsInitialContentFallback(env) {
  return env.DATABASE_DRIVER === undefined && Boolean(env.VERCEL) && !env.DATABASE_URL;
}

export function storageConfigurationReady(env) {
  try {
    if (storageDriver(env) === "postgres") postgresOptions(env);
    return true;
  } catch { return false; }
}

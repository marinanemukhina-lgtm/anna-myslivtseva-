import express from "express";
import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { database, readContent } from "./db.mjs";
import { TEMPORARY_CONTENT_ACCESS_ENABLED } from "./temporary-content-access.mjs";
import {
  callbackConsentSnapshot,
  callbackConsentUrl,
  callbackPrivacyUrl,
  callbackRetentionDays,
  callbackIdSchema,
  callbackPayloadSchema,
  callbackStatusSchema,
  normalizeCallbackPhone,
} from "../shared/callbacks.mjs";

const retentionMs = callbackRetentionDays * 24 * 60 * 60 * 1000;
const rateWindowMs = 15 * 60 * 1000;
const unavailable = "Заявки на обратный звонок пока недоступны. Вы можете позвонить по номеру на сайте.";
const pageSize = 50;
let tablesReady;

// Must run before the application's larger media JSON parser. Unrecognized keys,
// including free-text health information, are rejected and never persisted.
export function registerCallbackBodyLimit(app) {
  app.use(["/api/contact/callback", "/api/admin/callbacks"], express.json({ limit: "2kb" }));
}

async function storage() {
  const { query, transaction } = await database();
  if (!tablesReady) tablesReady = (async () => {
    await query(`CREATE TABLE IF NOT EXISTS callback_consents (
      version TEXT PRIMARY KEY,
      privacy_text TEXT NOT NULL,
      consent_text TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )`);
    await query(`CREATE TABLE IF NOT EXISTS callback_requests (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      consent_version TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('new','done')),
      version INTEGER NOT NULL
    )`);
    await query("CREATE INDEX IF NOT EXISTS callback_requests_created ON callback_requests (created_at, id)");
    await query(`CREATE TABLE IF NOT EXISTS callback_limits (
      id TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      expires BIGINT NOT NULL
    )`);
  })().catch((error) => { tablesReady = undefined; throw error; });
  await tablesReady;
  return { query, transaction };
}

// Export the exact production statements for isolated PostgreSQL concurrency
// checks. The first statement serializes with privacy/content edits. The second
// observes the post-lock ReadCommitted snapshot; SELECT alone is not enough.
export function callbackReleaseRevision(profile) {
  const privacy = profile?.privacy;
  const snapshot = callbackConsentSnapshot(profile);
  if (typeof privacy !== "string" || !privacy.trim() || !snapshot) return null;
  const version = createHash("sha256").update(JSON.stringify([privacy, snapshot])).digest("hex");
  return { version, consentText: snapshot.checkboxText, snapshot };
}

export function callbackInsertStatements(body, digest, now, contentVersion, privacyText, snapshot) {
  if (snapshot?.format !== "anna-callback-consent/v2" || !snapshot.operatorName || !snapshot.documentText ||
      body.consentVersion !== createHash("sha256").update(JSON.stringify([privacyText, snapshot])).digest("hex"))
    throw new Error("CALLBACK_CONSENT_SNAPSHOT_INVALID");
  // Reuse the existing TEXT column for a versioned envelope. Earlier plaintext
  // rows remain immutable/readable; no new schema or automatic data migration.
  const consentSnapshotText = JSON.stringify(snapshot);
  return [
    {
      sql: "UPDATE content SET version=version WHERE id=$1 AND version=$2 RETURNING version",
      args: ["main", contentVersion],
    },
    {
      sql: "INSERT INTO callback_consents (version,privacy_text,consent_text,created_at) SELECT $1,$2,$3,$4 FROM content WHERE id=$5 AND version=$6 ON CONFLICT (version) DO NOTHING RETURNING version",
      args: [body.consentVersion, privacyText, consentSnapshotText, now, "main", contentVersion],
    },
    {
      sql: "INSERT INTO callback_requests (id,phone,consent_version,fingerprint,created_at,status,version) SELECT $1,$2,$3,$4,$5,'new',1 FROM content WHERE id=$6 AND version=$7 ON CONFLICT (id) DO NOTHING RETURNING id,created_at,fingerprint",
      args: [body.requestId, normalizeCallbackPhone(body.phone), body.consentVersion, digest, now, "main", contentVersion],
    },
  ];
}

async function prune(query, now) {
  // Opportunistic deletion only: no claim of scheduled removal while idle, or
  // of removal from provider backups. The operator must arrange those separately.
  await query("DELETE FROM callback_requests WHERE created_at <= $1", [now - retentionMs]);
  // Owner-published policy/consent text contains no submitted callback numbers.
  // Keep these immutable revisions separately; deleting an "unreferenced"
  // revision here could race with a new request using the same accepted policy.
  await query("DELETE FROM callback_limits WHERE expires <= $1", [now]);
}

export function callbackConfiguredReason(env = process.env, openContentAccess = TEMPORARY_CONTENT_ACCESS_ENABLED) {
  if (env.CONTACT_CALLBACK_ENABLED !== "true") return "Приём заявок выключен.";
  if (openContentAccess) return "Для приёма заявок редактор сайта должен быть защищён входом владельца.";
  if (env.CONTACT_CALLBACK_DATA_APPROVED !== "true") return "Владелец ещё не подтвердил условия хранения и обработки номеров.";
  const parts = String(env.ADMIN_PASSWORD_HASH || "").split(":");
  if (parts.length !== 2 || !parts[0] || !/^[a-f0-9]{128}$/i.test(parts[1]))
    return "Защищённый доступ владельца ещё не настроен.";
  if (env.VERCEL && !env.DATABASE_URL) return "Постоянное хранилище ещё не подключено.";
  if (!/^[a-f0-9]{64}$/.test(env.CONTACT_CALLBACK_RELEASE_VERSION || ""))
    return "Выпуск этой версии документов ещё не подтверждён.";
  return "";
}

function disabledConfiguration(reason) {
  // Never disclose unpublished/partial consent, operator data or candidate hash.
  return { enabled: false, consentVersion: "", consentText: "", privacyUrl: callbackPrivacyUrl, consentUrl: callbackConsentUrl, reason };
}

async function configuration() {
  const reason = callbackConfiguredReason();
  if (reason) return disabledConfiguration(reason);
  const { data, version } = await readContent();
  const revision = callbackReleaseRevision(data.profile);
  if (!revision) return disabledConfiguration("Документы и сведения оператора ещё не опубликованы полностью.");
  if (process.env.CONTACT_CALLBACK_RELEASE_VERSION !== revision.version)
    return disabledConfiguration("Документы изменились. Приём заявок закрыт до подтверждения новой версии.");
  const { query } = await storage();
  await prune(query, Date.now());
  const config = { enabled: true, consentVersion: revision.version, consentText: revision.consentText, privacyUrl: callbackPrivacyUrl, consentUrl: callbackConsentUrl };
  Object.defineProperty(config, "contentVersion", { value: version });
  Object.defineProperty(config, "privacyText", { value: data.profile.privacy });
  Object.defineProperty(config, "consentSnapshot", { value: revision.snapshot });
  return config;
}

function fingerprint(body) {
  // Bind the exact accepted phone input and consent revision. Only the normalized
  // phone is retained; field order in JSON does not change the request identity.
  return createHash("sha256").update(JSON.stringify([body.phone, body.consent, body.consentVersion, body.website])).digest("hex");
}

function receipt(row) {
  return { ok: true, requestId: row.id, createdAt: new Date(Number(row.created_at)).toISOString() };
}

function requestView(row) {
  return { id: row.id, phone: row.phone, createdAt: new Date(Number(row.created_at)).toISOString(), status: row.status, version: Number(row.version) };
}

function duplicate(res, row, expectedFingerprint) {
  if (row.fingerprint !== expectedFingerprint)
    return res.status(409).json({ code: "IDEMPOTENCY_CONFLICT", error: "Этот запрос уже использован для других данных. Начните новую заявку." });
  return res.json(receipt(row));
}

async function savedRequest(query, id) {
  const [row] = await query("SELECT id,created_at,fingerprint FROM callback_requests WHERE id=$1", [id]);
  return row;
}

async function reserveRate(query, req, now) {
  const window = Math.floor(now / rateWindowMs);
  const expires = (window + 1) * rateWindowMs;
  // A keyed, window-specific digest prevents storing addresses or using a stable
  // cross-window visitor identifier. Ignore untrusted X-Forwarded-For; Express's
  // existing deployment-aware trust proxy policy determines req.ip.
  const addressKey = createHmac("sha256", process.env.ADMIN_PASSWORD_HASH)
    .update(`${window}:${req.ip || "unknown"}`).digest("hex");
  for (const [key, maximum] of [[`address:${window}:${addressKey}`, 5], [`site:${window}`, 100]]) {
    const rows = await query(
      "INSERT INTO callback_limits (id,count,expires) VALUES ($1,1,$2) ON CONFLICT (id) DO UPDATE SET count=callback_limits.count+1 WHERE callback_limits.count < $3 RETURNING count",
      [key, expires, maximum],
    );
    if (!rows.length) return Math.max(1, Math.ceil((expires - now) / 1000));
  }
  return 0;
}

const listQuerySchema = z.object({ cursor: z.string().max(200).optional() }).strict();
function parseCursor(value) {
  if (!value) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("INVALID_CURSOR");
  const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  if (!Array.isArray(decoded) || decoded.length !== 2 || !Number.isSafeInteger(decoded[0]) || decoded[0] < 0 || !callbackIdSchema.safeParse(decoded[1]).success)
    throw new Error("INVALID_CURSOR");
  return decoded;
}

export function registerCallbacks(app, requireAdmin) {
  app.get("/api/contact/config", async (_req, res) => {
    try { res.json(await configuration()); }
    catch {
      // The callback configuration fails closed without leaking storage details.
      res.json(disabledConfiguration(unavailable));
    }
  });

  app.post("/api/contact/callback", async (req, res, next) => {
    try {
      const config = await configuration();
      if (!config.enabled) return res.status(503).json({ code: "CALLBACK_DISABLED", error: unavailable });
      const parsed = callbackPayloadSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ code: "INVALID_CALLBACK", error: "Проверьте номер телефона и подтвердите согласие на его обработку." });
      const body = parsed.data;
      const digest = fingerprint(body);
      const { query, transaction } = await storage();
      const existing = await savedRequest(query, body.requestId);
      // A receipt already committed may be safely retrieved after a policy edit.
      // It does not create a new request or imply agreement to revised terms.
      if (existing) return duplicate(res, existing, digest);
      if (body.consentVersion !== config.consentVersion)
        return res.status(409).json({ code: "CONSENT_CHANGED", error: "Условия обработки номера изменились. Ознакомьтесь с ними и подтвердите согласие заново." });
      const now = Date.now();
      const retryAfter = await reserveRate(query, req, now);
      if (retryAfter) {
        const concurrent = await savedRequest(query, body.requestId);
        if (concurrent) return duplicate(res, concurrent, digest);
        res.set("Retry-After", String(retryAfter));
        return res.status(429).json({ code: "RATE_LIMITED", error: "Слишком много заявок. Попробуйте позже или позвоните по номеру на сайте." });
      }
      // INSERT is the durable commit boundary. No email, SMS, medical record,
      // appointment or external communication is created as a side effect.
      const [, , rows] = await transaction(callbackInsertStatements(body, digest, now, config.contentVersion, config.privacyText, config.consentSnapshot));
      if (rows.length) return res.status(201).json(receipt(rows[0]));
      const concurrent = await savedRequest(query, body.requestId);
      if (concurrent) return duplicate(res, concurrent, digest);
      // The content snapshot changed between reading consent and committing.
      // Fail closed even if the simultaneous CMS edit was unrelated to privacy.
      return res.status(409).json({ code: "CONSENT_CHANGED", error: "Условия сайта обновлены. Обновите форму и подтвердите согласие заново." });
    } catch (error) { next(error); }
  });

  // Deliberately require the real owner session, not temporaryContentAccess.
  app.get("/api/admin/callbacks", requireAdmin, async (req, res, next) => {
    try {
      const parsed = listQuerySchema.safeParse(req.query);
      let cursor;
      try { if (!parsed.success) throw new Error("INVALID_QUERY"); cursor = parseCursor(parsed.data.cursor); }
      catch { return res.status(400).json({ code: "INVALID_CURSOR", error: "Обновите список заявок." }); }
      const { query } = await storage();
      await prune(query, Date.now());
      const rows = cursor
        ? await query("SELECT id,phone,created_at,status,version FROM callback_requests WHERE created_at < $1 OR (created_at = $2 AND id < $3) ORDER BY created_at DESC,id DESC LIMIT $4", [cursor[0], cursor[0], cursor[1], pageSize + 1])
        : await query("SELECT id,phone,created_at,status,version FROM callback_requests ORDER BY created_at DESC,id DESC LIMIT $1", [pageSize + 1]);
      const shown = rows.slice(0, pageSize);
      const last = shown.at(-1);
      const config = await configuration();
      res.json({
        requests: shown.map(requestView),
        enabled: config.enabled,
        ...(config.reason ? { reason: config.reason } : {}),
        nextCursor: rows.length > pageSize ? Buffer.from(JSON.stringify([Number(last.created_at), last.id])).toString("base64url") : null,
      });
    } catch (error) { next(error); }
  });

  app.patch("/api/admin/callbacks/:id", requireAdmin, async (req, res, next) => {
    try {
      const parsed = callbackStatusSchema.safeParse(req.body);
      if (!callbackIdSchema.safeParse(req.params.id).success || !parsed.success)
        return res.status(400).json({ code: "INVALID_CALLBACK_STATUS", error: "Проверьте статус заявки и обновите список." });
      const { query } = await storage();
      await prune(query, Date.now());
      const rows = await query(
        "UPDATE callback_requests SET status=$1,version=version+1 WHERE id=$2 AND version=$3 RETURNING id,phone,created_at,status,version",
        [parsed.data.status, req.params.id, parsed.data.version],
      );
      if (rows.length) return res.json({ request: requestView(rows[0]) });
      const [existing] = await query("SELECT id FROM callback_requests WHERE id=$1", [req.params.id]);
      return existing
        ? res.status(409).json({ code: "VERSION_CONFLICT", error: "Заявка изменена в другой вкладке. Обновите список перед сохранением." })
        : res.status(404).json({ code: "CALLBACK_NOT_FOUND", error: "Заявка не найдена или срок её хранения истёк." });
    } catch (error) { next(error); }
  });
}

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { database, readContent } from "./db.mjs";
import { defaults, dateSchema, generateSlots } from "../shared/booking.mjs";

// Deliberately isolated prototype. A deployment without the exact flag has no
// clinical or public intake API. No free-form names, contacts or clinical notes.
export const demoEnabled = () => process.env.CLINICAL_DEMO_MODE === "synthetic-only";
const PERSONAS = ["Демо-клиент 001", "Демо-клиент 002", "Демо-клиент 003"];
const NOTE_OPTIONS = ["Тест: первичное наблюдение", "Тест: повторная процедура", "Тест: изменение показателя", "Тест: без изменений"];
const PROCEDURES = ["Демонстрационная процедура", "Повторный тестовый приём"];
const idSchema = z.string().uuid();
const bad = (res, msg = "Некорректные демонстрационные данные.") => res.status(400).json({ error: msg });
const fail = (next, error) => next(error);
const digest = (data) => createHash("sha256").update(data).digest("hex");

let ready;
async function store() {
  if (!ready) ready = (async () => {
    const db = await database();
    const statements = [
      "CREATE TABLE IF NOT EXISTS clinical_demo_clients (id TEXT PRIMARY KEY, label TEXT NOT NULL UNIQUE, created_at BIGINT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS clinical_demo_visits (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, date TEXT NOT NULL, procedure TEXT NOT NULL, note TEXT NOT NULL, pain INTEGER NOT NULL, mobility INTEGER NOT NULL, created_at BIGINT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS clinical_demo_photos (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, visit_id TEXT NOT NULL, mime TEXT NOT NULL, body TEXT NOT NULL, created_at BIGINT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS clinical_demo_requests (id TEXT PRIMARY KEY, persona TEXT NOT NULL, service_id TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, status TEXT NOT NULL, created_at BIGINT NOT NULL)",
      "CREATE UNIQUE INDEX IF NOT EXISTS clinical_demo_request_start ON clinical_demo_requests(starts_at) WHERE status <> 'cancelled'",
    ];
    for (const statement of statements) await db.query(statement);
    return db;
  })().catch((error) => { ready = undefined; throw error; });
  return ready;
}
const clientSchema = z.object({ label: z.enum(PERSONAS) }).strict();
const visitSchema = z.object({
  clientId: idSchema, date: dateSchema, procedure: z.enum(PROCEDURES),
  note: z.enum(NOTE_OPTIONS), pain: z.number().int().min(0).max(10),
  mobility: z.number().int().min(0).max(100),
}).strict();
const uploadSchema = z.object({
  clientId: idSchema, visitId: idSchema, mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
  base64: z.string().min(1).max(2 * 1024 * 1024),
}).strict();
const requestSchema = z.object({
  serviceId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  start: z.string().datetime({ offset: true }),
  persona: z.enum(PERSONAS),
}).strict();
const statuses = z.object({ status: z.enum(["pending", "confirmed", "cancelled"]) }).strict();

function testSchedule(content) {
  const actual = content.data.bookingSchedule ?? defaults();
  const services = actual.services.filter((s) => s.enabled && content.data.services.some((x) => x.id === s.serviceId && x.published));
  if (services.length && actual.timezone) {
    return { settings: actual, services: services.map((s) => ({
      ...s, title: content.data.services.find((x) => x.id === s.serviceId).title,
    })) };
  }
  // Explicit fictional fallback, never published to the real booking API.
  const fallback = defaults();
  fallback.timezone = "Europe/Moscow";
  fallback.services = [{ serviceId: "demo-session", durationMinutes: 60, bufferMinutes: 0, enabled: true }];
  fallback.weeklyHours = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [
    String(i), i === 0 || i === 6 ? [] : [{ start: "09:00", end: "18:00" }],
  ]));
  return { settings: fallback, services: [{ ...fallback.services[0], title: "Тестовая процедура (демо)" }] };
}
const overlaps = (a, b, c, d) => a < d && c < b;
async function options(serviceId, date) {
  const { settings, services } = testSchedule(await readContent());
  const service = services.find((s) => s.serviceId === serviceId);
  if (!service) return null;
  const slots = generateSlots(settings, service, date);
  const { query } = await store();
  const occupied = await query("SELECT starts_at,ends_at FROM clinical_demo_requests WHERE status <> $1", ["cancelled"]);
  return { settings, service, slots: slots.filter((slot) => !occupied.some((row) =>
    overlaps(Date.parse(slot.start), Date.parse(slot.end),
      Date.parse(row.starts_at), Date.parse(row.ends_at)))) };
}
async function snapshot() {
  const { query } = await store();
  const clients = await query("SELECT id,label,created_at FROM clinical_demo_clients ORDER BY label");
  const visits = await query("SELECT * FROM clinical_demo_visits ORDER BY date,id");
  const photos = await query("SELECT * FROM clinical_demo_photos ORDER BY created_at,id");
  const requests = await query("SELECT * FROM clinical_demo_requests ORDER BY starts_at,id");
  return { schema: "anna-synthetic-clinical-v1", clients, visits, photos, requests };
}
export function verifyClinicalBackup(backup) {
  if (!backup || backup.schema !== "anna-synthetic-backup-v1" || !backup.payload ||
      typeof backup.sha256 !== "string") return false;
  return digest(JSON.stringify(backup.payload)) === backup.sha256 &&
    backup.payload.schema === "anna-synthetic-clinical-v1" &&
    ["clients", "visits", "photos", "requests"].every((key) => Array.isArray(backup.payload[key]));
}
export function registerClinicalDemo(app, requireAdmin) {
  app.get("/api/demo/clinical/config", (_req, res) => res.json({
    enabled: demoEnabled(), syntheticOnly: true,
    message: "Только вымышленные записи. Реальные данные запрещены.",
  }));
  if (!demoEnabled()) return;
  // A restricted demo public surface; the real booking endpoints stay closed.
  app.get("/api/demo/booking/config", async (_req, res, next) => {
    try {
      const { settings, services } = testSchedule(await readContent());
      res.json({ enabled: true, timezone: settings.timezone,
        services: services.map(({ serviceId, title }) => ({ id: serviceId, title })),
        personas: PERSONAS });
    } catch (error) { fail(next, error); }
  });
  app.get("/api/demo/booking/availability", async (req, res, next) => {
    try {
      const parsed = z.object({ serviceId: requestSchema.shape.serviceId, date: dateSchema }).strict().safeParse(req.query);
      if (!parsed.success) return bad(res);
      const available = await options(parsed.data.serviceId, parsed.data.date);
      if (!available) return bad(res);
      res.json({ timezone: available.settings.timezone, slots: available.slots });
    } catch (error) { fail(next, error); }
  });
  app.post("/api/demo/booking/requests", async (req, res, next) => {
    try {
      const parsed = requestSchema.safeParse(req.body);
      if (!parsed.success) return bad(res);
      const { serviceId, start, persona } = parsed.data;
      const date = start.slice(0, 10); // UTC day could differ from practice day
      const { settings } = testSchedule(await readContent());
      const local = new Intl.DateTimeFormat("en-CA", {
        timeZone: settings.timezone, year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(new Date(start));
      const parts = Object.fromEntries(local.map((x) => [x.type, x.value]));
      const practiceDate = [parts.year, parts.month, parts.day].join("-");
      const available = await options(serviceId, practiceDate);
      const slot = available?.slots.find((x) => x.start === new Date(start).toISOString());
      if (!slot) return res.status(409).json({ error: "Это время уже занято или недоступно." });
      const { query } = await store();
      const id = randomUUID();
      try {
        await query("INSERT INTO clinical_demo_requests(id,persona,service_id,starts_at,ends_at,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [id, persona, serviceId, slot.start, slot.end, "pending", Date.now()]);
      } catch (error) {
        if (/UNIQUE|unique|duplicate key/i.test(error.message)) return res.status(409).json({ error: "Время уже занято." });
        throw error;
      }
      res.status(201).json({ id, status: "pending", start: slot.start, message: "Тестовая заявка создана. Приём не подтверждён." });
    } catch (error) { fail(next, error); }
  });
  app.get("/api/admin/clinical/clients", requireAdmin, async (_req, res, next) => {
    try { res.json({ clients: (await snapshot()).clients }); } catch (error) { fail(next, error); }
  });
  app.post("/api/admin/clinical/clients", requireAdmin, async (req, res, next) => {
    try {
      const parsed = clientSchema.safeParse(req.body);
      if (!parsed.success) return bad(res);
      const { query } = await store(); const id = randomUUID();
      const existing = await query("SELECT id FROM clinical_demo_clients WHERE label=$1", [parsed.data.label]);
      if (existing.length) return res.status(409).json({ error: "Такая тестовая карта уже существует." });
      await query("INSERT INTO clinical_demo_clients(id,label,created_at) VALUES ($1,$2,$3)", [id, parsed.data.label, Date.now()]);
      res.status(201).json({ id, label: parsed.data.label });
    } catch (error) { fail(next, error); }
  });
  app.get("/api/admin/clinical/clients/:id", requireAdmin, async (req, res, next) => {
    try {
      if (!idSchema.safeParse(req.params.id).success) return res.sendStatus(404);
      const { query } = await store();
      const [client] = await query("SELECT id,label,created_at FROM clinical_demo_clients WHERE id=$1", [req.params.id]);
      if (!client) return res.sendStatus(404);
      const visits = await query("SELECT * FROM clinical_demo_visits WHERE client_id=$1 ORDER BY date,id", [client.id]);
      const photos = await query("SELECT id,client_id,visit_id,mime,created_at FROM clinical_demo_photos WHERE client_id=$1 ORDER BY created_at,id", [client.id]);
      res.json({ client, visits, photos });
    } catch (error) { fail(next, error); }
  });
  app.post("/api/admin/clinical/visits", requireAdmin, async (req, res, next) => {
    try {
      const parsed = visitSchema.safeParse(req.body);
      if (!parsed.success) return bad(res);
      const { query } = await store();
      if (!(await query("SELECT id FROM clinical_demo_clients WHERE id=$1", [parsed.data.clientId])).length)
        return res.sendStatus(404);
      const id = randomUUID(), v = parsed.data;
      await query("INSERT INTO clinical_demo_visits(id,client_id,date,procedure,note,pain,mobility,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [id, v.clientId, v.date, v.procedure, v.note, v.pain, v.mobility, Date.now()]);
      res.status(201).json({ id });
    } catch (error) { fail(next, error); }
  });
  app.post("/api/admin/clinical/photos", requireAdmin, async (req, res, next) => {
    try {
      const parsed = uploadSchema.safeParse(req.body);
      if (!parsed.success) return bad(res);
      const v = parsed.data;
      const bytes = Buffer.from(v.base64, "base64");
      const magicOk = v.mime === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
        v.mime === "image/jpeg" ? bytes.subarray(0, 3).equals(Buffer.from([255,216,255])) :
          bytes.toString("ascii",0,4) === "RIFF" && bytes.toString("ascii",8,12) === "WEBP";
      if (!magicOk || bytes.length > 1024 * 1024 || !bytes.length ||
          bytes.toString("base64") !== v.base64) return bad(res, "Недопустимое изображение.");
      const { query } = await store();
      const [visit] = await query("SELECT client_id FROM clinical_demo_visits WHERE id=$1", [v.visitId]);
      if (!visit || visit.client_id !== v.clientId) return res.sendStatus(404);
      const id = randomUUID();
      await query("INSERT INTO clinical_demo_photos(id,client_id,visit_id,mime,body,created_at) VALUES ($1,$2,$3,$4,$5,$6)",
        [id, v.clientId, v.visitId, v.mime, v.base64, Date.now()]);
      res.status(201).json({ id, url: "/api/admin/clinical/photos/" + id });
    } catch (error) { fail(next, error); }
  });
  app.get("/api/admin/clinical/photos/:id", requireAdmin, async (req, res, next) => {
    try {
      if (!idSchema.safeParse(req.params.id).success) return res.sendStatus(404);
      const { query } = await store();
      const [row] = await query("SELECT mime,body FROM clinical_demo_photos WHERE id=$1", [req.params.id]);
      if (!row) return res.sendStatus(404);
      res.set({ "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": 'inline; filename="synthetic-photo"',
        "X-Content-Type-Options": "nosniff" });
      res.type(row.mime).send(Buffer.from(row.body, "base64"));
    } catch (error) { fail(next, error); }
  });
  app.get("/api/admin/clinical/requests", requireAdmin, async (_req, res, next) => {
    try { res.json({ requests: (await snapshot()).requests }); } catch (error) { fail(next, error); }
  });
  app.patch("/api/admin/clinical/requests/:id", requireAdmin, async (req, res, next) => {
    try {
      const parsed = statuses.safeParse(req.body);
      if (!idSchema.safeParse(req.params.id).success) return res.sendStatus(404);
      if (!parsed.success) return bad(res);
      const { query } = await store();
      const result = await query("UPDATE clinical_demo_requests SET status=$1 WHERE id=$2 RETURNING id,status",
        [parsed.data.status, req.params.id]);
      if (!result.length) return res.sendStatus(404);
      res.json(result[0]);
    } catch (error) { fail(next, error); }
  });
  app.get("/api/admin/clinical/export", requireAdmin, async (_req, res, next) => {
    try {
      const payload = await snapshot();
      const backup = { schema: "anna-synthetic-backup-v1",
        createdAt: new Date().toISOString(), payload, sha256: digest(JSON.stringify(payload)) };
      res.set({ "Content-Disposition": 'attachment; filename="anna-clinical-demo-backup.json"',
        "Content-Type": "application/json; charset=utf-8" });
      res.json(backup);
    } catch (error) { fail(next, error); }
  });
}

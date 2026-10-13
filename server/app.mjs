import express from "express";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { database, readContent } from "./db.mjs";
import {
  contentSchema,
  initialContent,
  publicContent,
} from "../shared/content.mjs";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const cookieName = "anna_admin";
function cookie(req) {
  return (
    (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(cookieName + "="))
      ?.split("=")
      .slice(1)
      .join("=") || ""
  );
}
function passwordMatches(password) {
  const [salt, expected] = String(process.env.ADMIN_PASSWORD_HASH || "").split(
    ":",
  );
  if (
    !salt ||
    !expected ||
    expected.length !== 128 ||
    typeof password !== "string" ||
    password.length > 256
  )
    return false;
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(expected, "hex"),
  );
}
async function isAdmin(req) {
  const token = cookie(req);
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const { query } = await database();
  const [s] = await query("SELECT expires FROM sessions WHERE id=$1", [
    hash(token),
  ]);
  return !!s && Number(s.expires) > Date.now();
}
async function requireAdmin(req, res, next) {
  try {
    if (!(await isAdmin(req)))
      return res.status(401).json({ error: "Войдите в панель управления." });
    next();
  } catch (e) {
    next(e);
  }
}
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", process.env.VERCEL ? 1 : false);
  app.use("/api", (_req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
    });
    next();
  });
  app.use(express.json({ limit: "4mb" }));
  app.use("/api", (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.headers.origin;
    const host = req.headers.host;
    try {
      if (
        !origin ||
        new URL(origin).host !== host ||
        req.headers["sec-fetch-site"] === "cross-site"
      )
        return res
          .status(403)
          .json({ error: "Запрос отклонён. Откройте панель на адресе сайта." });
    } catch {
      return res.status(403).json({ error: "Некорректный источник запроса." });
    }
    if (
      req.headers["content-type"]?.split(";")[0].trim() !== "application/json"
    )
      return res.status(415).json({ error: "Ожидается JSON." });
    next();
  });
  app.get("/api/content", async (req, res, next) => {
    try {
      if (process.env.VERCEL && !process.env.DATABASE_URL)
        return res.json(publicContent(initialContent));
      res.json(publicContent((await readContent()).data));
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/session", async (req, res, next) => {
    try {
      res.json({
        authenticated: await isAdmin(req),
        configured:
          !!process.env.ADMIN_PASSWORD_HASH &&
          (!process.env.VERCEL || !!process.env.DATABASE_URL),
      });
    } catch (e) {
      if (e.message === "STORAGE_NOT_CONFIGURED")
        res.json({ authenticated: false, configured: false });
      else next(e);
    }
  });
  app.post("/api/session", async (req, res, next) => {
    try {
      if (!process.env.ADMIN_PASSWORD_HASH)
        return res
          .status(503)
          .json({ error: "Пароль администратора ещё не настроен." });
      const { query } = await database();
      const key = hash(req.ip || "unknown");
      const now = Date.now();
      const [row] = await query(
        "INSERT INTO attempts (id,count,expires) VALUES ($1,1,$2) ON CONFLICT (id) DO UPDATE SET count=CASE WHEN attempts.expires<$3 THEN 1 ELSE attempts.count+1 END, expires=CASE WHEN attempts.expires<$4 THEN $5 ELSE attempts.expires END RETURNING count,expires",
        [key, now + 15 * 60000, now, now, now + 15 * 60000],
      );
      if (Number(row.count) > 8)
        return res
          .status(429)
          .json({ error: "Слишком много попыток. Повторите через 15 минут." });
      if (!passwordMatches(req.body?.password))
        return res.status(401).json({ error: "Неверный пароль." });
      await query("DELETE FROM attempts WHERE id=$1", [key]);
      await query("DELETE FROM sessions WHERE expires<$1", [now]);
      const token = randomBytes(32).toString("hex");
      await query("INSERT INTO sessions (id,expires) VALUES ($1,$2)", [
        hash(token),
        now + 8 * 3600000,
      ]);
      res.cookie(cookieName, token, {
        httpOnly: true,
        sameSite: "strict",
        secure: !!process.env.VERCEL || req.secure,
        maxAge: 8 * 3600000,
        path: "/",
      });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  app.delete("/api/session", async (req, res, next) => {
    try {
      const { query } = await database();
      await query("DELETE FROM sessions WHERE id=$1", [hash(cookie(req))]);
      res.clearCookie(cookieName, {
        path: "/",
        httpOnly: true,
        sameSite: "strict",
        secure: !!process.env.VERCEL || req.secure,
      });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/admin/content", requireAdmin, async (_req, res, next) => {
    try {
      res.json(await readContent());
    } catch (e) {
      next(e);
    }
  });
  app.put("/api/admin/content", requireAdmin, async (req, res, next) => {
    try {
      const parsed = contentSchema.safeParse(req.body?.data);
      const version = req.body?.version;
      if (!parsed.success || !Number.isSafeInteger(version) || version < 1)
        return res.status(400).json({
          error: parsed.error?.issues[0]?.message || "Некорректная версия.",
        });
      for (const collection of ["services", "news", "offers", "diplomas"])
        if (
          new Set(parsed.data[collection].map((x) => x.id)).size !==
          parsed.data[collection].length
        )
          return res.status(400).json({ error: "Повторяющиеся записи." });
      for (const collection of ["services", "news", "offers", "diplomas"])
        if (parsed.data[collection].some((x) => x.published && !x.title.trim()))
          return res
            .status(400)
            .json({ error: "У опубликованной записи должен быть заголовок." });
      const { query } = await database();
      const rows = await query(
        "UPDATE content SET body=$1,version=version+1 WHERE id=$2 AND version=$3 RETURNING version",
        [JSON.stringify(parsed.data), "main", version],
      );
      if (!rows.length)
        return res.status(409).json({
          error:
            "Сайт изменён в другой вкладке. Сохраните текст отдельно и обновите страницу.",
        });
      res.json({ data: parsed.data, version: Number(rows[0].version) });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/media", requireAdmin, async (req, res, next) => {
    try {
      const { base64, type, name } = req.body || {};
      if (
        typeof base64 !== "string" ||
        base64.length > 4 * 1024 * 1024 ||
        !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(
          type,
        )
      )
        return res
          .status(400)
          .json({ error: "Выберите JPG, PNG, WebP или PDF размером до 3 МБ." });
      const buffer = Buffer.from(base64, "base64");
      const valid =
        type === "image/jpeg"
          ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
          : type === "image/png"
            ? buffer
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : type === "image/webp"
              ? buffer.toString("ascii", 0, 4) === "RIFF" &&
                buffer.toString("ascii", 8, 12) === "WEBP"
              : buffer.toString("ascii", 0, 5) === "%PDF-";
      if (!valid || buffer.length > 3 * 1024 * 1024)
        return res
          .status(400)
          .json({ error: "Формат или размер файла не поддерживается." });
      const { query } = await database();
      const [{ total }] = await query("SELECT COUNT(*) AS total FROM media");
      if (Number(total) >= 500)
        return res
          .status(409)
          .json({ error: "Достигнут лимит медиатеки (500 файлов)." });
      const id = randomUUID();
      await query(
        "INSERT INTO media (id,mime,body,name) VALUES ($1,$2,$3,$4)",
        [id, type, base64, String(name || "Файл").slice(0, 200)],
      );
      res.status(201).json({ url: "/api/media/" + id, type, name });
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/media/:id", async (req, res, next) => {
    try {
      if (!/^[a-f0-9-]{36}$/.test(req.params.id)) return res.sendStatus(404);
      const url = "/api/media/" + req.params.id;
      const data = publicContent((await readContent()).data);
      const used =
        data.profile.portrait === url ||
        ["services", "news", "offers", "diplomas"].some((k) =>
          data[k].some((x) => x.image === url),
        );
      if (!used && !(await isAdmin(req))) return res.sendStatus(404);
      const { query } = await database();
      const [row] = await query(
        "SELECT mime,body,name FROM media WHERE id=$1",
        [req.params.id],
      );
      if (!row) return res.sendStatus(404);
      res.set("Content-Security-Policy", "default-src 'none'; sandbox");
      if (row.mime === "application/pdf")
        res.set("Content-Disposition", 'inline; filename="diploma.pdf"');
      res.type(row.mime).send(Buffer.from(row.body, "base64"));
    } catch (e) {
      next(e);
    }
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Страница не найдена." }),
  );
  app.use((e, _req, res, _next) => {
    const tooLarge = e.type === "entity.too.large";
    console.error("API:", e.message);
    res
      .status(tooLarge ? 413 : e.type === "entity.parse.failed" ? 400 : 503)
      .json({
        error: tooLarge
          ? "Файл слишком большой. Максимум — 3 МБ."
          : e.type === "entity.parse.failed"
            ? "Некорректный запрос."
            : "Сервис временно недоступен. Проверьте подключение хранилища.",
      });
  });
  return app;
}

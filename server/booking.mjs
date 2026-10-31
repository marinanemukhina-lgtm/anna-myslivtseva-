import { z } from "zod";
import { database, readContent } from "./db.mjs";
import {
  defaults,
  settingsSchema,
  dateSchema,
  generateSlots,
} from "../shared/booking.mjs";

const message = "Онлайн-запись ещё не подключена.";
const publicConfig = {
  ready: false,
  enabled: false,
  mode: "preparation",
  timezone: "",
  services: [],
  minDate: "",
  maxDate: "",
  message,
};

// Register before express.json: this release never accepts booking payloads.
// No administrator setting or environment flag enables patient intake.
export function closePublicIntake(app) {
  app.all("/api/booking/appointments", (_req, res) => {
    res.status(503).json({ code: "BOOKING_NOT_CONNECTED", error: message });
  });
  app.all("/api/booking/appointments/*path", (_req, res) => {
    res.status(503).json({ code: "BOOKING_NOT_CONNECTED", error: message });
  });
}

function snapshot(content) {
  return {
    settings: content.data.bookingSchedule ?? defaults(),
    version: content.version,
    serviceCatalog: content.data.services.map(({ id, title, published }) => ({
      id,
      title,
      published,
    })),
    activationBlocked: true,
    reasons: [message],
    mode: "preparation",
  };
}

const saveSchema = z.object({
  settings: settingsSchema,
  version: z.number().int().positive(),
}).strict();
const previewSchema = z.object({
  serviceId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  date: dateSchema,
}).strict();
const conflict = (res) => res.status(409).json({
  code: "VERSION_CONFLICT",
  error: "Сайт изменён в другой вкладке. Сохраните свои изменения отдельно и загрузите актуальную версию.",
});

export function registerBookingPreparation(app, requireAdmin) {
  app.get("/api/booking/config", (_req, res) => res.json(publicConfig));
  app.get("/api/booking/availability", (_req, res) =>
    res.json({ slots: [], ready: false, mode: "preparation" }),
  );
  app.get("/api/admin/booking", requireAdmin, async (_req, res, next) => {
    try {
      res.json(snapshot(await readContent()));
    } catch (error) {
      next(error);
    }
  });
  app.put("/api/admin/booking", requireAdmin, async (req, res, next) => {
    try {
      const parsed = saveSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({
          code: "INVALID_SETTINGS",
          error: "Проверьте часовой пояс, услуги, даты и интервалы расписания.",
        });
      const current = await readContent();
      if (current.version !== parsed.data.version) return conflict(res);
      const known = new Set(current.data.services.map((service) => service.id));
      if (parsed.data.settings.services.some((service) => !known.has(service.serviceId)))
        return res.status(400).json({
          code: "UNKNOWN_SERVICE",
          error: "Сначала добавьте услугу в разделе «Услуги и цены».",
        });
      const data = { ...current.data, bookingSchedule: parsed.data.settings };
      const { query } = await database();
      const rows = await query(
        "UPDATE content SET body=$1,version=version+1 WHERE id=$2 AND version=$3 RETURNING version",
        [JSON.stringify(data), "main", parsed.data.version],
      );
      if (!rows.length) return conflict(res);
      res.json(snapshot({ data, version: Number(rows[0].version) }));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/admin/booking/availability", requireAdmin, async (req, res, next) => {
    try {
      const parsed = previewSchema.safeParse(req.query);
      if (!parsed.success)
        return res.status(400).json({
          code: "INVALID_PREVIEW",
          error: "Выберите существующую дату и услугу.",
        });
      const current = await readContent();
      const settings = current.data.bookingSchedule ?? defaults();
      const service = settings.services.find((item) =>
        item.serviceId === parsed.data.serviceId && item.enabled,
      );
      if (!service || !current.data.services.some((item) => item.id === service.serviceId))
        return res.status(400).json({
          code: "UNKNOWN_SERVICE",
          error: "Настройте длительность услуги и включите её в расписание.",
        });
      res.json({
        date: parsed.data.date,
        timezone: settings.timezone,
        slots: generateSlots(settings, service, parsed.data.date),
        preview: true,
        message: "Предпросмотр расписания. Онлайн-запись ещё не подключена.",
      });
    } catch (error) {
      next(error);
    }
  });
}

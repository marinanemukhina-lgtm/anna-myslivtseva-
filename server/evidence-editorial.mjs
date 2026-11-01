import { evidenceDrafts } from "../editorial/evidence-drafts.mjs";
import { database, readContent } from "./db.mjs";

const catalog = new Map(evidenceDrafts.map(item => [item.id, item]));
export const evidenceIds = new Set(catalog.keys());

const respond = (res, status, error) => res.status(status).json({ error });

export function registerEvidenceEditorial(app, requireAdmin) {
  app.get("/api/admin/evidence/catalog", requireAdmin, async (_req, res, next) => {
    try {
      const current = await readContent();
      const existing = new Set(current.data.news.map(item => item.id));
      res.json({
        items: evidenceDrafts.map(({id,title,sources}) => ({
          id, title, sources, imported: existing.has(id), status: "requires-medical-review",
        })),
        message: "Только черновики. Публикация научных материалов заблокирована до отдельного медицинского утверждения.",
      });
    } catch (error) { next(error); }
  });
  app.post("/api/admin/evidence/import", requireAdmin, async (req, res, next) => {
    try {
      // No arbitrary user-supplied research text, external URLs or patient data accepted.
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
          Object.keys(req.body).length !== 1 || !Array.isArray(req.body.ids) ||
          !req.body.ids.length || req.body.ids.length > evidenceDrafts.length ||
          req.body.ids.some(id => typeof id !== "string" || !catalog.has(id)) ||
          new Set(req.body.ids).size !== req.body.ids.length)
        return respond(res,400,"Выберите существующие научные черновики.");
      const current = await readContent();
      const existing = new Set(current.data.news.map(item => item.id));
      const newlySelected = req.body.ids.filter(id => !existing.has(id));
      if (!newlySelected.length) return res.json({
        data: current.data, version: current.version, imported: [], skipped: req.body.ids,
      });
      const nextData = structuredClone(current.data);
      for (const id of newlySelected) {
        const { title, body } = catalog.get(id);
        nextData.news.push({ id, title, body, image:"", published:false, date:"" });
      }
      if (nextData.news.length > 200)
        return respond(res,409,"Превышен лимит записей в редакции.");
      const { query } = await database();
      const rows = await query(
        "UPDATE content SET body=$1,version=version+1 WHERE id=$2 AND version=$3 RETURNING version",
        [JSON.stringify(nextData),"main",current.version],
      );
      if (!rows.length) return respond(res,409,"Содержимое изменилось параллельно. Повторите импорт после обновления.");
      res.json({ data:nextData, version:Number(rows[0].version),
        imported:newlySelected, skipped:req.body.ids.filter(id=>existing.has(id)) });
    } catch(error) { next(error); }
  });
}

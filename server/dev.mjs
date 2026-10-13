import "dotenv/config";
import { createServer as createVite } from "vite";
import { createServer as createHttp } from "node:http";
import { createApp } from "./app.mjs";
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const host = value("--host", "0.0.0.0"),
  port = Number(value("--port", "4173"));
const app = createApp();
const server = createHttp(app);
// Never expose the local database or secrets through the development server.
app.use((req, res, next) => {
  const pathname = decodeURIComponent(req.path);
  if (
    pathname.includes("/.data") ||
    pathname.includes("/.env") ||
    pathname.includes("/.git")
  )
    return res.sendStatus(404);
  next();
});
const vite = await createVite({
  server: { middlewareMode: true, hmr: { server } },
  appType: "spa",
});
app.use(vite.middlewares);
server.listen(port, host, () => console.log(`Сайт запущен на порту ${port}`));
server.on("error", (e) => {
  console.error(e.message);
  process.exit(1);
});

import "dotenv/config";
import express from "express";
import path from "node:path";
import { createApp } from "./app.mjs";
const app = createApp();
app.use(express.static("dist/client"));
app.get("/{*path}", (_req, res) =>
  res.sendFile(path.resolve("dist/client/index.html")),
);
app.listen(Number(process.env.PORT || 4173), "0.0.0.0", () =>
  console.log("Сайт запущен"),
);

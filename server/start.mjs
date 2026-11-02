import "dotenv/config";
import express from "express";
import { createPageHandler } from "./page-response.mjs";
import { createApp } from "./app.mjs";
const app = createApp();
app.use(express.static("dist/client", { index: false }));
app.use(createPageHandler());
app.listen(Number(process.env.PORT || 4173), "0.0.0.0", () =>
  console.log("Сайт запущен"),
);

import "dotenv/config";
import express from "express";
import { createApp } from "./app.mjs";
const app = createApp();
app.use(express.static("dist/client"));
app.use((_req, res) => res.status(404).send("Страница не найдена."));
app.listen(Number(process.env.PORT || 4173), "0.0.0.0", () =>
  console.log("Сайт запущен"),
);

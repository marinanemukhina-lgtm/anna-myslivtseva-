import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/cormorant-garamond/cyrillic-500.css";
import "@fontsource/cormorant-garamond/latin-500.css";
import "@fontsource/inter/cyrillic-400.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/cyrillic-500.css";
import "@fontsource/inter/latin-500.css";
import App from "./App.jsx";
const setup = window.location.pathname.replace(/\/$/, "") === "/admin/setup";
const AdminSetup = lazy(() => import("./AdminSetup.jsx"));
if (setup) {
  document.documentElement.lang = "ru";
  document.title = "Подготовка пароля · Анна Мысливцева";
}
createRoot(document.getElementById("root")).render(
  setup ? <Suspense fallback={<p role="status">Загрузка настройки…</p>}><AdminSetup /></Suspense> : <App />,
);

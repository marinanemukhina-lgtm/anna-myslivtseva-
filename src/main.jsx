import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/cormorant-garamond/cyrillic-500.css";
import "@fontsource/cormorant-garamond/latin-500.css";
import "@fontsource/inter/cyrillic-400.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/cyrillic-500.css";
import "@fontsource/inter/latin-500.css";
import App from "./App.jsx";
const path = window.location.pathname.replace(/\/$/, "");
const setup = path === "/admin/setup";
const claim = path === "/admin/claim";
const OwnerClaim = lazy(() => import("./OwnerClaim.jsx"));
const AdminSetup = lazy(() => import("./AdminSetup.jsx"));
if (claim) {
  document.documentElement.lang = "ru";
  document.title = "Доступ владельца · Анна Мысливцева";
}
if (setup) {
  document.documentElement.lang = "ru";
  document.title = "Подготовка пароля · Анна Мысливцева";
}
createRoot(document.getElementById("root")).render(
  claim ? <Suspense fallback={<p role="status">Загрузка настройки…</p>}><OwnerClaim /></Suspense> : setup ? <Suspense fallback={<p role="status">Загрузка настройки…</p>}><AdminSetup /></Suspense> : <App />,
);

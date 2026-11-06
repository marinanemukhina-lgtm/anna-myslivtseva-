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
const demo = window.location.pathname.replace(/\/$/, "") === "/demo/booking";
const patients = ['/admin/patients', '/demo/patients'].includes(window.location.pathname.replace(/\/$/, ''));
const ClinicalDemo = lazy(() => import('./ClinicalDemo.jsx'));
const BookingDemo = lazy(() => import('./booking-demo-main.jsx').then(module => ({ default: module.Demo })));
const AdminSetup = lazy(() => import("./AdminSetup.jsx"));
if (setup) {
  document.documentElement.lang = "ru";
  document.title = "Подготовка пароля · Анна Мысливцева";
}
createRoot(document.getElementById("root")).render(
  patients ? <Suspense fallback={<p role="status">Загрузка историй…</p>}><ClinicalDemo /></Suspense> : demo ? <Suspense fallback={<p role="status">Загрузка демо…</p>}><BookingDemo transport="browser" /></Suspense> : setup ? <Suspense fallback={<p role="status">Загрузка настройки…</p>}><AdminSetup /></Suspense> : <App />,
);
